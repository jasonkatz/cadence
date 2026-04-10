import { describe, it, expect, afterEach } from "bun:test";
import { createRunLogger } from "./run-logger";
import { readFileSync, rmSync, existsSync } from "fs";
import path from "path";
import os from "os";

const TEST_WF_ID = `test-wf-${Date.now()}`;
const TEST_DIR = path.join(os.homedir(), ".tmpo", "runs", TEST_WF_ID);

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

describe("createRunLogger", () => {
  it("should create the run directory and log file", () => {
    const logger = createRunLogger(TEST_WF_ID, "plan", 0);

    expect(logger.logPath).toContain(TEST_WF_ID);
    expect(logger.logPath).toContain("plan-0.jsonl");

    logger.append("prompt", { text: "hello" });
    expect(existsSync(logger.logPath)).toBe(true);
  });

  it("should write valid JSONL with ts, event, and data fields", () => {
    const logger = createRunLogger(TEST_WF_ID, "dev", 1);

    logger.append("prompt", { text: "implement feature" });
    logger.append("response", { text: "done", exitCode: 0 });

    const content = readFileSync(logger.logPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    expect(first.ts).toBeDefined();
    expect(first.event).toBe("prompt");
    expect(first.data.text).toBe("implement feature");

    const second = JSON.parse(lines[1]);
    expect(second.event).toBe("response");
    expect(second.data.exitCode).toBe(0);
  });

  it("should support all event types", () => {
    const logger = createRunLogger(TEST_WF_ID, "e2e", 0);

    logger.append("prompt", { text: "test" });
    logger.append("tool_call", { name: "bash", args: "ls" });
    logger.append("response", { text: "ok" });
    logger.append("error", { message: "timeout" });

    const content = readFileSync(logger.logPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(4);

    const events = lines.map((l) => JSON.parse(l).event);
    expect(events).toEqual(["prompt", "tool_call", "response", "error"]);
  });

  it("should generate correct log path format", () => {
    const logger = createRunLogger(TEST_WF_ID, "review", 3);
    expect(logger.logPath).toBe(
      path.join(os.homedir(), ".tmpo", "runs", TEST_WF_ID, "review-3.jsonl")
    );
  });
});
