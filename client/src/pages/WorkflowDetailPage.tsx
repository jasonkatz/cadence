import { useAuth, withAuthenticationRequired } from "../hooks/useAuth";
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

function ExpandableDetail({ detail }: { detail: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-1">
      <button
        onClick={() => setExpanded(!expanded)}
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

function StepRow({ step }: { step: Step }) {
  return (
    <div className="py-2 px-3 rounded bg-gray-50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
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

function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, logout } = useAuth();
  const api = useApi();
  const queryClient = useQueryClient();

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
              <h1 className="text-xl font-semibold">Cadence</h1>
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
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">{user?.email}</span>
              <button
                onClick={() =>
                  logout({
                    logoutParams: { returnTo: window.location.origin },
                  })
                }
                className="text-sm text-gray-600 hover:text-gray-900 cursor-pointer"
              >
                Sign Out
              </button>
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
                    <StepRow key={step.id} step={step} />
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

export default withAuthenticationRequired(WorkflowDetailPage, {
  onRedirecting: () => (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
    </div>
  ),
});
