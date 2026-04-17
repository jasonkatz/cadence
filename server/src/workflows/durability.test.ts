import { describe, it, expect, mock } from "bun:test";
import {
  orchestrate,
  type OrchestratorSteps,
  type OrchestratorHooks,
} from "./orchestrator";
import type {
  WorkflowContext,
  PlanStepResult,
  DevStepResult,
  CiStepResult,
  ReviewStepResult,
  E2eStepResult,
  E2eVerifyStepResult,
  CreatePrStepResult,
} from "./types";

/**
 * These tests cover AC6 from the durable-workflows proposal:
 *   - crash-and-resume of an in-progress step
 *   - no-replay of completed steps across a daemon restart
 *
 * Rather than drive the real WDK runtime (which would require loading the
 * beta SDK and a Local World on disk), we simulate WDK's deterministic
 * replay contract with a small memoizing wrapper: on replay, a step that
 * previously returned a value returns the cached value; a step that
 * previously threw is retried. That is exactly the contract WDK's event
 * log provides, and it's the contract `orchestrator.ts` must be compatible
 * with for the real backend to work.
 */

function ctx(): WorkflowContext {
  return {
    workflowId: "wf-resume",
    task: "do the thing",
    repo: "owner/repo",
    branch: "main",
    requirements: null,
    maxIters: 3,
  };
}

function noopHooks(): OrchestratorHooks {
  return {
    onStepStart() {},
    onStepEnd() {},
    onProposal() {},
    onPrCreated() {},
    onIteration() {},
    onComplete() {},
    onFail() {},
  };
}

/**
 * Minimal WDK-like event log: each wrapped step call is keyed by (name,
 * callIndex). Only SUCCESSFUL completions are cached; failed steps are
 * re-executed on replay. This matches WDK's semantics — the event log
 * records step returns and errors, but replay re-runs any step that
 * didn't reach a terminal success event.
 */
interface StepLog {
  key: string;
  value: unknown;
}

function memoize<TArgs extends unknown[], TResult>(
  name: string,
  log: StepLog[],
  counter: { [k: string]: number },
  fn: (...args: TArgs) => Promise<TResult>
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs) => {
    const index = counter[name] ?? 0;
    counter[name] = index + 1;
    const key = `${name}:${index}`;
    const cached = log.find((e) => e.key === key);
    if (cached) return cached.value as TResult;
    const value = await fn(...args);
    log.push({ key, value });
    return value;
  };
}

function wrapSteps(
  impls: OrchestratorSteps,
  log: StepLog[]
): OrchestratorSteps {
  const counter: { [k: string]: number } = {};
  return {
    plan: memoize("plan", log, counter, impls.plan),
    dev: memoize("dev", log, counter, impls.dev),
    createPr: memoize("createPr", log, counter, impls.createPr),
    postComment: memoize("postComment", log, counter, impls.postComment),
    ci: memoize("ci", log, counter, impls.ci),
    review: memoize("review", log, counter, impls.review),
    e2e: memoize("e2e", log, counter, impls.e2e),
    e2eVerify: memoize("e2eVerify", log, counter, impls.e2eVerify),
  };
}

function plan(): PlanStepResult {
  return {
    ok: true,
    proposal: "## Proposal",
    exitCode: 0,
    durationSecs: 1,
    response: "ok",
    logPath: "/tmp/plan.jsonl",
  };
}
function devOk(): DevStepResult {
  return {
    ok: true,
    exitCode: 0,
    durationSecs: 1,
    response: "ok",
    logPath: "/tmp/dev.jsonl",
  };
}
function ci(): CiStepResult {
  return { ok: true, detail: null };
}
function review(): ReviewStepResult {
  return {
    ok: true,
    verdict: "LGTM",
    response: "looks good",
    exitCode: 0,
    durationSecs: 1,
    logPath: "/tmp/review.jsonl",
  };
}
function e2e(): E2eStepResult {
  return {
    ok: true,
    evidence: "evidence",
    response: "complete",
    exitCode: 0,
    durationSecs: 1,
    logPath: "/tmp/e2e.jsonl",
  };
}
function e2eVerify(): E2eVerifyStepResult {
  return {
    ok: true,
    verdict: "verified",
    response: "ok",
    exitCode: 0,
    durationSecs: 1,
    logPath: "/tmp/e2ev.jsonl",
  };
}
function pr(): CreatePrStepResult {
  return { number: 42, url: "https://github.com/owner/repo/pull/42" };
}

