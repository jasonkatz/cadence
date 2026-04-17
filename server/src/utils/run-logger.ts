import path from "path";
import os from "os";
import { mkdirSync, openSync, writeSync, closeSync, fsyncSync } from "fs";

export type RunEvent =
  | "prompt"
  | "response"
  | "tool_call"
  | "error"
  | "system"
  | "assistant"
  | "user"
  | "result"
  | "rate_limit_event";

export interface RunLogger {
  logPath: string;
  append(event: RunEvent, data: unknown): void;
  close(): void;
}

/**
 * Per-step logger that holds a single open file descriptor and writes each
 * event as a full JSONL line via `writeSync`. This beats `appendFileSync`
 * (one open/close per event) for throughput and keeps each record atomic at
 * the fd level. The fd is closed by `close()` on step completion. A final
 * `fsync` on close pushes OS buffers to disk; mid-step `kill -9` may still
 * truncate the tail line, which `parseJsonlTolerant()` drops on read.
 */
export function createRunLogger(
  workflowId: string,
  stepType: string,
  iteration: number
): RunLogger {
  const dir = path.join(os.homedir(), ".tmpo", "runs", workflowId);
  mkdirSync(dir, { recursive: true });
  const logPath = path.join(dir, `${stepType}-${iteration}.jsonl`);

  // 'a' = append; file is created if absent. Sharing an fd across appends is
  // safe because writeSync is atomic at the OS level for small writes.
  let fd: number | null = openSync(logPath, "a");

  return {
    logPath,
    append(event: RunEvent, data: unknown) {
      if (fd === null) return;
      const line =
        JSON.stringify({
          ts: new Date().toISOString(),
          event,
          data,
        }) + "\n";
      writeSync(fd, line);
    },
    close(): void {
      if (fd === null) return;
      const f = fd;
      fd = null;
      try {
        fsyncSync(f);
      } catch {
        // fsync may fail on some filesystems; durability on crash is best-effort.
      }
      try {
        closeSync(f);
      } catch {
        // best-effort close
      }
    },
  };
}

/**
 * Parse JSONL content, tolerating a partial trailing line (from e.g. a
 * `kill -9` between flushes). Any line that fails to JSON-parse is dropped
 * from the tail so the caller sees a well-formed stream.
 */
export function parseJsonlTolerant(content: string): string {
  if (!content) return "";
  const lines = content.split("\n");
  if (lines.length === 0) return "";
  const last = lines[lines.length - 1];
  if (last === "") {
    return content;
  }
  try {
    JSON.parse(last);
    return content;
  } catch {
    return lines.slice(0, -1).join("\n") + "\n";
  }
}
