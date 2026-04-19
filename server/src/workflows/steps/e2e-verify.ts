import { createRunLogger } from "../../utils/run-logger";
import type { E2eVerifyStepInput, E2eVerifyStepResult } from "../types";
import { getStepDeps, stepIdFor } from "./deps";
import type { Workflow } from "../../dao/workflow-dao";

export async function e2eVerifyStep(
  input: E2eVerifyStepInput
): Promise<E2eVerifyStepResult> {
  "use step";

  const deps = getStepDeps();
  const token = deps.getDecryptedToken();
  const runLogger = createRunLogger(input.workflowId, "e2e_verify", input.iteration);
  const stepId = stepIdFor(input.workflowId, input.iteration, "e2e_verify");

  try {
    const workflow = toWorkflow(input);
    const result = await deps.runE2eVerifier(workflow, input.evidence, token, runLogger, {
      stepId,
      pidRegistry: deps.pidRegistry,
    });
    return {
      ok: result.e2ePass,
      verdict: result.verdict,
      response: result.response,
      exitCode: result.exitCode,
      durationSecs: result.durationSecs,
      logPath: runLogger.logPath,
    };
  } finally {
    runLogger.close();
  }
}

function toWorkflow(input: E2eVerifyStepInput): Workflow {
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
