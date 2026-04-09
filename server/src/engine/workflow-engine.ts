import { workflowDao as defaultWorkflowDao, Workflow } from "../dao/workflow-dao";
import { stepDao as defaultStepDao } from "../dao/step-dao";
import { runDao as defaultRunDao } from "../dao/run-dao";
import { eventBus as defaultEventBus } from "../events/event-bus";
import { runPlannerAgent as defaultRunPlanner } from "./planner-agent";
import { runDevAgent as defaultRunDevAgent } from "./dev-agent";
import { pollCiStatus as defaultPollCiStatus } from "./ci-poller";
import { runReviewAgent as defaultRunReviewAgent } from "./review-agent";
import { runE2eAgent as defaultRunE2eAgent } from "./e2e-agent";
import { runE2eVerifier as defaultRunE2eVerifier } from "./e2e-verifier";
import { githubService as defaultGithubService } from "../services/github-service";
import { generatePrDescription as defaultGeneratePrDescription } from "./pr-description";
import { configService as defaultConfigService } from "../services/config-service";
import { createRunLogger } from "../utils/run-logger";
import { JobQueue, type JobData } from "./job-queue";
import { logger } from "../utils/logger";

// --- Job types ---

export const JOB_TYPES = {
  plan: "tmpo.plan",
  dev: "tmpo.dev",
  ci: "tmpo.ci",
  review: "tmpo.review",
  e2e: "tmpo.e2e",
  "e2e-verify": "tmpo.e2e-verify",
  signoff: "tmpo.signoff",
} as const;

const EXPIRE_MINUTES: Record<string, number> = {
  [JOB_TYPES.plan]: 35,
  [JOB_TYPES.dev]: 65,
  [JOB_TYPES.ci]: 20,
  [JOB_TYPES.review]: 35,
  [JOB_TYPES.e2e]: 45,
  [JOB_TYPES["e2e-verify"]]: 35,
  [JOB_TYPES.signoff]: 10,
};

const TERMINAL_STATUSES = ["complete", "failed", "cancelled"];

// Re-export JobData from job-queue
export type { JobData } from "./job-queue";

// --- Dependencies ---

export interface EngineDeps {
  workflowDao: typeof defaultWorkflowDao;
  stepDao: typeof defaultStepDao;
  runDao: typeof defaultRunDao;
  eventBus: typeof defaultEventBus;
  runPlannerAgent: typeof defaultRunPlanner;
  runDevAgent: typeof defaultRunDevAgent;
  createPullRequest: typeof defaultGithubService.createPullRequest;
  pollCiStatus: typeof defaultPollCiStatus;
  runReviewAgent: typeof defaultRunReviewAgent;
  getPrDiff: (token: string, repo: string, prNumber: number) => Promise<string>;
  getHeadSha: (token: string, repo: string, branch: string) => Promise<string>;
  postPrComment: typeof defaultGithubService.postPrComment;
  generatePrDescription: typeof defaultGeneratePrDescription;
  runE2eAgent: typeof defaultRunE2eAgent;
  runE2eVerifier: typeof defaultRunE2eVerifier;
  getDecryptedToken: () => string;
  enqueueJob: (name: string, data: JobData) => Promise<string | null>;
}

async function defaultGetPrDiff(token: string, repo: string, prNumber: number): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/pulls/${prNumber}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3.diff",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch PR diff (${res.status})`);
  }
  return res.text();
}

