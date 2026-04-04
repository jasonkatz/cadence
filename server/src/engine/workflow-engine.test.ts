import { describe, it, expect, mock } from "bun:test";
import type { Workflow } from "../dao/workflow-dao";
import type { Step } from "../dao/step-dao";
import type { Run } from "../dao/run-dao";
import type { WorkflowEvent } from "../events/event-bus";
import type { EngineDeps } from "./workflow-engine";
import { processWorkflow } from "./workflow-engine";

// --- Helpers ---
function makeWorkflow(overrides?: Partial<Workflow>): Workflow {
  return {
    id: "wf-1",
    task: "add login page",
    repo: "acme/webapp",
    branch: "cadence/abc123",
    requirements: null,
    proposal: null,
    pr_number: null,
    status: "pending",
    iteration: 0,
    max_iters: 8,
    error: null,
    created_by: "user-1",
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function makeStep(overrides?: Partial<Step>): Step {
  return {
    id: "step-1",
    workflow_id: "wf-1",
    iteration: 0,
    type: "plan",
    status: "pending",
    started_at: null,
    finished_at: null,
    detail: null,
    ...overrides,
  };
}

function makeRun(overrides?: Partial<Run>): Run {
  return {
    id: "run-1",
    step_id: "step-1",
    workflow_id: "wf-1",
    agent_role: "planner",
    iteration: 0,
    prompt: "Analyze the repo",
    response: null,
    exit_code: null,
    duration_secs: null,
    created_at: new Date(),
    ...overrides,
  };
}

const STEP_TYPES = ["plan", "dev", "ci", "review", "e2e", "e2e_verify", "signoff"];
const TEST_TOKEN = "ghp_testtoken123";

// --- Build fresh deps for each test ---
function makeDeps() {
  const emittedEvents: WorkflowEvent[] = [];

  const mockUpdateStatus = mock((_id: string, _s: string) =>
    Promise.resolve(makeWorkflow({ status: "running" }))
  );
  const mockUpdateProposal = mock((_id: string, _p: string) =>
    Promise.resolve(makeWorkflow({ proposal: "# Plan" }))
  );
  const mockUpdateError = mock((_id: string, _e: string) =>
    Promise.resolve(makeWorkflow({ status: "failed" }))
  );

  const mockCreateIterationSteps = mock((_wfId: string, _iter: number) => {
    const steps = STEP_TYPES.map((type, i) =>
      makeStep({ id: `step-${i}`, type })
    );
    return Promise.resolve(steps);
  });
  const mockStepUpdateStatus = mock((id: string, status: string, _d?: string) =>
    Promise.resolve(makeStep({ id, status }))
  );

  const mockRunCreate = mock((_data: unknown) => Promise.resolve(makeRun()));
  const mockRunUpdateResult = mock((_id: string, _data: unknown) =>
    Promise.resolve(makeRun({ response: "text", exit_code: 0, duration_secs: 30 }))
  );

  const mockRunPlanner = mock((_workflow: Workflow, _token: string) =>
    Promise.resolve({
      proposal: "# Plan\n...",
      exitCode: 0,
      durationSecs: 30,
      response: "proposal text",
    })
  );

  const deps: EngineDeps = {
    workflowDao: {
      updateStatus: mockUpdateStatus,
      updateProposal: mockUpdateProposal,
      updateError: mockUpdateError,
    } as unknown as EngineDeps["workflowDao"],
    stepDao: {
      createIterationSteps: mockCreateIterationSteps,
      updateStatus: mockStepUpdateStatus,
    } as unknown as EngineDeps["stepDao"],
    runDao: {
      create: mockRunCreate,
      updateResult: mockRunUpdateResult,
    } as unknown as EngineDeps["runDao"],
    eventBus: {
      emit: (event: WorkflowEvent) => emittedEvents.push(event),
      subscribe: () => {},
      unsubscribe: () => {},
      removeAllListeners: () => {},
    },
    runPlannerAgent: mockRunPlanner,
  };

  return {
    deps,
    emittedEvents,
    mocks: {
      updateStatus: mockUpdateStatus,
      updateProposal: mockUpdateProposal,
      updateError: mockUpdateError,
      createIterationSteps: mockCreateIterationSteps,
      stepUpdateStatus: mockStepUpdateStatus,
      runCreate: mockRunCreate,
      runUpdateResult: mockRunUpdateResult,
      runPlanner: mockRunPlanner,
    },
  };
}

describe("workflow engine", () => {
  describe("processWorkflow", () => {
    it("should transition workflow from pending to running", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow({ status: "pending" });

      await processWorkflow(wf, TEST_TOKEN, deps);

      expect(mocks.updateStatus).toHaveBeenCalledWith("wf-1", "running");
    });

    it("should create 7 steps for iteration 0", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      await processWorkflow(wf, TEST_TOKEN, deps);

      expect(mocks.createIterationSteps).toHaveBeenCalledWith("wf-1", 0);
    });

    it("should execute plan step and store proposal on success", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      mocks.runPlanner.mockResolvedValue({
        proposal: "# Summary\nDo the thing",
        exitCode: 0,
        durationSecs: 45,
        response: "full response",
      });

      await processWorkflow(wf, TEST_TOKEN, deps);

      // Plan step should transition to running then passed
      expect(mocks.stepUpdateStatus).toHaveBeenCalledWith("step-0", "running");
      expect(mocks.stepUpdateStatus).toHaveBeenCalledWith("step-0", "passed", undefined);
      // Proposal stored on workflow
      expect(mocks.updateProposal).toHaveBeenCalledTimes(1);
      // Run recorded
      expect(mocks.runCreate).toHaveBeenCalledTimes(1);
      expect(mocks.runUpdateResult).toHaveBeenCalledTimes(1);
    });

    it("should fail workflow when plan step fails", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      mocks.runPlanner.mockResolvedValue({
        proposal: null,
        exitCode: 1,
        durationSecs: 10,
        response: "Error: could not read repo",
      });

      await processWorkflow(wf, TEST_TOKEN, deps);

      expect(mocks.stepUpdateStatus).toHaveBeenCalledWith("step-0", "failed", expect.any(String));
      expect(mocks.updateError).toHaveBeenCalledTimes(1);
    });

    it("should fail workflow when iteration exceeds max_iters", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow({ iteration: 8, max_iters: 8 });

      await processWorkflow(wf, TEST_TOKEN, deps);

      expect(mocks.updateError).toHaveBeenCalledTimes(1);
      const errorMsg = mocks.updateError.mock.calls[0][1];
      expect(errorMsg).toContain("iteration limit");
    });

    it("should not process further steps after plan (engine stops)", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      await processWorkflow(wf, TEST_TOKEN, deps);

      // Only the plan step should have been set to running
      const runningCalls = mocks.stepUpdateStatus.mock.calls.filter(
        (c) => c[1] === "running"
      );
      expect(runningCalls).toHaveLength(1);
    });

    it("should emit SSE events for step transitions", async () => {
      const { deps, emittedEvents } = makeDeps();
      const wf = makeWorkflow();

      await processWorkflow(wf, TEST_TOKEN, deps);

      const stepEvents = emittedEvents.filter((e) => e.type === "step:updated");
      expect(stepEvents.length).toBeGreaterThanOrEqual(2); // running + passed
    });

    it("should record agent run with prompt, response, exit_code, duration", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      mocks.runPlanner.mockResolvedValue({
        proposal: "# Plan",
        exitCode: 0,
        durationSecs: 42,
        response: "full agent output",
      });

      await processWorkflow(wf, TEST_TOKEN, deps);

      expect(mocks.runCreate).toHaveBeenCalledTimes(1);
      const createArg = mocks.runCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(createArg.stepId).toBe("step-0");
      expect(createArg.agentRole).toBe("planner");
      expect(createArg.prompt).toBeTruthy();

      expect(mocks.runUpdateResult).toHaveBeenCalledTimes(1);
      const updateArg = mocks.runUpdateResult.mock.calls[0][1] as Record<string, unknown>;
      expect(updateArg.response).toBe("full agent output");
      expect(updateArg.exitCode).toBe(0);
      expect(updateArg.durationSecs).toBe(42);
    });

    it("should handle cancelled workflow by not proceeding", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow({ status: "cancelled" });

      await processWorkflow(wf, TEST_TOKEN, deps);

      expect(mocks.createIterationSteps).not.toHaveBeenCalled();
      expect(mocks.runPlanner).not.toHaveBeenCalled();
    });
  });
});
