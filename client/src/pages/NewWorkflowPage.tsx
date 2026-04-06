import { useAuth, withAuthenticationRequired } from "../hooks/useAuth";
import { useApi } from "../hooks/useApi";
import { Link, useNavigate } from "react-router-dom";
import { FormEvent, useState } from "react";

interface WorkflowCreateResponse {
  id: string;
}

function NewWorkflowPage() {
  const { user, logout } = useAuth();
  const api = useApi();
  const navigate = useNavigate();

  const [task, setTask] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [requirements, setRequirements] = useState("");
  const [maxIters, setMaxIters] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const body: Record<string, unknown> = { task, repo };
      if (branch) body.branch = branch;
      if (requirements) body.requirements = requirements;
      if (maxIters) body.max_iters = parseInt(maxIters, 10);

      const result = await api.post<WorkflowCreateResponse>(
        "/v1/workflows",
        body
      );
      navigate(`/workflows/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create workflow");
    } finally {
      setSubmitting(false);
    }
  }

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

      <main className="max-w-2xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 sm:px-0">
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-6">
              New Workflow
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="task"
                  className="block text-sm font-medium text-gray-700"
                >
                  Task *
                </label>
                <textarea
                  id="task"
                  required
                  rows={4}
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                  placeholder="Describe the task for the agent to complete..."
                />
              </div>

              <div>
                <label
                  htmlFor="repo"
                  className="block text-sm font-medium text-gray-700"
                >
                  Repository *
                </label>
                <input
                  id="repo"
                  type="text"
                  required
                  pattern="[\w.\-]+/[\w.\-]+"
                  title="Must be in owner/repo format"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                  placeholder="owner/repo"
                />
              </div>

              <div>
                <label
                  htmlFor="branch"
                  className="block text-sm font-medium text-gray-700"
                >
                  Branch
                </label>
                <input
                  id="branch"
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                  placeholder="Optional (default: tmpo/<short-id>)"
                />
              </div>

              <div>
                <label
                  htmlFor="requirements"
                  className="block text-sm font-medium text-gray-700"
                >
                  Requirements
                </label>
                <input
                  id="requirements"
                  type="text"
                  value={requirements}
                  onChange={(e) => setRequirements(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                  placeholder="Path to requirements file in the repo"
                />
              </div>

              <div>
                <label
                  htmlFor="maxIters"
                  className="block text-sm font-medium text-gray-700"
                >
                  Max Iterations
                </label>
                <input
                  id="maxIters"
                  type="number"
                  min="1"
                  value={maxIters}
                  onChange={(e) => setMaxIters(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                  placeholder="8"
                />
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-blue-600 text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {submitting ? "Creating..." : "Create Workflow"}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}

export default withAuthenticationRequired(NewWorkflowPage, {
  onRedirecting: () => (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
    </div>
  ),
});