async function defaultGetHeadSha(token: string, repo: string, branch: string): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/git/ref/heads/${branch}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch head SHA (${res.status})`);
  }
  const data = (await res.json()) as { object: { sha: string } };
  return data.object.sha;
}

// --- Shared helpers ---

async function failStep(
  stepId: string,
  stepType: string,
  workflowId: string,
  detail: string,
  deps: EngineDeps
): Promise<void> {
  await deps.stepDao.updateStatus(stepId, "failed", detail);
  deps.eventBus.emit({
    type: "step:updated",
    workflowId,
    data: { stepId, type: stepType, status: "failed" },
  });
}

async function passStep(
  stepId: string,
  stepType: string,
  workflowId: string,
  deps: EngineDeps
): Promise<void> {
  await deps.stepDao.updateStatus(stepId, "passed", undefined);
  deps.eventBus.emit({
    type: "step:updated",
    workflowId,
    data: { stepId, type: stepType, status: "passed" },
  });
}

async function startStep(
  stepId: string,
  stepType: string,
  workflowId: string,
  deps: EngineDeps
): Promise<void> {
  await deps.stepDao.updateStatus(stepId, "running");
  deps.eventBus.emit({
    type: "step:updated",
    workflowId,
    data: { stepId, type: stepType, status: "running" },
  });
}

async function failWorkflow(
  workflowId: string,
  error: string,
  deps: EngineDeps
): Promise<void> {
  await deps.workflowDao.updateError(workflowId, error);
  deps.eventBus.emit({
    type: "workflow:completed",
    workflowId,
    data: { status: "failed", error },
  });
}

async function regress(
  workflow: Workflow,
  failureDetail: string,
  deps: EngineDeps
): Promise<void> {
  const nextIteration = workflow.iteration + 1;

  if (nextIteration >= workflow.max_iters) {
    await failWorkflow(workflow.id, "Workflow failed: iteration limit reached", deps);
    return;
  }

  await deps.workflowDao.updateIteration(workflow.id, nextIteration);
  deps.eventBus.emit({
    type: "workflow:updated",
    workflowId: workflow.id,
    data: {
      regression: true,
      iteration: nextIteration,
      failureDetail,
    },
  });

  await startIteration(workflow.id, nextIteration, failureDetail, deps);
}

export async function startIteration(
  workflowId: string,
  iteration: number,
  failureContext: string | undefined,
  deps: EngineDeps
): Promise<void> {
  const steps = await deps.stepDao.createIterationSteps(workflowId, iteration);
  const stepIds: Record<string, string> = {};
  for (const s of steps) {
    stepIds[s.type] = s.id;
  }

  const firstJobType = iteration === 0 ? JOB_TYPES.plan : JOB_TYPES.dev;
  await deps.enqueueJob(firstJobType, {
    workflowId,
    iteration,
    stepIds,
    failureContext,
  });
}

function postProposalComment(
  deps: EngineDeps,
  token: string,
  repo: string,
  prNumber: number,
  proposal: string | null
): Promise<void> {
  if (!proposal) return Promise.resolve();
  const header = `\u{1F4CB} **Proposal**`;
  const body = `${header}\n\n${proposal}`;
  return deps.postPrComment({ token, repo, prNumber, body }).catch((error) => {
    logger.warn("Failed to post proposal comment", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function postReviewComment(
  deps: EngineDeps,
  token: string,
  repo: string,
  prNumber: number,
  reviewResult: { reviewPass: boolean; response: string },
  iteration: number
): Promise<void> {
  const icon = reviewResult.reviewPass ? "\u2705" : "\u274c";
  const status = reviewResult.reviewPass ? "passed" : "failed";
  const header = `${icon} **Review ${status}** (iteration ${iteration})`;
  const summary = reviewResult.response
    .replace(/```json[\s\S]*?```/g, "")
    .trim();
  const body = summary ? `${header}\n\n${summary}` : header;
  return deps.postPrComment({ token, repo, prNumber, body }).catch((error) => {
    logger.warn("Failed to post review comment", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function postE2eComment(
  deps: EngineDeps,
  token: string,
  repo: string,
  prNumber: number,
  e2eResult: { response: string },
  iteration: number
): Promise<void> {
  const header = `\u{1F9EA} **E2E Evidence** (iteration ${iteration})`;
  const summary = e2eResult.response
    .replace(/```json[\s\S]*?```/g, "")
    .trim();
  const body = summary ? `${header}\n\n${summary}` : header;
  return deps.postPrComment({ token, repo, prNumber, body }).catch((error) => {
    logger.warn("Failed to post E2E comment", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function postE2eVerifyComment(
  deps: EngineDeps,
  token: string,
  repo: string,
  prNumber: number,
  verifyResult: { e2ePass: boolean; response: string },
  iteration: number
): Promise<void> {
  const icon = verifyResult.e2ePass ? "\u2705" : "\u274c";
  const status = verifyResult.e2ePass ? "passed" : "failed";
  const header = `${icon} **E2E Verification ${status}** (iteration ${iteration})`;
  const summary = verifyResult.response
    .replace(/```json[\s\S]*?```/g, "")
    .trim();
  const body = summary ? `${header}\n\n${summary}` : header;
  return deps.postPrComment({ token, repo, prNumber, body }).catch((error) => {
    logger.warn("Failed to post E2E verify comment", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

// --- Step handlers ---

export async function handlePlan(data: JobData, deps: EngineDeps): Promise<void> {
  const { workflowId, stepIds } = data;
  const stepId = stepIds.plan;

  const workflow = await deps.workflowDao.findById(workflowId);
  if (!workflow || TERMINAL_STATUSES.includes(workflow.status)) return;

  if (workflow.iteration >= workflow.max_iters) {
    await failWorkflow(workflowId, "Workflow failed: iteration limit reached", deps);
    return;
  }

  await deps.workflowDao.updateStatus(workflowId, "running");
  deps.eventBus.emit({
    type: "workflow:updated",
    workflowId,
    data: { status: "running" },
  });

  const githubToken = deps.getDecryptedToken();

  await startStep(stepId, "plan", workflowId, deps);

  const runLogger = createRunLogger(workflowId, "plan", workflow.iteration);
  const planPrompt = `Plan task: ${workflow.task} for repo ${workflow.repo}`;
  runLogger.append("prompt", { text: planPrompt });

  const planRun = await deps.runDao.create({
    stepId,
    workflowId,
    agentRole: "planner",
    iteration: workflow.iteration,
    logPath: runLogger.logPath,
  });

  const planResult = await deps.runPlannerAgent(workflow, githubToken);

  runLogger.append("response", { text: planResult.response, exitCode: planResult.exitCode });

  await deps.runDao.updateResult(planRun.id, {
    exitCode: planResult.exitCode,
    durationSecs: planResult.durationSecs,
  });

  if (planResult.exitCode !== 0 || !planResult.proposal) {
    const detail = planResult.response || "Planner agent failed";
    await failStep(stepId, "plan", workflowId, detail, deps);
    await failWorkflow(workflowId, `Plan step failed: ${detail.substring(0, 500)}`, deps);
    return;
  }

  await passStep(stepId, "plan", workflowId, deps);
  await deps.workflowDao.updateProposal(workflowId, planResult.proposal);

  await deps.enqueueJob(JOB_TYPES.dev, { ...data });
}

export async function handleDev(data: JobData, deps: EngineDeps): Promise<void> {
  const { workflowId, stepIds, failureContext } = data;
  const stepId = stepIds.dev;

  const workflow = await deps.workflowDao.findById(workflowId);
  if (!workflow || TERMINAL_STATUSES.includes(workflow.status)) return;

  // For regression iterations (iteration > 0), ensure workflow is running
  if (workflow.status === "pending") {
    await deps.workflowDao.updateStatus(workflowId, "running");
    deps.eventBus.emit({
      type: "workflow:updated",
      workflowId,
      data: { status: "running" },
    });
  }

  const githubToken = deps.getDecryptedToken();

  await startStep(stepId, "dev", workflowId, deps);

  const runLogger = createRunLogger(workflowId, "dev", data.iteration);
  let devPrompt = `Implement task: ${workflow.task} for repo ${workflow.repo} using proposal`;
  if (failureContext) {
    devPrompt += `\n\n## Previous Iteration Failure\n\n${failureContext}`;
  }
  runLogger.append("prompt", { text: devPrompt });

  const devRun = await deps.runDao.create({
    stepId,
    workflowId,
    agentRole: "dev",
    iteration: data.iteration,
    logPath: runLogger.logPath,
  });

  const devResult = await deps.runDevAgent(workflow, githubToken);

  runLogger.append("response", { text: devResult.response, exitCode: devResult.exitCode });

  await deps.runDao.updateResult(devRun.id, {
    exitCode: devResult.exitCode,
    durationSecs: devResult.durationSecs,
  });

  if (devResult.exitCode !== 0) {
    const detail = devResult.response || "Dev agent failed";
    await failStep(stepId, "dev", workflowId, detail, deps);
    await failWorkflow(workflowId, `Dev step failed: ${detail.substring(0, 500)}`, deps);
    return;
  }

  await passStep(stepId, "dev", workflowId, deps);

  // Create PR on first iteration
  if (workflow.pr_number === null) {
    const { title: prTitle, body: prBody } = await deps.generatePrDescription(
      workflow.task,
      workflow.proposal || ""
    );

    try {
      const pr = await deps.createPullRequest({
        token: githubToken,
        repo: workflow.repo,
        head: workflow.branch,
        title: prTitle,
        body: prBody,
      });

      await deps.workflowDao.updatePrNumber(workflowId, pr.number);
      deps.eventBus.emit({
        type: "workflow:updated",
        workflowId,
        data: { status: "running", pr_number: pr.number, pr_url: pr.url },
      });

      await postProposalComment(deps, githubToken, workflow.repo, pr.number, workflow.proposal);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await failWorkflow(workflowId, `PR creation failed: ${detail.substring(0, 500)}`, deps);
      return;
    }
  }

  await deps.enqueueJob(JOB_TYPES.ci, { ...data });
}

