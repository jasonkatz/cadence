import { workflowDao as defaultWorkflowDao, Workflow } from "../dao/workflow-dao";
import { stepDao as defaultStepDao } from "../dao/step-dao";
import { runDao as defaultRunDao } from "../dao/run-dao";
import { eventBus as defaultEventBus } from "../events/event-bus";
import { runPlannerAgent as defaultRunPlanner } from "./planner-agent";
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
}

const defaultDeps: EngineDeps = {
  workflowDao: defaultWorkflowDao,
  stepDao: defaultStepDao,
  runDao: defaultRunDao,
  eventBus: defaultEventBus,
  runPlannerAgent: defaultRunPlanner,
};

export async function processWorkflow(
  workflow: Workflow,
  githubToken: string,
  deps: EngineDeps = defaultDeps
): Promise<void> {
  const { workflowDao, stepDao, runDao, eventBus, runPlannerAgent } = deps;

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

  // Find the plan step
  const planStep = steps.find((s) => s.type === "plan");
  if (!planStep) {
    await workflowDao.updateError(workflow.id, "No plan step created");
    return;
  }

  // Transition plan step to running
  await stepDao.updateStatus(planStep.id, "running");
  eventBus.emit({
    type: "step:updated",
    workflowId: workflow.id,
    data: { stepId: planStep.id, type: "plan", status: "running" },
  });

  // Create the run record
  const prompt = `Plan task: ${workflow.task} for repo ${workflow.repo}`;
  const run = await runDao.create({
    stepId: planStep.id,
    workflowId: workflow.id,
    agentRole: "planner",
    iteration: workflow.iteration,
    prompt,
  });

  // Execute the planner agent
  const result = await runPlannerAgent(workflow, githubToken);

  // Record the result
  await runDao.updateResult(run.id, {
    response: result.response,
    exitCode: result.exitCode,
    durationSecs: result.durationSecs,
  });

  if (result.exitCode === 0 && result.proposal) {
    // Plan succeeded
    await stepDao.updateStatus(planStep.id, "passed", undefined);
    eventBus.emit({
      type: "step:updated",
      workflowId: workflow.id,
      data: { stepId: planStep.id, type: "plan", status: "passed" },
    });

    await workflowDao.updateProposal(workflow.id, result.proposal);
    // Engine stops after plan step — remaining steps stay pending
  } else {
    // Plan failed
    const detail = result.response || "Planner agent failed";
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
  }
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
