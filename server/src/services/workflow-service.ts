import { workflowDao as defaultWorkflowDao, Workflow } from "../dao/workflow-dao";
import { stepDao as defaultStepDao, Step } from "../dao/step-dao";
import { runDao as defaultRunDao, Run } from "../dao/run-dao";
import { settingsService as defaultSettingsService } from "./settings-service";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from "../middleware/error-handler";

export interface WorkflowCreateInput {
  task: string;
  repo: string;
  branch?: string;
  requirements?: string;
  max_iters?: number;
}

export interface WorkflowListItem {
  id: string;
  task: string;
  repo: string;
  branch: string;
  status: string;
  iteration: number;
  pr_number: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface WorkflowDetail extends Workflow {
  steps: Step[];
}

export interface WorkflowServiceDeps {
  workflowDao: Pick<typeof defaultWorkflowDao, "create" | "findByIdAndUser" | "list" | "updateStatus">;
  stepDao: Pick<typeof defaultStepDao, "findByWorkflowId" | "findLatestIterationByWorkflowId">;
  runDao: Pick<typeof defaultRunDao, "findByWorkflowId">;
  settingsService: Pick<typeof defaultSettingsService, "hasGithubToken">;
  enqueueWorkflow: (workflowId: string, iteration: number) => Promise<void>;
  cancelWorkflowJobs: (workflowId: string) => Promise<void>;
}

// Engine functions are set at startup via setEngineFunctions() to avoid circular imports
let engineEnqueue: (workflowId: string, iteration: number) => Promise<void> = async () => {
  throw new Error("Engine not initialized");
};
let engineCancel: (workflowId: string) => Promise<void> = async () => {
  throw new Error("Engine not initialized");
};

export function setEngineFunctions(fns: {
  enqueueWorkflow: (workflowId: string, iteration: number) => Promise<void>;
  cancelWorkflowJobs: (workflowId: string) => Promise<void>;
}): void {
  engineEnqueue = fns.enqueueWorkflow;
  engineCancel = fns.cancelWorkflowJobs;
}

const defaultDeps: WorkflowServiceDeps = {
  workflowDao: defaultWorkflowDao,
  stepDao: defaultStepDao,
  runDao: defaultRunDao,
  settingsService: defaultSettingsService,
  enqueueWorkflow: (...args) => engineEnqueue(...args),
  cancelWorkflowJobs: (...args) => engineCancel(...args),
};

const TERMINAL_STATUSES = ["complete", "failed", "cancelled"];

export function createWorkflowService(deps: WorkflowServiceDeps = defaultDeps) {
  return {
    async create(
      userId: string,
      input: WorkflowCreateInput
    ): Promise<Workflow> {
      if (!input.task) {
        throw new ValidationError("task is required");
      }
      if (!input.repo) {
        throw new ValidationError("repo is required");
      }

      const hasToken = await deps.settingsService.hasGithubToken(userId);
      if (!hasToken) {
        throw new ValidationError(
          "GitHub token not configured. Use PUT /v1/settings to set your token."
        );
      }

      const tempId = crypto.randomUUID().split("-")[0];
      const branch = input.branch || `cadence/${tempId}`;

      const workflow = await deps.workflowDao.create({
        task: input.task,
        repo: input.repo,
        branch,
        requirements: input.requirements,
        maxIters: input.max_iters,
        createdBy: userId,
      });

      await deps.enqueueWorkflow(workflow.id, workflow.iteration);

      return workflow;
    },

    async list(
      userId: string,
      params: { status?: string; limit?: number; offset?: number }
    ): Promise<{ workflows: WorkflowListItem[]; total: number }> {
      const { workflows, total } = await deps.workflowDao.list({
        userId,
        status: params.status,
        limit: params.limit,
        offset: params.offset,
      });

      return {
        workflows: workflows.map((w) => ({
          id: w.id,
          task: w.task,
          repo: w.repo,
          branch: w.branch,
          status: w.status,
          iteration: w.iteration,
          pr_number: w.pr_number,
          created_at: w.created_at,
          updated_at: w.updated_at,
        })),
        total,
      };
    },

    async getById(
      workflowId: string,
      userId: string
    ): Promise<WorkflowDetail> {
      const workflow = await deps.workflowDao.findByIdAndUser(workflowId, userId);
      if (!workflow) {
        throw new NotFoundError("Workflow not found");
      }

      const steps = await deps.stepDao.findLatestIterationByWorkflowId(workflowId);

      return { ...workflow, steps };
    },

    async getSteps(
      workflowId: string,
      userId: string,
      filters?: { iteration?: number }
    ): Promise<Step[]> {
      const workflow = await deps.workflowDao.findByIdAndUser(workflowId, userId);
      if (!workflow) {
        throw new NotFoundError("Workflow not found");
      }

      return deps.stepDao.findByWorkflowId(workflowId, filters);
    },

    async getRuns(
      workflowId: string,
      userId: string,
      filters?: { agentRole?: string; iteration?: number }
    ): Promise<Run[]> {
      const workflow = await deps.workflowDao.findByIdAndUser(workflowId, userId);
      if (!workflow) {
        throw new NotFoundError("Workflow not found");
      }

      return deps.runDao.findByWorkflowId(workflowId, filters);
    },

    async cancel(
      workflowId: string,
      userId: string
    ): Promise<Workflow> {
      const workflow = await deps.workflowDao.findByIdAndUser(workflowId, userId);
      if (!workflow) {
        throw new NotFoundError("Workflow not found");
      }

      if (TERMINAL_STATUSES.includes(workflow.status)) {
        throw new ConflictError(
          `Cannot cancel workflow with status '${workflow.status}'`
        );
      }

      await deps.cancelWorkflowJobs(workflowId);
      const updated = await deps.workflowDao.updateStatus(workflowId, "cancelled");
      return updated!;
    },
  };
}

export const workflowService = createWorkflowService();
