import { describe, it, expect, afterEach, mock } from "bun:test";
import { planStep } from "./plan";
import { devStep } from "./dev";
import { reviewStep } from "./review";
import { e2eStep } from "./e2e";
import { e2eVerifyStep } from "./e2e-verify";
import { setStepDeps, resetStepDeps, stepIdFor, type StepDeps } from "./deps";
import type { PidRegistry, PidRecord } from "../../engine/subprocess-reaper";
import { rmSync, existsSync } from "fs";
import path from "path";
import os from "os";

function inMemoryRegistry(): PidRegistry {
  const records = new Map<string, PidRecord>();
  return {
    record(stepId, pid) {
      records.set(stepId, { stepId, pid, startedAt: "t" });
    },
    clear(stepId) {
      records.delete(stepId);
    },
    list() {
      return Array.from(records.values());
    },
  };
}

function makeDeps(overrides?: Partial<StepDeps>): StepDeps {
  return {
    runPlannerAgent: mock(async () => ({
      proposal: "## plan",
      exitCode: 0,
      durationSecs: 1,
      response: "ok",
    })),
    runDevAgent: mock(async () => ({
      exitCode: 0,
      durationSecs: 1,
      response: "ok",
    })),
    pollCiStatus: mock(async () => ({ status: "passed" as const, detail: null })),
    runReviewAgent: mock(async () => ({
      reviewPass: true,
      verdict: "LGTM",
      exitCode: 0,
      durationSecs: 1,
      response: "ok",
    })),
    runE2eAgent: mock(async () => ({
      e2ePass: true,
      evidence: "ev",
      exitCode: 0,
      durationSecs: 1,
      response: "ok",
    })),
    runE2eVerifier: mock(async () => ({
      e2ePass: true,
      verdict: "verified",
      exitCode: 0,
      durationSecs: 1,
      response: "ok",
    })),
    generatePrDescription: mock(async () => ({ title: "t", body: "b" })),
    createPullRequest: mock(async () => ({ number: 1, url: "u" })),
    postPrComment: mock(async () => ({} as never)),
    getPrDiff: mock(async () => "diff"),
    getHeadSha: mock(async () => "abc"),
    getDecryptedToken: mock(() => "ghp_test"),
    pidRegistry: inMemoryRegistry(),
    ...overrides,
  };
}

const TEST_WF_ID = `steps-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const TEST_DIR = path.join(os.homedir(), ".tmpo", "runs", TEST_WF_ID);

afterEach(() => {
  resetStepDeps();
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

describe("stepIdFor", () => {
  it("is deterministic across calls with the same inputs", () => {
    const a = stepIdFor("wf-1", 2, "dev");
    const b = stepIdFor("wf-1", 2, "dev");
    expect(a).toBe(b);
  });

  it("differs by iteration, type, and workflow", () => {
    const base = stepIdFor("wf-1", 0, "dev");
    expect(base).not.toBe(stepIdFor("wf-1", 1, "dev"));
    expect(base).not.toBe(stepIdFor("wf-1", 0, "review"));
    expect(base).not.toBe(stepIdFor("wf-2", 0, "dev"));
  });
});

describe("planStep", () => {
  it("threads stepId and pidRegistry to the planner agent", async () => {
    const deps = makeDeps();
    setStepDeps(deps);

    await planStep({
      workflowId: TEST_WF_ID,
      task: "t",
      repo: "r",
      branch: "b",
      requirements: null,
      maxIters: 8,
    });

    const call = (deps.runPlannerAgent as ReturnType<typeof mock>).mock.calls[0];
    const reaper = call[3] as { stepId?: string; pidRegistry?: PidRegistry };
    expect(reaper.stepId).toBe(stepIdFor(TEST_WF_ID, 0, "plan"));
    expect(reaper.pidRegistry).toBe(deps.pidRegistry);
  });
});

describe("devStep", () => {
  it("threads iteration-scoped stepId to the dev agent", async () => {
    const deps = makeDeps();
    setStepDeps(deps);

    await devStep({
      workflowId: TEST_WF_ID,
      task: "t",
      repo: "r",
      branch: "b",
      requirements: null,
      maxIters: 8,
      iteration: 2,
      proposal: "p",
    });

    const call = (deps.runDevAgent as ReturnType<typeof mock>).mock.calls[0];
    const reaper = call[3] as { stepId?: string; pidRegistry?: PidRegistry };
    expect(reaper.stepId).toBe(stepIdFor(TEST_WF_ID, 2, "dev"));
    expect(reaper.pidRegistry).toBe(deps.pidRegistry);
  });
});

describe("reviewStep", () => {
  it("threads stepId to the review agent", async () => {
    const deps = makeDeps();
    setStepDeps(deps);

    await reviewStep({
      workflowId: TEST_WF_ID,
      task: "t",
      repo: "r",
      branch: "b",
      requirements: null,
      maxIters: 8,
      iteration: 1,
      proposal: "p",
      prNumber: 42,
    });

    const call = (deps.runReviewAgent as ReturnType<typeof mock>).mock.calls[0];
    const reaper = call[4] as { stepId?: string };
    expect(reaper.stepId).toBe(stepIdFor(TEST_WF_ID, 1, "review"));
  });
});

describe("e2eStep", () => {
  it("threads stepId to the e2e agent", async () => {
    const deps = makeDeps();
    setStepDeps(deps);

    await e2eStep({
      workflowId: TEST_WF_ID,
      task: "t",
      repo: "r",
      branch: "b",
      requirements: null,
      maxIters: 8,
      iteration: 3,
      proposal: "p",
      prNumber: 42,
    });

    const call = (deps.runE2eAgent as ReturnType<typeof mock>).mock.calls[0];
    const reaper = call[3] as { stepId?: string };
    expect(reaper.stepId).toBe(stepIdFor(TEST_WF_ID, 3, "e2e"));
  });
});

describe("e2eVerifyStep", () => {
  it("threads stepId to the e2e verifier", async () => {
    const deps = makeDeps();
    setStepDeps(deps);

    await e2eVerifyStep({
      workflowId: TEST_WF_ID,
      task: "t",
      repo: "r",
      branch: "b",
      requirements: null,
      maxIters: 8,
      iteration: 0,
      proposal: "p",
      prNumber: 42,
      evidence: "ev",
    });

    const call = (deps.runE2eVerifier as ReturnType<typeof mock>).mock.calls[0];
    const reaper = call[4] as { stepId?: string };
    expect(reaper.stepId).toBe(stepIdFor(TEST_WF_ID, 0, "e2e_verify"));
  });
});
