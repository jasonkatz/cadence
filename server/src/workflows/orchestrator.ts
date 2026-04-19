import type {
  WorkflowContext,
  WorkflowRunResult,
  PlanStepResult,
  DevStepResult,
  CiStepResult,
  ReviewStepResult,
  E2eStepResult,
  E2eVerifyStepResult,
  CreatePrStepResult,
} from "./types";

/**
 * Bag of step callables. Pure functions — each returns its result without
 * performing orchestration control flow. This keeps the orchestrator testable
 * without the WDK runtime.
 */
export interface OrchestratorSteps {
  plan: (input: WorkflowContext) => Promise<PlanStepResult>;
  dev: (input: WorkflowContext & { iteration: number; proposal: string }) => Promise<DevStepResult>;
  createPr: (input: WorkflowContext & { proposal: string }) => Promise<CreatePrStepResult>;
  postComment: (input: { repo: string; prNumber: number; body: string }) => Promise<void>;
  ci: (input: WorkflowContext & { iteration: number }) => Promise<CiStepResult>;
  review: (input: WorkflowContext & { iteration: number; proposal: string; prNumber: number }) => Promise<ReviewStepResult>;
  e2e: (input: WorkflowContext & { iteration: number; proposal: string; prNumber: number }) => Promise<E2eStepResult>;
  e2eVerify: (
    input: WorkflowContext & { iteration: number; proposal: string; prNumber: number; evidence: string }
  ) => Promise<E2eVerifyStepResult>;
}

/**
 * Hooks the orchestrator calls out to for side-effects that belong outside
 * the deterministic workflow body — SQLite index-sync, SSE events, PR
 * comments' formatted text. Hooks are side-effecting but read-only from the
 * orchestrator's perspective, so the orchestrator can be replayed by WDK
 * without re-triggering them (WDK caches step return values, and the hook
 * calls live inside step wrappers when we bind to the WDK runtime).
 */
/**
 * Per-step run details surfaced to the index-sync adapter so it can create a
 * row in the SQLite `runs` table (what `tmpo logs` reads). Only set for
 * agent-backed steps (plan / dev / review / e2e / e2e_verify); `ci` and
 * `signoff` don't spawn an agent process and carry no run row.
 */
export interface OrchestratorRunInfo {
  agentRole: string;
  logPath: string;
  exitCode: number;
  durationSecs: number;
}

export interface OrchestratorHooks {
  onStepStart(type: string, iteration: number): void;
  onStepEnd(
    type: string,
    iteration: number,
    result: { ok: boolean; detail?: string; run?: OrchestratorRunInfo }
  ): void;
  onProposal(proposal: string): void;
  onPrCreated(prNumber: number, prUrl: string): void;
  onIteration(iteration: number, failureDetail: string): void;
  onComplete(prNumber: number | null): void;
  onFail(error: string): void;
}

const DEFAULT_HOOKS: OrchestratorHooks = {
  onStepStart() {},
  onStepEnd() {},
  onProposal() {},
  onPrCreated() {},
  onIteration() {},
  onComplete() {},
  onFail() {},
};

function summaryText(raw: string): string {
  return raw.replace(/```json[\s\S]*?```/g, "").trim();
}

/**
 * Orchestrates the plan → (dev → ci → review → e2e → e2e_verify → signoff)
 * loop. Mirrors the behavior of the legacy engine's step dispatcher but
 * expressed as linear async/await with a for-loop over iterations.
 */
