import { useEffect, useRef } from "react";
import { useAuth } from "./useAuth";
import { config } from "../config";

interface WorkflowEventData {
  type: "step:updated" | "workflow:updated" | "workflow:completed";
  data: Record<string, unknown>;
}

export function useWorkflowEvents(
  workflowId: string | undefined,
  onEvent: (event: WorkflowEventData) => void
) {
  const { getAccessTokenSilently } = useAuth();
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!workflowId) return;

    let cancelled = false;

    async function connect() {
      const token = await getAccessTokenSilently();
      if (cancelled) return;

      // EventSource doesn't support auth headers, so use fetch + ReadableStream
      const response = await fetch(
        `${config.apiUrl}/v1/workflows/${workflowId}/events`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
          },
        }
      );

      if (!response.ok || !response.body) return;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";
      let currentData = "";

      while (!cancelled) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7);
          } else if (line.startsWith("data: ")) {
            currentData = line.slice(6);
          } else if (line === "" && currentEvent) {
            try {
              const parsed = JSON.parse(currentData);
              onEventRef.current({
                type: currentEvent as WorkflowEventData["type"],
                data: parsed,
              });
            } catch {
              // ignore parse errors
            }
            currentEvent = "";
            currentData = "";
          }
        }
      }
    }

    connect().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [workflowId, getAccessTokenSilently]);
}
