import { useState, useEffect, useRef } from "react";
import { useAuth } from "./useAuth";
import { config } from "../config";

export interface PipelineState {
  id: string;
  task: string;
  stage: string;
  iteration: number;
  max_iters: number;
  pr_number: number | null;
  branch: string;
  repo: string;
  started_at: string;
  updated_at: string;
  error: string | null;
  personality?: string;
}

interface UsePipelineStateResult {
  state: PipelineState | null;
  /** True while the initial fetch is in progress. */
  loading: boolean;
}

/**
 * Connects to the SSE stream for the given workflow id and returns live state.
 * Falls back to null when no workflow id is provided.
 */
export function usePipelineState(
  workflowId: string | null,
): UsePipelineStateResult {
  const { getAccessTokenSilently } = useAuth();
  const [state, setState] = useState<PipelineState | null>(null);
  const [loading, setLoading] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!workflowId) return;

    let cancelled = false;
    setLoading(true);

    const connect = async () => {
      const token = await getAccessTokenSilently();

      // EventSource doesn't support custom headers, so pass token as query param.
      // The server's requireAuth middleware must accept bearer tokens via query.
      const url = `${config.apiUrl}/v1/workflows/${workflowId}/events?token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.onmessage = (event) => {
        if (cancelled) return;
        try {
          const parsed = JSON.parse(event.data) as PipelineState;
          setState(parsed);
          setLoading(false);
        } catch {
          // Ignore malformed SSE frames
        }
      };

      es.onerror = () => {
        if (!cancelled) setLoading(false);
      };
    };

    connect().catch(() => setLoading(false));

    return () => {
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
      setState(null);
    };
  }, [workflowId, getAccessTokenSilently]);

  return { state, loading };
}
