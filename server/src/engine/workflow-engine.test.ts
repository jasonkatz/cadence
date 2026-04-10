import { describe, it, expect, mock } from "bun:test";
import type { Workflow } from "../dao/workflow-dao";
import type { Step } from "../dao/step-dao";
import type { Run } from "../dao/run-dao";
import type { WorkflowEvent } from "../events/event-bus";
import type { EngineDeps } from "./workflow-engine";
import type { JobData } from "./job-queue";
import type { DevResult } from "./dev-agent";
import type { CiPollResult } from "./ci-poller";
import type { ReviewResult } from "./review-agent";
import type { E2eResult } from "./e2e-agent";
import type { E2eVerifierResult } from "./e2e-verifier";
import {
  handlePlan, handleDev, handleCi, handleReview,
  handleE2e, handleE2eVerify, handleSignoff,
  startIteration, JOB_TYPES,
} from "./workflow-engine";

function makeWorkflow(overrides?: Partial<Workflow>): Workflow {
  return { id: "wf-1", task: "add login page", repo: "acme/webapp", branch: "tmpo/abc123", requirements: null, proposal: null, pr_number: null, status: "pending", iteration: 0, max_iters: 8, error: null, created_at: new Date(), updated_at: new Date(), ...overrides };
}
function makeStep(overrides?: Partial<Step>): Step {
  return { id: "step-1", workflow_id: "wf-1", iteration: 0, type: "plan", status: "pending", started_at: null, finished_at: null, detail: null, ...overrides };
}
function makeRun(overrides?: Partial<Run>): Run {
  return { id: "run-1", step_id: "step-1", workflow_id: "wf-1", agent_role: "planner", iteration: 0, log_path: "/tmp/.tmpo/runs/wf-1/plan-0.jsonl", exit_code: null, duration_secs: null, created_at: new Date(), ...overrides };
}

const STEP_TYPES = ["plan", "dev", "ci", "review", "e2e", "e2e_verify", "signoff"];
const TEST_TOKEN = "ghp_testtoken123";

function makeStepIds(): Record<string, string> {
  const ids: Record<string, string> = {};
  STEP_TYPES.forEach((type, i) => { ids[type] = `step-${i}`; });
  return ids;
}
function makeJobData(overrides?: Partial<JobData>): JobData {
  return { workflowId: "wf-1", iteration: 0, stepIds: makeStepIds(), ...overrides };
}

