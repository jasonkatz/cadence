import { createRunLogger } from "../../utils/run-logger";
import type { E2eStepInput, E2eStepResult } from "../types";
import { getStepDeps, stepIdFor } from "./deps";
import type { Workflow } from "../../dao/workflow-dao";

export async function e2eStep(input: E2eStepInput): Promise<E2eStepResult> {
  "use step";

  const deps = getStepDeps();
  const token = deps.getDecryptedToken();
  const runLogger = createRunLogger(input.workflowId, "e2e", input.iteration);
  const stepId = stepIdFor(input.workflowId, input.iteration, "e2e");

  try {
    const workflow = toWorkflow(input);
    const result = await deps.runE2eAgent(workflow, token, runLogger, {
      stepId,
      pidRegistry: deps.pidRegistry,
    });
    return {
      ok: result.e2ePass,
      evidence: result.evidence,
      response: result.response,
      exitCode: result.exitCode,
      durationSecs: result.durationSecs,
      logPath: runLogger.logPath,
    };
  } finally {
    runLogger.close();
  }
}

function toWorkflow(input: E2eStepInput): Workflow {
  return {
    id: input.workflowId,
    task: input.task,
    repo: input.repo,
    branch: input.branch,
    requirements: input.requirements,
    proposal: input.proposal,
    pr_number: input.prNumber,
    status: "running",
    iteration: input.iteration,
    max_iters: input.maxIters,
    error: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
}
