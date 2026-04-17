import { describe, it, expect, afterEach } from "bun:test";
import { createRunLogger, parseJsonlTolerant } from "./run-logger";
import { readFileSync, rmSync, existsSync, writeFileSync } from "fs";
import path from "path";
import os from "os";

const TEST_WF_ID = `test-wf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
    logger.close();
  });

  it("should write valid JSONL with ts, event, and data fields", () => {
    const logger = createRunLogger(TEST_WF_ID, "dev", 1);

    logger.append("prompt", { text: "implement feature" });
    logger.append("response", { text: "done", exitCode: 0 });
    logger.close();

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
    logger.close();

    const content = readFileSync(logger.logPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(4);

    const events = lines.map((l) => JSON.parse(l).event);
    expect(events).toEqual(["prompt", "tool_call", "response", "error"]);
  });

  it("should generate correct log path format", () => {
    const logger = createRunLogger(TEST_WF_ID, "review", 3);
    logger.close();
    expect(logger.logPath).toBe(
      path.join(os.homedir(), ".tmpo", "runs", TEST_WF_ID, "review-3.jsonl")
    );
  });

  it("close() is idempotent", () => {
    const logger = createRunLogger(TEST_WF_ID, "plan", 0);
    logger.close();
    // Second close is a no-op, does not throw.
    logger.close();
  });

  it("append() after close is a no-op", () => {
    const logger = createRunLogger(TEST_WF_ID, "plan", 0);
    logger.append("prompt", { text: "before" });
    logger.close();
    logger.append("prompt", { text: "after" });
    const content = readFileSync(logger.logPath, "utf-8");
    expect(content.trim().split("\n")).toHaveLength(1);
  });

  it("appends across a re-open to the same path (simulating replay)", () => {
    const first = createRunLogger(TEST_WF_ID, "plan", 0);
    first.append("prompt", { text: "first run" });
    first.close();

    const second = createRunLogger(TEST_WF_ID, "plan", 0);
    second.append("prompt", { text: "second run" });
    second.close();

    const content = readFileSync(first.logPath, "utf-8");
    expect(content.trim().split("\n")).toHaveLength(2);
  });

  it("heals a partial trailing line on re-open (no mid-file corruption)", () => {
    // First run writes one good line + a partial (unterminated) second line,
    // simulating kill -9 between writeSync and newline flush.
    const first = createRunLogger(TEST_WF_ID, "dev", 0);
    first.append("prompt", { text: "first run" });
    first.close();
    const logPath = first.logPath;
    writeFileSync(
      logPath,
      readFileSync(logPath, "utf-8") + `{"event":"parti`
    );

    // Replay: re-open the same path. The healer MUST truncate the partial
    // tail before appending, otherwise the new line is glued onto the
    // fragment and produces a malformed mid-file record that
    // parseJsonlTolerant can't trivially recover.
    const second = createRunLogger(TEST_WF_ID, "dev", 0);
    second.append("prompt", { text: "second run" });
    second.close();

    const content = readFileSync(logPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    // Every retained line must be valid JSON — no splicing.
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});

describe("parseJsonlTolerant", () => {
  it("returns empty on empty input", () => {
    expect(parseJsonlTolerant("")).toBe("");
  });

  it("preserves well-formed input with trailing newline", () => {
    const content = `{"event":"a"}\n{"event":"b"}\n`;
    expect(parseJsonlTolerant(content)).toBe(content);
  });

  it("drops a partial trailing line", () => {
    const content = `{"event":"a"}\n{"event":"b"}\n{"event":"partial`;
    const result = parseJsonlTolerant(content);
    expect(result).toBe(`{"event":"a"}\n{"event":"b"}\n`);
  });

  it("tolerates truncated JSON even if final line has no newline", () => {
    const logPath = path.join(TEST_DIR, "test.jsonl");
    const logger = createRunLogger(TEST_WF_ID, "test", 0);
    logger.append("prompt", { text: "complete" });
    logger.close();

    // Append a partial line (simulating kill -9 mid-write)
    writeFileSync(logPath.replace("test.jsonl", "test-0.jsonl"), readFileSync(logPath.replace("test.jsonl", "test-0.jsonl"), "utf-8") + `{"event":"partial`);

    const raw = readFileSync(logPath.replace("test.jsonl", "test-0.jsonl"), "utf-8");
    const cleaned = parseJsonlTolerant(raw);
    expect(cleaned.endsWith("partial")).toBe(false);
    expect(cleaned.trim().split("\n")).toHaveLength(1);
  });
});
