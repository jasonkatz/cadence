import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { Workflow } from "../dao/workflow-dao";
import type { Step } from "../dao/step-dao";
import type { Run } from "../dao/run-dao";

// --- Workflow DAO mocks ---
const mockWorkflowCreate = mock<(data: any) => Promise<Workflow>>(() =>
  Promise.resolve(makeWorkflow())
);
const mockWorkflowFindByIdAndUser = mock<
  (id: string, userId: string) => Promise<Workflow | null>
>(() => Promise.resolve(null));
const mockWorkflowList = mock<
  (params: any) => Promise<{ workflows: Workflow[]; total: number }>
>(() => Promise.resolve({ workflows: [], total: 0 }));
const mockWorkflowUpdateStatus = mock<
  (id: string, status: string) => Promise<Workflow | null>
>(() => Promise.resolve(null));

mock.module("../dao/workflow-dao", () => ({
  workflowDao: {
    create: mockWorkflowCreate,
    findById: mock(() => Promise.resolve(null)),
    findByIdAndUser: mockWorkflowFindByIdAndUser,
    list: mockWorkflowList,
    updateStatus: mockWorkflowUpdateStatus,
  },
}));

// --- Step DAO mocks ---
const mockStepFindByWorkflowId = mock<
  (workflowId: string, filters?: any) => Promise<Step[]>
>(() => Promise.resolve([]));
const mockStepFindLatest = mock<(workflowId: string) => Promise<Step[]>>(() =>
  Promise.resolve([])
);

mock.module("../dao/step-dao", () => ({
  stepDao: {
    findByWorkflowId: mockStepFindByWorkflowId,
    findLatestIterationByWorkflowId: mockStepFindLatest,
  },
}));

// --- Run DAO mock ---
const mockRunFindByWorkflowId = mock<
  (workflowId: string, filters?: any) => Promise<Run[]>
>(() => Promise.resolve([]));

mock.module("../dao/run-dao", () => ({
  runDao: {
    findByWorkflowId: mockRunFindByWorkflowId,
  },
}));

// --- Settings service mock ---
const mockHasGithubToken = mock<(userId: string) => Promise<boolean>>(() =>
  Promise.resolve(true)
);

mock.module("./settings-service", () => ({
  settingsService: {
    hasGithubToken: mockHasGithubToken,
  },
}));

const { workflowService } = await import("./workflow-service");

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

