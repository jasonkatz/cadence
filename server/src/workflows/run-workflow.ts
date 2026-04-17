import { orchestrate, type OrchestratorHooks, type OrchestratorSteps } from "./orchestrator";
import {
  planStep,
  devStep,
  ciStep,
  reviewStep,
  e2eStep,
  e2eVerifyStep,
  createPrStep,
  postCommentStep,
} from "./steps";
import type { WorkflowContext, WorkflowRunResult } from "./types";
import { getIndexSync } from "../engine/index-sync";

/**
 * `"use workflow"` entry point. Under WDK, this function body is replayed
 * deterministically on daemon restart: completed step results are served
 * from the WDK event log, and the first unfinished step re-executes.
 *
 * All side effects live inside steps (which WDK memoizes) or in hooks
 * (which are invoked idempotently via the SQLite index-sync adapter).
 */
export async function runWorkflow(ctx: WorkflowContext): Promise<WorkflowRunResult> {
  "use workflow";

  const steps: OrchestratorSteps = {
    plan: (i) => planStep(i),
    dev: (i) => devStep(i),
    createPr: (i) => createPrStep(i),
    postComment: (i) => postCommentStep(i),
    ci: (i) => ciStep(i),
    review: (i) => reviewStep(i),
    e2e: (i) => e2eStep(i),
    e2eVerify: (i) => e2eVerifyStep(i),
  };

  const hooks: OrchestratorHooks = getIndexSync().hooksFor(ctx.workflowId);

  return orchestrate(ctx, steps, hooks);
}
