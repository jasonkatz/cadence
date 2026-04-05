import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { Step } from "./step-dao";
import { createStepDao } from "./step-dao";
import type { QueryFn } from "../db";

const STEP_TYPES = ["plan", "dev", "ci", "review", "e2e", "e2e_verify", "signoff"] as const;

function makeStep(overrides?: Partial<Step>): Step {
  return {
    id: "step-1",
    workflow_id: "wf-1",
    iteration: 0,
    type: "plan",
    status: "pending",
    started_at: null,
    finished_at: null,
    detail: null,
    ...overrides,
  };
}

const mockQuery = mock<(...args: unknown[]) => Promise<{ rows: unknown[] }>>(() =>
  Promise.resolve({ rows: [] })
);

function makeDeps() {
  return createStepDao(mockQuery as unknown as QueryFn);
}

describe("stepDao", () => {
  let stepDao: ReturnType<typeof createStepDao>;

  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    stepDao = makeDeps();
  });

  describe("createIterationSteps", () => {
    it("should insert 7 steps for the given workflow and iteration 0", async () => {
      const steps = STEP_TYPES.map((type, i) =>
        makeStep({ id: `step-${i}`, type, workflow_id: "wf-1", iteration: 0 })
      );
      mockQuery.mockResolvedValue({ rows: steps });

      const result = await stepDao.createIterationSteps("wf-1", 0);

      expect(result).toHaveLength(7);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("INSERT INTO steps");
      const params = mockQuery.mock.calls[0][1] as string[];
      expect(params).toContain("plan");
      expect(params).toContain("signoff");
    });

    it("should skip plan step for iteration > 0", async () => {
      const typesWithoutPlan = STEP_TYPES.filter((t) => t !== "plan");
      const steps = typesWithoutPlan.map((type, i) =>
        makeStep({ id: `step-${i}`, type, workflow_id: "wf-1", iteration: 1 })
      );
      mockQuery.mockResolvedValue({ rows: steps });

      await stepDao.createIterationSteps("wf-1", 1);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const params = mockQuery.mock.calls[0][1] as string[];
      expect(params).not.toContain("plan");
      expect(params).toContain("dev");
      expect(params).toContain("signoff");
    });
  });

  describe("updateStatus", () => {
    it("should update step status and set started_at when transitioning to running", async () => {
      const updated = makeStep({ status: "running", started_at: new Date() });
      mockQuery.mockResolvedValue({ rows: [updated] });

      const result = await stepDao.updateStatus("step-1", "running");

      expect(result).not.toBeNull();
      expect(result!.status).toBe("running");
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("started_at");
    });

    it("should update step status and set finished_at when transitioning to passed", async () => {
      const updated = makeStep({ status: "passed", finished_at: new Date() });
      mockQuery.mockResolvedValue({ rows: [updated] });

      const result = await stepDao.updateStatus("step-1", "passed");

      expect(result).not.toBeNull();
      expect(result!.status).toBe("passed");
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("finished_at");
    });

    it("should accept optional detail when updating status", async () => {
      const updated = makeStep({ status: "failed", detail: "timeout" });
      mockQuery.mockResolvedValue({ rows: [updated] });

      const result = await stepDao.updateStatus("step-1", "failed", "timeout");

      expect(result).not.toBeNull();
      expect(result!.detail).toBe("timeout");
    });

    it("should return null if step not found", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await stepDao.updateStatus("nonexistent", "running");

      expect(result).toBeNull();
    });
  });
});
