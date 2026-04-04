import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { Workflow } from "../dao/workflow-dao";
import type { Step } from "../dao/step-dao";
import type { Run } from "../dao/run-dao";
import type { WorkflowEvent } from "../events/event-bus";

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

// --- DAO Mocks ---
const mockFindPending = mock(() => Promise.resolve(null as Workflow | null));
const mockUpdateStatus = mock((_id: string, _s: string) =>
  Promise.resolve(null as Workflow | null)
);
const mockUpdateProposal = mock((_id: string, _p: string) =>
  Promise.resolve(null as Workflow | null)
);
const mockUpdateError = mock((_id: string, _e: string) =>
  Promise.resolve(null as Workflow | null)
);
const mockFindById = mock((_id: string) => Promise.resolve(null as Workflow | null));

const mockWorkflowCreate = mock((_data: unknown) => Promise.resolve(makeWorkflow()));
const mockWorkflowFindByIdAndUser = mock((_id: string, _userId: string) =>
  Promise.resolve(null as Workflow | null)
);
const mockWorkflowList = mock((_params: unknown) =>
  Promise.resolve({ workflows: [], total: 0 })
);
const mockWorkflowUpdateIteration = mock((_id: string, _iter: number) =>
  Promise.resolve(null as Workflow | null)
);

mock.module("../dao/workflow-dao", () => ({
  workflowDao: {
    create: mockWorkflowCreate,
    findById: mockFindById,
    findByIdAndUser: mockWorkflowFindByIdAndUser,
    findPending: mockFindPending,
    list: mockWorkflowList,
    updateStatus: mockUpdateStatus,
    updateProposal: mockUpdateProposal,
    updateError: mockUpdateError,
    updateIteration: mockWorkflowUpdateIteration,
  },
}));

const mockCreateIterationSteps = mock((_wfId: string, _iter: number) =>
  Promise.resolve([] as Step[])
);
const mockStepUpdateStatus = mock((_id: string, _s: string, _d?: string) =>
  Promise.resolve(null as Step | null)
);

const mockStepFindByWorkflowId = mock((_wfId: string, _filters?: unknown) =>
  Promise.resolve([] as Step[])
);
const mockStepFindLatest = mock((_wfId: string) =>
  Promise.resolve([] as Step[])
);

mock.module("../dao/step-dao", () => ({
  stepDao: {
    createIterationSteps: mockCreateIterationSteps,
    updateStatus: mockStepUpdateStatus,
    findByWorkflowId: mockStepFindByWorkflowId,
    findLatestIterationByWorkflowId: mockStepFindLatest,
  },
}));

const mockRunCreate = mock((_data: unknown) => Promise.resolve(makeRun()));
const mockRunUpdateResult = mock((_id: string, _data: unknown) =>
  Promise.resolve(null as Run | null)
);

const mockRunFindByWorkflowId = mock((_wfId: string, _filters?: unknown) =>
  Promise.resolve([] as Run[])
);

mock.module("../dao/run-dao", () => ({
  runDao: {
    create: mockRunCreate,
    updateResult: mockRunUpdateResult,
    findByWorkflowId: mockRunFindByWorkflowId,
  },
}));

// --- Event Bus Mock ---
const emittedEvents: WorkflowEvent[] = [];
mock.module("../events/event-bus", () => ({
  eventBus: {
    emit: (event: WorkflowEvent) => emittedEvents.push(event),
    subscribe: () => {},
    unsubscribe: () => {},
    removeAllListeners: () => {},
  },
}));

// --- Planner Agent Mock ---
const mockRunPlanner = mock(
  (_workflow: Workflow, _githubToken: string) =>
    Promise.resolve({ proposal: "# Plan\n\n## Summary\nDo the thing\n\n## Acceptance Criteria\n- It works\n\n## Technical Considerations\n- Use React", exitCode: 0, durationSecs: 30, response: "proposal text" })
);

mock.module("./planner-agent", () => ({
  runPlannerAgent: mockRunPlanner,
}));

const { processWorkflow } = await import("./workflow-engine");

const TEST_TOKEN = "ghp_testtoken123";

