import { describe, it, expect, beforeEach } from "bun:test";
import { JobQueue, type JobData } from "./job-queue";

function makeJobData(overrides?: Partial<JobData>): JobData {
  return {
    workflowId: "wf-1",
    iteration: 0,
    stepIds: { plan: "step-1", dev: "step-2" },
    ...overrides,
  };
}

describe("JobQueue", () => {
  let queue: JobQueue;

  beforeEach(() => {
    queue = new JobQueue();
  });

  it("should execute jobs sequentially within a workflow", async () => {
    const order: string[] = [];

    queue.registerHandler("job-a", async (data) => {
      order.push(`a-${data.workflowId}`);
      await new Promise((r) => setTimeout(r, 10));
    });
    queue.registerHandler("job-b", async (data) => {
      order.push(`b-${data.workflowId}`);
    });

    queue.start();

    queue.enqueue("job-a", makeJobData(), 60000);
    queue.enqueue("job-b", makeJobData(), 60000);

    // Wait for processing
    await new Promise((r) => setTimeout(r, 100));

    expect(order).toEqual(["a-wf-1", "b-wf-1"]);
    queue.stop();
  });

  it("should execute jobs concurrently across workflows", async () => {
    const running: string[] = [];
    const completed: string[] = [];

    queue.registerHandler("job-a", async (data) => {
      running.push(data.workflowId);
      await new Promise((r) => setTimeout(r, 50));
      completed.push(data.workflowId);
    });

    queue.start();

    queue.enqueue("job-a", makeJobData({ workflowId: "wf-1" }), 60000);
    queue.enqueue("job-a", makeJobData({ workflowId: "wf-2" }), 60000);

    // Both should start concurrently
    await new Promise((r) => setTimeout(r, 20));
    expect(running).toContain("wf-1");
    expect(running).toContain("wf-2");

    await new Promise((r) => setTimeout(r, 100));
    expect(completed).toContain("wf-1");
    expect(completed).toContain("wf-2");
    queue.stop();
  });

  it("should cancel pending jobs for a workflow", async () => {
    const executed: string[] = [];

    queue.registerHandler("job-a", async (data) => {
      executed.push(`a-${data.iteration}`);
      await new Promise((r) => setTimeout(r, 50));
    });
    queue.registerHandler("job-b", async (data) => {
      executed.push(`b-${data.iteration}`);
    });

    queue.start();

    queue.enqueue("job-a", makeJobData({ iteration: 0 }), 60000);
    queue.enqueue("job-b", makeJobData({ iteration: 1 }), 60000);

    // Cancel before job-b runs
    await new Promise((r) => setTimeout(r, 10));
    queue.cancel("wf-1");

    await new Promise((r) => setTimeout(r, 100));

    // job-a already started, job-b should not execute
    expect(executed).toContain("a-0");
    expect(executed).not.toContain("b-1");
    queue.stop();
  });

  it("should return a job ID on enqueue", () => {
    queue.registerHandler("job-a", async () => {});
    const id = queue.enqueue("job-a", makeJobData(), 60000);
    expect(id).toBeDefined();
    expect(typeof id).toBe("string");
  });

  it("should handle errors without crashing the queue", async () => {
    const executed: string[] = [];

    queue.registerHandler("job-a", async () => {
      throw new Error("boom");
    });
    queue.registerHandler("job-b", async () => {
      executed.push("b");
    });

    queue.start();

    queue.enqueue("job-a", makeJobData(), 60000);
    queue.enqueue("job-b", makeJobData(), 60000);

    await new Promise((r) => setTimeout(r, 100));

    expect(executed).toContain("b");
    queue.stop();
  });

  it("should not process jobs before start() is called", async () => {
    const executed: string[] = [];
    queue.registerHandler("job-a", async () => {
      executed.push("a");
    });

    queue.enqueue("job-a", makeJobData(), 60000);

    await new Promise((r) => setTimeout(r, 50));
    expect(executed).toHaveLength(0);

    queue.start();
    await new Promise((r) => setTimeout(r, 50));
    expect(executed).toContain("a");
    queue.stop();
  });
});
