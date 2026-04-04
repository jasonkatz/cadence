import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { Run } from "./run-dao";
import { createRunDao } from "./run-dao";
import type { QueryFn } from "../db";

function makeRun(overrides?: Partial<Run>): Run {
  return {
    id: "run-1",
    step_id: "step-1",
    workflow_id: "wf-1",
    agent_role: "planner",
    iteration: 0,
    prompt: "Analyze the repository",
    response: null,
    exit_code: null,
    duration_secs: null,
    created_at: new Date(),
    ...overrides,
  };
}

const mockQuery = mock<(...args: unknown[]) => Promise<{ rows: unknown[] }>>(() =>
  Promise.resolve({ rows: [] })
);

function makeDeps() {
  return createRunDao(mockQuery as unknown as QueryFn);
}

describe("runDao", () => {
  let runDao: ReturnType<typeof createRunDao>;

  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    runDao = makeDeps();
  });

  describe("create", () => {
    it("should insert a run and return it", async () => {
      const run = makeRun();
      mockQuery.mockResolvedValue({ rows: [run] });

      const result = await runDao.create({
        stepId: "step-1",
        workflowId: "wf-1",
        agentRole: "planner",
        iteration: 0,
        prompt: "Analyze the repository",
      });

      expect(result.id).toBe("run-1");
      expect(result.agent_role).toBe("planner");
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("INSERT INTO runs");
    });
  });

  describe("updateResult", () => {
    it("should update run with response, exit_code, and duration", async () => {
      const updated = makeRun({
        response: "Here is the proposal...",
        exit_code: 0,
        duration_secs: 45,
      });
      mockQuery.mockResolvedValue({ rows: [updated] });

      const result = await runDao.updateResult("run-1", {
        response: "Here is the proposal...",
        exitCode: 0,
        durationSecs: 45,
      });

      expect(result).not.toBeNull();
      expect(result!.response).toBe("Here is the proposal...");
      expect(result!.exit_code).toBe(0);
      expect(result!.duration_secs).toBe(45);
    });

    it("should return null if run not found", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await runDao.updateResult("nonexistent", {
        response: "test",
        exitCode: 1,
        durationSecs: 5,
      });

      expect(result).toBeNull();
    });
  });
});