describe("workflow engine", () => {
  beforeEach(() => {
    mockFindPending.mockReset();
    mockUpdateStatus.mockReset();
    mockUpdateProposal.mockReset();
    mockUpdateError.mockReset();
    mockFindById.mockReset();
    mockCreateIterationSteps.mockReset();
    mockStepUpdateStatus.mockReset();
    mockRunCreate.mockReset();
    mockRunUpdateResult.mockReset();
    mockRunPlanner.mockReset();
    emittedEvents.length = 0;

    // Default happy-path setup
    mockRunCreate.mockResolvedValue(makeRun());
    mockRunUpdateResult.mockResolvedValue(
      makeRun({ response: "proposal text", exit_code: 0, duration_secs: 30 })
    );
  });

  describe("processWorkflow", () => {
    it("should transition workflow from pending to running", async () => {
      const wf = makeWorkflow({ status: "pending" });
      const steps = STEP_TYPES.map((type, i) =>
        makeStep({ id: `step-${i}`, type })
      );
      mockCreateIterationSteps.mockResolvedValue(steps);
      mockUpdateStatus.mockResolvedValue(makeWorkflow({ status: "running" }));
      mockStepUpdateStatus.mockImplementation((id, status) =>
        Promise.resolve(makeStep({ id, status }))
      );
      mockRunPlanner.mockResolvedValue({
        proposal: "# Plan\n...",
        exitCode: 0,
        durationSecs: 30,
        response: "proposal text",
      });
      mockUpdateProposal.mockResolvedValue(
        makeWorkflow({ status: "running", proposal: "# Plan\n..." })
      );

      await processWorkflow(wf, TEST_TOKEN);

      expect(mockUpdateStatus).toHaveBeenCalledWith("wf-1", "running");
    });

    it("should create 7 steps for iteration 0", async () => {
      const wf = makeWorkflow();
      const steps = STEP_TYPES.map((type, i) =>
        makeStep({ id: `step-${i}`, type })
      );
      mockCreateIterationSteps.mockResolvedValue(steps);
      mockUpdateStatus.mockResolvedValue(makeWorkflow({ status: "running" }));
      mockStepUpdateStatus.mockImplementation((id, status) =>
        Promise.resolve(makeStep({ id, status }))
      );
      mockRunPlanner.mockResolvedValue({
        proposal: "# Plan\n...",
        exitCode: 0,
        durationSecs: 30,
        response: "proposal text",
      });
      mockUpdateProposal.mockResolvedValue(
        makeWorkflow({ status: "running", proposal: "# Plan\n..." })
      );

      await processWorkflow(wf, TEST_TOKEN);

      expect(mockCreateIterationSteps).toHaveBeenCalledWith("wf-1", 0);
    });

    it("should execute plan step and store proposal on success", async () => {
      const wf = makeWorkflow();
      const planStep = makeStep({ id: "plan-step", type: "plan" });
      const steps = [planStep, ...STEP_TYPES.slice(1).map((type, i) =>
        makeStep({ id: `step-${i + 1}`, type })
      )];
      mockCreateIterationSteps.mockResolvedValue(steps);
      mockUpdateStatus.mockResolvedValue(makeWorkflow({ status: "running" }));
      mockStepUpdateStatus.mockImplementation((id, status) =>
        Promise.resolve(makeStep({ id, status }))
      );
      mockRunPlanner.mockResolvedValue({
        proposal: "# Summary\nDo the thing\n\n# Acceptance Criteria\n- It works",
        exitCode: 0,
        durationSecs: 45,
        response: "full response",
      });
      mockUpdateProposal.mockResolvedValue(
        makeWorkflow({ proposal: "# Summary\nDo the thing" })
      );

      await processWorkflow(wf, TEST_TOKEN);

      // Plan step should transition to running then passed
      expect(mockStepUpdateStatus).toHaveBeenCalledWith("plan-step", "running");
      expect(mockStepUpdateStatus).toHaveBeenCalledWith("plan-step", "passed", undefined);
      // Proposal stored on workflow
      expect(mockUpdateProposal).toHaveBeenCalledTimes(1);
      // Run recorded
      expect(mockRunCreate).toHaveBeenCalledTimes(1);
      expect(mockRunUpdateResult).toHaveBeenCalledTimes(1);
    });

    it("should fail workflow when plan step fails", async () => {
      const wf = makeWorkflow();
      const planStep = makeStep({ id: "plan-step", type: "plan" });
      const steps = [planStep, ...STEP_TYPES.slice(1).map((type, i) =>
        makeStep({ id: `step-${i + 1}`, type })
      )];
      mockCreateIterationSteps.mockResolvedValue(steps);
      mockUpdateStatus.mockResolvedValue(makeWorkflow({ status: "running" }));
      mockStepUpdateStatus.mockImplementation((id, status) =>
        Promise.resolve(makeStep({ id, status }))
      );
      mockRunPlanner.mockResolvedValue({
        proposal: null,
        exitCode: 1,
        durationSecs: 10,
        response: "Error: could not read repo",
      });
      mockUpdateError.mockResolvedValue(
        makeWorkflow({ status: "failed", error: "Plan step failed" })
      );

      await processWorkflow(wf, TEST_TOKEN);

      expect(mockStepUpdateStatus).toHaveBeenCalledWith("plan-step", "failed", expect.any(String));
      expect(mockUpdateError).toHaveBeenCalledTimes(1);
    });

    it("should fail workflow when iteration exceeds max_iters", async () => {
      const wf = makeWorkflow({ iteration: 8, max_iters: 8 });
      mockUpdateError.mockResolvedValue(
        makeWorkflow({ status: "failed", error: "Iteration limit reached" })
      );

      await processWorkflow(wf, TEST_TOKEN);

      expect(mockUpdateError).toHaveBeenCalledTimes(1);
      const errorMsg = mockUpdateError.mock.calls[0][1];
      expect(errorMsg).toContain("iteration limit");
    });

    it("should not process further steps after plan (engine stops)", async () => {
      const wf = makeWorkflow();
      const steps = STEP_TYPES.map((type, i) =>
        makeStep({ id: `step-${i}`, type })
      );
      mockCreateIterationSteps.mockResolvedValue(steps);
      mockUpdateStatus.mockResolvedValue(makeWorkflow({ status: "running" }));
      mockStepUpdateStatus.mockImplementation((id, status) =>
        Promise.resolve(makeStep({ id, status }))
      );
      mockRunPlanner.mockResolvedValue({
        proposal: "# Plan",
        exitCode: 0,
        durationSecs: 5,
        response: "plan",
      });
      mockUpdateProposal.mockResolvedValue(
        makeWorkflow({ proposal: "# Plan" })
      );

      await processWorkflow(wf, TEST_TOKEN);

      // Only the plan step should have been set to running
      const runningCalls = mockStepUpdateStatus.mock.calls.filter(
        (c) => c[1] === "running"
      );
      expect(runningCalls).toHaveLength(1);
    });

    it("should emit SSE events for step transitions", async () => {
      const wf = makeWorkflow();
      const planStep = makeStep({ id: "plan-step", type: "plan" });
      const steps = [planStep, ...STEP_TYPES.slice(1).map((type, i) =>
        makeStep({ id: `step-${i + 1}`, type })
      )];
      mockCreateIterationSteps.mockResolvedValue(steps);
      mockUpdateStatus.mockResolvedValue(makeWorkflow({ status: "running" }));
      mockStepUpdateStatus.mockImplementation((id, status) =>
        Promise.resolve(makeStep({ id, status }))
      );
      mockRunPlanner.mockResolvedValue({
        proposal: "# Plan",
        exitCode: 0,
        durationSecs: 5,
        response: "plan",
      });
      mockUpdateProposal.mockResolvedValue(
        makeWorkflow({ proposal: "# Plan" })
      );

      await processWorkflow(wf, TEST_TOKEN);

      const stepEvents = emittedEvents.filter((e) => e.type === "step:updated");
      expect(stepEvents.length).toBeGreaterThanOrEqual(2); // running + passed
    });

    it("should record agent run with prompt, response, exit_code, duration", async () => {
      const wf = makeWorkflow();
      const planStep = makeStep({ id: "plan-step", type: "plan" });
      const steps = [planStep, ...STEP_TYPES.slice(1).map((type, i) =>
        makeStep({ id: `step-${i + 1}`, type })
      )];
      mockCreateIterationSteps.mockResolvedValue(steps);
      mockUpdateStatus.mockResolvedValue(makeWorkflow({ status: "running" }));
      mockStepUpdateStatus.mockImplementation((id, status) =>
        Promise.resolve(makeStep({ id, status }))
      );
      mockRunPlanner.mockResolvedValue({
        proposal: "# Plan",
        exitCode: 0,
        durationSecs: 42,
        response: "full agent output",
      });
      mockUpdateProposal.mockResolvedValue(
        makeWorkflow({ proposal: "# Plan" })
      );

      await processWorkflow(wf, TEST_TOKEN);

      expect(mockRunCreate).toHaveBeenCalledTimes(1);
      const createArg = mockRunCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(createArg.stepId).toBe("plan-step");
      expect(createArg.agentRole).toBe("planner");
      expect(createArg.prompt).toBeTruthy();

      expect(mockRunUpdateResult).toHaveBeenCalledTimes(1);
      const updateArg = mockRunUpdateResult.mock.calls[0][1] as Record<string, unknown>;
      expect(updateArg.response).toBe("full agent output");
      expect(updateArg.exitCode).toBe(0);
      expect(updateArg.durationSecs).toBe(42);
    });

    it("should handle cancelled workflow by not proceeding", async () => {
      const wf = makeWorkflow({ status: "cancelled" });

      await processWorkflow(wf, TEST_TOKEN);

      expect(mockCreateIterationSteps).not.toHaveBeenCalled();
      expect(mockRunPlanner).not.toHaveBeenCalled();
    });
  });
});