function makeDeps() {
  const emittedEvents: WorkflowEvent[] = [];
  const mockFindById = mock((_id: string) => Promise.resolve(makeWorkflow() as Workflow | null));
  const mockUpdateStatus = mock((_id: string, _s: string) => Promise.resolve(makeWorkflow({ status: "running" })));
  const mockUpdateProposal = mock((_id: string, _p: string) => Promise.resolve(makeWorkflow({ proposal: "# Plan" })));
  const mockUpdateError = mock((_id: string, _e: string) => Promise.resolve(makeWorkflow({ status: "failed" })));
  const mockUpdatePrNumber = mock((_id: string, _prNumber: number) => Promise.resolve(makeWorkflow({ pr_number: 42 })));
  const mockUpdateIteration = mock((_id: string, _iter: number) => Promise.resolve(makeWorkflow({ iteration: 1 })));
  const mockList = mock((_params: unknown) => Promise.resolve({ workflows: [] as Workflow[], total: 0 }));
  const mockCreateIterationSteps = mock((_wfId: string, _iter: number) => Promise.resolve(STEP_TYPES.map((type, i) => makeStep({ id: `step-${i}`, type }))));
  const mockStepUpdateStatus = mock((id: string, status: string, _d?: string) => Promise.resolve(makeStep({ id, status })));
  const mockStepFindByWorkflowId = mock((_wfId: string, _filters?: unknown) => Promise.resolve([] as Step[]));
  const mockRunCreate = mock((_data: unknown) => Promise.resolve(makeRun()));
  const mockRunUpdateResult = mock((_id: string, _data: unknown) => Promise.resolve(makeRun({ exit_code: 0, duration_secs: 30 })));
  const mockRunPlanner = mock((_workflow: Workflow, _token: string) => Promise.resolve({ proposal: "# Plan\n...", exitCode: 0, durationSecs: 30, response: "proposal text" }));
  const mockRunDevAgent = mock((_workflow: Workflow, _token: string) => Promise.resolve<DevResult>({ exitCode: 0, durationSecs: 60, response: "dev agent output" }));
  const mockCreatePullRequest = mock((_params: { token: string; repo: string; head: string; title: string; body: string }) => Promise.resolve({ number: 42, url: "https://github.com/acme/webapp/pull/42" }));
  const mockPollCiStatus = mock((_repo: string, _sha: string, _token: string) => Promise.resolve<CiPollResult>({ status: "passed", detail: null }));
  const mockRunReviewAgent = mock((_workflow: Workflow, _diff: string, _token: string) => Promise.resolve<ReviewResult>({ reviewPass: true, verdict: '{"review_pass": true}', exitCode: 0, durationSecs: 30, response: "review output" }));
  const mockGetPrDiff = mock((_token: string, _repo: string, _prNumber: number) => Promise.resolve("diff content"));
  const mockGetHeadSha = mock((_token: string, _repo: string, _branch: string) => Promise.resolve("abc123sha"));
  const mockGeneratePrDescription = mock((_task: string, _proposal: string) => Promise.resolve({ title: "Add login page", body: "Implements login with email/password." }));
  const mockPostPrComment = mock((_params: { token: string; repo: string; prNumber: number; body: string }) => Promise.resolve());
  const mockRunE2eAgent = mock((_workflow: Workflow, _token: string) => Promise.resolve<E2eResult>({ e2ePass: true, evidence: "All user journeys passed.", exitCode: 0, durationSecs: 120, response: "E2E evidence output" }));
  const mockRunE2eVerifier = mock((_workflow: Workflow, _evidence: string, _token: string) => Promise.resolve<E2eVerifierResult>({ e2ePass: true, verdict: '{"e2e_pass": true}', exitCode: 0, durationSecs: 30, response: "All criteria verified." }));
  const mockGetDecryptedToken = mock(() => TEST_TOKEN);
  const enqueuedJobs: { name: string; data: JobData }[] = [];
  const mockEnqueueJob = mock((name: string, data: JobData) => { enqueuedJobs.push({ name, data }); return Promise.resolve("job-id-1"); });

  const deps: EngineDeps = {
    workflowDao: { findById: mockFindById, updateStatus: mockUpdateStatus, updateProposal: mockUpdateProposal, updateError: mockUpdateError, updatePrNumber: mockUpdatePrNumber, updateIteration: mockUpdateIteration, list: mockList, findPending: mock(() => Promise.resolve(null)) } as unknown as EngineDeps["workflowDao"],
    stepDao: { createIterationSteps: mockCreateIterationSteps, updateStatus: mockStepUpdateStatus, findByWorkflowId: mockStepFindByWorkflowId } as unknown as EngineDeps["stepDao"],
    runDao: { create: mockRunCreate, updateResult: mockRunUpdateResult } as unknown as EngineDeps["runDao"],
    eventBus: { emit: (event: WorkflowEvent) => emittedEvents.push(event), subscribe: () => {}, unsubscribe: () => {}, removeAllListeners: () => {} },
    runPlannerAgent: mockRunPlanner, runDevAgent: mockRunDevAgent, createPullRequest: mockCreatePullRequest,
    pollCiStatus: mockPollCiStatus, runReviewAgent: mockRunReviewAgent, getPrDiff: mockGetPrDiff, getHeadSha: mockGetHeadSha,
    postPrComment: mockPostPrComment, generatePrDescription: mockGeneratePrDescription,
    runE2eAgent: mockRunE2eAgent, runE2eVerifier: mockRunE2eVerifier,
    getDecryptedToken: mockGetDecryptedToken, enqueueJob: mockEnqueueJob,
  };

  return {
    deps, emittedEvents, enqueuedJobs,
    mocks: { findById: mockFindById, updateStatus: mockUpdateStatus, updateProposal: mockUpdateProposal, updateError: mockUpdateError, updatePrNumber: mockUpdatePrNumber, updateIteration: mockUpdateIteration, createIterationSteps: mockCreateIterationSteps, stepUpdateStatus: mockStepUpdateStatus, runCreate: mockRunCreate, runUpdateResult: mockRunUpdateResult, runPlanner: mockRunPlanner, runDevAgent: mockRunDevAgent, createPullRequest: mockCreatePullRequest, pollCiStatus: mockPollCiStatus, runReviewAgent: mockRunReviewAgent, getPrDiff: mockGetPrDiff, getHeadSha: mockGetHeadSha, postPrComment: mockPostPrComment, generatePrDescription: mockGeneratePrDescription, runE2eAgent: mockRunE2eAgent, runE2eVerifier: mockRunE2eVerifier, getDecryptedToken: mockGetDecryptedToken, enqueueJob: mockEnqueueJob },
  };
}

