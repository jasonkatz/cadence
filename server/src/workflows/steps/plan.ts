import { createRunLogger } from "../../utils/run-logger";
import type { PlanStepInput, PlanStepResult } from "../types";
import { getStepDeps, stepIdFor } from "./deps";
import type { Workflow } from "../../dao/workflow-dao";

/**
 * `planStep` is the step-level boundary for the planner agent. Each call is
 * durable under WDK replay: once the step completes, WDK caches the return
 * value and subsequent replays skip re-execution.
 */
export async function planStep(
  input: PlanStepInput
): Promise<PlanStepResult> {
  "use step";

  const deps = getStepDeps();
  const runLogger = createRunLogger(input.workflowId, "plan", 0);
  const stepId = stepIdFor(input.workflowId, 0, "plan");

  try {
    const token = deps.getDecryptedToken();
    const workflow = toWorkflow(input, 0, null, null);
    const result = await deps.runPlannerAgent(workflow, token, runLogger, {
      stepId,
      pidRegistry: deps.pidRegistry,
    });
    return {
      ok: result.exitCode === 0 && !!result.proposal,
      proposal: result.proposal,
      exitCode: result.exitCode,
      durationSecs: result.durationSecs,
      response: result.response,
      logPath: runLogger.logPath,
    };
  } finally {
    runLogger.close();
  }
}

function toWorkflow(
  input: PlanStepInput,
  iteration: number,
  proposal: string | null,
  prNumber: number | null
): Workflow {
  return {
    id: input.workflowId,
    task: input.task,
    repo: input.repo,
    branch: input.branch,
    requirements: input.requirements,
    proposal,
    pr_number: prNumber,
    status: "running",
    iteration,
    max_iters: input.maxIters,
    error: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
}
