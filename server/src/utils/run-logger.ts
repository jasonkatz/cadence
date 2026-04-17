import path from "path";
import os from "os";
import {
  mkdirSync,
  openSync,
  readSync,
  writeSync,
  closeSync,
  fsyncSync,
  ftruncateSync,
  fstatSync,
} from "fs";

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
 * Per-step logger that holds a single open file descriptor for the duration
 * of the step, equivalent to a flushed `fs.WriteStream` (each `writeSync`
 * is a full flush to the OS, so there is no internal buffer to lose on
 * `kill -9`). This beats `appendFileSync` on throughput by avoiding an
 * open/close per event and keeps each record atomic at the fd level.
 *
 * Closed by `close()` on step completion; a final `fsyncSync` pushes OS
 * buffers to disk.
 *
 * Crash recovery: if a previous daemon lifecycle was killed mid-write, the
 * file may end with a partial (non-`\n`-terminated) line. On open we heal
 * by truncating back to the last complete record, so a WDK replay writing
 * to the same (workflowId, stepType, iteration) path doesn't produce a
 * malformed line spliced across the crash boundary.
 */
export function createRunLogger(
  workflowId: string,
  stepType: string,
  iteration: number
): RunLogger {
  const dir = path.join(os.homedir(), ".tmpo", "runs", workflowId);
  mkdirSync(dir, { recursive: true });
  const logPath = path.join(dir, `${stepType}-${iteration}.jsonl`);

  healPartialTail(logPath);

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
 * Truncate `logPath` to the last complete line (last `\n` byte). No-op if
 * the file ends in `\n` or does not exist. Called from `createRunLogger`
 * before re-opening for append on a replayed step.
 */
function healPartialTail(logPath: string): void {
  let fd: number;
  try {
    fd = openSync(logPath, "r+");
  } catch {
    // File doesn't exist yet; append-open below will create it.
    return;
  }
  try {
    const size = fstatSync(fd).size;
    if (size === 0) return;

    // Read the last chunk to find the last `\n`. 64 KiB is enough for any
    // single JSONL record this codebase produces; if no newline is found in
    // that window, assume the whole file is partial and truncate to zero.
    const chunk = Math.min(size, 65536);
    const buf = Buffer.alloc(chunk);
    readSync(fd, buf, 0, chunk, size - chunk);
    let lastNl = -1;
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i] === 0x0a) {
        lastNl = i;
        break;
      }
    }
    const lastAbs = lastNl === -1 ? -1 : size - chunk + lastNl;
    if (lastAbs < size - 1) {
      ftruncateSync(fd, lastAbs + 1);
    }
  } finally {
    closeSync(fd);
  }
}

/**
 * Parse JSONL content, dropping any line that fails to JSON-parse. On-disk
 * healing (see `healPartialTail`) makes this a rare path, but readers that
 * stream the file while a step is actively writing may still see a partial
 * tail between an OS page flush and the next newline.
 */
export function parseJsonlTolerant(content: string): string {
  if (!content) return "";
  const kept: string[] = [];
  for (const line of content.split("\n")) {
    if (line === "") continue;
    try {
      JSON.parse(line);
      kept.push(line);
    } catch {
      // Drop malformed line — partial write or corruption.
    }
  }
  if (kept.length === 0) return "";
  return kept.join("\n") + "\n";
}
