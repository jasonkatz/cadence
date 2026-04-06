import { describe, it, expect, mock } from "bun:test";
import type { Workflow } from "../dao/workflow-dao";
import type { WorkflowEvent } from "../events/event-bus";
import { createEventsHandler, EventsHandlerDeps } from "./events";

function makeWorkflow(overrides?: Partial<Workflow>): Workflow {
  return {
    id: "wf-1",
    task: "add login page",
    repo: "acme/webapp",
    branch: "tmpo/abc123",
    requirements: null,
    proposal: null,
    pr_number: null,
    status: "running",
    iteration: 0,
    max_iters: 8,
    error: null,
    created_by: "user-1",
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function makeFakeRes() {
  const written: string[] = [];
  const headers: Record<string, string> = {};
  let flushed = 0;
  let ended = false;

  return {
    written,
    headers,
    get flushed() { return flushed; },
    get ended() { return ended; },
    writeHead(_code: number, hdrs: Record<string, string>) {
      Object.assign(headers, hdrs);
    },
    write(data: string) {
      written.push(data);
      return true;
    },
    flush() { flushed++; },
    end() { ended = true; },
    on(_event: string, _cb: () => void) {},
  };
}

function makeDeps() {
  let subscribedHandler: ((event: WorkflowEvent) => void) | null = null;

  const mockFindByIdAndUser = mock((_id: string, _userId: string) =>
    Promise.resolve(null as Workflow | null)
  );

  const deps: EventsHandlerDeps = {
    workflowDao: { findByIdAndUser: mockFindByIdAndUser },
    eventBus: {
      subscribe: (_workflowId: string, handler: (event: WorkflowEvent) => void) => {
        subscribedHandler = handler;
      },
      unsubscribe: () => { subscribedHandler = null; },
    },
  };

  return {
    deps,
    mockFindByIdAndUser,
    emitEvent: (event: WorkflowEvent) => subscribedHandler?.(event),
  };
}

describe("events route handler", () => {
  it("should return 404 if workflow not found", async () => {
    const { deps, mockFindByIdAndUser } = makeDeps();
    mockFindByIdAndUser.mockResolvedValue(null);
    const res = makeFakeRes();
    const next = mock(() => {});

    const handler = createEventsHandler(deps);
    await handler(
      { params: { id: "wf-1" }, user: { id: "user-1" } } as unknown as Parameters<typeof handler>[0],
      res as unknown as Parameters<typeof handler>[1],
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("should set SSE headers for valid workflow", async () => {
    const { deps, mockFindByIdAndUser } = makeDeps();
    mockFindByIdAndUser.mockResolvedValue(makeWorkflow());
    const res = makeFakeRes();
    const next = mock(() => {});

    const handler = createEventsHandler(deps);
    await handler(
      { params: { id: "wf-1" }, user: { id: "user-1" } } as unknown as Parameters<typeof handler>[0],
      res as unknown as Parameters<typeof handler>[1],
      next
    );

    expect(res.headers["Content-Type"]).toBe("text/event-stream");
    expect(res.headers["Cache-Control"]).toBe("no-cache");
    expect(res.headers["Connection"]).toBe("keep-alive");
  });

  it("should write SSE-formatted events when emitted", async () => {
    const { deps, mockFindByIdAndUser, emitEvent } = makeDeps();
    mockFindByIdAndUser.mockResolvedValue(makeWorkflow());
    const res = makeFakeRes();
    const next = mock(() => {});

    const handler = createEventsHandler(deps);
    await handler(
      { params: { id: "wf-1" }, user: { id: "user-1" } } as unknown as Parameters<typeof handler>[0],
      res as unknown as Parameters<typeof handler>[1],
      next
    );

    emitEvent({
      type: "step:updated",
      workflowId: "wf-1",
      data: { stepId: "step-1", status: "running" },
    });

    const allData = res.written.join("");
    expect(allData).toContain("event: step:updated");
    expect(allData).toContain('"stepId":"step-1"');
  });

  it("should close connection on workflow:completed event", async () => {
    const { deps, mockFindByIdAndUser, emitEvent } = makeDeps();
    mockFindByIdAndUser.mockResolvedValue(makeWorkflow());
    const res = makeFakeRes();
    const next = mock(() => {});

    const handler = createEventsHandler(deps);
    await handler(
      { params: { id: "wf-1" }, user: { id: "user-1" } } as unknown as Parameters<typeof handler>[0],
      res as unknown as Parameters<typeof handler>[1],
      next
    );

    emitEvent({
      type: "workflow:completed",
      workflowId: "wf-1",
      data: { status: "complete" },
    });

    const allData = res.written.join("");
    expect(allData).toContain("event: workflow:completed");
    expect(res.ended).toBe(true);
  });
});
