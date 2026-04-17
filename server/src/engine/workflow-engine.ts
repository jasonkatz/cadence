import path from "path";
import os from "os";
import { mkdirSync } from "fs";
import { workflowDao as defaultWorkflowDao } from "../dao/workflow-dao";
import { stepDao as defaultStepDao } from "../dao/step-dao";
import { runDao as defaultRunDao } from "../dao/run-dao";
import { eventBus as defaultEventBus } from "../events/event-bus";
import { createIndexSync, setIndexSync, type IndexSync } from "./index-sync";
import {
  createDiskPidRegistry,
  reapOrphanSubprocesses,
  type PidRegistry,
} from "./subprocess-reaper";
import { runWorkflow } from "../workflows/run-workflow";
import { contextFromWorkflow, type WorkflowContext } from "../workflows/types";
import { setStepPidRegistry } from "../workflows/steps";
import { logger } from "../utils/logger";

/**
 * Backend for starting/resuming durable workflows. Injected into the engine
 * so tests can stub out the WDK runtime without loading the real SDK.
 *
 * `cancel` takes a WDK runId (the value returned from `start()`), not our
 * workflowId — the engine owns the workflowId → runId translation.
 */
export interface WorkflowBackend {
  start(workflowFn: (ctx: WorkflowContext) => Promise<unknown>, args: [WorkflowContext]): Promise<{ runId: string }>;
  /**
   * Scans the durable store for non-terminal runs and re-enqueues them.
   * Under `@workflow/world-local` this is called automatically by
   * `localWorld.start()`. Here we expose it explicitly so the engine can
   * sequence reaper → sync → resume on boot.
   */
  resumeActive(): Promise<void>;
  cancel(runId: string): Promise<void>;
  close(): Promise<void>;
}

export interface EngineDeps {
  workflowDao: typeof defaultWorkflowDao;
  stepDao: typeof defaultStepDao;
  runDao: typeof defaultRunDao;
  eventBus: typeof defaultEventBus;
  backend: WorkflowBackend;
  pidRegistry: PidRegistry;
  indexSync: IndexSync;
}

export interface Engine {
  start(): Promise<void>;
  stop(): Promise<void>;
  enqueueWorkflow(workflowId: string, iteration: number): Promise<void>;
  cancelWorkflowJobs(workflowId: string): Promise<void>;
  activeCount(): Promise<number>;
  deps: EngineDeps;
}

/**
 * Loads the WDK runtime and returns a backend bound to a
 * `@workflow/world-local` instance rooted at `~/.tmpo/workflow-data`.
 * Throws if the SDK is not installed — durability is the whole point of
 * this engine, so booting without it would silently violate the PR's
 * acceptance criteria. Set `TMPO_ALLOW_EPHEMERAL=1` to opt into the
 * in-process (non-durable) backend for CI or smoke tests.
 */
async function defaultBackend(): Promise<WorkflowBackend> {
  if (process.env.TMPO_ALLOW_EPHEMERAL === "1") {
    logger.warn(
      "TMPO_ALLOW_EPHEMERAL=1 set — using in-process backend with NO durability"
    );
    return createInProcessBackend();
  }

  const dataDir = path.join(os.homedir(), ".tmpo", "workflow-data");
  mkdirSync(dataDir, { recursive: true });
  // Route Local World's state under ~/.tmpo/ so it lives alongside SQLite
  // and run logs. WORKFLOW_LOCAL_DATA_DIR is consumed by @workflow/world-local
  // on import; setting it before import is required.
  process.env.WORKFLOW_LOCAL_DATA_DIR = dataDir;
  process.env.WORKFLOW_TARGET_WORLD = process.env.WORKFLOW_TARGET_WORLD || "local";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (await import("workflow/api" as any)) as {
    start: (fn: unknown, args: unknown[]) => Promise<{ runId: string }>;
    cancelRun: (runId: string) => Promise<void>;
    reenqueueActiveRuns?: () => Promise<void>;
    getRun?: (runId: string) => Promise<{ status: string }>;
  };
  let world: { start?: () => Promise<void>; close?: () => Promise<void> } | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wlocal = await import("@workflow/world-local" as any);
    if (typeof wlocal.createLocalWorld === "function") {
      world = wlocal.createLocalWorld({ dataDir });
      // NB: `world.start()` triggers re-enqueueing of any active runs left
      // from the previous daemon lifecycle. Defer it to `resumeActive()`
      // below so the engine's boot sequence can reap orphan subprocesses
      // BEFORE any step is replayed — otherwise a replayed spawn could
      // match the surviving orphan's sentinel argv and collide.
    }
  } catch {
    // world-local optional — the api module may already have configured
    // the world from WORKFLOW_TARGET_WORLD env.
  }

  return {
    async start(workflowFn, args) {
      return api.start(workflowFn, args);
    },
    async resumeActive() {
      // `world.start()` internally scans `runs/` for non-terminal state and
      // re-enqueues them. Must run AFTER the subprocess reaper (enforced by
      // engine.start()'s call order).
      if (world && typeof world.start === "function") {
        await world.start();
      }
      if (api.reenqueueActiveRuns) {
        await api.reenqueueActiveRuns();
      }
    },
    async cancel(runId) {
      await api.cancelRun(runId);
    },
    async close() {
      if (world && typeof world.close === "function") {
        await world.close();
      }
    },
  };
}

