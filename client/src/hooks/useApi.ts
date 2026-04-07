import { useCallback, useMemo } from "react";
import { config } from "../config";

export function useApi() {
  const request = useCallback(
    async <T>(
      method: string,
      path: string,
      body?: unknown
    ): Promise<T> => {
      const response = await fetch(`${config.apiUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || `Request failed: ${response.status}`);
      }

      return response.json();
    },
    []
  );

  return useMemo(
    () => ({
      get: <T>(path: string) => request<T>("GET", path),
      post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
      put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
      patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
      delete: <T>(path: string) => request<T>("DELETE", path),
    }),
    [request]
  );
}
