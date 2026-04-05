import { useAuth, withAuthenticationRequired } from "../hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { useApi } from "../hooks/useApi";
import { Link, useNavigate } from "react-router-dom";

interface WorkflowListItem {
  id: string;
  task: string;
  repo: string;
  branch: string;
  status: string;
  iteration: number;
  pr_number: number | null;
  created_at: string;
  updated_at: string;
}

interface WorkflowListResponse {
  workflows: WorkflowListItem[];
  total: number;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-100 text-gray-800",
  running: "bg-blue-100 text-blue-800",
  complete: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-yellow-100 text-yellow-800",
};

function formatAge(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  if (diffMins > 0) return `${diffMins}m ago`;
  return "just now";
}

function DashboardPage() {
  const { user, logout } = useAuth();
  const api = useApi();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["workflows"],
    queryFn: () => api.get<WorkflowListResponse>("/v1/workflows"),
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-6">
              <h1 className="text-xl font-semibold">Cadence</h1>
              <Link
                to="/dashboard"
                className="text-sm font-medium text-gray-900"
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
        <div className="px-4 py-6 sm:px-0">
          <div className="bg-white shadow rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium">Workflows</h2>
            </div>
            {isLoading ? (
              <div className="p-6 text-center text-gray-500">Loading...</div>
            ) : !data?.workflows.length ? (
              <div className="p-6 text-center text-gray-500">
                No workflows yet.
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Task
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Repo
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      PR
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Iteration
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {data.workflows.map((w) => (
                    <tr
                      key={w.id}
                      onClick={() => navigate(`/workflows/${w.id}`)}
                      className="hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate">
                        {w.task}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {w.repo}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${STATUS_COLORS[w.status] || "bg-gray-100 text-gray-800"}`}
                        >
                          {w.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {w.pr_number ? (
                          <a
                            href={`https://github.com/${w.repo}/pull/${w.pr_number}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            #{w.pr_number}
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {w.iteration}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {formatAge(w.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default withAuthenticationRequired(DashboardPage, {
  onRedirecting: () => (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
    </div>
  ),
});