/**
 * Ephemeral, in-process backend. Runs the workflow body directly with no
 * durability — workflows do NOT survive a daemon restart. Only used when
 * `TMPO_ALLOW_EPHEMERAL=1` is set (CI smoke tests, local dev without the
 * WDK installed).
 */
function createInProcessBackend(): WorkflowBackend {
  return {
    async start(workflowFn, args) {
      const [ctx] = args;
      const runId = (ctx as WorkflowContext).workflowId;
      Promise.resolve()
        .then(() => workflowFn(ctx))
        .catch((error) => {
          logger.error("In-process workflow failed", {
            runId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return { runId };
    },
    async resumeActive() {
      // No durable state to resume.
    },
    async cancel() {
      // In-process fallback can't selectively cancel.
    },
    async close() {},
  };
}

export async function createEngine(
  overrideDeps?: Partial<EngineDeps>
): Promise<Engine> {
  const pidRegistry = overrideDeps?.pidRegistry ?? createDiskPidRegistry();
  // Publish the registry to the step module so each agent spawn records its
  // pid without having to plumb the registry through every step signature.
  setStepPidRegistry(pidRegistry);
  const indexSync =
    overrideDeps?.indexSync ??
    createIndexSync({
      workflowDao: overrideDeps?.workflowDao ?? defaultWorkflowDao,
      stepDao: overrideDeps?.stepDao ?? defaultStepDao,
      runDao: overrideDeps?.runDao ?? defaultRunDao,
      eventBus: overrideDeps?.eventBus ?? defaultEventBus,
    });
  setIndexSync(indexSync);

  const backend = overrideDeps?.backend ?? (await defaultBackend());

  const deps: EngineDeps = {
    workflowDao: overrideDeps?.workflowDao ?? defaultWorkflowDao,
    stepDao: overrideDeps?.stepDao ?? defaultStepDao,
    runDao: overrideDeps?.runDao ?? defaultRunDao,
    eventBus: overrideDeps?.eventBus ?? defaultEventBus,
    backend,
    pidRegistry,
    indexSync,
  };

  // WDK returns its own runId from start(); cancelRun() requires that runId,
  // not our workflowId. Map is populated on enqueueWorkflow and consulted by
  // cancelWorkflowJobs. Entries are pruned lazily — if WDK rejects a cancel
  // for an already-terminated run, we just drop the entry.
  const workflowToRun = new Map<string, string>();

  return {
    async start(): Promise<void> {
      // Reap any orphan subprocesses BEFORE re-enqueueing runs so a replayed
      // step can't collide with a surviving child from the previous daemon
      // lifecycle.
      await reapOrphanSubprocesses({ registry: pidRegistry });
      await deps.backend.resumeActive();
      logger.info("Workflow engine started (Vercel Workflow SDK)");
    },
    async stop(): Promise<void> {
      await deps.backend.close();
      logger.info("Workflow engine stopped");
    },
    async enqueueWorkflow(workflowId: string): Promise<void> {
      const workflow = await deps.workflowDao.findById(workflowId);
      if (!workflow) {
        throw new Error(`Workflow ${workflowId} not found`);
      }
      const ctx = contextFromWorkflow(workflow);
      const { runId } = await deps.backend.start(runWorkflow, [ctx]);
      workflowToRun.set(workflowId, runId);
    },
    async cancelWorkflowJobs(workflowId: string): Promise<void> {
      const runId = workflowToRun.get(workflowId);
      if (!runId) {
        // No runId means the workflow was never started under this daemon's
        // lifetime (e.g. it was left over from a previous boot and we're
        // being asked to cancel before resumeActive has registered its
        // replay). Callers still update SQLite status directly.
        throw new Error(
          `Cannot cancel workflow ${workflowId}: no active run tracked by this engine`
        );
      }
      try {
        await deps.backend.cancel(runId);
      } finally {
        workflowToRun.delete(workflowId);
      }
    },
    async activeCount(): Promise<number> {
      // SQLite is the user-facing source of truth for run state; the
      // index-sync adapter keeps it consistent with WDK's event log.
      // Querying here avoids having to track a second in-memory set that
      // must be kept in sync with terminal lifecycle events.
      return deps.workflowDao.countByStatus("running");
    },
    deps,
  };
}
