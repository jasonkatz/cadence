import { runPlannerAgent as defaultRunPlanner } from "../../engine/planner-agent";
import { runDevAgent as defaultRunDevAgent } from "../../engine/dev-agent";
import { pollCiStatus as defaultPollCiStatus } from "../../engine/ci-poller";
import { runReviewAgent as defaultRunReviewAgent } from "../../engine/review-agent";
import { runE2eAgent as defaultRunE2eAgent } from "../../engine/e2e-agent";
import { runE2eVerifier as defaultRunE2eVerifier } from "../../engine/e2e-verifier";
import { generatePrDescription as defaultGeneratePrDescription } from "../../engine/pr-description";
import { githubService as defaultGithubService } from "../../services/github-service";
import { configService as defaultConfigService } from "../../services/config-service";
import type { PidRegistry } from "../../engine/subprocess-reaper";

export interface StepDeps {
  runPlannerAgent: typeof defaultRunPlanner;
  runDevAgent: typeof defaultRunDevAgent;
  pollCiStatus: typeof defaultPollCiStatus;
  runReviewAgent: typeof defaultRunReviewAgent;
  runE2eAgent: typeof defaultRunE2eAgent;
  runE2eVerifier: typeof defaultRunE2eVerifier;
  generatePrDescription: typeof defaultGeneratePrDescription;
  createPullRequest: typeof defaultGithubService.createPullRequest;
  postPrComment: typeof defaultGithubService.postPrComment;
  getPrDiff: (token: string, repo: string, prNumber: number) => Promise<string>;
  getHeadSha: (token: string, repo: string, branch: string) => Promise<string>;
  getDecryptedToken: () => string;
  /**
   * Shared with the engine so each claude spawn can record its pid and the
   * startup reaper can find orphans across daemon restarts. Optional —
   * absent in unit tests that don't exercise the reaper path.
   */
  pidRegistry?: PidRegistry;
}

/**
 * Deterministic step identifier used both as the PID registry key and the
 * `--tmpo-step-id=` sentinel on spawned subprocesses. Stable across WDK
 * replays because it only depends on workflow inputs.
 */
export function stepIdFor(workflowId: string, iteration: number, type: string): string {
  return `${workflowId}:${iteration}:${type}`;
}

async function defaultGetPrDiff(
  token: string,
  repo: string,
  prNumber: number
): Promise<string> {
  const diffRes = await fetch(
    `https://api.github.com/repos/${repo}/pulls/${prNumber}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3.diff",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );
  if (diffRes.ok) return diffRes.text();

  const filesRes = await fetch(
    `https://api.github.com/repos/${repo}/pulls/${prNumber}/files?per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );
  if (!filesRes.ok) {
    throw new Error(`Failed to fetch PR files (${filesRes.status})`);
  }
  const files = (await filesRes.json()) as Array<{
    filename: string;
    status: string;
    patch?: string;
  }>;
  return files
    .map((f) => `--- a/${f.filename}\n+++ b/${f.filename}\n${f.patch || ""}`)
    .join("\n");
}

async function defaultGetHeadSha(
  token: string,
  repo: string,
  branch: string
): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/git/ref/heads/${branch}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch head SHA (${res.status})`);
  }
  const data = (await res.json()) as { object: { sha: string } };
  return data.object.sha;
}

let activeDeps: StepDeps | null = null;
let activePidRegistry: PidRegistry | null = null;

export function setStepDeps(deps: StepDeps): void {
  activeDeps = deps;
}

/**
 * Called by the engine during startup with the daemon's disk-backed registry.
 * Separate from `setStepDeps` so tests can override a single agent without
 * having to construct a real registry.
 */
export function setStepPidRegistry(registry: PidRegistry): void {
  activePidRegistry = registry;
  if (activeDeps) {
    activeDeps = { ...activeDeps, pidRegistry: registry };
  }
}

export function getStepDeps(): StepDeps {
  if (activeDeps) return activeDeps;
  activeDeps = {
    runPlannerAgent: defaultRunPlanner,
    runDevAgent: defaultRunDevAgent,
    pollCiStatus: defaultPollCiStatus,
    runReviewAgent: defaultRunReviewAgent,
    runE2eAgent: defaultRunE2eAgent,
    runE2eVerifier: defaultRunE2eVerifier,
    generatePrDescription: defaultGeneratePrDescription,
    createPullRequest: defaultGithubService.createPullRequest.bind(defaultGithubService),
    postPrComment: defaultGithubService.postPrComment.bind(defaultGithubService),
    getPrDiff: defaultGetPrDiff,
    getHeadSha: defaultGetHeadSha,
    getDecryptedToken: defaultConfigService.getDecryptedToken.bind(defaultConfigService),
    pidRegistry: activePidRegistry ?? undefined,
  };
  return activeDeps;
}

/**
 * For tests: resets module-level deps so the next getStepDeps() call
 * re-initializes from defaults (or a freshly setStepDeps() call).
 */
export function resetStepDeps(): void {
  activeDeps = null;
  activePidRegistry = null;
}
