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
import { logger } from "../utils/logger";

/**
 * Backend for starting/resuming durable workflows. Injected into the engine
 * so tests can stub out the WDK runtime without loading the real SDK.
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
  cancel(workflowId: string): Promise<void>;
  /** Approximate count of runs currently executing — used by daemon shutdown. */
  activeCount(): number;
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
  activeCount(): number;
  deps: EngineDeps;
}

/**
 * Resolves the WDK `workflow/api` module lazily so test environments without
 * the beta SDK installed don't fail to import the engine. Returns a backend
 * bound to a `@workflow/world-local` instance rooted at `~/.tmpo/workflow-data`.
 */
async function defaultBackend(): Promise<WorkflowBackend> {
  const dataDir = path.join(os.homedir(), ".tmpo", "workflow-data");
  mkdirSync(dataDir, { recursive: true });
  // Route Local World's state under ~/.tmpo/ so it lives alongside SQLite
  // and run logs. WORKFLOW_LOCAL_DATA_DIR is consumed by @workflow/world-local
  // on import; setting it before import is required.
  process.env.WORKFLOW_LOCAL_DATA_DIR = dataDir;
  process.env.WORKFLOW_TARGET_WORLD = process.env.WORKFLOW_TARGET_WORLD || "local";

  let api: {
    start: (fn: unknown, args: unknown[]) => Promise<{ runId: string }>;
    cancelRun: (runId: string) => Promise<void>;
    reenqueueActiveRuns?: () => Promise<void>;
    getRun?: (runId: string) => Promise<{ status: string }>;
  };
  let world: { start?: () => Promise<void>; close?: () => Promise<void> } | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    api = await import("workflow/api" as any);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wlocal = await import("@workflow/world-local" as any);
      if (typeof wlocal.createLocalWorld === "function") {
        world = wlocal.createLocalWorld({ dataDir });
        if (world && typeof world.start === "function") {
          await world.start();
        }
      }
    } catch {
      // world-local optional — the api module may already have configured
      // the world from WORKFLOW_TARGET_WORLD env.
    }
  } catch (error) {
    logger.error("Failed to load Vercel Workflow SDK (falling back to in-process runner)", {
      error: error instanceof Error ? error.message : String(error),
    });
    return createInProcessBackend();
  }

  const activeRuns = new Map<string, Promise<unknown>>();

  return {
    async start(workflowFn, args) {
      const run = await api.start(workflowFn, args);
      return { runId: run.runId };
    },
    async resumeActive() {
      if (api.reenqueueActiveRuns) {
        await api.reenqueueActiveRuns();
      }
    },
    async cancel(workflowId) {
      // Best-effort: if the SDK exposes cancelRun and we have a known run id,
      // send a cancel; otherwise this is a no-op and the caller must mark the
      // workflow cancelled in SQLite directly.
      try {
        await api.cancelRun(workflowId);
      } catch {
        // no-op
      }
    },
    activeCount() {
      return activeRuns.size;
    },
    async close() {
      if (world && typeof world.close === "function") {
        await world.close();
      }
    },
  };
}

/**
 * Fallback in-process backend used when the Vercel Workflow SDK is not
 * available on the machine (e.g. CI, tests). Runs the workflow body directly
 * with no durability guarantees — intended only as a soft fallback so the
 * daemon boots even without the SDK installed.
 */
function createInProcessBackend(): WorkflowBackend {
  const active = new Set<Promise<unknown>>();
  return {
    async start(workflowFn, args) {
      const [ctx] = args;
      const runId = (ctx as WorkflowContext).workflowId;
      const p = Promise.resolve()
        .then(() => workflowFn(ctx))
        .catch((error) => {
          logger.error("In-process workflow failed", {
            runId,
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          active.delete(p);
        });
      active.add(p);
      return { runId };
    },
    async resumeActive() {
      // No durable state to resume.
    },
    async cancel() {
      // In-process fallback can't selectively cancel.
    },
    activeCount() {
      return active.size;
    },
    async close() {
      await Promise.allSettled(Array.from(active));
    },
  };
}

export async function createEngine(
  overrideDeps?: Partial<EngineDeps>
): Promise<Engine> {
  const pidRegistry = overrideDeps?.pidRegistry ?? createDiskPidRegistry();
  const indexSync =
    overrideDeps?.indexSync ??
    createIndexSync({
      workflowDao: overrideDeps?.workflowDao ?? defaultWorkflowDao,
      stepDao: overrideDeps?.stepDao ?? defaultStepDao,
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
      await deps.backend.start(runWorkflow, [ctx]);
    },
    async cancelWorkflowJobs(workflowId: string): Promise<void> {
      await deps.backend.cancel(workflowId);
    },
    activeCount(): number {
      return deps.backend.activeCount();
    },
    deps,
  };
}
