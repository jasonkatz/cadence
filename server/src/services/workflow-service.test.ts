import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { Workflow } from "../dao/workflow-dao";
import { createWorkflowService, WorkflowServiceDeps } from "./workflow-service";

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

function makeDeps() {
  const mockWorkflowCreate = mock((_data: unknown) => Promise.resolve(makeWorkflow()));
  const mockFindByIdAndUser = mock((_id: string, _userId: string) =>
    Promise.resolve(null as Workflow | null)
  );
  const mockList = mock((_params: unknown) =>
    Promise.resolve({ workflows: [] as Workflow[], total: 0 })
  );
  const mockUpdateStatus = mock((_id: string, _status: string) =>
    Promise.resolve(null as Workflow | null)
  );

  const mockStepFindByWorkflowId = mock((_wfId: string, _filters?: unknown) =>
    Promise.resolve([])
  );
  const mockStepFindLatest = mock((_wfId: string) => Promise.resolve([]));

  const mockRunFindByWorkflowId = mock((_wfId: string, _filters?: unknown) =>
    Promise.resolve([])
  );

  const mockHasGithubToken = mock((_userId: string) => Promise.resolve(true));

  const deps: WorkflowServiceDeps = {
    workflowDao: {
      create: mockWorkflowCreate,
      findByIdAndUser: mockFindByIdAndUser,
      list: mockList,
      updateStatus: mockUpdateStatus,
    } as WorkflowServiceDeps["workflowDao"],
    stepDao: {
      findByWorkflowId: mockStepFindByWorkflowId,
      findLatestIterationByWorkflowId: mockStepFindLatest,
    } as WorkflowServiceDeps["stepDao"],
    runDao: {
      findByWorkflowId: mockRunFindByWorkflowId,
    } as WorkflowServiceDeps["runDao"],
    settingsService: {
      hasGithubToken: mockHasGithubToken,
    },
  };

  return {
    deps,
    mocks: {
      workflowCreate: mockWorkflowCreate,
      findByIdAndUser: mockFindByIdAndUser,
      list: mockList,
      updateStatus: mockUpdateStatus,
      stepFindByWorkflowId: mockStepFindByWorkflowId,
      stepFindLatest: mockStepFindLatest,
      runFindByWorkflowId: mockRunFindByWorkflowId,
      hasGithubToken: mockHasGithubToken,
    },
  };
}

