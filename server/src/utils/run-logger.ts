import path from "path";
import os from "os";
import { mkdirSync, appendFileSync } from "fs";

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
}

export function createRunLogger(
  workflowId: string,
  stepType: string,
  iteration: number
): RunLogger {
  const dir = path.join(os.homedir(), ".tmpo", "runs", workflowId);
  mkdirSync(dir, { recursive: true });
  const logPath = path.join(dir, `${stepType}-${iteration}.jsonl`);

  return {
    logPath,
    append(event: RunEvent, data: unknown) {
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        event,
        data,
      });
      appendFileSync(logPath, line + "\n");
    },
  };
}