export async function handleCi(data: JobData, deps: EngineDeps): Promise<void> {
  const { workflowId, stepIds } = data;
  const stepId = stepIds.ci;

  const workflow = await deps.workflowDao.findById(workflowId);
  if (!workflow || TERMINAL_STATUSES.includes(workflow.status)) return;

  const githubToken = deps.getDecryptedToken();

  await startStep(stepId, "ci", workflowId, deps);

  const headSha = await deps.getHeadSha(githubToken, workflow.repo, workflow.branch);
  const ciResult = await deps.pollCiStatus(workflow.repo, headSha, githubToken);

  if (ciResult.status === "failed") {
    const detail = ciResult.detail || "CI checks failed";
    await failStep(stepId, "ci", workflowId, detail, deps);
    await regress(workflow, detail, deps);
    return;
  }

  await passStep(stepId, "ci", workflowId, deps);
  await deps.enqueueJob(JOB_TYPES.review, { ...data });
}

export async function handleReview(data: JobData, deps: EngineDeps): Promise<void> {
  const { workflowId, stepIds } = data;
  const stepId = stepIds.review;

  const workflow = await deps.workflowDao.findById(workflowId);
  if (!workflow || TERMINAL_STATUSES.includes(workflow.status)) return;

  const githubToken = deps.getDecryptedToken();

  await startStep(stepId, "review", workflowId, deps);

  const prDiff = await deps.getPrDiff(githubToken, workflow.repo, workflow.pr_number!);

  const runLogger = createRunLogger(workflowId, "review", data.iteration);
  const reviewPrompt = `Review PR #${workflow.pr_number} for task: ${workflow.task}`;
  runLogger.append("prompt", { text: reviewPrompt });

  const reviewRun = await deps.runDao.create({
    stepId,
    workflowId,
    agentRole: "reviewer",
    iteration: data.iteration,
    logPath: runLogger.logPath,
  });

  const reviewResult = await deps.runReviewAgent(workflow, prDiff, githubToken);

  runLogger.append("response", { text: reviewResult.verdict, exitCode: reviewResult.exitCode });

  await deps.runDao.updateResult(reviewRun.id, {
    exitCode: reviewResult.exitCode,
    durationSecs: reviewResult.durationSecs,
  });

  await postReviewComment(
    deps, githubToken, workflow.repo, workflow.pr_number!,
    reviewResult, data.iteration
  );

  if (!reviewResult.reviewPass) {
    const detail = reviewResult.verdict || "Review failed";
    await failStep(stepId, "review", workflowId, detail, deps);
    await regress(workflow, detail, deps);
    return;
  }

  await passStep(stepId, "review", workflowId, deps);
  await deps.enqueueJob(JOB_TYPES.e2e, { ...data });
}

