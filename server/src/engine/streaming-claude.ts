import { spawn } from "child_process";
import {
  recordProcess,
  clearProcess,
  type PidRegistry,
} from "./subprocess-reaper";
import type { RunEvent, RunLogger } from "../utils/run-logger";

export interface StreamingClaudeOptions {
  prompt: string;
  allowedTools: string;
  cwd?: string;
  timeoutMs?: number;
  runLogger?: RunLogger;
  /**
   * Unique step identifier — appended to argv as `--tmpo-step-id=<id>` and
   * recorded in the PID registry so a daemon restart can match the surviving
   * process even if its pid was recycled. `claude` ignores unknown flags.
   */
  stepId?: string;
  /**
   * Registry for stale-PID recovery. Tests pass an in-memory registry;
   * production passes the daemon-wide registry backed by disk.
   */
  pidRegistry?: PidRegistry;
}

export interface StreamingClaudeResult {
  exitCode: number;
  // Final assistant text reported by claude's "result" message. Falls back to
  // the concatenation of assistant text blocks if the result message is missing.
  resultText: string;
  numTurns: number;
}

interface ClaudeMessage {
  type: string;
  subtype?: string;
  message?: { role?: string; content?: Array<{ type: string; text?: string }> };
  result?: string;
  num_turns?: number;
}

const KNOWN_EVENTS: ReadonlySet<string> = new Set<RunEvent>([
  "system",
  "assistant",
  "user",
  "result",
  "rate_limit_event",
  "error",
]);

export function runStreamingClaude(
  opts: StreamingClaudeOptions
): Promise<StreamingClaudeResult> {
  return new Promise((resolve, reject) => {
    opts.runLogger?.append("prompt", { text: opts.prompt });

    const args = [
      "-p",
      opts.prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--allowedTools",
      opts.allowedTools,
    ];
    // Sentinel argv element — the reaper uses this to confirm a recycled PID
    // still belongs to a tmpo step before sending SIGTERM.
    if (opts.stepId) {
      args.push(`--tmpo-step-id=${opts.stepId}`);
    }

    const proc = spawn("claude", args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      // detached:true puts the child in its own process group so we can kill
      // the whole tree via negative pid, and a daemon crash doesn't leave it
      // implicitly attached to a reaped parent.
      detached: true,
    });

    const stepId = opts.stepId;
    if (stepId && proc.pid !== undefined && opts.pidRegistry) {
      opts.pidRegistry.record(stepId, proc.pid);
    }

    let stdoutBuf = "";
    let stderrBuf = "";
    let resultText = "";
    let assistantTextFallback = "";
    let numTurns = 0;

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg: ClaudeMessage;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        opts.runLogger?.append("error", {
          message: "failed to parse claude stream line",
          line: trimmed.slice(0, 500),
        });
        return;
      }

      const event = (KNOWN_EVENTS.has(msg.type) ? msg.type : "system") as RunEvent;
      opts.runLogger?.append(event, msg);

      if (msg.type === "assistant" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "text" && typeof block.text === "string") {
            assistantTextFallback = block.text;
          }
        }
      }

      if (msg.type === "result") {
        if (typeof msg.result === "string") resultText = msg.result;
        if (typeof msg.num_turns === "number") numTurns = msg.num_turns;
      }
    };

    proc.stdout.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      let nl: number;
      while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
        const line = stdoutBuf.slice(0, nl);
        stdoutBuf = stdoutBuf.slice(nl + 1);
        handleLine(line);
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    const killTree = (signal: NodeJS.Signals = "SIGTERM") => {
      if (proc.pid === undefined) return;
      try {
        process.kill(-proc.pid, signal);
      } catch {
        // Process group already gone, or never started.
      }
    };

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          opts.runLogger?.append("error", {
            message: `claude timed out after ${opts.timeoutMs}ms`,
          });
          killTree("SIGTERM");
          reject(new Error(`Command timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;

    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (stdoutBuf.trim()) handleLine(stdoutBuf);
      if (stderrBuf.trim()) {
        opts.runLogger?.append("error", { stderr: stderrBuf.slice(0, 4000) });
      }
      if (stepId && opts.pidRegistry) {
        clearProcess(opts.pidRegistry, stepId);
      }
      resolve({
        exitCode: code ?? 1,
        resultText: resultText || assistantTextFallback,
        numTurns,
      });
    });

    proc.on("error", (err) => {
      if (timer) clearTimeout(timer);
      opts.runLogger?.append("error", { message: err.message });
      if (stepId && opts.pidRegistry) {
        clearProcess(opts.pidRegistry, stepId);
      }
      reject(err);
    });
  });
}

// Re-exported for callers that want to persist pids outside the streaming
// helper (e.g. long-running shell commands wrapped in a step).
export { recordProcess };
