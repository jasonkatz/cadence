import { logger } from "./utils/logger";
import type { EngineDeps } from "./engine/workflow-engine";

/**
 * Detect and recover interrupted workflows on daemon startup.
 *
 * Any step with status "running" at startup was interrupted by a crash or
 * kill -9. Mark those steps as failed, and mark the parent workflow as
 * failed with an "interrupted" error so users can see and re-run.
 */
export async function recoverInterruptedWorkflows(
  deps: Pick<EngineDeps, "workflowDao" | "stepDao">
): Promise<number> {
  const { workflows } = await deps.workflowDao.list({ status: "running" });

  let recoveredCount = 0;

  for (const wf of workflows) {
    const steps = await deps.stepDao.findByWorkflowId(wf.id);
    let hadRunningStep = false;

    for (const step of steps) {
      if (step.status === "running") {
        await deps.stepDao.updateStatus(
          step.id,
          "failed",
          "interrupted: daemon shutdown"
        );
        hadRunningStep = true;
      }
    }

    if (hadRunningStep) {
      await deps.workflowDao.updateStatus(wf.id, "failed");
      await deps.workflowDao.updateError(wf.id, "interrupted: daemon shutdown");
      recoveredCount++;
      logger.info(`Recovered interrupted workflow ${wf.id}`);
    }
  }

  if (recoveredCount > 0) {
    logger.info(`Recovered ${recoveredCount} interrupted workflow(s)`);
  }

  return recoveredCount;
}