export async function handleE2e(data: JobData, deps: EngineDeps): Promise<void> {
  const { workflowId, stepIds } = data;
  const stepId = stepIds.e2e;

  const workflow = await deps.workflowDao.findById(workflowId);
  if (!workflow || TERMINAL_STATUSES.includes(workflow.status)) return;

  const githubToken = deps.getDecryptedToken();

  await startStep(stepId, "e2e", workflowId, deps);

  const runLogger = createRunLogger(workflowId, "e2e", data.iteration);
  const e2ePrompt = `Run E2E tests for task: ${workflow.task} on repo ${workflow.repo}`;
  runLogger.append("prompt", { text: e2ePrompt });

  const e2eRun = await deps.runDao.create({
    stepId,
    workflowId,
    agentRole: "e2e",
    iteration: data.iteration,
    logPath: runLogger.logPath,
  });

  const e2eResult = await deps.runE2eAgent(workflow, githubToken);

  runLogger.append("response", { text: e2eResult.response, exitCode: e2eResult.exitCode });

  await deps.runDao.updateResult(e2eRun.id, {
    exitCode: e2eResult.exitCode,
    durationSecs: e2eResult.durationSecs,
  });

  await postE2eComment(
    deps, githubToken, workflow.repo, workflow.pr_number!,
    e2eResult, data.iteration
  );

  if (!e2eResult.e2ePass) {
    const detail = e2eResult.response || "E2E tests failed";
    await failStep(stepId, "e2e", workflowId, detail, deps);
    await regress(workflow, detail, deps);
    return;
  }

  await passStep(stepId, "e2e", workflowId, deps);
  await deps.enqueueJob(JOB_TYPES["e2e-verify"], {
    ...data,
    e2eEvidence: e2eResult.evidence,
  });
}