async function runPipeline(startJob: string, data: JobData, deps: EngineDeps, enqueuedJobs: { name: string; data: JobData }[]): Promise<void> {
  const handlers: Record<string, (data: JobData, deps: EngineDeps) => Promise<void>> = {
    [JOB_TYPES.plan]: handlePlan, [JOB_TYPES.dev]: handleDev, [JOB_TYPES.ci]: handleCi,
    [JOB_TYPES.review]: handleReview, [JOB_TYPES.e2e]: handleE2e,
    [JOB_TYPES["e2e-verify"]]: handleE2eVerify, [JOB_TYPES.signoff]: handleSignoff,
  };
  let currentJob = startJob;
  let currentData = data;
  while (currentJob && handlers[currentJob]) {
    const beforeCount = enqueuedJobs.length;
    await handlers[currentJob](currentData, deps);
    if (enqueuedJobs.length > beforeCount) {
      const last = enqueuedJobs[enqueuedJobs.length - 1];
      currentJob = last.name;
      currentData = last.data;
    } else { break; }
  }
}

describe("workflow engine", () => {
  describe("handlePlan", () => {
    it("should transition workflow from pending to running", async () => {
      const { deps, mocks } = makeDeps();
      await handlePlan(makeJobData(), deps);
      expect(mocks.updateStatus).toHaveBeenCalledWith("wf-1", "running");
    });
    it("should execute plan step and store proposal on success", async () => {
      const { deps, mocks } = makeDeps();
      mocks.runPlanner.mockResolvedValue({ proposal: "# Summary", exitCode: 0, durationSecs: 45, response: "full response" });
      await handlePlan(makeJobData(), deps);
      expect(mocks.stepUpdateStatus).toHaveBeenCalledWith("step-0", "running");
      expect(mocks.stepUpdateStatus).toHaveBeenCalledWith("step-0", "passed", undefined);
      expect(mocks.updateProposal).toHaveBeenCalledTimes(1);
    });
    it("should fail workflow when plan step fails", async () => {
      const { deps, mocks } = makeDeps();
      mocks.runPlanner.mockResolvedValue({ proposal: null, exitCode: 1, durationSecs: 10, response: "Error" });
      await handlePlan(makeJobData(), deps);
      expect(mocks.stepUpdateStatus).toHaveBeenCalledWith("step-0", "failed", expect.any(String));
      expect(mocks.updateError).toHaveBeenCalledTimes(1);
    });
    it("should fail workflow when iteration exceeds max_iters", async () => {
      const { deps, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ iteration: 8, max_iters: 8 }));
      await handlePlan(makeJobData({ iteration: 8 }), deps);
      expect(mocks.updateError.mock.calls[0][1]).toContain("iteration limit");
    });
    it("should enqueue tmpo.dev after plan succeeds", async () => {
      const { deps, enqueuedJobs } = makeDeps();
      await handlePlan(makeJobData(), deps);
      expect(enqueuedJobs).toHaveLength(1);
      expect(enqueuedJobs[0].name).toBe(JOB_TYPES.dev);
    });
    it("should not enqueue next job when plan fails", async () => {
      const { deps, mocks, enqueuedJobs } = makeDeps();
      mocks.runPlanner.mockResolvedValue({ proposal: null, exitCode: 1, durationSecs: 5, response: "fail" });
      await handlePlan(makeJobData(), deps);
      expect(enqueuedJobs).toHaveLength(0);
    });
    it("should emit SSE events for step transitions", async () => {
      const { deps, emittedEvents } = makeDeps();
      await handlePlan(makeJobData(), deps);
      expect(emittedEvents.filter((e) => e.type === "step:updated").length).toBeGreaterThanOrEqual(2);
    });
    it("should record planner agent run", async () => {
      const { deps, mocks } = makeDeps();
      mocks.runPlanner.mockResolvedValue({ proposal: "# Plan", exitCode: 0, durationSecs: 42, response: "full agent output" });
      await handlePlan(makeJobData(), deps);
      const createArg = mocks.runCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(createArg.agentRole).toBe("planner");
      const updateArg = mocks.runUpdateResult.mock.calls[0][1] as Record<string, unknown>;
      expect(updateArg.exitCode).toBe(0);
      expect(updateArg.durationSecs).toBe(42);
    });
    it("should not proceed for cancelled workflow", async () => {
      const { deps, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "cancelled" }));
      await handlePlan(makeJobData(), deps);
      expect(mocks.runPlanner).not.toHaveBeenCalled();
    });
  });

  describe("handleDev", () => {
    it("should execute dev step and enqueue ci on success", async () => {
      const { deps, mocks, enqueuedJobs } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "running", proposal: "# Plan" }));
      await handleDev(makeJobData(), deps);
      expect(mocks.runDevAgent).toHaveBeenCalledTimes(1);
      expect(enqueuedJobs[0].name).toBe(JOB_TYPES.ci);
    });
    it("should fail workflow when dev step fails", async () => {
      const { deps, mocks, enqueuedJobs } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "running", proposal: "# Plan" }));
      mocks.runDevAgent.mockResolvedValue({ exitCode: 1, durationSecs: 10, response: "compilation failed" });
      await handleDev(makeJobData(), deps);
      expect(mocks.updateError).toHaveBeenCalledTimes(1);
      expect(enqueuedJobs).toHaveLength(0);
    });
    it("should create PR after dev step passes", async () => {
      const { deps, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "running", proposal: "# Plan" }));
      await handleDev(makeJobData(), deps);
      expect(mocks.createPullRequest).toHaveBeenCalledTimes(1);
      expect(mocks.updatePrNumber).toHaveBeenCalledWith("wf-1", 42);
    });
    it("should not create PR on regression", async () => {
      const { deps, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "running", proposal: "# Plan", pr_number: 42, iteration: 1 }));
      await handleDev(makeJobData({ iteration: 1 }), deps);
      expect(mocks.createPullRequest).not.toHaveBeenCalled();
    });
    it("should fail workflow when PR creation throws", async () => {
      const { deps, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "running", proposal: "# Plan" }));
      mocks.createPullRequest.mockRejectedValue(new Error("GitHub API error"));
      await handleDev(makeJobData(), deps);
      expect((mocks.updateError.mock.calls[0][1] as string)).toContain("PR creation failed");
    });
    it("should use generated PR title and body", async () => {
      const { deps, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "running", proposal: "# Plan" }));
      mocks.generatePrDescription.mockResolvedValue({ title: "Add auth", body: "OAuth2 flow." });
      await handleDev(makeJobData(), deps);
      const prArgs = mocks.createPullRequest.mock.calls[0][0];
      expect(prArgs.title).toBe("Add auth");
    });
    it("should include failure context in dev prompt on regression", async () => {
      const { deps, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "running", proposal: "# Plan", pr_number: 42, iteration: 1 }));
      await handleDev(makeJobData({ iteration: 1, failureContext: "compilation error" }), deps);
      expect((mocks.runCreate.mock.calls[0][0] as Record<string, unknown>).logPath as string).toBeDefined();
    });
  });

  describe("handleCi", () => {
    it("should execute ci step and enqueue review on success", async () => {
      const { deps, mocks, enqueuedJobs } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "running", pr_number: 42 }));
      await handleCi(makeJobData(), deps);
      expect(mocks.pollCiStatus).toHaveBeenCalledTimes(1);
      expect(enqueuedJobs[0].name).toBe(JOB_TYPES.review);
    });
    it("should pass head SHA from branch to CI poller", async () => {
      const { deps, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "running", pr_number: 42, branch: "tmpo/feat-1" }));
      mocks.getHeadSha.mockResolvedValue("deadbeef");
      await handleCi(makeJobData(), deps);
      expect(mocks.getHeadSha).toHaveBeenCalledWith(TEST_TOKEN, "acme/webapp", "tmpo/feat-1");
      expect(mocks.pollCiStatus).toHaveBeenCalledWith("acme/webapp", "deadbeef", TEST_TOKEN);
    });
    it("should regress when ci step fails", async () => {
      const { deps, mocks, enqueuedJobs } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "running", pr_number: 42 }));
      mocks.pollCiStatus.mockResolvedValue({ status: "failed", detail: "CI failed" });
      await handleCi(makeJobData(), deps);
      expect(mocks.updateIteration).toHaveBeenCalledWith("wf-1", 1);
      expect(enqueuedJobs[enqueuedJobs.length - 1].name).toBe(JOB_TYPES.dev);
    });
  });

  describe("handleReview", () => {
    it("should execute review step and enqueue e2e on success", async () => {
      const { deps, mocks, enqueuedJobs } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "running", pr_number: 42 }));
      await handleReview(makeJobData(), deps);
      expect(mocks.runReviewAgent).toHaveBeenCalledTimes(1);
      expect(enqueuedJobs[0].name).toBe(JOB_TYPES.e2e);
    });
    it("should fetch PR diff for review agent", async () => {
      const { deps, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "running", pr_number: 42 }));
      await handleReview(makeJobData(), deps);
      expect(mocks.getPrDiff).toHaveBeenCalledWith(TEST_TOKEN, "acme/webapp", 42);
    });
    it("should regress when review step fails", async () => {
      const { deps, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "running", pr_number: 42 }));
      mocks.runReviewAgent.mockResolvedValue({ reviewPass: false, verdict: '{"review_pass": false}', exitCode: 0, durationSecs: 20, response: "fail" });
      await handleReview(makeJobData(), deps);
      expect(mocks.updateIteration).toHaveBeenCalledWith("wf-1", 1);
    });
    it("should post review comment", async () => {
      const { deps, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "running", pr_number: 42 }));
      await handleReview(makeJobData(), deps);
      expect(mocks.postPrComment).toHaveBeenCalledTimes(1);
      expect(mocks.postPrComment.mock.calls[0][0].body).toContain("Review passed");
    });
    it("should not fail workflow if PR comment fails to post", async () => {
      const { deps, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "running", pr_number: 42 }));
      mocks.postPrComment.mockRejectedValue(new Error("GitHub API 403"));
      await handleReview(makeJobData(), deps);
      expect(mocks.updateError).not.toHaveBeenCalled();
    });
  });

  describe("handleE2e", () => {
    it("should execute e2e step and enqueue e2e-verify on success", async () => {
      const { deps, enqueuedJobs, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "running", pr_number: 42 }));
      await handleE2e(makeJobData(), deps);
      expect(enqueuedJobs[0].name).toBe(JOB_TYPES["e2e-verify"]);
    });
    it("should pass e2e evidence in next job data", async () => {
      const { deps, mocks, enqueuedJobs } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "running", pr_number: 42 }));
      mocks.runE2eAgent.mockResolvedValue({ e2ePass: true, evidence: "screenshot", exitCode: 0, durationSecs: 120, response: "ok" });
      await handleE2e(makeJobData(), deps);
      expect(enqueuedJobs[0].data.e2eEvidence).toBe("screenshot");
    });
    it("should regress when e2e step fails", async () => {
      const { deps, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "running", pr_number: 42 }));
      mocks.runE2eAgent.mockResolvedValue({ e2ePass: false, evidence: "", exitCode: 1, durationSecs: 60, response: "E2E failed" });
      await handleE2e(makeJobData(), deps);
      expect(mocks.updateIteration).toHaveBeenCalledWith("wf-1", 1);
    });
  });

  describe("handleE2eVerify", () => {
    it("should execute e2e_verify step and enqueue signoff on success", async () => {
      const { deps, enqueuedJobs, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "running", pr_number: 42 }));
      await handleE2eVerify(makeJobData({ e2eEvidence: "evidence" }), deps);
      expect(enqueuedJobs[0].name).toBe(JOB_TYPES.signoff);
    });
    it("should pass e2e evidence to e2e verifier", async () => {
      const { deps, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "running", pr_number: 42 }));
      await handleE2eVerify(makeJobData({ e2eEvidence: "Login form screenshot" }), deps);
      expect(mocks.runE2eVerifier.mock.calls[0][1]).toBe("Login form screenshot");
    });
    it("should regress when e2e_verify step fails", async () => {
      const { deps, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "running", pr_number: 42 }));
      mocks.runE2eVerifier.mockResolvedValue({ e2ePass: false, verdict: '{"e2e_pass": false}', exitCode: 0, durationSecs: 30, response: "Missing." });
      await handleE2eVerify(makeJobData({ e2eEvidence: "evidence" }), deps);
      expect(mocks.updateIteration).toHaveBeenCalledWith("wf-1", 1);
    });
  });

  describe("handleSignoff", () => {
    it("should auto-pass signoff and complete workflow", async () => {
      const { deps, mocks, emittedEvents } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "running", pr_number: 42 }));
      await handleSignoff(makeJobData(), deps);
      expect(mocks.stepUpdateStatus).toHaveBeenCalledWith("step-6", "passed", undefined);
      expect(mocks.updateStatus).toHaveBeenCalledWith("wf-1", "complete");
      const ce = emittedEvents.filter((e) => e.type === "workflow:completed");
      expect(ce).toHaveLength(1);
      expect((ce[0].data as Record<string, unknown>).status).toBe("complete");
    });
  });

  describe("startIteration", () => {
    it("should create steps and enqueue plan for iteration 0", async () => {
      const { deps, mocks, enqueuedJobs } = makeDeps();
      await startIteration("wf-1", 0, undefined, deps);
      expect(mocks.createIterationSteps).toHaveBeenCalledWith("wf-1", 0);
      expect(enqueuedJobs[0].name).toBe(JOB_TYPES.plan);
    });
    it("should enqueue dev for iteration > 0", async () => {
      const { deps, enqueuedJobs } = makeDeps();
      await startIteration("wf-1", 1, "CI failed", deps);
      expect(enqueuedJobs[0].name).toBe(JOB_TYPES.dev);
      expect(enqueuedJobs[0].data.failureContext).toBe("CI failed");
    });
  });

  describe("full pipeline", () => {
    it("should process all 7 steps through signoff", async () => {
      const { deps, mocks, enqueuedJobs } = makeDeps();
      let c = 0;
      mocks.findById.mockImplementation(() => { c++; if (c === 1) return Promise.resolve(makeWorkflow({ status: "pending" })); if (c === 2) return Promise.resolve(makeWorkflow({ status: "running", proposal: "# Plan", pr_number: null })); return Promise.resolve(makeWorkflow({ status: "running", proposal: "# Plan", pr_number: 42 })); });
      await runPipeline(JOB_TYPES.plan, makeJobData(), deps, enqueuedJobs);
      expect(mocks.stepUpdateStatus.mock.calls.filter((c) => c[1] === "running")).toHaveLength(6);
    });
    it("should emit workflow:completed after all steps pass", async () => {
      const { deps, mocks, emittedEvents, enqueuedJobs } = makeDeps();
      let c = 0;
      mocks.findById.mockImplementation(() => { c++; if (c === 1) return Promise.resolve(makeWorkflow({ status: "pending" })); if (c === 2) return Promise.resolve(makeWorkflow({ status: "running", proposal: "# Plan", pr_number: null })); return Promise.resolve(makeWorkflow({ status: "running", proposal: "# Plan", pr_number: 42 })); });
      await runPipeline(JOB_TYPES.plan, makeJobData(), deps, enqueuedJobs);
      const ce = emittedEvents.filter((e) => e.type === "workflow:completed");
      expect(ce).toHaveLength(1);
      expect((ce[0].data as Record<string, unknown>).status).toBe("complete");
    });
    it("should post 4 PR comments", async () => {
      const { deps, mocks, enqueuedJobs } = makeDeps();
      let c = 0;
      mocks.findById.mockImplementation(() => { c++; if (c === 1) return Promise.resolve(makeWorkflow({ status: "pending" })); if (c === 2) return Promise.resolve(makeWorkflow({ status: "running", proposal: "# Plan", pr_number: null })); return Promise.resolve(makeWorkflow({ status: "running", proposal: "# Plan", pr_number: 42 })); });
      await runPipeline(JOB_TYPES.plan, makeJobData(), deps, enqueuedJobs);
      expect(mocks.postPrComment).toHaveBeenCalledTimes(4);
    });
    it("should fail when iteration limit reached during regression", async () => {
      const { deps, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "running", pr_number: 42, iteration: 7, max_iters: 8 }));
      mocks.pollCiStatus.mockResolvedValue({ status: "failed", detail: "CI failed" });
      await handleCi(makeJobData({ iteration: 7 }), deps);
      expect(mocks.updateError.mock.calls[0][1] as string).toContain("iteration limit");
    });
    it("should emit regression event", async () => {
      const { deps, mocks, emittedEvents } = makeDeps();
      mocks.findById.mockResolvedValue(makeWorkflow({ status: "running", pr_number: 42 }));
      mocks.pollCiStatus.mockResolvedValue({ status: "failed", detail: "CI failed" });
      await handleCi(makeJobData(), deps);
      expect(emittedEvents.filter((e) => e.type === "workflow:updated" && (e.data as Record<string, unknown>).regression === true)).toHaveLength(1);
    });
  });
});
