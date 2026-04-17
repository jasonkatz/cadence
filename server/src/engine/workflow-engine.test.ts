import { describe, it, expect, mock, beforeEach } from "bun:test";
import { createEngine, type WorkflowBackend } from "./workflow-engine";
import type { PidRegistry, PidRecord } from "./subprocess-reaper";
import type { IndexSync } from "./index-sync";
import type { Workflow } from "../dao/workflow-dao";

function wf(overrides?: Partial<Workflow>): Workflow {
  return {
    id: "wf-1",
    task: "t",
    repo: "r",
    branch: "b",
    requirements: null,
    proposal: null,
    pr_number: null,
    status: "pending",
    iteration: 0,
    max_iters: 8,
    error: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

interface BootEvent {
  kind: "reaper_list" | "resume_active" | "backend_start";
  pid?: number;
}

function makeDeps() {
  const events: BootEvent[] = [];

  const pidRegistry: PidRegistry = {
    record: mock((_stepId: string, _pid: number) => {}),
    clear: mock((_stepId: string) => {}),
    list: mock((): PidRecord[] => {
      events.push({ kind: "reaper_list" });
      return [];
    }),
  };

  const backend: WorkflowBackend = {
    start: mock(async (_fn: unknown, _args: unknown) => {
      events.push({ kind: "backend_start" });
      return { runId: "run-1" };
    }),
    resumeActive: mock(async () => {
      events.push({ kind: "resume_active" });
    }),
    cancel: mock(async (_runId: string) => {}),
    close: mock(async () => {}),
  };

  const indexSync: IndexSync = {
    hooksFor: mock(() => ({
      onStepStart: () => {},
      onStepEnd: () => {},
      onProposal: () => {},
      onPrCreated: () => {},
      onIteration: () => {},
      onComplete: () => {},
      onFail: () => {},
    })),
  };

  const workflowDao = {
    findById: mock(async (id: string) => (id === "wf-1" ? wf() : null)),
    updateStatus: mock(async () => null),
    updateProposal: mock(async () => null),
    updateError: mock(async () => null),
    updatePrNumber: mock(async () => null),
    updateIteration: mock(async () => null),
    countByStatus: mock(async (_status: string) => 0),
  };

  const stepDao = {
    findByWorkflowId: mock(async () => []),
    createIterationSteps: mock(async () => []),
    updateStatus: mock(async () => null),
  };

  const runDao = {
    findByStepIdAndRole: mock(async () => null),
    create: mock(async () => ({}) as never),
    updateResult: mock(async () => null),
  };

  const eventBus = {
    emit: mock(() => {}),
  };

  return {
    events,
    pidRegistry,
    backend,
    indexSync,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    workflowDao: workflowDao as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stepDao: stepDao as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runDao: runDao as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventBus: eventBus as any,
  };
}

describe("createEngine boot sequence", () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps();
  });

  it("reaps orphan subprocesses BEFORE resuming active runs", async () => {
    const engine = await createEngine({
      workflowDao: deps.workflowDao,
      stepDao: deps.stepDao,
      runDao: deps.runDao,
      eventBus: deps.eventBus,
      backend: deps.backend,
      pidRegistry: deps.pidRegistry,
      indexSync: deps.indexSync,
    });

    await engine.start();

    const listIdx = deps.events.findIndex((e) => e.kind === "reaper_list");
    const resumeIdx = deps.events.findIndex((e) => e.kind === "resume_active");
    expect(listIdx).toBeGreaterThanOrEqual(0);
    expect(resumeIdx).toBeGreaterThanOrEqual(0);
    // Reaper must inspect the registry before replay triggers start a
    // potentially-colliding subprocess. If this ordering flips, a replayed
    // step could contest the surviving orphan.
    expect(listIdx).toBeLessThan(resumeIdx);
  });

  it("stops by calling backend.close()", async () => {
    const engine = await createEngine({
      workflowDao: deps.workflowDao,
      stepDao: deps.stepDao,
      runDao: deps.runDao,
      eventBus: deps.eventBus,
      backend: deps.backend,
      pidRegistry: deps.pidRegistry,
      indexSync: deps.indexSync,
    });

    await engine.stop();

    expect(deps.backend.close).toHaveBeenCalledTimes(1);
  });

  it("enqueueWorkflow reads the workflow and hands it to the backend", async () => {
    const engine = await createEngine({
      workflowDao: deps.workflowDao,
      stepDao: deps.stepDao,
      runDao: deps.runDao,
      eventBus: deps.eventBus,
      backend: deps.backend,
      pidRegistry: deps.pidRegistry,
      indexSync: deps.indexSync,
    });

    await engine.enqueueWorkflow("wf-1", 0);

    expect(deps.workflowDao.findById).toHaveBeenCalledWith("wf-1");
    expect(deps.backend.start).toHaveBeenCalledTimes(1);
    const call = (deps.backend.start as ReturnType<typeof mock>).mock.calls[0];
    const [, args] = call as [unknown, [{ workflowId: string; maxIters: number }]];
    expect(args[0].workflowId).toBe("wf-1");
    expect(args[0].maxIters).toBe(8);
  });

  it("enqueueWorkflow throws when the workflow is missing", async () => {
    const engine = await createEngine({
      workflowDao: deps.workflowDao,
      stepDao: deps.stepDao,
      runDao: deps.runDao,
      eventBus: deps.eventBus,
      backend: deps.backend,
      pidRegistry: deps.pidRegistry,
      indexSync: deps.indexSync,
    });

    await expect(engine.enqueueWorkflow("does-not-exist", 0)).rejects.toThrow(
      /not found/
    );
    expect(deps.backend.start).not.toHaveBeenCalled();
  });

  it("cancelWorkflowJobs translates workflowId to WDK runId", async () => {
    (deps.backend.start as ReturnType<typeof mock>).mockImplementation(
      async () => ({ runId: "wdk-run-42" })
    );
    const engine = await createEngine({
      workflowDao: deps.workflowDao,
      stepDao: deps.stepDao,
      runDao: deps.runDao,
      eventBus: deps.eventBus,
      backend: deps.backend,
      pidRegistry: deps.pidRegistry,
      indexSync: deps.indexSync,
    });

    await engine.enqueueWorkflow("wf-1", 0);
    await engine.cancelWorkflowJobs("wf-1");

    // Must pass the runId from start(), not the workflowId — WDK's
    // cancelRun rejects the wrong ID.
    expect(deps.backend.cancel).toHaveBeenCalledWith("wdk-run-42");
  });

  it("cancelWorkflowJobs throws when the workflow has no tracked run", async () => {
    const engine = await createEngine({
      workflowDao: deps.workflowDao,
      stepDao: deps.stepDao,
      runDao: deps.runDao,
      eventBus: deps.eventBus,
      backend: deps.backend,
      pidRegistry: deps.pidRegistry,
      indexSync: deps.indexSync,
    });

    await expect(engine.cancelWorkflowJobs("wf-unknown")).rejects.toThrow(
      /no active run/
    );
    expect(deps.backend.cancel).not.toHaveBeenCalled();
  });

  it("activeCount queries SQLite (source of truth, not backend memory)", async () => {
    (deps.workflowDao.countByStatus as ReturnType<typeof mock>).mockImplementation(
      async (status: string) => (status === "running" ? 3 : 0)
    );
    const engine = await createEngine({
      workflowDao: deps.workflowDao,
      stepDao: deps.stepDao,
      runDao: deps.runDao,
      eventBus: deps.eventBus,
      backend: deps.backend,
      pidRegistry: deps.pidRegistry,
      indexSync: deps.indexSync,
    });

    expect(await engine.activeCount()).toBe(3);
    expect(deps.workflowDao.countByStatus).toHaveBeenCalledWith("running");
  });
});
