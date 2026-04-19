import { describe, it, expect, mock } from "bun:test";
import { orchestrate, type OrchestratorSteps, type OrchestratorHooks } from "./orchestrator";
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

function ctx(overrides?: Partial<WorkflowContext>): WorkflowContext {
  return {
    workflowId: "wf-1",
    task: "do the thing",
    repo: "owner/repo",
    branch: "main",
    requirements: null,
    maxIters: 3,
    ...overrides,
  };
}

function plan(overrides?: Partial<PlanStepResult>): PlanStepResult {
  return {
    ok: true,
    proposal: "## Proposal\n\nDo X",
    exitCode: 0,
    durationSecs: 1,
    response: "ok",
    logPath: "/tmp/plan.jsonl",
    ...overrides,
  };
}
function dev(overrides?: Partial<DevStepResult>): DevStepResult {
  return {
    ok: true,
    exitCode: 0,
    durationSecs: 1,
    response: "ok",
    logPath: "/tmp/dev.jsonl",
    ...overrides,
  };
}
function ci(overrides?: Partial<CiStepResult>): CiStepResult {
  return { ok: true, detail: null, ...overrides };
}
function review(overrides?: Partial<ReviewStepResult>): ReviewStepResult {
  return {
    ok: true,
    verdict: "LGTM",
    response: "looks good",
    exitCode: 0,
    durationSecs: 1,
    logPath: "/tmp/review.jsonl",
    ...overrides,
  };
}
function e2e(overrides?: Partial<E2eStepResult>): E2eStepResult {
  return {
    ok: true,
    evidence: "passing evidence",
    response: "run complete",
    exitCode: 0,
    durationSecs: 1,
    logPath: "/tmp/e2e.jsonl",
    ...overrides,
  };
}
function e2eVerify(overrides?: Partial<E2eVerifyStepResult>): E2eVerifyStepResult {
  return {
    ok: true,
    verdict: "verified",
    response: "evidence checks out",
    exitCode: 0,
    durationSecs: 1,
    logPath: "/tmp/e2ev.jsonl",
    ...overrides,
  };
}
function pr(overrides?: Partial<CreatePrStepResult>): CreatePrStepResult {
  return { number: 42, url: "https://github.com/owner/repo/pull/42", ...overrides };
}

function makeSteps(overrides?: Partial<OrchestratorSteps>): OrchestratorSteps {
  return {
    plan: mock(async () => plan()),
    dev: mock(async () => dev()),
    createPr: mock(async () => pr()),
    postComment: mock(async () => undefined),
    ci: mock(async () => ci()),
    review: mock(async () => review()),
    e2e: mock(async () => e2e()),
    e2eVerify: mock(async () => e2eVerify()),
    ...overrides,
  };
}

function makeRecordingHooks(): { hooks: OrchestratorHooks; events: Array<[string, ...unknown[]]> } {
  const events: Array<[string, ...unknown[]]> = [];
  const hooks: OrchestratorHooks = {
    onStepStart: (type, iter) => events.push(["onStepStart", type, iter]),
    onStepEnd: (type, iter, result) => events.push(["onStepEnd", type, iter, result]),
    onProposal: (p) => events.push(["onProposal", p]),
    onPrCreated: (n, url) => events.push(["onPrCreated", n, url]),
    onIteration: (iter, detail) => events.push(["onIteration", iter, detail]),
    onComplete: (n) => events.push(["onComplete", n]),
    onFail: (err) => events.push(["onFail", err]),
  };
  return { hooks, events };
}

