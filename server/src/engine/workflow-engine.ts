import { workflowDao as defaultWorkflowDao, Workflow } from "../dao/workflow-dao";
import { stepDao as defaultStepDao } from "../dao/step-dao";
import { runDao as defaultRunDao } from "../dao/run-dao";
import { eventBus as defaultEventBus } from "../events/event-bus";
import { runPlannerAgent as defaultRunPlanner } from "./planner-agent";
import { runDevAgent as defaultRunDevAgent } from "./dev-agent";
import { pollCiStatus as defaultPollCiStatus } from "./ci-poller";
import { runReviewAgent as defaultRunReviewAgent } from "./review-agent";
import { githubService as defaultGithubService } from "../services/github-service";
import { settingsService as defaultSettingsService } from "../services/settings-service";
import { logger } from "../utils/logger";

const POLL_INTERVAL_MS = 5_000;
const TERMINAL_STATUSES = ["complete", "failed", "cancelled"];

let running = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

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

const defaultDeps: EngineDeps = {
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
};

export async function processWorkflow(
  workflow: Workflow,
  githubToken: string,
  deps: EngineDeps = defaultDeps
): Promise<void> {
  const {
    workflowDao,
    stepDao,
    runDao,
    eventBus,
    runPlannerAgent,
    runDevAgent,
    createPullRequest,
    pollCiStatus,
    runReviewAgent,
    getPrDiff,
    getHeadSha,
  } = deps;

  // Don't process terminal workflows
  if (TERMINAL_STATUSES.includes(workflow.status)) {
    return;
  }

  // Check iteration limit
  if (workflow.iteration >= workflow.max_iters) {
    await workflowDao.updateError(
      workflow.id,
      "Workflow failed: iteration limit reached"
    );
    eventBus.emit({
      type: "workflow:completed",
      workflowId: workflow.id,
      data: { status: "failed", error: "Iteration limit reached" },
    });
    return;
  }

  // Transition to running
  await workflowDao.updateStatus(workflow.id, "running");
  eventBus.emit({
    type: "workflow:updated",
    workflowId: workflow.id,
    data: { status: "running" },
  });

  // Create iteration steps
  const steps = await stepDao.createIterationSteps(
    workflow.id,
    workflow.iteration
  );

  // Keep mutable workflow state for passing context through steps
  let currentWorkflow = { ...workflow };
  const failureContext: string | null = null;

  // --- Plan step (iteration 0 only) ---
  const planStep = steps.find((s) => s.type === "plan");
  if (planStep) {
    await stepDao.updateStatus(planStep.id, "running");
    eventBus.emit({
      type: "step:updated",
      workflowId: workflow.id,
      data: { stepId: planStep.id, type: "plan", status: "running" },
    });

    const planPrompt = `Plan task: ${workflow.task} for repo ${workflow.repo}`;
    const planRun = await runDao.create({
      stepId: planStep.id,
      workflowId: workflow.id,
      agentRole: "planner",
      iteration: workflow.iteration,
      prompt: planPrompt,
    });

    const planResult = await runPlannerAgent(workflow, githubToken);

    await runDao.updateResult(planRun.id, {
      response: planResult.response,
      exitCode: planResult.exitCode,
      durationSecs: planResult.durationSecs,
    });

    if (planResult.exitCode !== 0 || !planResult.proposal) {
      const detail = planResult.response || "Planner agent failed";
      await stepDao.updateStatus(planStep.id, "failed", detail);
      eventBus.emit({
        type: "step:updated",
        workflowId: workflow.id,
        data: { stepId: planStep.id, type: "plan", status: "failed" },
      });
      await workflowDao.updateError(
        workflow.id,
        `Plan step failed: ${detail.substring(0, 500)}`
      );
      eventBus.emit({
        type: "workflow:completed",
        workflowId: workflow.id,
        data: { status: "failed" },
      });
      return;
    }

    // Plan succeeded
    await stepDao.updateStatus(planStep.id, "passed", undefined);
    eventBus.emit({
      type: "step:updated",
      workflowId: workflow.id,
      data: { stepId: planStep.id, type: "plan", status: "passed" },
    });
    await workflowDao.updateProposal(workflow.id, planResult.proposal);
    currentWorkflow = { ...currentWorkflow, proposal: planResult.proposal };
  }

  // --- Dev step ---
  const devStep = steps.find((s) => s.type === "dev");
  if (!devStep) {
    await workflowDao.updateError(workflow.id, "No dev step created");
    return;
  }

  await stepDao.updateStatus(devStep.id, "running");
  eventBus.emit({
    type: "step:updated",
    workflowId: workflow.id,
    data: { stepId: devStep.id, type: "dev", status: "running" },
  });

  let devPrompt = `Implement task: ${workflow.task} for repo ${workflow.repo} using proposal`;
  if (failureContext) {
    devPrompt += `\n\n## Previous Iteration Failure\n\n${failureContext}`;
  }

  const devRun = await runDao.create({
    stepId: devStep.id,
    workflowId: workflow.id,
    agentRole: "dev",
    iteration: workflow.iteration,
    prompt: devPrompt,
  });

  const devResult = await runDevAgent(currentWorkflow, githubToken);

  await runDao.updateResult(devRun.id, {
    response: devResult.response,
    exitCode: devResult.exitCode,
    durationSecs: devResult.durationSecs,
  });

  if (devResult.exitCode !== 0) {
    const detail = devResult.response || "Dev agent failed";
    await stepDao.updateStatus(devStep.id, "failed", detail);
    eventBus.emit({
      type: "step:updated",
      workflowId: workflow.id,
      data: { stepId: devStep.id, type: "dev", status: "failed" },
    });
    await workflowDao.updateError(
      workflow.id,
      `Dev step failed: ${detail.substring(0, 500)}`
    );
    eventBus.emit({
      type: "workflow:completed",
      workflowId: workflow.id,
      data: { status: "failed" },
    });
    return;
  }

  // Dev succeeded
  await stepDao.updateStatus(devStep.id, "passed", undefined);
  eventBus.emit({
    type: "step:updated",
    workflowId: workflow.id,
    data: { stepId: devStep.id, type: "dev", status: "passed" },
  });

  // --- Create PR (first iteration only) ---
  if (currentWorkflow.pr_number === null) {
    const prTitle = workflow.task.substring(0, 72);
    const prBody = currentWorkflow.proposal || "";

    try {
      const pr = await createPullRequest({
        token: githubToken,
        repo: workflow.repo,
        head: workflow.branch,
        title: prTitle,
        body: prBody,
      });

      await workflowDao.updatePrNumber(workflow.id, pr.number);
      currentWorkflow = { ...currentWorkflow, pr_number: pr.number };
      eventBus.emit({
        type: "workflow:updated",
        workflowId: workflow.id,
        data: { status: "running", pr_number: pr.number, pr_url: pr.url },
      });
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : String(error);
      await workflowDao.updateError(
        workflow.id,
        `PR creation failed: ${detail.substring(0, 500)}`
      );
      eventBus.emit({
        type: "workflow:completed",
        workflowId: workflow.id,
        data: { status: "failed" },
      });
      return;
    }
  }

  // --- CI step ---
  const ciStep = steps.find((s) => s.type === "ci");
  if (!ciStep) {
    await workflowDao.updateError(workflow.id, "No ci step created");
    return;
  }

  await stepDao.updateStatus(ciStep.id, "running");
  eventBus.emit({
    type: "step:updated",
    workflowId: workflow.id,
    data: { stepId: ciStep.id, type: "ci", status: "running" },
  });

  const headSha = await getHeadSha(githubToken, workflow.repo, workflow.branch);
  const ciResult = await pollCiStatus(workflow.repo, headSha, githubToken);

  if (ciResult.status === "failed") {
    const detail = ciResult.detail || "CI checks failed";
    await stepDao.updateStatus(ciStep.id, "failed", detail);
    eventBus.emit({
      type: "step:updated",
      workflowId: workflow.id,
      data: { stepId: ciStep.id, type: "ci", status: "failed" },
    });

    // Trigger regression
    return await regress(
      workflow,
      githubToken,
      detail,
      deps
    );
  }

  // CI passed
  await stepDao.updateStatus(ciStep.id, "passed", undefined);
  eventBus.emit({
    type: "step:updated",
    workflowId: workflow.id,
    data: { stepId: ciStep.id, type: "ci", status: "passed" },
  });

  // --- Review step ---
  const reviewStep = steps.find((s) => s.type === "review");
  if (!reviewStep) {
    await workflowDao.updateError(workflow.id, "No review step created");
    return;
  }

  await stepDao.updateStatus(reviewStep.id, "running");
  eventBus.emit({
    type: "step:updated",
    workflowId: workflow.id,
    data: { stepId: reviewStep.id, type: "review", status: "running" },
  });

  const prDiff = await getPrDiff(githubToken, workflow.repo, currentWorkflow.pr_number!);

  const reviewPrompt = `Review PR #${currentWorkflow.pr_number} for task: ${workflow.task}`;
  const reviewRun = await runDao.create({
    stepId: reviewStep.id,
    workflowId: workflow.id,
    agentRole: "reviewer",
    iteration: workflow.iteration,
    prompt: reviewPrompt,
  });

  const reviewResult = await runReviewAgent(currentWorkflow, prDiff, githubToken);

  await runDao.updateResult(reviewRun.id, {
    response: reviewResult.verdict,
    exitCode: reviewResult.exitCode,
    durationSecs: reviewResult.durationSecs,
  });

  if (!reviewResult.reviewPass) {
    const detail = reviewResult.verdict || "Review failed";
    await stepDao.updateStatus(reviewStep.id, "failed", detail);
    eventBus.emit({
      type: "step:updated",
      workflowId: workflow.id,
      data: { stepId: reviewStep.id, type: "review", status: "failed" },
    });

    // Trigger regression
    return await regress(
      workflow,
      githubToken,
      detail,
      deps
    );
  }

  // Review passed
  await stepDao.updateStatus(reviewStep.id, "passed", undefined);
  eventBus.emit({
    type: "step:updated",
    workflowId: workflow.id,
    data: { stepId: reviewStep.id, type: "review", status: "passed" },
  });

  // Engine stops after review — e2e, e2e_verify, signoff remain pending
  eventBus.emit({
    type: "workflow:completed",
    workflowId: workflow.id,
    data: { status: "running", pr_number: currentWorkflow.pr_number },
  });
}