describe("workflowService", () => {
  beforeEach(() => {
    mockWorkflowCreate.mockReset();
    mockWorkflowFindByIdAndUser.mockReset();
    mockWorkflowList.mockReset();
    mockWorkflowUpdateStatus.mockReset();
    mockStepFindByWorkflowId.mockReset();
    mockStepFindLatest.mockReset();
    mockRunFindByWorkflowId.mockReset();
    mockHasGithubToken.mockReset();
    mockHasGithubToken.mockResolvedValue(true);
  });

  describe("create", () => {
    it("should create a workflow with defaults", async () => {
      const wf = makeWorkflow();
      mockWorkflowCreate.mockResolvedValue(wf);

      const result = await workflowService.create("user-1", {
        task: "add login page",
        repo: "acme/webapp",
      });

      expect(result.id).toBe("wf-1");
      expect(result.status).toBe("pending");
      expect(mockWorkflowCreate).toHaveBeenCalledTimes(1);
    });

    it("should throw ValidationError when task is missing", async () => {
      await expect(
        workflowService.create("user-1", { task: "", repo: "acme/webapp" })
      ).rejects.toThrow("task is required");
    });

    it("should throw ValidationError when repo is missing", async () => {
      await expect(
        workflowService.create("user-1", { task: "do something", repo: "" })
      ).rejects.toThrow("repo is required");
    });

    it("should throw ValidationError when no GitHub token configured", async () => {
      mockHasGithubToken.mockResolvedValue(false);

      await expect(
        workflowService.create("user-1", {
          task: "add login",
          repo: "acme/webapp",
        })
      ).rejects.toThrow("GitHub token not configured");
    });

    it("should use provided branch when given", async () => {
      const wf = makeWorkflow({ branch: "my-branch" });
      mockWorkflowCreate.mockResolvedValue(wf);

      await workflowService.create("user-1", {
        task: "add login",
        repo: "acme/webapp",
        branch: "my-branch",
      });

      const createArg = mockWorkflowCreate.mock.calls[0][0];
      expect(createArg.branch).toBe("my-branch");
    });

    it("should auto-generate branch when not provided", async () => {
      mockWorkflowCreate.mockResolvedValue(makeWorkflow());

      await workflowService.create("user-1", {
        task: "add login",
        repo: "acme/webapp",
      });

      const createArg = mockWorkflowCreate.mock.calls[0][0];
      expect(createArg.branch).toMatch(/^cadence\//);
    });
  });

  describe("list", () => {
    it("should return workflows for user", async () => {
      const wf = makeWorkflow();
      mockWorkflowList.mockResolvedValue({ workflows: [wf], total: 1 });

      const result = await workflowService.list("user-1", {});

      expect(result.total).toBe(1);
      expect(result.workflows).toHaveLength(1);
      expect(result.workflows[0].id).toBe("wf-1");
    });

    it("should pass status filter to DAO", async () => {
      mockWorkflowList.mockResolvedValue({ workflows: [], total: 0 });

      await workflowService.list("user-1", { status: "pending" });

      const listArg = mockWorkflowList.mock.calls[0][0];
      expect(listArg.status).toBe("pending");
    });
  });

  describe("getById", () => {
    it("should return workflow with steps", async () => {
      const wf = makeWorkflow();
      mockWorkflowFindByIdAndUser.mockResolvedValue(wf);
      mockStepFindLatest.mockResolvedValue([]);

      const result = await workflowService.getById("wf-1", "user-1");

      expect(result.id).toBe("wf-1");
      expect(result.steps).toEqual([]);
    });

    it("should throw NotFoundError for missing workflow", async () => {
      mockWorkflowFindByIdAndUser.mockResolvedValue(null);

      await expect(
        workflowService.getById("nonexistent", "user-1")
      ).rejects.toThrow("Workflow not found");
    });
  });

  describe("getSteps", () => {
    it("should throw NotFoundError for missing workflow", async () => {
      mockWorkflowFindByIdAndUser.mockResolvedValue(null);

      await expect(
        workflowService.getSteps("nonexistent", "user-1")
      ).rejects.toThrow("Workflow not found");
    });

    it("should return steps for valid workflow", async () => {
      mockWorkflowFindByIdAndUser.mockResolvedValue(makeWorkflow());
      mockStepFindByWorkflowId.mockResolvedValue([]);

      const result = await workflowService.getSteps("wf-1", "user-1");
      expect(result).toEqual([]);
    });
  });

  describe("getRuns", () => {
    it("should throw NotFoundError for missing workflow", async () => {
      mockWorkflowFindByIdAndUser.mockResolvedValue(null);

      await expect(
        workflowService.getRuns("nonexistent", "user-1")
      ).rejects.toThrow("Workflow not found");
    });

    it("should return runs for valid workflow", async () => {
      mockWorkflowFindByIdAndUser.mockResolvedValue(makeWorkflow());
      mockRunFindByWorkflowId.mockResolvedValue([]);

      const result = await workflowService.getRuns("wf-1", "user-1");
      expect(result).toEqual([]);
    });
  });

  describe("cancel", () => {
    it("should cancel a pending workflow", async () => {
      const wf = makeWorkflow({ status: "pending" });
      mockWorkflowFindByIdAndUser.mockResolvedValue(wf);
      mockWorkflowUpdateStatus.mockResolvedValue(
        makeWorkflow({ status: "cancelled" })
      );

      const result = await workflowService.cancel("wf-1", "user-1");
      expect(result.status).toBe("cancelled");
    });

    it("should throw NotFoundError for missing workflow", async () => {
      mockWorkflowFindByIdAndUser.mockResolvedValue(null);

      await expect(
        workflowService.cancel("nonexistent", "user-1")
      ).rejects.toThrow("Workflow not found");
    });

    it("should throw ConflictError for completed workflow", async () => {
      mockWorkflowFindByIdAndUser.mockResolvedValue(
        makeWorkflow({ status: "complete" })
      );

      await expect(
        workflowService.cancel("wf-1", "user-1")
      ).rejects.toThrow("Cannot cancel workflow with status 'complete'");
    });

    it("should throw ConflictError for failed workflow", async () => {
      mockWorkflowFindByIdAndUser.mockResolvedValue(
        makeWorkflow({ status: "failed" })
      );

      await expect(
        workflowService.cancel("wf-1", "user-1")
      ).rejects.toThrow("Cannot cancel workflow with status 'failed'");
    });

    it("should throw ConflictError for already cancelled workflow", async () => {
      mockWorkflowFindByIdAndUser.mockResolvedValue(
        makeWorkflow({ status: "cancelled" })
      );

      await expect(
        workflowService.cancel("wf-1", "user-1")
      ).rejects.toThrow("Cannot cancel workflow with status 'cancelled'");
    });

    it("should allow cancelling a running workflow", async () => {
      const wf = makeWorkflow({ status: "running" });
      mockWorkflowFindByIdAndUser.mockResolvedValue(wf);
      mockWorkflowUpdateStatus.mockResolvedValue(
        makeWorkflow({ status: "cancelled" })
      );

      const result = await workflowService.cancel("wf-1", "user-1");
      expect(result.status).toBe("cancelled");
    });
  });
});
