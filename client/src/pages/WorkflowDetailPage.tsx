import { useAuth, withAuthenticationRequired } from "../hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "../hooks/useApi";
import { useWorkflowEvents } from "../hooks/useWorkflowEvents";
import { Link, useParams } from "react-router-dom";
import { useCallback } from "react";

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

  const handleEvent = useCallback(
    (_event: { type: string; data: Record<string, unknown> }) => {
      // Invalidate the query to refetch fresh data on any event
      queryClient.invalidateQueries({ queryKey: ["workflow", id] });
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
              <span
                className={`inline-flex px-3 py-1 text-sm font-semibold rounded-full ${STATUS_COLORS[workflow.status] || "bg-gray-100 text-gray-800"}`}
              >
                {workflow.status}
              </span>
            </div>
            {workflow.error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                {workflow.error}
              </div>
            )}
          </div>

          {/* Step Timeline */}
          <div className="bg-white shadow rounded-lg p-6">
            <h3 className="text-md font-medium text-gray-900 mb-4">
              Step Timeline (Iteration {workflow.iteration})
            </h3>
            {workflow.steps.length === 0 ? (
              <p className="text-sm text-gray-500">No steps yet.</p>
            ) : (
              <div className="space-y-3">
                {workflow.steps.map((step) => (
                  <div
                    key={step.id}
                    className="flex items-center justify-between py-2 px-3 rounded bg-gray-50"
                  >
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
                ))}
              </div>
            )}
          </div>

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
