import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "../hooks/useApi";
import { useWorkflowEvents } from "../hooks/useWorkflowEvents";
import { Link, useParams } from "react-router-dom";
import { useCallback, useState } from "react";

interface Step {
  id: string;
  workflow_id: string;
  iteration: number;
  type: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  detail: string | null;
}

interface Run {
  id: string;
  step_id: string;
  workflow_id: string;
  agent_role: string;
  iteration: number;
  prompt: string;
  response: string | null;
  exit_code: number | null;
  duration_secs: number | null;
  created_at: string;
}

interface WorkflowDetail {
  id: string;
  task: string;
  repo: string;
  branch: string;
  requirements: string | null;
  proposal: string | null;
  pr_number: number | null;
  status: string;
  iteration: number;
  max_iters: number;
  error: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  steps: Step[];
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-100 text-gray-800",
  running: "bg-blue-100 text-blue-800",
  passed: "bg-green-100 text-green-800",
  complete: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-yellow-100 text-yellow-800",
};

const STEP_LABELS: Record<string, string> = {
  plan: "Plan",
  dev: "Development",
  ci: "CI",
  review: "Review",
  e2e: "E2E Tests",
  e2e_verify: "E2E Verify",
  signoff: "Sign-off",
};

const STEP_TYPE_TO_AGENT_ROLE: Record<string, string> = {
  plan: "planner",
  dev: "dev",
  review: "reviewer",
  e2e: "e2e",
  e2e_verify: "e2e_verifier",
};

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "-";
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date();
  const diffSecs = Math.round(
    (endDate.getTime() - startDate.getTime()) / 1000
  );
  if (diffSecs < 60) return `${diffSecs}s`;
  const mins = Math.floor(diffSecs / 60);
  const secs = diffSecs % 60;
  return `${mins}m ${secs}s`;
}

function formatRunDuration(secs: number | null): string {
  if (secs == null) return "-";
  if (secs < 60) return `${Math.round(secs)}s`;
  const mins = Math.floor(secs / 60);
  const rem = Math.round(secs % 60);
  return `${mins}m ${rem}s`;
}

function ExpandableDetail({ detail }: { detail: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-1">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(!expanded);
        }}
        className="text-xs text-red-600 hover:text-red-800 cursor-pointer"
      >
        {expanded ? "Hide detail" : "Show detail"}
      </button>
      {expanded && (
        <pre className="mt-1 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 whitespace-pre-wrap overflow-x-auto max-h-48 overflow-y-auto">
          {detail}
        </pre>
      )}
    </div>
  );
}

