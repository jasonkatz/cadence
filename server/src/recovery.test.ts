import { describe, it, expect, mock } from "bun:test";
import { recoverInterruptedWorkflows } from "./recovery";

function makeDeps() {
  const workflows: Array<{
    id: string;
    status: string;
  }> = [];

  const steps: Array<{
    id: string;
    workflow_id: string;
    status: string;
    detail: string | null;
  }> = [];

  const statusUpdates: Array<{ id: string; status: string; detail?: string }> = [];
  const workflowStatusUpdates: Array<{ id: string; status: string }> = [];
  const workflowErrorUpdates: Array<{ id: string; error: string }> = [];

  return {
    deps: {
      workflowDao: {
        list: mock(async (params: { status?: string }) => {
          const filtered = workflows.filter(
            (w) => !params.status || w.status === params.status
          );
          return { workflows: filtered, total: filtered.length };
        }),
        updateStatus: mock(async (id: string, status: string) => {
          workflowStatusUpdates.push({ id, status });
          return null;
        }),
        updateError: mock(async (id: string, error: string) => {
          workflowErrorUpdates.push({ id, error });
          return null;
        }),
      },
      stepDao: {
        findByWorkflowId: mock(async (workflowId: string) => {
          return steps.filter((s) => s.workflow_id === workflowId);
        }),
        updateStatus: mock(async (id: string, status: string, detail?: string) => {
          statusUpdates.push({ id, status, detail });
          return null;
        }),
      },
    },
    workflows,
    steps,
    statusUpdates,
    workflowStatusUpdates,
    workflowErrorUpdates,
  };
}

describe("recoverInterruptedWorkflows", () => {
  it("should return 0 when no running workflows exist", async () => {
    const { deps } = makeDeps();
    const count = await recoverInterruptedWorkflows(deps);
    expect(count).toBe(0);
  });

  it("should mark running steps as failed with interrupted message", async () => {
    const { deps, workflows, steps, statusUpdates } = makeDeps();

    workflows.push({ id: "wf-1", status: "running" });
    steps.push(
      { id: "step-1", workflow_id: "wf-1", status: "passed", detail: null },
      { id: "step-2", workflow_id: "wf-1", status: "running", detail: null }
    );

    const count = await recoverInterruptedWorkflows(deps);

    expect(count).toBe(1);
    expect(statusUpdates).toEqual([
      { id: "step-2", status: "failed", detail: "interrupted: daemon shutdown" },
    ]);
  });

  it("should mark parent workflow as failed", async () => {
    const { deps, workflows, steps, workflowStatusUpdates, workflowErrorUpdates } =
      makeDeps();

    workflows.push({ id: "wf-1", status: "running" });
    steps.push({
      id: "step-1",
      workflow_id: "wf-1",
      status: "running",
      detail: null,
    });

    await recoverInterruptedWorkflows(deps);

    expect(workflowStatusUpdates).toEqual([{ id: "wf-1", status: "failed" }]);
    expect(workflowErrorUpdates).toEqual([
      { id: "wf-1", error: "interrupted: daemon shutdown" },
    ]);
  });

  it("should handle multiple interrupted workflows", async () => {
    const { deps, workflows, steps } = makeDeps();

    workflows.push(
      { id: "wf-1", status: "running" },
      { id: "wf-2", status: "running" }
    );
    steps.push(
      { id: "step-1", workflow_id: "wf-1", status: "running", detail: null },
      { id: "step-2", workflow_id: "wf-2", status: "running", detail: null }
    );

    const count = await recoverInterruptedWorkflows(deps);
    expect(count).toBe(2);
  });

  it("should skip workflows where no steps were running", async () => {
    const { deps, workflows, steps, workflowStatusUpdates } = makeDeps();

    workflows.push({ id: "wf-1", status: "running" });
    steps.push({
      id: "step-1",
      workflow_id: "wf-1",
      status: "passed",
      detail: null,
    });

    const count = await recoverInterruptedWorkflows(deps);
    expect(count).toBe(0);
    expect(workflowStatusUpdates).toHaveLength(0);
  });
});
