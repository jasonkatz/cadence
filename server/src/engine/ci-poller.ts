export const CI_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const POLL_INTERVAL_MS = 30_000; // 30 seconds

export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  output: { summary: string | null };
}

export interface CheckRunsResponse {
  total_count: number;
  check_runs: CheckRun[];
}

export interface CiPollResult {
  status: "passed" | "failed";
  detail: string | null;
}

export interface CiPollerDeps {
  getCheckRuns: (repo: string, ref: string, token: string) => Promise<CheckRunsResponse>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const defaultDeps: CiPollerDeps = {
  getCheckRuns: async (repo, ref, token) => {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/commits/${ref}/check-runs`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );
    if (!res.ok) {
      throw new Error(`GitHub API error fetching check runs (${res.status}): ${await res.text()}`);
    }
    return res.json() as Promise<CheckRunsResponse>;
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

export async function pollCiStatus(
  repo: string,
  commitSha: string,
  token: string,
  deps: CiPollerDeps = defaultDeps
): Promise<CiPollResult> {
  const startTime = deps.now();

  while (true) {
    // Check timeout
    if (deps.now() - startTime >= CI_TIMEOUT_MS) {
      return {
        status: "failed",
        detail: "CI checks timed out: timeout exceeded waiting for checks to complete",
      };
    }

    const response = await deps.getCheckRuns(repo, commitSha, token);

    // No check runs yet — wait and retry
    if (response.total_count === 0) {
      await deps.sleep(POLL_INTERVAL_MS);
      continue;
    }

    // Check if all runs are completed
    const allCompleted = response.check_runs.every(
      (run) => run.status === "completed"
    );

    if (!allCompleted) {
      await deps.sleep(POLL_INTERVAL_MS);
      continue;
    }

    // All completed — check conclusions
    const failures = response.check_runs.filter(
      (run) => run.conclusion !== "success"
    );

    if (failures.length === 0) {
      return { status: "passed", detail: null };
    }

    // Build failure detail
    const failureDetails = failures.map((run) => {
      const summary = run.output.summary ? `: ${run.output.summary}` : "";
      return `${run.name} (${run.conclusion})${summary}`;
    });

    return {
      status: "failed",
      detail: `CI checks failed:\n${failureDetails.join("\n")}`,
    };
  }
}
