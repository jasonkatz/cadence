import { createRunLogger } from "../../utils/run-logger";
import type { DevStepInput, DevStepResult } from "../types";
import { getStepDeps } from "./deps";
import type { Workflow } from "../../dao/workflow-dao";

export async function devStep(input: DevStepInput): Promise<DevStepResult> {
  "use step";

  const deps = getStepDeps();
  const runLogger = createRunLogger(input.workflowId, "dev", input.iteration);

  try {
    const token = deps.getDecryptedToken();
    const workflow = toWorkflow(input);
    const result = await deps.runDevAgent(workflow, token, runLogger);
    return {
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      durationSecs: result.durationSecs,
      response: result.response,
      logPath: runLogger.logPath,
    };
  } finally {
    runLogger.close();
  }
}

function toWorkflow(input: DevStepInput): Workflow {
  return {
    id: input.workflowId,
    task: input.task,
    repo: input.repo,
    branch: input.branch,
    requirements: input.requirements,
    proposal: input.proposal,
    pr_number: null,
    status: "running",
    iteration: input.iteration,
    max_iters: input.maxIters,
    error: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
}
