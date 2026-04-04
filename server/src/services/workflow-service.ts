import { workflowDao, Workflow } from "../dao/workflow-dao";
import { stepDao, Step } from "../dao/step-dao";
import { runDao, Run } from "../dao/run-dao";
import { settingsService } from "./settings-service";
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

const TERMINAL_STATUSES = ["complete", "failed", "cancelled"];

export const workflowService = {
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

    const hasToken = await settingsService.hasGithubToken(userId);
    if (!hasToken) {
      throw new ValidationError(
        "GitHub token not configured. Use PUT /v1/settings to set your token."
      );
    }

    const tempId = crypto.randomUUID().split("-")[0];
    const branch = input.branch || `cadence/${tempId}`;

    return workflowDao.create({
      task: input.task,
      repo: input.repo,
      branch,
      requirements: input.requirements,
      maxIters: input.max_iters,
      createdBy: userId,
    });
  },

  async list(
    userId: string,
    params: { status?: string; limit?: number; offset?: number }
  ): Promise<{ workflows: WorkflowListItem[]; total: number }> {
    const { workflows, total } = await workflowDao.list({
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
    const workflow = await workflowDao.findByIdAndUser(workflowId, userId);
    if (!workflow) {
      throw new NotFoundError("Workflow not found");
    }

    const steps = await stepDao.findLatestIterationByWorkflowId(workflowId);

    return { ...workflow, steps };
  },

  async getSteps(
    workflowId: string,
    userId: string,
    filters?: { iteration?: number }
  ): Promise<Step[]> {
    const workflow = await workflowDao.findByIdAndUser(workflowId, userId);
    if (!workflow) {
      throw new NotFoundError("Workflow not found");
    }

    return stepDao.findByWorkflowId(workflowId, filters);
  },

  async getRuns(
    workflowId: string,
    userId: string,
    filters?: { agentRole?: string; iteration?: number }
  ): Promise<Run[]> {
    const workflow = await workflowDao.findByIdAndUser(workflowId, userId);
    if (!workflow) {
      throw new NotFoundError("Workflow not found");
    }

    return runDao.findByWorkflowId(workflowId, filters);
  },

  async cancel(
    workflowId: string,
    userId: string
  ): Promise<Workflow> {
    const workflow = await workflowDao.findByIdAndUser(workflowId, userId);
    if (!workflow) {
      throw new NotFoundError("Workflow not found");
    }

    if (TERMINAL_STATUSES.includes(workflow.status)) {
      throw new ConflictError(
        `Cannot cancel workflow with status '${workflow.status}'`
      );
    }

    const updated = await workflowDao.updateStatus(workflowId, "cancelled");
    return updated!;
  },
};
