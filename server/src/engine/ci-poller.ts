export const CI_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const POLL_INTERVAL_MS = 30_000; // 30 seconds

export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  output: { summary: string | null };
  details_url: string | null;
}

export interface CheckRunsResponse {
  total_count: number;
  check_runs: CheckRun[];
}

export interface ActionJob {
  id: number;
  name: string;
  conclusion: string | null;
}

export interface ActionJobsResponse {
  total_count: number;
  jobs: ActionJob[];
}

export interface CiPollResult {
  status: "passed" | "failed";
  detail: string | null;
}

export interface CiPollerDeps {
  getCheckRuns: (repo: string, ref: string, token: string) => Promise<CheckRunsResponse>;
  getFailedJobLogs: (repo: string, ref: string, token: string, failedCheckNames: string[]) => Promise<string | null>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const GITHUB_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

const LOG_TAIL_LINES = 80;

function tailLines(text: string, n: number): string {
  const lines = text.split("\n");
  return lines.slice(-n).join("\n");
}

async function defaultGetFailedJobLogs(
  repo: string,
  ref: string,
  token: string,
  failedCheckNames: string[]
): Promise<string | null> {
  try {
    // Find the workflow run for this commit
    const runsRes = await fetch(
      `https://api.github.com/repos/${repo}/actions/runs?head_sha=${ref}&per_page=5`,
      { headers: GITHUB_HEADERS(token) }
    );
    if (!runsRes.ok) return null;
    const runsData = await runsRes.json() as { workflow_runs: Array<{ id: number }> };
    if (!runsData.workflow_runs?.length) return null;

    const logParts: string[] = [];
    const nameSet = new Set(failedCheckNames.map((n) => n.toLowerCase()));

    for (const run of runsData.workflow_runs) {
      // List jobs for this run
      const jobsRes = await fetch(
        `https://api.github.com/repos/${repo}/actions/runs/${run.id}/jobs`,
        { headers: GITHUB_HEADERS(token) }
      );
      if (!jobsRes.ok) continue;
      const jobsData = await jobsRes.json() as ActionJobsResponse;

      // Find failed jobs matching the check names
      const failedJobs = jobsData.jobs.filter(
        (j) => j.conclusion === "failure" && nameSet.has(j.name.toLowerCase())
      );

      for (const job of failedJobs) {
        const logRes = await fetch(
          `https://api.github.com/repos/${repo}/actions/jobs/${job.id}/logs`,
          { headers: GITHUB_HEADERS(token), redirect: "follow" }
        );
        if (!logRes.ok) continue;
        const logText = await logRes.text();
        logParts.push(`--- ${job.name} (last ${LOG_TAIL_LINES} lines) ---\n${tailLines(logText, LOG_TAIL_LINES)}`);
      }
    }

    return logParts.length > 0 ? logParts.join("\n\n") : null;
  } catch {
    return null;
  }
}

const defaultDeps: CiPollerDeps = {
  getCheckRuns: async (repo, ref, token) => {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/commits/${ref}/check-runs`,
      { headers: GITHUB_HEADERS(token) }
    );
    if (!res.ok) {
      throw new Error(`GitHub API error fetching check runs (${res.status}): ${await res.text()}`);
    }
    return res.json() as Promise<CheckRunsResponse>;
  },
  getFailedJobLogs: defaultGetFailedJobLogs,
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
    // "success" and "skipped" are both passing; everything else is a failure
    const passingConclusions = new Set(["success", "skipped", "neutral"]);
    const failures = response.check_runs.filter(
      (run) => !passingConclusions.has(run.conclusion ?? "")
    );

    if (failures.length === 0) {
      return { status: "passed", detail: null };
    }

    // Build failure detail
    const failureDetails = failures.map((run) => {
      const summary = run.output.summary ? `: ${run.output.summary}` : "";
      return `${run.name} (${run.conclusion})${summary}`;
    });

    // Fetch actual CI logs for failed jobs
    const failedNames = failures.map((f) => f.name);
    const logs = await deps.getFailedJobLogs(repo, commitSha, token, failedNames);

    let detail = `CI checks failed:\n${failureDetails.join("\n")}`;
    if (logs) {
      detail += `\n\n## CI Logs\n\n${logs}`;
    }

    return { status: "failed", detail };
  }
}