async function regress(
  workflow: Workflow,
  githubToken: string,
  failureDetail: string,
  deps: EngineDeps
): Promise<void> {
  const { workflowDao, eventBus } = deps;

  const nextIteration = workflow.iteration + 1;

  // Check iteration limit before regressing
  if (nextIteration >= workflow.max_iters) {
    await workflowDao.updateError(
      workflow.id,
      "Workflow failed: iteration limit reached"
    );
    eventBus.emit({
      type: "workflow:completed",
      workflowId: workflow.id,
      data: { status: "failed", error: "Iteration limit reached" },
    });
    return;
  }

  // Increment iteration
  await workflowDao.updateIteration(workflow.id, nextIteration);
  eventBus.emit({
    type: "workflow:updated",
    workflowId: workflow.id,
    data: {
      regression: true,
      iteration: nextIteration,
      failureDetail,
    },
  });

  // Process the next iteration recursively
  const regressionWorkflow: Workflow = {
    ...workflow,
    iteration: nextIteration,
    pr_number: workflow.pr_number,
    status: "running",
  };

  await processRegressionIteration(
    regressionWorkflow,
    githubToken,
    failureDetail,
    deps
  );
}

async function processRegressionIteration(
  workflow: Workflow,
  githubToken: string,
  failureContext: string,
  deps: EngineDeps
): Promise<void> {
  const {
    workflowDao,
    stepDao,
    runDao,
    eventBus,
    runDevAgent,
    pollCiStatus,
    runReviewAgent,
    getPrDiff,
    getHeadSha,
  } = deps;

  // Check iteration limit
  if (workflow.iteration >= workflow.max_iters) {
    await workflowDao.updateError(
      workflow.id,
      "Workflow failed: iteration limit reached"
    );
    eventBus.emit({
      type: "workflow:completed",
      workflowId: workflow.id,
      data: { status: "failed", error: "Iteration limit reached" },
    });
    return;
  }

  // Create iteration steps (no plan step for iteration > 0)
  const steps = await stepDao.createIterationSteps(
    workflow.id,
    workflow.iteration
  );

  // --- Dev step with failure context ---
  const devStep = steps.find((s) => s.type === "dev");
  if (!devStep) {
    await workflowDao.updateError(workflow.id, "No dev step created");
    return;
  }

  await stepDao.updateStatus(devStep.id, "running");
  eventBus.emit({
    type: "step:updated",
    workflowId: workflow.id,
    data: { stepId: devStep.id, type: "dev", status: "running" },
  });

  const devPrompt = `Implement task: ${workflow.task} for repo ${workflow.repo} using proposal\n\n## Previous Iteration Failure\n\n${failureContext}`;
  const devRun = await runDao.create({
    stepId: devStep.id,
    workflowId: workflow.id,
    agentRole: "dev",
    iteration: workflow.iteration,
    prompt: devPrompt,
  });

  const devResult = await runDevAgent(workflow, githubToken);

  await runDao.updateResult(devRun.id, {
    response: devResult.response,
    exitCode: devResult.exitCode,
    durationSecs: devResult.durationSecs,
  });

  if (devResult.exitCode !== 0) {
    const detail = devResult.response || "Dev agent failed";
    await stepDao.updateStatus(devStep.id, "failed", detail);
    eventBus.emit({
      type: "step:updated",
      workflowId: workflow.id,
      data: { stepId: devStep.id, type: "dev", status: "failed" },
    });
    await workflowDao.updateError(
      workflow.id,
      `Dev step failed: ${detail.substring(0, 500)}`
    );
    eventBus.emit({
      type: "workflow:completed",
      workflowId: workflow.id,
      data: { status: "failed" },
    });
    return;
  }

  // Dev succeeded
  await stepDao.updateStatus(devStep.id, "passed", undefined);
  eventBus.emit({
    type: "step:updated",
    workflowId: workflow.id,
    data: { stepId: devStep.id, type: "dev", status: "passed" },
  });

  // --- CI step ---
  const ciStep = steps.find((s) => s.type === "ci");
  if (!ciStep) {
    await workflowDao.updateError(workflow.id, "No ci step created");
    return;
  }

  await stepDao.updateStatus(ciStep.id, "running");
  eventBus.emit({
    type: "step:updated",
    workflowId: workflow.id,
    data: { stepId: ciStep.id, type: "ci", status: "running" },
  });

  const headSha = await getHeadSha(githubToken, workflow.repo, workflow.branch);
  const ciResult = await pollCiStatus(workflow.repo, headSha, githubToken);

  if (ciResult.status === "failed") {
    const detail = ciResult.detail || "CI checks failed";
    await stepDao.updateStatus(ciStep.id, "failed", detail);
    eventBus.emit({
      type: "step:updated",
      workflowId: workflow.id,
      data: { stepId: ciStep.id, type: "ci", status: "failed" },
    });

    return await regress(workflow, githubToken, detail, deps);
  }

  // CI passed
  await stepDao.updateStatus(ciStep.id, "passed", undefined);
  eventBus.emit({
    type: "step:updated",
    workflowId: workflow.id,
    data: { stepId: ciStep.id, type: "ci", status: "passed" },
  });

  // --- Review step ---
  const reviewStep = steps.find((s) => s.type === "review");
  if (!reviewStep) {
    await workflowDao.updateError(workflow.id, "No review step created");
    return;
  }

  await stepDao.updateStatus(reviewStep.id, "running");
  eventBus.emit({
    type: "step:updated",
    workflowId: workflow.id,
    data: { stepId: reviewStep.id, type: "review", status: "running" },
  });

  const prDiff = await getPrDiff(githubToken, workflow.repo, workflow.pr_number!);

  const reviewPrompt = `Review PR #${workflow.pr_number} for task: ${workflow.task}`;
  const reviewRun = await runDao.create({
    stepId: reviewStep.id,
    workflowId: workflow.id,
    agentRole: "reviewer",
    iteration: workflow.iteration,
    prompt: reviewPrompt,
  });

  const reviewResult = await runReviewAgent(workflow, prDiff, githubToken);

  await runDao.updateResult(reviewRun.id, {
    response: reviewResult.verdict,
    exitCode: reviewResult.exitCode,
    durationSecs: reviewResult.durationSecs,
  });

  if (!reviewResult.reviewPass) {
    const detail = reviewResult.verdict || "Review failed";
    await stepDao.updateStatus(reviewStep.id, "failed", detail);
    eventBus.emit({
      type: "step:updated",
      workflowId: workflow.id,
      data: { stepId: reviewStep.id, type: "review", status: "failed" },
    });

    return await regress(workflow, githubToken, detail, deps);
  }

  // Review passed
  await stepDao.updateStatus(reviewStep.id, "passed", undefined);
  eventBus.emit({
    type: "step:updated",
    workflowId: workflow.id,
    data: { stepId: reviewStep.id, type: "review", status: "passed" },
  });

  // Engine stops after review
  eventBus.emit({
    type: "workflow:completed",
    workflowId: workflow.id,
    data: { status: "running", pr_number: workflow.pr_number },
  });
}

export async function poll(): Promise<void> {
  try {
    const workflow = await defaultWorkflowDao.findPending();
    if (workflow) {
      logger.info("Processing workflow", { workflowId: workflow.id });
      const githubToken = await defaultSettingsService.getDecryptedToken(
        workflow.created_by
      );
      await processWorkflow(workflow, githubToken);
    }
  } catch (error) {
    logger.error("Engine poll error", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function startEngine(): void {
  if (running) return;
  running = true;
  logger.info("Workflow engine started");

  const tick = async () => {
    if (!running) return;
    await poll();
    if (running) {
      pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
    }
  };

  tick();
}

export function stopEngine(): void {
  running = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logger.info("Workflow engine stopped");
}