describe("durability: crash-and-resume (AC6)", () => {
  it("resumes an in-progress step that threw during a crash", async () => {
    const log: StepLog[] = [];

    // First run: dev throws once (simulating a crash mid-step). Subsequent
    // invocations return success.
    let devCalls = 0;
    const devImpl = mock(async () => {
      devCalls++;
      if (devCalls === 1) throw new Error("daemon killed mid-dev");
      return devOk();
    });

    const firstSteps = wrapSteps(
      {
        plan: mock(async () => plan()),
        dev: devImpl,
        createPr: mock(async () => pr()),
        postComment: mock(async () => undefined),
        ci: mock(async () => ci()),
        review: mock(async () => review()),
        e2e: mock(async () => e2e()),
        e2eVerify: mock(async () => e2eVerify()),
      },
      log
    );

    await expect(orchestrate(ctx(), firstSteps, noopHooks())).rejects.toThrow(
      /mid-dev/
    );

    // Second run (daemon restart) reuses the same event log. The failed dev
    // step is retried; all previously-completed steps (plan only, in this
    // case) return their cached outcomes.
    const secondSteps = wrapSteps(
      {
        plan: mock(async () => {
          throw new Error(
            "plan must NOT be re-invoked on resume — should hit cache"
          );
        }),
        dev: devImpl,
        createPr: mock(async () => pr()),
        postComment: mock(async () => undefined),
        ci: mock(async () => ci()),
        review: mock(async () => review()),
        e2e: mock(async () => e2e()),
        e2eVerify: mock(async () => e2eVerify()),
      },
      log
    );

    const result = await orchestrate(ctx(), secondSteps, noopHooks());
    expect(result.status).toBe("complete");
    expect(result.prNumber).toBe(42);
    // dev was called twice: once during the crashed run, once during resume.
    expect(devCalls).toBe(2);
  });
});

describe("durability: no-replay of completed steps (AC6)", () => {
  it("does not re-execute steps that completed in a prior run", async () => {
    const log: StepLog[] = [];

    // First run fails after review (simulating a crash between review and
    // e2e). Track how many times each step's underlying fn is invoked.
    const planFn = mock(async () => plan());
    const devFn = mock(async () => devOk());
    const ciFn = mock(async () => ci());
    const reviewFn = mock(async () => review());
    let e2eCalls = 0;
    const e2eFn = mock(async () => {
      e2eCalls++;
      if (e2eCalls === 1) throw new Error("daemon killed before e2e returned");
      return e2e();
    });
    const e2eVerifyFn = mock(async () => e2eVerify());
    const prFn = mock(async () => pr());
    const postCommentFn = mock(async () => undefined);

    const makeImpls = (): OrchestratorSteps => ({
      plan: planFn,
      dev: devFn,
      createPr: prFn,
      postComment: postCommentFn,
      ci: ciFn,
      review: reviewFn,
      e2e: e2eFn,
      e2eVerify: e2eVerifyFn,
    });

    const firstSteps = wrapSteps(makeImpls(), log);
    await expect(orchestrate(ctx(), firstSteps, noopHooks())).rejects.toThrow(
      /before e2e returned/
    );

    // Before resume: plan/dev/createPr/ci/review each ran exactly once.
    expect(planFn).toHaveBeenCalledTimes(1);
    expect(devFn).toHaveBeenCalledTimes(1);
    expect(prFn).toHaveBeenCalledTimes(1);
    expect(ciFn).toHaveBeenCalledTimes(1);
    expect(reviewFn).toHaveBeenCalledTimes(1);

    // Resume: e2e was the in-progress step, so it runs again (and this time
    // succeeds). All earlier steps MUST NOT be re-invoked — the WDK event
    // log returns their cached outputs. Our assertion that the underlying
    // fns were called exactly once is the contract.
    const secondSteps = wrapSteps(makeImpls(), log);
    const result = await orchestrate(ctx(), secondSteps, noopHooks());
    expect(result.status).toBe("complete");

    expect(planFn).toHaveBeenCalledTimes(1);
    expect(devFn).toHaveBeenCalledTimes(1);
    expect(prFn).toHaveBeenCalledTimes(1);
    expect(ciFn).toHaveBeenCalledTimes(1);
    expect(reviewFn).toHaveBeenCalledTimes(1);
    // e2e ran twice: once crashed, once on resume.
    expect(e2eCalls).toBe(2);
    // e2eVerify only runs on the successful resume.
    expect(e2eVerifyFn).toHaveBeenCalledTimes(1);
  });
});
