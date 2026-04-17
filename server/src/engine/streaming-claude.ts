import { spawn } from "child_process";
import type { RunEvent, RunLogger } from "../utils/run-logger";

export interface StreamingClaudeOptions {
  prompt: string;
  allowedTools: string;
  cwd?: string;
  timeoutMs?: number;
  runLogger?: RunLogger;
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

    const proc = spawn("claude", args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

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

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          opts.runLogger?.append("error", {
            message: `claude timed out after ${opts.timeoutMs}ms`,
          });
          proc.kill("SIGTERM");
          reject(new Error(`Command timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;

    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (stdoutBuf.trim()) handleLine(stdoutBuf);
      if (stderrBuf.trim()) {
        opts.runLogger?.append("error", { stderr: stderrBuf.slice(0, 4000) });
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
      reject(err);
    });
  });
}
