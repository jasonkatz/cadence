import { describe, it, expect, mock } from "bun:test";
import { createIndexSync, type IndexSyncDeps } from "./index-sync";
import type { Workflow } from "../dao/workflow-dao";
import type { Step } from "../dao/step-dao";
import type { Run } from "../dao/run-dao";
import type { WorkflowEvent } from "../events/event-bus";

const STEP_TYPES = ["plan", "dev", "ci", "review", "e2e", "e2e_verify", "signoff"] as const;

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

function makeStepRows(workflowId: string, iteration: number): Step[] {
  const types = iteration > 0 ? STEP_TYPES.filter((t) => t !== "plan") : STEP_TYPES;
  return types.map((type) => ({
    id: `${workflowId}-${iteration}-${type}`,
    workflow_id: workflowId,
    iteration,
    type,
    status: "pending",
    started_at: null,
    finished_at: null,
    detail: null,
  }));
}

function makeDeps() {
  const emitted: WorkflowEvent[] = [];
  const workflowState: Record<string, Workflow> = { "wf-1": wf() };
  const stepRows = new Map<string, Step[]>();
  const statusUpdates: Array<{ stepId: string; status: string; detail?: string }> = [];
  const proposalUpdates: Array<{ id: string; proposal: string }> = [];
  const errorUpdates: Array<{ id: string; error: string }> = [];
  const prUpdates: Array<{ id: string; prNumber: number }> = [];
  const iterationUpdates: Array<{ id: string; iteration: number }> = [];
  const workflowStatusUpdates: Array<{ id: string; status: string }> = [];

  const runs = new Map<string, Run>();
  const runResultUpdates: Array<{ runId: string; exitCode: number; durationSecs: number }> = [];
  let runSeq = 0;

  const deps: IndexSyncDeps = {
    workflowDao: {
      findById: mock(async (id: string) => workflowState[id] ?? null),
      updateStatus: mock(async (id: string, status: string) => {
        workflowStatusUpdates.push({ id, status });
        if (workflowState[id]) workflowState[id] = { ...workflowState[id], status };
        return workflowState[id] ?? null;
      }),
      updateProposal: mock(async (id: string, proposal: string) => {
        proposalUpdates.push({ id, proposal });
        return workflowState[id] ?? null;
      }),
      updateError: mock(async (id: string, error: string) => {
        errorUpdates.push({ id, error });
        return workflowState[id] ?? null;
      }),
      updatePrNumber: mock(async (id: string, prNumber: number) => {
        prUpdates.push({ id, prNumber });
        return workflowState[id] ?? null;
      }),
      updateIteration: mock(async (id: string, iteration: number) => {
        iterationUpdates.push({ id, iteration });
        return workflowState[id] ?? null;
      }),
    },
    stepDao: {
      findByWorkflowId: mock(async (workflowId: string, filters?: { iteration?: number }) => {
        const key = `${workflowId}:${filters?.iteration ?? "all"}`;
        return stepRows.get(key) ?? [];
      }),
      createIterationSteps: mock(async (workflowId: string, iteration: number) => {
        const rows = makeStepRows(workflowId, iteration);
        stepRows.set(`${workflowId}:${iteration}`, rows);
        return rows;
      }),
      updateStatus: mock(async (stepId: string, status: string, detail?: string) => {
        statusUpdates.push({ stepId, status, detail });
        return null;
      }),
    },
    runDao: {
      findByStepIdAndRole: mock(async (stepId: string, agentRole: string) => {
        return runs.get(`${stepId}:${agentRole}`) ?? null;
      }),
      create: mock(async (data: {
        stepId: string;
        workflowId: string;
        agentRole: string;
        iteration: number;
        logPath: string;
      }) => {
        const run: Run = {
          id: `run-${++runSeq}`,
          step_id: data.stepId,
          workflow_id: data.workflowId,
          agent_role: data.agentRole,
          iteration: data.iteration,
          log_path: data.logPath,
          exit_code: null,
          duration_secs: null,
          created_at: new Date(),
        };
        runs.set(`${data.stepId}:${data.agentRole}`, run);
        return run;
      }),
      updateResult: mock(async (runId: string, data: { exitCode: number; durationSecs: number }) => {
        runResultUpdates.push({ runId, exitCode: data.exitCode, durationSecs: data.durationSecs });
        for (const [key, run] of runs.entries()) {
          if (run.id === runId) {
            const updated = { ...run, exit_code: data.exitCode, duration_secs: data.durationSecs };
            runs.set(key, updated);
            return updated;
          }
        }
        return null;
      }),
    },
    eventBus: {
      emit: mock((event: WorkflowEvent) => {
        emitted.push(event);
      }),
    },
  };

  return {
    deps,
    emitted,
    workflowState,
    stepRows,
    statusUpdates,
    proposalUpdates,
    errorUpdates,
    prUpdates,
    iterationUpdates,
    workflowStatusUpdates,
    runs,
    runResultUpdates,
  };
}