describe("workflowService", () => {
  let service: ReturnType<typeof createWorkflowService>;
  let mocks: ReturnType<typeof makeDeps>["mocks"];

  beforeEach(() => {
    const d = makeDeps();
    service = createWorkflowService(d.deps);
    mocks = d.mocks;
  });

  describe("create", () => {
    it("should create a workflow with defaults", async () => {
      const wf = makeWorkflow();
      mocks.workflowCreate.mockResolvedValue(wf);

      const result = await service.create("user-1", {
        task: "add login page",
        repo: "acme/webapp",
      });

      expect(result.id).toBe("wf-1");
      expect(result.status).toBe("pending");
      expect(mocks.workflowCreate).toHaveBeenCalledTimes(1);
    });

    it("should throw ValidationError when task is missing", async () => {
      await expect(
        service.create("user-1", { task: "", repo: "acme/webapp" })
      ).rejects.toThrow("task is required");
    });

    it("should throw ValidationError when repo is missing", async () => {
      await expect(
        service.create("user-1", { task: "do something", repo: "" })
      ).rejects.toThrow("repo is required");
    });

    it("should throw ValidationError when no GitHub token configured", async () => {
      mocks.hasGithubToken.mockResolvedValue(false);

      await expect(
        service.create("user-1", {
          task: "add login",
          repo: "acme/webapp",
        })
      ).rejects.toThrow("GitHub token not configured");
    });

    it("should use provided branch when given", async () => {
      const wf = makeWorkflow({ branch: "my-branch" });
      mocks.workflowCreate.mockResolvedValue(wf);

      await service.create("user-1", {
        task: "add login",
        repo: "acme/webapp",
        branch: "my-branch",
      });

      const createArg = mocks.workflowCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(createArg.branch).toBe("my-branch");
    });

    it("should auto-generate branch when not provided", async () => {
      mocks.workflowCreate.mockResolvedValue(makeWorkflow());

      await service.create("user-1", {
        task: "add login",
        repo: "acme/webapp",
      });

      const createArg = mocks.workflowCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(createArg.branch).toMatch(/^cadence\//);
    });
  });

  describe("list", () => {
    it("should return workflows for user", async () => {
      const wf = makeWorkflow();
      mocks.list.mockResolvedValue({ workflows: [wf], total: 1 });

      const result = await service.list("user-1", {});

      expect(result.total).toBe(1);
      expect(result.workflows).toHaveLength(1);
      expect(result.workflows[0].id).toBe("wf-1");
    });

    it("should pass status filter to DAO", async () => {
      mocks.list.mockResolvedValue({ workflows: [], total: 0 });

      await service.list("user-1", { status: "pending" });

      const listArg = mocks.list.mock.calls[0][0] as Record<string, unknown>;
      expect(listArg.status).toBe("pending");
    });
  });

  describe("getById", () => {
    it("should return workflow with steps", async () => {
      const wf = makeWorkflow();
      mocks.findByIdAndUser.mockResolvedValue(wf);
      mocks.stepFindLatest.mockResolvedValue([]);

      const result = await service.getById("wf-1", "user-1");

      expect(result.id).toBe("wf-1");
      expect(result.steps).toEqual([]);
    });

    it("should throw NotFoundError for missing workflow", async () => {
      mocks.findByIdAndUser.mockResolvedValue(null);

      await expect(
        service.getById("nonexistent", "user-1")
      ).rejects.toThrow("Workflow not found");
    });
  });

  describe("getSteps", () => {
    it("should throw NotFoundError for missing workflow", async () => {
      mocks.findByIdAndUser.mockResolvedValue(null);

      await expect(
        service.getSteps("nonexistent", "user-1")
      ).rejects.toThrow("Workflow not found");
    });

    it("should return steps for valid workflow", async () => {
      mocks.findByIdAndUser.mockResolvedValue(makeWorkflow());
      mocks.stepFindByWorkflowId.mockResolvedValue([]);

      const result = await service.getSteps("wf-1", "user-1");
      expect(result).toEqual([]);
    });
  });

  describe("getRuns", () => {
    it("should throw NotFoundError for missing workflow", async () => {
      mocks.findByIdAndUser.mockResolvedValue(null);

      await expect(
        service.getRuns("nonexistent", "user-1")
      ).rejects.toThrow("Workflow not found");
    });

    it("should return runs for valid workflow", async () => {
      mocks.findByIdAndUser.mockResolvedValue(makeWorkflow());
      mocks.runFindByWorkflowId.mockResolvedValue([]);

      const result = await service.getRuns("wf-1", "user-1");
      expect(result).toEqual([]);
    });
  });

  describe("cancel", () => {
    it("should cancel a pending workflow", async () => {
      const wf = makeWorkflow({ status: "pending" });
      mocks.findByIdAndUser.mockResolvedValue(wf);
      mocks.updateStatus.mockResolvedValue(
        makeWorkflow({ status: "cancelled" })
      );

      const result = await service.cancel("wf-1", "user-1");
      expect(result.status).toBe("cancelled");
    });

    it("should throw NotFoundError for missing workflow", async () => {
      mocks.findByIdAndUser.mockResolvedValue(null);

      await expect(
        service.cancel("nonexistent", "user-1")
      ).rejects.toThrow("Workflow not found");
    });

    it("should throw ConflictError for completed workflow", async () => {
      mocks.findByIdAndUser.mockResolvedValue(
        makeWorkflow({ status: "complete" })
      );

      await expect(
        service.cancel("wf-1", "user-1")
      ).rejects.toThrow("Cannot cancel workflow with status 'complete'");
    });

    it("should throw ConflictError for failed workflow", async () => {
      mocks.findByIdAndUser.mockResolvedValue(
        makeWorkflow({ status: "failed" })
      );

      await expect(
        service.cancel("wf-1", "user-1")
      ).rejects.toThrow("Cannot cancel workflow with status 'failed'");
    });

    it("should throw ConflictError for already cancelled workflow", async () => {
      mocks.findByIdAndUser.mockResolvedValue(
        makeWorkflow({ status: "cancelled" })
      );

      await expect(
        service.cancel("wf-1", "user-1")
      ).rejects.toThrow("Cannot cancel workflow with status 'cancelled'");
    });

    it("should allow cancelling a running workflow", async () => {
      const wf = makeWorkflow({ status: "running" });
      mocks.findByIdAndUser.mockResolvedValue(wf);
      mocks.updateStatus.mockResolvedValue(
        makeWorkflow({ status: "cancelled" })
      );

      const result = await service.cancel("wf-1", "user-1");
      expect(result.status).toBe("cancelled");
    });
  });
});
