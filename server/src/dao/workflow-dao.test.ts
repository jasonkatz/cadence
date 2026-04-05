import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { Workflow } from "./workflow-dao";
import { createWorkflowDao } from "./workflow-dao";
import type { QueryFn } from "../db";

function makeWorkflow(overrides?: Partial<Workflow>): Workflow {
  return {
    id: "wf-1",
    task: "add login page",
    repo: "acme/webapp",
    branch: "cadence/abc123",
    requirements: null,
    proposal: null,
    pr_number: null,
    status: "pending",
    iteration: 0,
    max_iters: 8,
    error: null,
    created_by: "user-1",
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

const mockQuery = mock<(...args: unknown[]) => Promise<{ rows: unknown[] }>>(() =>
  Promise.resolve({ rows: [] })
);

function makeDeps() {
  return createWorkflowDao(mockQuery as unknown as QueryFn);
}

describe("workflowDao", () => {
  let workflowDao: ReturnType<typeof createWorkflowDao>;

  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    workflowDao = makeDeps();
  });

  describe("findPending", () => {
    it("should return the oldest pending workflow", async () => {
      const wf = makeWorkflow({ status: "pending" });
      mockQuery.mockResolvedValue({ rows: [wf] });

      const result = await workflowDao.findPending();

      expect(result).not.toBeNull();
      expect(result!.status).toBe("pending");
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("status = 'pending'");
      expect(sql).toContain("ORDER BY created_at ASC");
      expect(sql).toContain("LIMIT 1");
    });

    it("should return null when no pending workflows", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await workflowDao.findPending();

      expect(result).toBeNull();
    });
  });

  describe("updateProposal", () => {
    it("should set the proposal text on a workflow", async () => {
      const updated = makeWorkflow({ proposal: "# Plan\n..." });
      mockQuery.mockResolvedValue({ rows: [updated] });

      const result = await workflowDao.updateProposal("wf-1", "# Plan\n...");

      expect(result).not.toBeNull();
      expect(result!.proposal).toBe("# Plan\n...");
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("proposal");
    });
  });

  describe("updateError", () => {
    it("should set error and status to failed", async () => {
      const updated = makeWorkflow({ status: "failed", error: "Agent timed out" });
      mockQuery.mockResolvedValue({ rows: [updated] });

      const result = await workflowDao.updateError("wf-1", "Agent timed out");

      expect(result).not.toBeNull();
      expect(result!.status).toBe("failed");
      expect(result!.error).toBe("Agent timed out");
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("status = 'failed'");
      expect(sql).toContain("error");
    });
  });

  describe("create", () => {
    it("should pass maxIters 0 without defaulting to 8", async () => {
      const wf = makeWorkflow({ max_iters: 0 });
      mockQuery.mockResolvedValue({ rows: [wf] });

      await workflowDao.create({
        task: "test",
        repo: "acme/app",
        branch: "cadence/abc",
        maxIters: 0,
        createdBy: "user-1",
      });

      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params[4]).toBe(0);
    });
  });

  describe("updateIteration", () => {
    it("should increment the iteration field", async () => {
      const updated = makeWorkflow({ iteration: 1 });
      mockQuery.mockResolvedValue({ rows: [updated] });

      const result = await workflowDao.updateIteration("wf-1", 1);

      expect(result).not.toBeNull();
      expect(result!.iteration).toBe(1);
    });
  });

  describe("updatePrNumber", () => {
    it("should set the pr_number on a workflow", async () => {
      const updated = makeWorkflow({ pr_number: 42 });
      mockQuery.mockResolvedValue({ rows: [updated] });

      const result = await workflowDao.updatePrNumber("wf-1", 42);

      expect(result).not.toBeNull();
      expect(result!.pr_number).toBe(42);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("pr_number");
      expect(sql).toContain("RETURNING");
    });

    it("should return null when workflow not found", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await workflowDao.updatePrNumber("wf-nonexistent", 42);

      expect(result).toBeNull();
    });
  });
});
