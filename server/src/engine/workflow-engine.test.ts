import { describe, it, expect, mock } from "bun:test";
import type { Workflow } from "../dao/workflow-dao";
import type { Step } from "../dao/step-dao";
import type { Run } from "../dao/run-dao";
import type { WorkflowEvent } from "../events/event-bus";
import type { EngineDeps } from "./workflow-engine";
import type { DevResult } from "./dev-agent";
import type { CiPollResult } from "./ci-poller";
import type { ReviewResult } from "./review-agent";
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

  const mockRunDevAgent = mock((_workflow: Workflow, _token: string) =>
    Promise.resolve<DevResult>({
      exitCode: 0,
      durationSecs: 60,
      response: "dev agent output",
    })
  );

  const mockUpdatePrNumber = mock((_id: string, _prNumber: number) =>
    Promise.resolve(makeWorkflow({ pr_number: 42 }))
  );

  const mockCreatePullRequest = mock(
    (_params: {
      token: string;
      repo: string;
      head: string;
      title: string;
      body: string;
    }) =>
      Promise.resolve({
        number: 42,
        url: "https://github.com/acme/webapp/pull/42",
      })
  );

  const mockPollCiStatus = mock(
    (_repo: string, _sha: string, _token: string) =>
      Promise.resolve<CiPollResult>({ status: "passed", detail: null })
  );

  const mockRunReviewAgent = mock(
    (_workflow: Workflow, _diff: string, _token: string) =>
      Promise.resolve<ReviewResult>({
        reviewPass: true,
        verdict: '{"review_pass": true}',
        exitCode: 0,
        durationSecs: 30,
        response: "review output",
      })
  );

  const mockGetPrDiff = mock((_token: string, _repo: string, _prNumber: number) =>
    Promise.resolve("diff content")
  );

  const mockGetHeadSha = mock((_token: string, _repo: string, _branch: string) =>
    Promise.resolve("abc123sha")
  );

  const mockUpdateIteration = mock((_id: string, _iter: number) =>
    Promise.resolve(makeWorkflow({ iteration: 1 }))
  );

  const deps: EngineDeps = {
    workflowDao: {
      updateStatus: mockUpdateStatus,
      updateProposal: mockUpdateProposal,
      updateError: mockUpdateError,
      updatePrNumber: mockUpdatePrNumber,
      updateIteration: mockUpdateIteration,
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
    runDevAgent: mockRunDevAgent,
    createPullRequest: mockCreatePullRequest,
    pollCiStatus: mockPollCiStatus,
    runReviewAgent: mockRunReviewAgent,
    getPrDiff: mockGetPrDiff,
    getHeadSha: mockGetHeadSha,
  };

  return {
    deps,
    emittedEvents,
    mocks: {
      updateStatus: mockUpdateStatus,
      updateProposal: mockUpdateProposal,
      updateError: mockUpdateError,
      updatePrNumber: mockUpdatePrNumber,
      updateIteration: mockUpdateIteration,
      createIterationSteps: mockCreateIterationSteps,
      stepUpdateStatus: mockStepUpdateStatus,
      runCreate: mockRunCreate,
      runUpdateResult: mockRunUpdateResult,
      runPlanner: mockRunPlanner,
      runDevAgent: mockRunDevAgent,
      createPullRequest: mockCreatePullRequest,
      pollCiStatus: mockPollCiStatus,
      runReviewAgent: mockRunReviewAgent,
      getPrDiff: mockGetPrDiff,
      getHeadSha: mockGetHeadSha,
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
      // Runs recorded (planner + dev + reviewer)
      expect(mocks.runCreate).toHaveBeenCalledTimes(3);
      expect(mocks.runUpdateResult).toHaveBeenCalledTimes(3);
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

    it("should not process e2e steps after review passes", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      await processWorkflow(wf, TEST_TOKEN, deps);

      // plan, dev, ci, review should have been set to running
      const runningCalls = mocks.stepUpdateStatus.mock.calls.filter(
        (c) => c[1] === "running"
      );
      expect(runningCalls).toHaveLength(4);
    });

    it("should emit SSE events for step transitions", async () => {
      const { deps, emittedEvents } = makeDeps();
      const wf = makeWorkflow();

      await processWorkflow(wf, TEST_TOKEN, deps);

      const stepEvents = emittedEvents.filter((e) => e.type === "step:updated");
      expect(stepEvents.length).toBeGreaterThanOrEqual(2); // running + passed
    });

    it("should record planner agent run with prompt, response, exit_code, duration", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      mocks.runPlanner.mockResolvedValue({
        proposal: "# Plan",
        exitCode: 0,
        durationSecs: 42,
        response: "full agent output",
      });

      await processWorkflow(wf, TEST_TOKEN, deps);

      // First run create is for planner
      expect(mocks.runCreate).toHaveBeenCalledTimes(3); // planner + dev + reviewer
      const createArg = mocks.runCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(createArg.stepId).toBe("step-0");
      expect(createArg.agentRole).toBe("planner");
      expect(createArg.prompt).toBeTruthy();

      // First run update is for planner
      expect(mocks.runUpdateResult).toHaveBeenCalledTimes(3);
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

    it("should execute dev step after plan passes", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      mocks.runPlanner.mockResolvedValue({
        proposal: "# Plan\nDo the thing",
        exitCode: 0,
        durationSecs: 30,
        response: "planner output",
      });

      mocks.runDevAgent.mockResolvedValue({
        exitCode: 0,
        durationSecs: 60,
        response: "dev output",
      });

      await processWorkflow(wf, TEST_TOKEN, deps);

      // Dev step should be set to running
      const devStep = STEP_TYPES.indexOf("dev");
      expect(mocks.stepUpdateStatus).toHaveBeenCalledWith(`step-${devStep}`, "running");
      // Dev agent should be invoked
      expect(mocks.runDevAgent).toHaveBeenCalledTimes(1);
      // Dev run should be recorded
      expect(mocks.runCreate).toHaveBeenCalledTimes(3); // planner + dev + reviewer
    });

    it("should create PR after dev step passes", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      mocks.runPlanner.mockResolvedValue({
        proposal: "# Plan\nDo the thing",
        exitCode: 0,
        durationSecs: 30,
        response: "planner output",
      });

      mocks.runDevAgent.mockResolvedValue({
        exitCode: 0,
        durationSecs: 60,
        response: "dev output",
      });

      await processWorkflow(wf, TEST_TOKEN, deps);

      expect(mocks.createPullRequest).toHaveBeenCalledTimes(1);
      const prArgs = mocks.createPullRequest.mock.calls[0][0];
      expect(prArgs.repo).toBe("acme/webapp");
      expect(prArgs.head).toBe("cadence/abc123");
      expect(prArgs.token).toBe(TEST_TOKEN);
    });

    it("should store pr_number after PR creation", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      await processWorkflow(wf, TEST_TOKEN, deps);

      expect(mocks.updatePrNumber).toHaveBeenCalledWith("wf-1", 42);
    });

    it("should fail workflow when dev step fails", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      mocks.runPlanner.mockResolvedValue({
        proposal: "# Plan\nDo the thing",
        exitCode: 0,
        durationSecs: 30,
        response: "planner output",
      });

      mocks.runDevAgent.mockResolvedValue({
        exitCode: 1,
        durationSecs: 10,
        response: "Error: compilation failed",
      });

      await processWorkflow(wf, TEST_TOKEN, deps);

      // Dev step should be failed
      const devStep = STEP_TYPES.indexOf("dev");
      expect(mocks.stepUpdateStatus).toHaveBeenCalledWith(
        `step-${devStep}`,
        "failed",
        expect.any(String)
      );
      // Workflow should be failed
      expect(mocks.updateError).toHaveBeenCalledTimes(1);
      // PR should NOT be created
      expect(mocks.createPullRequest).not.toHaveBeenCalled();
    });

    it("should not run dev step when plan fails", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      mocks.runPlanner.mockResolvedValue({
        proposal: null,
        exitCode: 1,
        durationSecs: 5,
        response: "could not analyze repo",
      });

      await processWorkflow(wf, TEST_TOKEN, deps);

      expect(mocks.runDevAgent).not.toHaveBeenCalled();
      expect(mocks.createPullRequest).not.toHaveBeenCalled();
    });

    it("should emit dev step events", async () => {
      const { deps, emittedEvents } = makeDeps();
      const wf = makeWorkflow();

      await processWorkflow(wf, TEST_TOKEN, deps);

      const devEvents = emittedEvents.filter(
        (e) => e.type === "step:updated" && (e.data as Record<string, unknown>).type === "dev"
      );
      expect(devEvents.length).toBeGreaterThanOrEqual(2); // running + passed
    });

    it("should stop after review step — e2e steps remain pending", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      await processWorkflow(wf, TEST_TOKEN, deps);

      // plan, dev, ci, review should have been set to running
      const runningCalls = mocks.stepUpdateStatus.mock.calls.filter(
        (c) => c[1] === "running"
      );
      expect(runningCalls).toHaveLength(4); // plan + dev + ci + review
    });

    it("should use PR title from task (first 72 chars)", async () => {
      const { deps, mocks } = makeDeps();
      const longTask =
        "Implement a comprehensive authentication system with OAuth2 support, multi-factor authentication, and session management";
      const wf = makeWorkflow({ task: longTask });

      await processWorkflow(wf, TEST_TOKEN, deps);

      const prArgs = mocks.createPullRequest.mock.calls[0][0];
      expect(prArgs.title.length).toBeLessThanOrEqual(72);
    });

    it("should use proposal as PR body", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      mocks.runPlanner.mockResolvedValue({
        proposal: "## Summary\nDetailed plan here",
        exitCode: 0,
        durationSecs: 30,
        response: "output",
      });

      await processWorkflow(wf, TEST_TOKEN, deps);

      const prArgs = mocks.createPullRequest.mock.calls[0][0];
      expect(prArgs.body).toContain("## Summary\nDetailed plan here");
    });

    it("should record dev agent run with prompt, response, exit_code, duration", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      mocks.runDevAgent.mockResolvedValue({
        exitCode: 0,
        durationSecs: 120,
        response: "full dev output",
      });

      await processWorkflow(wf, TEST_TOKEN, deps);

      // Second run create call is for dev
      expect(mocks.runCreate).toHaveBeenCalledTimes(3); // planner + dev + reviewer
      const devCreateArg = mocks.runCreate.mock.calls[1][0] as Record<string, unknown>;
      expect(devCreateArg.agentRole).toBe("dev");
      expect(devCreateArg.prompt).toBeTruthy();

      // Second run update is for dev
      expect(mocks.runUpdateResult).toHaveBeenCalledTimes(3);
      const devUpdateArg = mocks.runUpdateResult.mock.calls[1][1] as Record<string, unknown>;
      expect(devUpdateArg.response).toBe("full dev output");
      expect(devUpdateArg.exitCode).toBe(0);
      expect(devUpdateArg.durationSecs).toBe(120);
    });

    it("should emit workflow:completed after successful PR creation", async () => {
      const { deps, emittedEvents } = makeDeps();
      const wf = makeWorkflow();

      await processWorkflow(wf, TEST_TOKEN, deps);

      const completedEvents = emittedEvents.filter(
        (e) => e.type === "workflow:completed"
      );
      expect(completedEvents).toHaveLength(1);
      const data = completedEvents[0].data as Record<string, unknown>;
      expect(data.status).toBe("running");
      expect(data.pr_number).toBe(42);
    });

    it("should fail workflow when PR creation throws", async () => {
      const { deps, mocks, emittedEvents } = makeDeps();
      const wf = makeWorkflow();

      mocks.createPullRequest.mockRejectedValue(
        new Error("GitHub API error creating PR (422): Validation Failed")
      );

      await processWorkflow(wf, TEST_TOKEN, deps);

      // Workflow should be failed
      expect(mocks.updateError).toHaveBeenCalledTimes(1);
      const errorMsg = mocks.updateError.mock.calls[0][1] as string;
      expect(errorMsg).toContain("PR creation failed");

      // PR number should NOT be stored
      expect(mocks.updatePrNumber).not.toHaveBeenCalled();

      // workflow:completed event should fire
      const completedEvents = emittedEvents.filter(
        (e) => e.type === "workflow:completed"
      );
      expect(completedEvents).toHaveLength(1);
    });

    // --- CI step tests ---

    it("should execute ci step after PR creation", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      await processWorkflow(wf, TEST_TOKEN, deps);

      // CI step should transition to running then passed
      const ciStepIndex = STEP_TYPES.indexOf("ci");
      expect(mocks.stepUpdateStatus).toHaveBeenCalledWith(`step-${ciStepIndex}`, "running");
      expect(mocks.stepUpdateStatus).toHaveBeenCalledWith(`step-${ciStepIndex}`, "passed", undefined);
      expect(mocks.pollCiStatus).toHaveBeenCalledTimes(1);
      expect(mocks.getHeadSha).toHaveBeenCalledTimes(1);
    });

    it("should pass head SHA from branch to CI poller", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow({ branch: "cadence/feat-1" });
      mocks.getHeadSha.mockResolvedValue("deadbeef");

      await processWorkflow(wf, TEST_TOKEN, deps);

      expect(mocks.getHeadSha).toHaveBeenCalledWith(TEST_TOKEN, "acme/webapp", "cadence/feat-1");
      expect(mocks.pollCiStatus).toHaveBeenCalledWith("acme/webapp", "deadbeef", TEST_TOKEN);
    });

    // --- Review step tests ---

    it("should execute review step after ci passes", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      await processWorkflow(wf, TEST_TOKEN, deps);

      // Review step should transition to running then passed
      const reviewStepIndex = STEP_TYPES.indexOf("review");
      expect(mocks.stepUpdateStatus).toHaveBeenCalledWith(`step-${reviewStepIndex}`, "running");
      expect(mocks.stepUpdateStatus).toHaveBeenCalledWith(`step-${reviewStepIndex}`, "passed", undefined);
      expect(mocks.runReviewAgent).toHaveBeenCalledTimes(1);
    });

    it("should record reviewer run with agent_role reviewer", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      await processWorkflow(wf, TEST_TOKEN, deps);

      // Should have 3 run creates: planner, dev, reviewer
      expect(mocks.runCreate).toHaveBeenCalledTimes(3);
      const reviewCreateArg = mocks.runCreate.mock.calls[2][0] as Record<string, unknown>;
      expect(reviewCreateArg.agentRole).toBe("reviewer");
    });

    it("should fetch PR diff for review agent", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      await processWorkflow(wf, TEST_TOKEN, deps);

      expect(mocks.getPrDiff).toHaveBeenCalledWith(TEST_TOKEN, "acme/webapp", 42);
    });

    it("should stop after review passes — e2e steps remain pending", async () => {
      const { deps, mocks, emittedEvents } = makeDeps();
      const wf = makeWorkflow();

      await processWorkflow(wf, TEST_TOKEN, deps);

      // Only plan, dev, ci, review should have been set to running
      const runningCalls = mocks.stepUpdateStatus.mock.calls.filter(
        (c) => c[1] === "running"
      );
      expect(runningCalls).toHaveLength(4); // plan + dev + ci + review

      // Should emit workflow:completed
      const completedEvents = emittedEvents.filter(
        (e) => e.type === "workflow:completed"
      );
      expect(completedEvents).toHaveLength(1);
    });

    // --- Regression tests ---

    it("should regress when ci step fails", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      let ciCallCount = 0;
      mocks.pollCiStatus.mockImplementation(() => {
        ciCallCount++;
        if (ciCallCount === 1) {
          return Promise.resolve({
            status: "failed" as const,
            detail: "CI checks failed:\nbuild (failure): compilation error",
          });
        }
        return Promise.resolve({ status: "passed" as const, detail: null });
      });

      await processWorkflow(wf, TEST_TOKEN, deps);

      // CI step should be failed
      const ciStepIndex = STEP_TYPES.indexOf("ci");
      expect(mocks.stepUpdateStatus).toHaveBeenCalledWith(
        `step-${ciStepIndex}`,
        "failed",
        expect.any(String)
      );

      // Iteration should be incremented
      expect(mocks.updateIteration).toHaveBeenCalledWith("wf-1", 1);

      // New iteration steps should be created
      expect(mocks.createIterationSteps).toHaveBeenCalledWith("wf-1", 1);
    });

    it("should regress when review step fails", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      let reviewCallCount = 0;
      mocks.runReviewAgent.mockImplementation(() => {
        reviewCallCount++;
        if (reviewCallCount === 1) {
          return Promise.resolve({
            reviewPass: false,
            verdict: '{"review_pass": false, "blocking_issues": ["missing tests"]}',
            exitCode: 0,
            durationSecs: 20,
            response: "review output",
          });
        }
        return Promise.resolve({
          reviewPass: true,
          verdict: '{"review_pass": true}',
          exitCode: 0,
          durationSecs: 25,
          response: "LGTM",
        });
      });

      await processWorkflow(wf, TEST_TOKEN, deps);

      // Review step should be failed
      const reviewStepIndex = STEP_TYPES.indexOf("review");
      expect(mocks.stepUpdateStatus).toHaveBeenCalledWith(
        `step-${reviewStepIndex}`,
        "failed",
        expect.any(String)
      );

      // Iteration should be incremented
      expect(mocks.updateIteration).toHaveBeenCalledWith("wf-1", 1);
    });

    it("should include failure context in regression dev prompt", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      let ciCallCount = 0;
      mocks.pollCiStatus.mockImplementation(() => {
        ciCallCount++;
        if (ciCallCount === 1) {
          return Promise.resolve({
            status: "failed" as const,
            detail: "CI checks failed:\nbuild (failure): compilation error",
          });
        }
        return Promise.resolve({ status: "passed" as const, detail: null });
      });

      await processWorkflow(wf, TEST_TOKEN, deps);

      // Dev agent should be called twice (once per iteration)
      expect(mocks.runDevAgent).toHaveBeenCalledTimes(2);

      // The workflow should carry regression context — checked via the run's prompt
      const devRunCreateCalls = mocks.runCreate.mock.calls.filter(
        (c) => (c[0] as Record<string, unknown>).agentRole === "dev"
      );
      expect(devRunCreateCalls).toHaveLength(2);
      const secondDevPrompt = (devRunCreateCalls[1][0] as Record<string, unknown>).prompt as string;
      expect(secondDevPrompt).toContain("compilation error");
    });

    it("should not create plan step on regression iteration", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      let ciCallCount = 0;
      mocks.pollCiStatus.mockImplementation(() => {
        ciCallCount++;
        if (ciCallCount === 1) {
          return Promise.resolve({ status: "failed" as const, detail: "CI failed" });
        }
        return Promise.resolve({ status: "passed" as const, detail: null });
      });

      await processWorkflow(wf, TEST_TOKEN, deps);

      // Second createIterationSteps call should be for iteration 1
      expect(mocks.createIterationSteps).toHaveBeenCalledWith("wf-1", 1);
      // Planner should only be called once (iteration 0)
      expect(mocks.runPlanner).toHaveBeenCalledTimes(1);
    });

    it("should reuse same PR on regression — no new PR created", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      let ciCallCount = 0;
      mocks.pollCiStatus.mockImplementation(() => {
        ciCallCount++;
        if (ciCallCount === 1) {
          return Promise.resolve({ status: "failed" as const, detail: "CI failed" });
        }
        return Promise.resolve({ status: "passed" as const, detail: null });
      });

      await processWorkflow(wf, TEST_TOKEN, deps);

      // PR should only be created once
      expect(mocks.createPullRequest).toHaveBeenCalledTimes(1);
    });

    it("should fail workflow when iteration limit reached during regression", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow({ iteration: 7, max_iters: 8 });

      // CI fails, would trigger regression to iteration 8 which exceeds max
      mocks.pollCiStatus.mockResolvedValue({
        status: "failed",
        detail: "CI failed again",
      });

      await processWorkflow(wf, TEST_TOKEN, deps);

      // Should fail with iteration limit
      expect(mocks.updateError).toHaveBeenCalledTimes(1);
      const errorMsg = mocks.updateError.mock.calls[0][1] as string;
      expect(errorMsg).toContain("iteration limit");
    });

    it("should emit regression event when regressing", async () => {
      const { deps, mocks, emittedEvents } = makeDeps();
      const wf = makeWorkflow();

      let ciCallCount = 0;
      mocks.pollCiStatus.mockImplementation(() => {
        ciCallCount++;
        if (ciCallCount === 1) {
          return Promise.resolve({ status: "failed" as const, detail: "CI failed" });
        }
        return Promise.resolve({ status: "passed" as const, detail: null });
      });

      await processWorkflow(wf, TEST_TOKEN, deps);

      const regressionEvents = emittedEvents.filter(
        (e) => e.type === "workflow:updated" && (e.data as Record<string, unknown>).regression === true
      );
      expect(regressionEvents).toHaveLength(1);
    });

    it("should include review verdict in reviewer run response", async () => {
      const { deps, mocks } = makeDeps();
      const wf = makeWorkflow();

      mocks.runReviewAgent.mockResolvedValue({
        reviewPass: true,
        verdict: '{"review_pass": true}',
        exitCode: 0,
        durationSecs: 25,
        response: "All criteria met. LGTM.",
      });

      await processWorkflow(wf, TEST_TOKEN, deps);

      // Third runUpdateResult is for reviewer
      expect(mocks.runUpdateResult).toHaveBeenCalledTimes(3);
      const reviewUpdateArg = mocks.runUpdateResult.mock.calls[2][1] as Record<string, unknown>;
      expect(reviewUpdateArg.response).toBe('{"review_pass": true}');
    });
  });
});
