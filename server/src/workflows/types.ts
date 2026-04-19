import type { Workflow } from "../dao/workflow-dao";

/**
 * The minimal workflow context handed to each step. Mirrors the columns we'd
 * historically read from SQLite inside a step, but carried explicitly so the
 * workflow body stays deterministic and the step is pure w.r.t. input.
 */
export interface WorkflowContext {
  workflowId: string;
  task: string;
  repo: string;
  branch: string;
  requirements: string | null;
  maxIters: number;
}

export function contextFromWorkflow(w: Workflow): WorkflowContext {
  return {
    workflowId: w.id,
    task: w.task,
    repo: w.repo,
    branch: w.branch,
    requirements: w.requirements,
    maxIters: w.max_iters,
  };
}

export type PlanStepInput = WorkflowContext;
export interface PlanStepResult {
  ok: boolean;
  proposal: string | null;
  exitCode: number;
  durationSecs: number;
  response: string;
  logPath: string;
}

export interface DevStepInput extends WorkflowContext {
  iteration: number;
  proposal: string;
}
export interface DevStepResult {
  ok: boolean;
  exitCode: number;
  durationSecs: number;
  response: string;
  logPath: string;
}

export interface CiStepInput extends WorkflowContext {
  iteration: number;
}
export interface CiStepResult {
  ok: boolean;
  detail: string | null;
}

export interface ReviewStepInput extends WorkflowContext {
  iteration: number;
  proposal: string;
  prNumber: number;
}
export interface ReviewStepResult {
  ok: boolean;
  verdict: string;
  response: string;
  exitCode: number;
  durationSecs: number;
  logPath: string;
}

export interface E2eStepInput extends WorkflowContext {
  iteration: number;
  proposal: string;
  prNumber: number;
}
export interface E2eStepResult {
  ok: boolean;
  evidence: string;
  response: string;
  exitCode: number;
  durationSecs: number;
  logPath: string;
}

export interface E2eVerifyStepInput extends WorkflowContext {
  iteration: number;
  proposal: string;
  prNumber: number;
  evidence: string;
}
export interface E2eVerifyStepResult {
  ok: boolean;
  verdict: string;
  response: string;
  exitCode: number;
  durationSecs: number;
  logPath: string;
}

export interface CreatePrStepInput extends WorkflowContext {
  proposal: string;
}
export interface CreatePrStepResult {
  number: number;
  url: string;
}

export type StepType =
  | "plan"
  | "dev"
  | "ci"
  | "review"
  | "e2e"
  | "e2e_verify"
  | "signoff";

export interface WorkflowRunResult {
  status: "complete" | "failed";
  prNumber: number | null;
  error?: string;
  iteration: number;
}