export async function handleE2eVerify(data: JobData, deps: EngineDeps): Promise<void> {
  const { workflowId, stepIds } = data;
  const stepId = stepIds.e2e_verify;

  const workflow = await deps.workflowDao.findById(workflowId);
  if (!workflow || TERMINAL_STATUSES.includes(workflow.status)) return;

  const githubToken = deps.getDecryptedToken();

  await startStep(stepId, "e2e_verify", workflowId, deps);

  const runLogger = createRunLogger(workflowId, "e2e_verify", data.iteration);
  const verifyPrompt = `Verify E2E evidence for task: ${workflow.task}`;
  runLogger.append("prompt", { text: verifyPrompt });

  const verifyRun = await deps.runDao.create({
    stepId,
    workflowId,
    agentRole: "e2e_verifier",
    iteration: data.iteration,
    logPath: runLogger.logPath,
  });

  const verifyResult = await deps.runE2eVerifier(workflow, data.e2eEvidence || "", githubToken);

  runLogger.append("response", { text: verifyResult.verdict, exitCode: verifyResult.exitCode });

  await deps.runDao.updateResult(verifyRun.id, {
    exitCode: verifyResult.exitCode,
    durationSecs: verifyResult.durationSecs,
  });

  await postE2eVerifyComment(
    deps, githubToken, workflow.repo, workflow.pr_number!,
    verifyResult, data.iteration
  );

  if (!verifyResult.e2ePass) {
    const detail = verifyResult.verdict || "E2E verification failed";
    await failStep(stepId, "e2e_verify", workflowId, detail, deps);
    await regress(workflow, detail, deps);
    return;
  }

  await passStep(stepId, "e2e_verify", workflowId, deps);
  await deps.enqueueJob(JOB_TYPES.signoff, { ...data });
}

