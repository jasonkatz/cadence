import { useAuth, withAuthenticationRequired } from "../hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { useApi } from "../hooks/useApi";
import { AgentTheater } from "../components/AgentTheater";
import { AchievementBadges } from "../components/AchievementBadges";
import { usePipelineState, type PipelineState } from "../hooks/usePipelineState";

function DashboardPage() {
  const { user, logout } = useAuth();
  const api = useApi();

  const { data: serverUser, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<{ id: string; email: string; name?: string }>("/auth/me"),
  });

  // Poll for the active workflow id so the theater can connect to its SSE stream.
  const { data: activeWorkflow } = useQuery({
    queryKey: ["workflows", "active"],
    queryFn: () =>
      api
        .get<PipelineState>("/workflows/active")
        .catch(() => null),
    refetchInterval: 5000,
  });

  const { state: pipelineState } = usePipelineState(
    activeWorkflow?.id ?? null,
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <h1 className="text-xl font-semibold text-gray-900">
              🎭 Cadence
            </h1>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">{user?.email}</span>
              <button
                onClick={() =>
                  logout({ logoutParams: { returnTo: window.location.origin } })
                }
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 sm:px-0 space-y-6">
          {/* Live Agent Theater — shows real pipeline state when a run is active */}
          <AgentTheater pipelineState={pipelineState} />

          {/* Achievement Badges */}
          <AchievementBadges earned={[]} />

          {/* User Info */}
          <div className="bg-white shadow rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Account
            </h2>
            {isLoading ? (
              <p className="text-gray-500">Loading...</p>
            ) : serverUser ? (
              <dl className="space-y-2">
                <div>
                  <dt className="text-sm font-medium text-gray-500">ID</dt>
                  <dd className="text-sm text-gray-900">{serverUser.id}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Email</dt>
                  <dd className="text-sm text-gray-900">{serverUser.email}</dd>
                </div>
                {serverUser.name && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Name</dt>
                    <dd className="text-sm text-gray-900">{serverUser.name}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="text-gray-500">No user data</p>
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
      <div
        role="status"
        className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"
      />
    </div>
  ),
});
