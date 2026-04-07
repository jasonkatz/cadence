import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "../hooks/useApi";
import { Link } from "react-router-dom";
import { useState } from "react";

interface Settings {
  github_token: string | null;
}

export default function SettingsPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [tokenValue, setTokenValue] = useState("");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<Settings>("/v1/settings"),
  });

  const mutation = useMutation({
    mutationFn: (token: string) =>
      api.put<Settings>("/v1/settings", { github_token: token }),
    onSuccess: (data) => {
      queryClient.setQueryData(["settings"], data);
      setTokenValue("");
      setFeedback({ type: "success", message: "GitHub token saved." });
      setTimeout(() => setFeedback(null), 3000);
    },
    onError: (err: Error) => {
      setFeedback({ type: "error", message: err.message });
      setTimeout(() => setFeedback(null), 5000);
    },
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenValue.trim()) return;
    mutation.mutate(tokenValue.trim());
  };

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
                className="text-sm font-medium text-gray-900"
              >
                Settings
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-medium mb-4">GitHub Personal Access Token</h2>

            {isLoading ? (
              <p className="text-gray-500">Loading...</p>
            ) : (
              <>
                {settings?.github_token && (
                  <p className="text-sm text-gray-600 mb-4">
                    Current token: <code className="bg-gray-100 px-1 py-0.5 rounded">{settings.github_token}</code>
                  </p>
                )}

                <form onSubmit={handleSave} className="space-y-4">
                  <div>
                    <label
                      htmlFor="github-token"
                      className="block text-sm font-medium text-gray-700"
                    >
                      {settings?.github_token ? "Update token" : "Set token"}
                    </label>
                    <input
                      id="github-token"
                      type="password"
                      value={tokenValue}
                      onChange={(e) => setTokenValue(e.target.value)}
                      placeholder="ghp_..."
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={mutation.isPending || !tokenValue.trim()}
                    className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {mutation.isPending ? "Saving..." : "Save"}
                  </button>
                </form>

                {feedback && (
                  <div
                    className={`mt-4 p-3 rounded-md text-sm ${
                      feedback.type === "success"
                        ? "bg-green-50 text-green-800"
                        : "bg-red-50 text-red-800"
                    }`}
                  >
                    {feedback.message}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
