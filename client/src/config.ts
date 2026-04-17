// When the CLI opens the embedded HTML via file://, it appends ?api=<url>
// so the client knows where the daemon's TCP listener lives. For `vite dev`
// we fall back to the env var or localhost.
function resolveApiUrl(): string {
  if (typeof window !== "undefined") {
    const fromQuery = new URLSearchParams(window.location.search).get("api");
    if (fromQuery) return fromQuery;
  }
  return import.meta.env.VITE_API_URL || "http://localhost:8080";
}

export const config = {
  apiUrl: resolveApiUrl(),
} as const;