// Drain the hook's internal promise chain. Each chained fn performs up to
// ~6 awaits; repeated setImmediate-style yields cover the worst case.
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

describe("createIndexSync", () => {
  it("creates step rows on first iteration lookup and maps stepId by (iteration, type)", async () => {
    const { deps, statusUpdates, emitted } = makeDeps();
    const sync = createIndexSync(deps);
    const hooks = sync.hooksFor("wf-1");

    hooks.onStepStart("plan", 0);
    await flush();

    expect(deps.stepDao.findByWorkflowId).toHaveBeenCalledWith("wf-1", { iteration: 0 });
    expect(deps.stepDao.createIterationSteps).toHaveBeenCalledWith("wf-1", 0);
    expect(statusUpdates).toEqual([{ stepId: "wf-1-0-plan", status: "running", detail: undefined }]);
    expect(emitted.map((e) => e.type)).toContain("step:updated");
  });

  it("transitions workflow from pending to running on first step start", async () => {
    const { deps, workflowStatusUpdates, emitted } = makeDeps();
    const sync = createIndexSync(deps);
    const hooks = sync.hooksFor("wf-1");

    hooks.onStepStart("plan", 0);
    await flush();

    expect(workflowStatusUpdates).toContainEqual({ id: "wf-1", status: "running" });
    const wfUpdated = emitted.find((e) => e.type === "workflow:updated" && e.data.status === "running");
    expect(wfUpdated).toBeDefined();
  });

  it("writes passed/failed status with detail on onStepEnd", async () => {
    const { deps, statusUpdates } = makeDeps();
    const sync = createIndexSync(deps);
    const hooks = sync.hooksFor("wf-1");

    hooks.onStepStart("dev", 0);
    hooks.onStepEnd("dev", 0, { ok: true });
    hooks.onStepEnd("ci", 0, { ok: false, detail: "tests failed" });
    await flush();

    const dev = statusUpdates.find((u) => u.stepId === "wf-1-0-dev" && u.status === "passed");
    expect(dev).toBeDefined();
    const ci = statusUpdates.find((u) => u.stepId === "wf-1-0-ci" && u.status === "failed");
    expect(ci).toEqual({ stepId: "wf-1-0-ci", status: "failed", detail: "tests failed" });
  });

  it("is idempotent on replay — does not create duplicate step rows", async () => {
    const { deps } = makeDeps();
    const sync = createIndexSync(deps);
    const hooks = sync.hooksFor("wf-1");

    hooks.onStepStart("plan", 0);
    hooks.onStepStart("dev", 0);
    hooks.onStepStart("ci", 0);
    await flush();

    expect(deps.stepDao.createIterationSteps).toHaveBeenCalledTimes(1);
  });

  it("uses existing step rows when found rather than creating new ones", async () => {
    const { deps, stepRows } = makeDeps();
    // Pre-populate as if they already exist from a prior daemon lifecycle.
    stepRows.set("wf-1:0", makeStepRows("wf-1", 0));
    const sync = createIndexSync(deps);
    const hooks = sync.hooksFor("wf-1");

    hooks.onStepStart("plan", 0);
    await flush();

    expect(deps.stepDao.createIterationSteps).not.toHaveBeenCalled();
  });

  it("persists proposal, PR number, and iteration via the respective DAO methods", async () => {
    const { deps, proposalUpdates, prUpdates, iterationUpdates, emitted } = makeDeps();
    const sync = createIndexSync(deps);
    const hooks = sync.hooksFor("wf-1");

    hooks.onProposal("## plan");
    hooks.onPrCreated(42, "https://github.com/x/y/pull/42");
    hooks.onIteration(1, "ci red");
    await flush();

    expect(proposalUpdates).toEqual([{ id: "wf-1", proposal: "## plan" }]);
    expect(prUpdates).toEqual([{ id: "wf-1", prNumber: 42 }]);
    expect(iterationUpdates).toEqual([{ id: "wf-1", iteration: 1 }]);
    expect(emitted.some((e) => e.type === "workflow:updated" && e.data.pr_number === 42)).toBe(true);
    expect(
      emitted.some((e) => e.type === "workflow:updated" && e.data.regression === true && e.data.iteration === 1)
    ).toBe(true);
  });

  it("completes the workflow on onComplete and emits workflow:completed", async () => {
    const { deps, workflowStatusUpdates, emitted } = makeDeps();
    const sync = createIndexSync(deps);
    const hooks = sync.hooksFor("wf-1");

    hooks.onComplete(42);
    await flush();

    expect(workflowStatusUpdates).toContainEqual({ id: "wf-1", status: "complete" });
    expect(
      emitted.some((e) => e.type === "workflow:completed" && e.data.status === "complete" && e.data.pr_number === 42)
    ).toBe(true);
  });

  it("records error on onFail and emits workflow:completed with failed status", async () => {
    const { deps, errorUpdates, emitted } = makeDeps();
    const sync = createIndexSync(deps);
    const hooks = sync.hooksFor("wf-1");

    hooks.onFail("boom");
    await flush();

    expect(errorUpdates).toEqual([{ id: "wf-1", error: "boom" }]);
    expect(
      emitted.some((e) => e.type === "workflow:completed" && e.data.status === "failed" && e.data.error === "boom")
    ).toBe(true);
  });

  it("serializes writes for the same workflow in hook-call order", async () => {
    const { deps, statusUpdates } = makeDeps();
    const sync = createIndexSync(deps);
    const hooks = sync.hooksFor("wf-1");

    hooks.onStepStart("plan", 0);
    hooks.onStepEnd("plan", 0, { ok: true });
    hooks.onStepStart("dev", 0);
    hooks.onStepEnd("dev", 0, { ok: false, detail: "oops" });
    await flush();

    const planIdx = statusUpdates.findIndex((u) => u.stepId === "wf-1-0-plan" && u.status === "passed");
    const devIdx = statusUpdates.findIndex((u) => u.stepId === "wf-1-0-dev" && u.status === "failed");
    expect(planIdx).toBeGreaterThanOrEqual(0);
    expect(devIdx).toBeGreaterThan(planIdx);
  });

  it("creates a run row when onStepEnd carries run info", async () => {
    const { deps, runs, runResultUpdates } = makeDeps();
    const sync = createIndexSync(deps);
    const hooks = sync.hooksFor("wf-1");

    hooks.onStepStart("dev", 0);
    hooks.onStepEnd("dev", 0, {
      ok: true,
      run: { agentRole: "dev", logPath: "/tmp/dev.jsonl", exitCode: 0, durationSecs: 12.5 },
    });
    await flush();

    const run = runs.get("wf-1-0-dev:dev");
    expect(run).toBeDefined();
    expect(run?.log_path).toBe("/tmp/dev.jsonl");
    expect(runResultUpdates).toEqual([{ runId: run!.id, exitCode: 0, durationSecs: 12.5 }]);
    expect(deps.runDao.create).toHaveBeenCalledTimes(1);
  });

  it("upserts the run row on replay — does not duplicate", async () => {
    const { deps, runs } = makeDeps();
    const sync = createIndexSync(deps);
    const hooks = sync.hooksFor("wf-1");

    hooks.onStepStart("dev", 0);
    hooks.onStepEnd("dev", 0, {
      ok: true,
      run: { agentRole: "dev", logPath: "/tmp/dev.jsonl", exitCode: 0, durationSecs: 12.5 },
    });
    hooks.onStepEnd("dev", 0, {
      ok: true,
      run: { agentRole: "dev", logPath: "/tmp/dev.jsonl", exitCode: 0, durationSecs: 12.5 },
    });
    await flush();

    expect(deps.runDao.create).toHaveBeenCalledTimes(1);
    expect(deps.runDao.updateResult).toHaveBeenCalledTimes(2);
    expect(runs.size).toBe(1);
  });

  it("skips run-row writes when onStepEnd has no run info (ci, signoff)", async () => {
    const { deps } = makeDeps();
    const sync = createIndexSync(deps);
    const hooks = sync.hooksFor("wf-1");

    hooks.onStepStart("ci", 0);
    hooks.onStepEnd("ci", 0, { ok: true });
    hooks.onStepStart("signoff", 0);
    hooks.onStepEnd("signoff", 0, { ok: true });
    await flush();

    expect(deps.runDao.create).not.toHaveBeenCalled();
    expect(deps.runDao.updateResult).not.toHaveBeenCalled();
  });

  it("keeps iteration tracking independent per workflowId", async () => {
    const { deps } = makeDeps();
    // Add a second workflow into the findById lookup.
    (deps.workflowDao.findById as ReturnType<typeof mock>).mockImplementation(async (id: string) =>
      wf({ id })
    );
    const sync = createIndexSync(deps);
    const a = sync.hooksFor("wf-1");
    const b = sync.hooksFor("wf-2");

    a.onStepStart("plan", 0);
    b.onStepStart("plan", 0);
    await flush();

    expect(deps.stepDao.createIterationSteps).toHaveBeenCalledTimes(2);
  });
});