describe("orchestrate", () => {
  it("completes on first iteration when all steps pass", async () => {
    const steps = makeSteps();
    const { hooks, events } = makeRecordingHooks();

    const result = await orchestrate(ctx(), steps, hooks);

    expect(result.status).toBe("complete");
    expect(result.prNumber).toBe(42);
    expect(result.iteration).toBe(0);
    expect(steps.plan).toHaveBeenCalledTimes(1);
    expect(steps.dev).toHaveBeenCalledTimes(1);
    expect(steps.createPr).toHaveBeenCalledTimes(1);
    expect(steps.ci).toHaveBeenCalledTimes(1);
    expect(steps.review).toHaveBeenCalledTimes(1);
    expect(steps.e2e).toHaveBeenCalledTimes(1);
    expect(steps.e2eVerify).toHaveBeenCalledTimes(1);
    // proposal comment + review + e2e + e2eVerify = 4
    expect(steps.postComment).toHaveBeenCalledTimes(4);
    expect(events.find((e) => e[0] === "onComplete")).toEqual(["onComplete", 42]);
    expect(events.find((e) => e[0] === "onPrCreated")).toEqual([
      "onPrCreated",
      42,
      "https://github.com/owner/repo/pull/42",
    ]);
  });

  it("fails when plan step fails and does not enter the loop", async () => {
    const steps = makeSteps({ plan: mock(async () => plan({ ok: false, proposal: null, response: "boom" })) });
    const { hooks, events } = makeRecordingHooks();

    const result = await orchestrate(ctx(), steps, hooks);

    expect(result.status).toBe("failed");
    expect(result.prNumber).toBeNull();
    expect(result.error).toContain("Plan step failed");
    expect(steps.dev).not.toHaveBeenCalled();
    expect(steps.createPr).not.toHaveBeenCalled();
    expect(events.some((e) => e[0] === "onFail")).toBe(true);
  });

  it("fails when dev step fails on first iteration (no PR created yet)", async () => {
    const steps = makeSteps({ dev: mock(async () => dev({ ok: false, response: "dev broke" })) });
    const { hooks, events } = makeRecordingHooks();

    const result = await orchestrate(ctx(), steps, hooks);

    expect(result.status).toBe("failed");
    expect(result.prNumber).toBeNull();
    expect(steps.createPr).not.toHaveBeenCalled();
    expect(events.some((e) => e[0] === "onFail")).toBe(true);
  });

  it("regresses when CI fails and retries without creating a second PR", async () => {
    let ciCall = 0;
    const steps = makeSteps({
      ci: mock(async () => {
        ciCall++;
        return ciCall === 1 ? ci({ ok: false, detail: "tests red" }) : ci();
      }),
    });
    const { hooks, events } = makeRecordingHooks();

    const result = await orchestrate(ctx({ maxIters: 3 }), steps, hooks);

    expect(result.status).toBe("complete");
    expect(result.iteration).toBe(1);
    expect(steps.createPr).toHaveBeenCalledTimes(1);
    expect(steps.dev).toHaveBeenCalledTimes(2);
    expect(steps.ci).toHaveBeenCalledTimes(2);
    // Review/e2e should not have run in the failing iteration.
    expect(steps.review).toHaveBeenCalledTimes(1);
    const regressions = events.filter((e) => e[0] === "onIteration");
    expect(regressions.length).toBe(1);
    expect(regressions[0][1]).toBe(1);
    expect(regressions[0][2]).toBe("tests red");
  });

  it("regresses when review fails and posts a review comment on the failure", async () => {
    let reviewCall = 0;
    const steps = makeSteps({
      review: mock(async () => {
        reviewCall++;
        return reviewCall === 1
          ? review({ ok: false, verdict: "nit missed", response: "nit missed" })
          : review();
      }),
    });
    const { hooks, events } = makeRecordingHooks();

    const result = await orchestrate(ctx({ maxIters: 3 }), steps, hooks);

    expect(result.status).toBe("complete");
    expect(steps.review).toHaveBeenCalledTimes(2);
    // Proposal + 2 review comments + 1 e2e + 1 e2eVerify = 5 postComment calls
    expect(steps.postComment).toHaveBeenCalledTimes(5);
    expect(events.filter((e) => e[0] === "onIteration").length).toBe(1);
  });

  it("regresses when e2e fails", async () => {
    let e2eCall = 0;
    const steps = makeSteps({
      e2e: mock(async () => {
        e2eCall++;
        return e2eCall === 1 ? e2e({ ok: false, response: "flaked" }) : e2e();
      }),
    });
    const { hooks, events } = makeRecordingHooks();

    const result = await orchestrate(ctx({ maxIters: 3 }), steps, hooks);

    expect(result.status).toBe("complete");
    expect(steps.e2e).toHaveBeenCalledTimes(2);
    expect(events.filter((e) => e[0] === "onIteration").length).toBe(1);
  });

  it("regresses when e2e_verify fails", async () => {
    let verifyCall = 0;
    const steps = makeSteps({
      e2eVerify: mock(async () => {
        verifyCall++;
        return verifyCall === 1
          ? e2eVerify({ ok: false, verdict: "evidence insufficient" })
          : e2eVerify();
      }),
    });
    const { hooks, events } = makeRecordingHooks();

    const result = await orchestrate(ctx({ maxIters: 3 }), steps, hooks);

    expect(result.status).toBe("complete");
    expect(steps.e2eVerify).toHaveBeenCalledTimes(2);
    expect(events.filter((e) => e[0] === "onIteration").length).toBe(1);
  });

  it("fails with iteration-limit error after maxIters regressions", async () => {
    const steps = makeSteps({ ci: mock(async () => ci({ ok: false, detail: "always red" })) });
    const { hooks, events } = makeRecordingHooks();

    const result = await orchestrate(ctx({ maxIters: 2 }), steps, hooks);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("iteration limit reached");
    expect(result.iteration).toBe(2);
    expect(steps.dev).toHaveBeenCalledTimes(2);
    expect(steps.createPr).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e[0] === "onIteration").length).toBe(2);
    expect(events.some((e) => e[0] === "onFail")).toBe(true);
  });

  it("fails when createPr throws", async () => {
    const steps = makeSteps({
      createPr: mock(async () => {
        throw new Error("api down");
      }),
    });
    const { hooks, events } = makeRecordingHooks();

    const result = await orchestrate(ctx(), steps, hooks);

    expect(result.status).toBe("failed");
    expect(result.prNumber).toBeNull();
    expect(result.error).toContain("PR creation failed");
    expect(result.error).toContain("api down");
    expect(events.some((e) => e[0] === "onFail")).toBe(true);
  });

  it("records step lifecycle events in order for a happy path", async () => {
    const steps = makeSteps();
    const { hooks, events } = makeRecordingHooks();

    await orchestrate(ctx({ maxIters: 1 }), steps, hooks);

    const lifecycle = events
      .filter((e) => e[0] === "onStepStart" || e[0] === "onStepEnd")
      .map((e) => `${e[0]}:${e[1]}:${e[2]}`);
    expect(lifecycle).toEqual([
      "onStepStart:plan:0",
      "onStepEnd:plan:0",
      "onStepStart:dev:0",
      "onStepEnd:dev:0",
      "onStepStart:ci:0",
      "onStepEnd:ci:0",
      "onStepStart:review:0",
      "onStepEnd:review:0",
      "onStepStart:e2e:0",
      "onStepEnd:e2e:0",
      "onStepStart:e2e_verify:0",
      "onStepEnd:e2e_verify:0",
      "onStepStart:signoff:0",
      "onStepEnd:signoff:0",
    ]);
  });
});
