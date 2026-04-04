export interface WorkflowEvent {
  type: "step:updated" | "workflow:updated" | "workflow:completed";
  workflowId: string;
  data: Record<string, unknown>;
}

type EventHandler = (event: WorkflowEvent) => void;

class EventBus {
  private subscribers = new Map<string, Set<EventHandler>>();

  subscribe(workflowId: string, handler: EventHandler): void {
    if (!this.subscribers.has(workflowId)) {
      this.subscribers.set(workflowId, new Set());
    }
    this.subscribers.get(workflowId)!.add(handler);
  }

  unsubscribe(workflowId: string, handler: EventHandler): void {
    this.subscribers.get(workflowId)?.delete(handler);
  }

  emit(event: WorkflowEvent): void {
    const handlers = this.subscribers.get(event.workflowId);
    if (handlers) {
      for (const handler of handlers) {
        handler(event);
      }
    }
  }

  removeAllListeners(): void {
    this.subscribers.clear();
  }
}

export const eventBus = new EventBus();