export async function orchestrate(
  ctx: WorkflowContext,
  steps: OrchestratorSteps,
  hooks: OrchestratorHooks = DEFAULT_HOOKS
): Promise<WorkflowRunResult> {
  // --- Plan (runs once) ---
  hooks.onStepStart("plan", 0);
  const plan = await steps.plan(ctx);
  hooks.onStepEnd("plan", 0, {
    ok: plan.ok,
    detail: plan.ok ? undefined : plan.response,
    run: {
      agentRole: "planner",
      logPath: plan.logPath,
      exitCode: plan.exitCode,
      durationSecs: plan.durationSecs,
    },
  });
  if (!plan.ok || !plan.proposal) {
    const error = `Plan step failed: ${(plan.response || "Planner agent failed").substring(0, 500)}`;
    hooks.onFail(error);
    return { status: "failed", prNumber: null, error, iteration: 0 };
  }
  hooks.onProposal(plan.proposal);
  const proposal = plan.proposal;

  let prNumber: number | null = null;

  for (let iteration = 0; iteration < ctx.maxIters; iteration++) {
    // Iteration state is advanced by the regression hook fired from the
    // failing step below; no per-loop bump needed here.

    // --- Dev ---
    hooks.onStepStart("dev", iteration);
    const dev = await steps.dev({ ...ctx, iteration, proposal });
    hooks.onStepEnd("dev", iteration, {
      ok: dev.ok,
      detail: dev.ok ? undefined : dev.response,
      run: {
        agentRole: "dev",
        logPath: dev.logPath,
        exitCode: dev.exitCode,
        durationSecs: dev.durationSecs,
      },
    });
    if (!dev.ok) {
      const error = `Dev step failed: ${(dev.response || "Dev agent failed").substring(0, 500)}`;
      hooks.onFail(error);
      return { status: "failed", prNumber, error, iteration };
    }

    // --- Create PR on first iteration ---
    if (prNumber === null) {
      try {
        const pr = await steps.createPr({ ...ctx, proposal });
        prNumber = pr.number;
        hooks.onPrCreated(pr.number, pr.url);
        await steps.postComment({
          repo: ctx.repo,
          prNumber: pr.number,
          body: `\u{1F4CB} **Proposal**\n\n${proposal}`,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const wrapped = `PR creation failed: ${detail.substring(0, 500)}`;
        hooks.onFail(wrapped);
        return { status: "failed", prNumber: null, error: wrapped, iteration };
      }
    }

    // --- CI ---
    hooks.onStepStart("ci", iteration);
    const ci = await steps.ci({ ...ctx, iteration });
    hooks.onStepEnd("ci", iteration, { ok: ci.ok, detail: ci.ok ? undefined : ci.detail ?? undefined });
    if (!ci.ok) {
      hooks.onIteration(iteration + 1, ci.detail || "CI checks failed");
      continue;
    }

    // --- Review ---
    hooks.onStepStart("review", iteration);
    const review = await steps.review({ ...ctx, iteration, proposal, prNumber });
    hooks.onStepEnd("review", iteration, {
      ok: review.ok,
      detail: review.ok ? undefined : review.verdict,
      run: {
        agentRole: "reviewer",
        logPath: review.logPath,
        exitCode: review.exitCode,
        durationSecs: review.durationSecs,
      },
    });
    await steps.postComment({
      repo: ctx.repo,
      prNumber,
      body: formatReviewComment(review, iteration),
    });
    if (!review.ok) {
      hooks.onIteration(iteration + 1, review.verdict || "Review failed");
      continue;
    }

    // --- E2E ---
    hooks.onStepStart("e2e", iteration);
    const e2e = await steps.e2e({ ...ctx, iteration, proposal, prNumber });
    hooks.onStepEnd("e2e", iteration, {
      ok: e2e.ok,
      detail: e2e.ok ? undefined : e2e.response,
      run: {
        agentRole: "e2e",
        logPath: e2e.logPath,
        exitCode: e2e.exitCode,
        durationSecs: e2e.durationSecs,
      },
    });
    await steps.postComment({
      repo: ctx.repo,
      prNumber,
      body: formatE2eComment(e2e, iteration),
    });
    if (!e2e.ok) {
      hooks.onIteration(iteration + 1, e2e.response || "E2E tests failed");
      continue;
    }

    // --- E2E verify ---
    hooks.onStepStart("e2e_verify", iteration);
    const verify = await steps.e2eVerify({
      ...ctx,
      iteration,
      proposal,
      prNumber,
      evidence: e2e.evidence,
    });
    hooks.onStepEnd("e2e_verify", iteration, {
      ok: verify.ok,
      detail: verify.ok ? undefined : verify.verdict,
      run: {
        agentRole: "e2e_verifier",
        logPath: verify.logPath,
        exitCode: verify.exitCode,
        durationSecs: verify.durationSecs,
      },
    });
    await steps.postComment({
      repo: ctx.repo,
      prNumber,
      body: formatE2eVerifyComment(verify, iteration),
    });
    if (!verify.ok) {
      hooks.onIteration(iteration + 1, verify.verdict || "E2E verification failed");
      continue;
    }

    // --- Signoff: implicit pass on reaching here ---
    hooks.onStepStart("signoff", iteration);
    hooks.onStepEnd("signoff", iteration, { ok: true });
    hooks.onComplete(prNumber);
    return { status: "complete", prNumber, iteration };
  }

  const error = "Workflow failed: iteration limit reached";
  hooks.onFail(error);
  return { status: "failed", prNumber, error, iteration: ctx.maxIters };
}

function formatReviewComment(result: ReviewStepResult, iteration: number): string {
  const icon = result.ok ? "\u2705" : "\u274c";
  const status = result.ok ? "passed" : "failed";
  const header = `${icon} **Review ${status}** (iteration ${iteration})`;
  const body = summaryText(result.response);
  return body ? `${header}\n\n${body}` : header;
}

function formatE2eComment(result: E2eStepResult, iteration: number): string {
  const header = `\u{1F9EA} **E2E Evidence** (iteration ${iteration})`;
  const body = summaryText(result.response);
  return body ? `${header}\n\n${body}` : header;
}

function formatE2eVerifyComment(
  result: E2eVerifyStepResult,
  iteration: number
): string {
  const icon = result.ok ? "\u2705" : "\u274c";
  const status = result.ok ? "passed" : "failed";
  const header = `${icon} **E2E Verification ${status}** (iteration ${iteration})`;
  const body = summaryText(result.response);
  return body ? `${header}\n\n${body}` : header;
}