function RunLogs({
  workflowId,
  step,
}: {
  workflowId: string;
  step: Step;
}) {
  const api = useApi();
  const agentRole = STEP_TYPE_TO_AGENT_ROLE[step.type];

  const { data: runs, isLoading } = useQuery({
    queryKey: ["runs", workflowId, step.type, step.iteration],
    queryFn: () => {
      let path = `/v1/workflows/${workflowId}/runs?iteration=${step.iteration}`;
      if (agentRole) path += `&agent_role=${agentRole}`;
      return api.get<Run[]>(path);
    },
  });

  if (isLoading) {
    return (
      <div className="py-2 px-3 text-sm text-gray-500">Loading runs...</div>
    );
  }

  if (!runs || runs.length === 0) {
    return (
      <div className="py-2 px-3 text-sm text-gray-500">
        No runs recorded for this step.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {runs.map((run) => (
        <div
          key={run.id}
          className="border border-gray-200 rounded p-3 bg-white"
        >
          <div className="flex items-center gap-4 text-xs text-gray-500 mb-2">
            <span className="font-medium text-gray-700">{run.agent_role}</span>
            <span>Iteration {run.iteration}</span>
            <span>
              Exit: {run.exit_code != null ? run.exit_code : "-"}
            </span>
            <span>Duration: {formatRunDuration(run.duration_secs)}</span>
          </div>
          <div className="space-y-2">
            <div>
              <div className="text-xs font-medium text-gray-500 mb-1">
                Prompt
              </div>
              <pre className="text-xs text-gray-800 bg-gray-50 border border-gray-200 rounded p-2 whitespace-pre-wrap max-h-96 overflow-y-auto">
                {run.prompt}
              </pre>
            </div>
            {run.response && (
              <div>
                <div className="text-xs font-medium text-gray-500 mb-1">
                  Response
                </div>
                <pre className="text-xs text-gray-800 bg-gray-50 border border-gray-200 rounded p-2 whitespace-pre-wrap max-h-96 overflow-y-auto">
                  {run.response}
                </pre>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function StepRow({
  step,
  isExpanded,
  onToggle,
  workflowId,
}: {
  step: Step;
  isExpanded: boolean;
  onToggle: () => void;
  workflowId: string;
}) {
  return (
    <div>
      <div
        className="py-2 px-3 rounded bg-gray-50 cursor-pointer hover:bg-gray-100"
        onClick={onToggle}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">
              {isExpanded ? "\u25BC" : "\u25B6"}
            </span>
            <span
              className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[step.status] || "bg-gray-100 text-gray-800"}`}
            >
              {step.status}
            </span>
            <span className="text-sm font-medium text-gray-900">
              {STEP_LABELS[step.type] || step.type}
            </span>
          </div>
          <div className="text-sm text-gray-500">
            {formatDuration(step.started_at, step.finished_at)}
          </div>
        </div>
        {step.status === "failed" && step.detail && (
          <ExpandableDetail detail={step.detail} />
        )}
      </div>
      {isExpanded && (
        <div className="mt-2 ml-6 mb-2">
          <RunLogs workflowId={workflowId} step={step} />
        </div>
      )}
    </div>
  );
}

function groupStepsByIteration(steps: Step[]): Map<number, Step[]> {
  const groups = new Map<number, Step[]>();
  for (const step of steps) {
    const group = groups.get(step.iteration) || [];
    group.push(step);
    groups.set(step.iteration, group);
  }
  return groups;
}

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const api = useApi();
  const queryClient = useQueryClient();
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);

  const { data: workflow, isLoading } = useQuery({
    queryKey: ["workflow", id],
    queryFn: () => api.get<WorkflowDetail>(`/v1/workflows/${id}`),
    enabled: !!id,
  });

  // Fetch all steps (all iterations) for multi-iteration display
  const { data: allSteps } = useQuery({
    queryKey: ["workflow-steps", id],
    queryFn: () => api.get<Step[]>(`/v1/workflows/${id}/steps`),
    enabled: !!id && (workflow?.iteration ?? 0) > 0,
  });

  const handleEvent = useCallback(
    (_event: { type: string; data: Record<string, unknown> }) => {
      queryClient.invalidateQueries({ queryKey: ["workflow", id] });
      queryClient.invalidateQueries({ queryKey: ["workflow-steps", id] });
    },
    [queryClient, id]
  );

  // Connect SSE for real-time updates (only for non-terminal workflows)
  const isTerminal = ["complete", "failed", "cancelled"].includes(
    workflow?.status || ""
  );
  useWorkflowEvents(isTerminal ? undefined : id, handleEvent);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Workflow not found</div>
      </div>
    );
  }

  // Use allSteps when available (multi-iteration), otherwise fall back to workflow.steps
  const stepsToDisplay = allSteps && allSteps.length > 0 ? allSteps : workflow.steps;
  const iterationGroups = groupStepsByIteration(stepsToDisplay);
  const sortedIterations = Array.from(iterationGroups.keys()).sort((a, b) => a - b);

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-6">
              <h1 className="text-xl font-semibold">Tmpo</h1>
              <Link
                to="/dashboard"
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                Dashboard
              </Link>
              <Link
                to="/settings"
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                Settings
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 sm:px-0 space-y-6">
          {/* Header */}
          <div className="bg-white shadow rounded-lg p-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-medium text-gray-900">
                  {workflow.task}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  {workflow.repo} &middot; {workflow.branch}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {workflow.iteration > 0 && (
                  <span className="text-sm text-gray-500">
                    Iteration {workflow.iteration} / {workflow.max_iters}
                  </span>
                )}
                <span
                  className={`inline-flex px-3 py-1 text-sm font-semibold rounded-full ${STATUS_COLORS[workflow.status] || "bg-gray-100 text-gray-800"}`}
                >
                  {workflow.status}
                </span>
              </div>
            </div>
            {workflow.status === "complete" && workflow.pr_number && (
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2 text-green-800 font-medium">
                  <span className="text-lg">&#10003;</span>
                  <span>All stages passed — PR ready for review</span>
                </div>
                <a
                  href={`https://github.com/${workflow.repo}/pull/${workflow.pr_number}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-green-700 hover:text-green-900 font-medium underline"
                >
                  {workflow.repo}#{workflow.pr_number}
                </a>
              </div>
            )}
            {workflow.status !== "complete" && workflow.pr_number && (
              <div className="mt-4 flex items-center gap-2">
                <span className="text-sm text-gray-500">Pull Request:</span>
                <a
                  href={`https://github.com/${workflow.repo}/pull/${workflow.pr_number}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                >
                  #{workflow.pr_number}
                </a>
              </div>
            )}
            {workflow.error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                {workflow.error}
              </div>
            )}
          </div>

          {/* Step Timeline — grouped by iteration */}
          {sortedIterations.map((iteration) => {
            const iterSteps = iterationGroups.get(iteration) || [];
            return (
              <div key={iteration} className="bg-white shadow rounded-lg p-6">
                <h3 className="text-md font-medium text-gray-900 mb-4">
                  {sortedIterations.length > 1
                    ? `Iteration ${iteration}`
                    : `Step Timeline (Iteration ${iteration})`}
                </h3>
                <div className="space-y-3">
                  {iterSteps.map((step) => (
                    <StepRow
                      key={step.id}
                      step={step}
                      workflowId={workflow.id}
                      isExpanded={expandedStepId === step.id}
                      onToggle={() =>
                        setExpandedStepId(
                          expandedStepId === step.id ? null : step.id
                        )
                      }
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {stepsToDisplay.length === 0 && (
            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-md font-medium text-gray-900 mb-4">
                Step Timeline
              </h3>
              <p className="text-sm text-gray-500">No steps yet.</p>
            </div>
          )}

          {/* Proposal */}
          {workflow.proposal && (
            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-md font-medium text-gray-900 mb-4">
                Proposal
              </h3>
              <div className="prose prose-sm max-w-none">
                <pre className="whitespace-pre-wrap text-sm text-gray-800 bg-gray-50 p-4 rounded">
                  {workflow.proposal}
                </pre>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
