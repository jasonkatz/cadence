import { workflowDao as defaultWorkflowDao } from "../dao/workflow-dao";
import { stepDao as defaultStepDao } from "../dao/step-dao";
import { eventBus as defaultEventBus } from "../events/event-bus";
import type { OrchestratorHooks } from "../workflows/orchestrator";
import { logger } from "../utils/logger";

/**
 * Translates orchestrator hook callbacks into SQLite writes + SSE events.
 * Idempotent on (workflowId, iteration, type): safe to re-invoke during
 * WDK replay, because we upsert step rows rather than blindly inserting.
 *
 * SQLite is the user-facing index for `tmpo list` / `tmpo status` / web UI.
 * The WDK event log remains the execution source of truth; this adapter
 * keeps SQLite eventually-consistent with it.
 */
export interface IndexSyncDeps {
  workflowDao: Pick<
    typeof defaultWorkflowDao,
    "findById" | "updateStatus" | "updateProposal" | "updateError" | "updatePrNumber" | "updateIteration"
  >;
  stepDao: Pick<typeof defaultStepDao, "findByWorkflowId" | "createIterationSteps" | "updateStatus">;
  eventBus: Pick<typeof defaultEventBus, "emit">;
}

export interface IndexSync {
  hooksFor(workflowId: string): OrchestratorHooks;
}

export function createIndexSync(deps: IndexSyncDeps): IndexSync {
  const typeToStepId = new Map<string, Map<string, string>>();
  const ensuredIterations = new Map<string, Set<number>>();

  async function ensureIteration(workflowId: string, iteration: number): Promise<void> {
    const seen = ensuredIterations.get(workflowId) ?? new Set<number>();
    if (seen.has(iteration)) return;
    seen.add(iteration);
    ensuredIterations.set(workflowId, seen);

    // Look for existing step rows (idempotency: handle replays).
    const existing = await deps.stepDao.findByWorkflowId(workflowId, { iteration });
    if (existing.length === 0) {
      const created = await deps.stepDao.createIterationSteps(workflowId, iteration);
      const map = typeToStepId.get(workflowId) ?? new Map<string, string>();
      for (const s of created) {
        map.set(stepKey(s.iteration, s.type), s.id);
      }
      typeToStepId.set(workflowId, map);
    } else {
      const map = typeToStepId.get(workflowId) ?? new Map<string, string>();
      for (const s of existing) {
        map.set(stepKey(s.iteration, s.type), s.id);
      }
      typeToStepId.set(workflowId, map);
    }
  }

  async function resolveStepId(
    workflowId: string,
    iteration: number,
    type: string
  ): Promise<string | null> {
    await ensureIteration(workflowId, iteration);
    const map = typeToStepId.get(workflowId);
    return map?.get(stepKey(iteration, type)) ?? null;
  }

  return {
    hooksFor(workflowId: string): OrchestratorHooks {
      // Kick off hook dispatches in parallel — order-within-a-step is
      // guaranteed by awaiting in the orchestrator; cross-hook ordering is
      // maintained by `lastPromise` chaining so SQLite writes remain
      // sequential for a given workflow.
      let lastPromise: Promise<void> = Promise.resolve();
      const chain = (fn: () => Promise<void>): void => {
        lastPromise = lastPromise.then(fn).catch((error) => {
          logger.error("Index sync error", {
            workflowId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      };

      return {
        onStepStart(type, iteration) {
          chain(async () => {
            const stepId = await resolveStepId(workflowId, iteration, type);
            if (!stepId) return;
            await deps.stepDao.updateStatus(stepId, "running");
            deps.eventBus.emit({
              type: "step:updated",
              workflowId,
              data: { stepId, type, status: "running" },
            });

            // Transition workflow to running if this is the first step.
            const wf = await deps.workflowDao.findById(workflowId);
            if (wf && wf.status === "pending") {
              await deps.workflowDao.updateStatus(workflowId, "running");
              deps.eventBus.emit({
                type: "workflow:updated",
                workflowId,
                data: { status: "running" },
              });
            }
          });
        },
        onStepEnd(type, iteration, result) {
          chain(async () => {
            const stepId = await resolveStepId(workflowId, iteration, type);
            if (!stepId) return;
            const status = result.ok ? "passed" : "failed";
            await deps.stepDao.updateStatus(stepId, status, result.detail);
            deps.eventBus.emit({
              type: "step:updated",
              workflowId,
              data: { stepId, type, status },
            });
          });
        },
        onProposal(proposal) {
          chain(async () => {
            await deps.workflowDao.updateProposal(workflowId, proposal);
          });
        },
        onPrCreated(prNumber, prUrl) {
          chain(async () => {
            await deps.workflowDao.updatePrNumber(workflowId, prNumber);
            deps.eventBus.emit({
              type: "workflow:updated",
              workflowId,
              data: { status: "running", pr_number: prNumber, pr_url: prUrl },
            });
          });
        },
        onIteration(iteration, failureDetail) {
          chain(async () => {
            await deps.workflowDao.updateIteration(workflowId, iteration);
            deps.eventBus.emit({
              type: "workflow:updated",
              workflowId,
              data: { regression: true, iteration, failureDetail },
            });
          });
        },
        onComplete(prNumber) {
          chain(async () => {
            await deps.workflowDao.updateStatus(workflowId, "complete");
            deps.eventBus.emit({
              type: "workflow:completed",
              workflowId,
              data: { status: "complete", pr_number: prNumber },
            });
          });
        },
        onFail(error) {
          chain(async () => {
            await deps.workflowDao.updateError(workflowId, error);
            deps.eventBus.emit({
              type: "workflow:completed",
              workflowId,
              data: { status: "failed", error },
            });
          });
        },
      };
    },
  };
}

function stepKey(iteration: number, type: string): string {
  return `${iteration}:${type}`;
}

let activeIndexSync: IndexSync | null = null;

export function setIndexSync(sync: IndexSync): void {
  activeIndexSync = sync;
}

export function getIndexSync(): IndexSync {
  if (activeIndexSync) return activeIndexSync;
  activeIndexSync = createIndexSync({
    workflowDao: defaultWorkflowDao,
    stepDao: defaultStepDao,
    eventBus: defaultEventBus,
  });
  return activeIndexSync;
}

export function resetIndexSync(): void {
  activeIndexSync = null;
}
