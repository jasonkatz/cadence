import { createRunLogger } from "../../utils/run-logger";
import type { ReviewStepInput, ReviewStepResult } from "../types";
import { getStepDeps, stepIdFor } from "./deps";
import type { Workflow } from "../../dao/workflow-dao";

export async function reviewStep(input: ReviewStepInput): Promise<ReviewStepResult> {
  "use step";

  const deps = getStepDeps();
  const token = deps.getDecryptedToken();
  const runLogger = createRunLogger(input.workflowId, "review", input.iteration);
  const stepId = stepIdFor(input.workflowId, input.iteration, "review");

  try {
    let diff: string;
    try {
      diff = await deps.getPrDiff(token, input.repo, input.prNumber);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        verdict: `Failed to fetch PR diff (${message})`,
        response: "",
        exitCode: 1,
        durationSecs: 0,
        logPath: runLogger.logPath,
      };
    }

    const workflow = toWorkflow(input);
    const result = await deps.runReviewAgent(workflow, diff, token, runLogger, {
      stepId,
      pidRegistry: deps.pidRegistry,
    });
    return {
      ok: result.reviewPass,
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

function toWorkflow(input: ReviewStepInput): Workflow {
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