export async function handleSignoff(data: JobData, deps: EngineDeps): Promise<void> {
  const { workflowId, stepIds } = data;
  const stepId = stepIds.signoff;

  const workflow = await deps.workflowDao.findById(workflowId);
  if (!workflow || TERMINAL_STATUSES.includes(workflow.status)) return;

  await passStep(stepId, "signoff", workflowId, deps);

  await deps.workflowDao.updateStatus(workflowId, "complete");
  deps.eventBus.emit({
    type: "workflow:completed",
    workflowId,
    data: { status: "complete", pr_number: workflow.pr_number },
  });
}

// --- Engine factory ---

const HANDLERS: Record<string, (data: JobData, deps: EngineDeps) => Promise<void>> = {
  [JOB_TYPES.plan]: handlePlan,
  [JOB_TYPES.dev]: handleDev,
  [JOB_TYPES.ci]: handleCi,
  [JOB_TYPES.review]: handleReview,
  [JOB_TYPES.e2e]: handleE2e,
  [JOB_TYPES["e2e-verify"]]: handleE2eVerify,
  [JOB_TYPES.signoff]: handleSignoff,
};

export function createEngine(overrideDeps?: Partial<EngineDeps>) {
  const jobQueue = new JobQueue();

  const enqueueJob = async (name: string, data: JobData): Promise<string | null> => {
    const expireMs = (EXPIRE_MINUTES[name] ?? 10) * 60 * 1000;
    return jobQueue.enqueue(name, data, expireMs);
  };

  const deps: EngineDeps = {
    workflowDao: defaultWorkflowDao,
    stepDao: defaultStepDao,
    runDao: defaultRunDao,
    eventBus: defaultEventBus,
    runPlannerAgent: defaultRunPlanner,
    runDevAgent: defaultRunDevAgent,
    createPullRequest: defaultGithubService.createPullRequest.bind(defaultGithubService),
    pollCiStatus: defaultPollCiStatus,
    runReviewAgent: defaultRunReviewAgent,
    getPrDiff: defaultGetPrDiff,
    getHeadSha: defaultGetHeadSha,
    postPrComment: defaultGithubService.postPrComment.bind(defaultGithubService),
    generatePrDescription: defaultGeneratePrDescription,
    runE2eAgent: defaultRunE2eAgent,
    runE2eVerifier: defaultRunE2eVerifier,
    getDecryptedToken: defaultConfigService.getDecryptedToken.bind(defaultConfigService),
    enqueueJob,
    ...overrideDeps,
  };

  // Register handlers with the job queue
  for (const [jobType, handler] of Object.entries(HANDLERS)) {
    jobQueue.registerHandler(jobType, async (data: JobData) => {
      try {
        await handler(data, deps);
      } catch (error) {
        logger.error("Job handler error", {
          jobType,
          error: error instanceof Error ? error.message : String(error),
        });
        const stepType = jobType.replace("tmpo.", "").replace("-", "_");
        const stepId = data.stepIds[stepType];
        if (stepId) {
          const detail = error instanceof Error ? error.message : String(error);
          await failStep(stepId, stepType, data.workflowId, detail, deps).catch(() => {});
        }
        throw error;
      }
    });
  }

  return {
    async start(): Promise<void> {
      // Recovery: mark incomplete steps as failed for any running workflows
      const runningWorkflows = await deps.workflowDao.list({ status: "running" });
      for (const wf of runningWorkflows.workflows) {
        const steps = await deps.stepDao.findByWorkflowId(wf.id);
        for (const step of steps) {
          if (step.status === "running") {
            await deps.stepDao.updateStatus(step.id, "failed", "Recovered on startup: step was incomplete");
          }
        }
      }

      jobQueue.start();
      logger.info("Workflow engine started (in-process job queue)");
    },

    async stop(): Promise<void> {
      jobQueue.stop();
      logger.info("Workflow engine stopped");
    },

    async enqueueWorkflow(workflowId: string, iteration: number): Promise<void> {
      await startIteration(workflowId, iteration, undefined, deps);
    },

    async cancelWorkflowJobs(workflowId: string): Promise<void> {
      jobQueue.cancel(workflowId);
    },

    jobQueue,
    deps,
  };
}
