import { workflowDao as defaultWorkflowDao, Workflow } from "../dao/workflow-dao";
import { stepDao as defaultStepDao } from "../dao/step-dao";
import { runDao as defaultRunDao } from "../dao/run-dao";
import { eventBus as defaultEventBus } from "../events/event-bus";
import { runPlannerAgent as defaultRunPlanner } from "./planner-agent";
import { runDevAgent as defaultRunDevAgent } from "./dev-agent";
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
}

const defaultDeps: EngineDeps = {
  workflowDao: defaultWorkflowDao,
  stepDao: defaultStepDao,
  runDao: defaultRunDao,
  eventBus: defaultEventBus,
  runPlannerAgent: defaultRunPlanner,
  runDevAgent: defaultRunDevAgent,
  createPullRequest: defaultGithubService.createPullRequest.bind(defaultGithubService),
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

  // --- Plan step ---
  const planStep = steps.find((s) => s.type === "plan");
  if (!planStep) {
    await workflowDao.updateError(workflow.id, "No plan step created");
    return;
  }

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

  // Update workflow in-memory with proposal for dev agent
  const workflowWithProposal = { ...workflow, proposal: planResult.proposal };

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

  const devPrompt = `Implement task: ${workflow.task} for repo ${workflow.repo} using proposal`;
  const devRun = await runDao.create({
    stepId: devStep.id,
    workflowId: workflow.id,
    agentRole: "dev",
    iteration: workflow.iteration,
    prompt: devPrompt,
  });

  const devResult = await runDevAgent(workflowWithProposal, githubToken);

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

  // --- Create PR ---
  const prTitle = workflow.task.substring(0, 72);
  const prBody = planResult.proposal;

  try {
    const pr = await createPullRequest({
      token: githubToken,
      repo: workflow.repo,
      head: workflow.branch,
      title: prTitle,
      body: prBody,
    });

    await workflowDao.updatePrNumber(workflow.id, pr.number);
    eventBus.emit({
      type: "workflow:completed",
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

  // Engine stops after dev step — remaining steps (ci, review, etc.) stay pending
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
