import { describe, it, expect, beforeEach } from "bun:test";
import { eventBus, WorkflowEvent } from "./event-bus";

describe("eventBus", () => {
  beforeEach(() => {
    eventBus.removeAllListeners();
  });

  describe("subscribe / emit", () => {
    it("should deliver step events to workflow subscribers", () => {
      const received: WorkflowEvent[] = [];
      eventBus.subscribe("wf-1", (event) => received.push(event));

      const event: WorkflowEvent = {
        type: "step:updated",
        workflowId: "wf-1",
        data: { stepId: "step-1", status: "running" },
      };
      eventBus.emit(event);

      expect(received).toHaveLength(1);
      expect(received[0].type).toBe("step:updated");
    });

    it("should not deliver events to unrelated workflow subscribers", () => {
      const received: WorkflowEvent[] = [];
      eventBus.subscribe("wf-2", (event) => received.push(event));

      eventBus.emit({
        type: "step:updated",
        workflowId: "wf-1",
        data: { stepId: "step-1", status: "running" },
      });

      expect(received).toHaveLength(0);
    });

    it("should support multiple subscribers for the same workflow", () => {
      const received1: WorkflowEvent[] = [];
      const received2: WorkflowEvent[] = [];
      eventBus.subscribe("wf-1", (event) => received1.push(event));
      eventBus.subscribe("wf-1", (event) => received2.push(event));

      eventBus.emit({
        type: "step:updated",
        workflowId: "wf-1",
        data: { stepId: "step-1", status: "passed" },
      });

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
    });
  });

  describe("unsubscribe", () => {
    it("should stop delivering events after unsubscribe", () => {
      const received: WorkflowEvent[] = [];
      const handler = (event: WorkflowEvent) => received.push(event);
      eventBus.subscribe("wf-1", handler);

      eventBus.emit({
        type: "step:updated",
        workflowId: "wf-1",
        data: { stepId: "step-1", status: "running" },
      });
      expect(received).toHaveLength(1);

      eventBus.unsubscribe("wf-1", handler);

      eventBus.emit({
        type: "step:updated",
        workflowId: "wf-1",
        data: { stepId: "step-1", status: "passed" },
      });
      expect(received).toHaveLength(1); // still 1
    });
  });

  describe("workflow events", () => {
    it("should deliver workflow:updated events", () => {
      const received: WorkflowEvent[] = [];
      eventBus.subscribe("wf-1", (event) => received.push(event));

      eventBus.emit({
        type: "workflow:updated",
        workflowId: "wf-1",
        data: { status: "failed", error: "Agent timed out" },
      });

      expect(received).toHaveLength(1);
      expect(received[0].type).toBe("workflow:updated");
    });

    it("should deliver workflow:completed events", () => {
      const received: WorkflowEvent[] = [];
      eventBus.subscribe("wf-1", (event) => received.push(event));

      eventBus.emit({
        type: "workflow:completed",
        workflowId: "wf-1",
        data: { status: "complete" },
      });

      expect(received).toHaveLength(1);
      expect(received[0].type).toBe("workflow:completed");
    });
  });

  describe("removeAllListeners", () => {
    it("should clear all subscribers", () => {
      const received: WorkflowEvent[] = [];
      eventBus.subscribe("wf-1", (event) => received.push(event));
      eventBus.subscribe("wf-2", (event) => received.push(event));

      eventBus.removeAllListeners();

      eventBus.emit({
        type: "step:updated",
        workflowId: "wf-1",
        data: { stepId: "step-1", status: "running" },
      });

      expect(received).toHaveLength(0);
    });
  });
});
