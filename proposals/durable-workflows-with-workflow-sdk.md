# Proposal: Durable Workflows via Vercel Workflow SDK (Local World)

## Summary

Replace tmpo's hand-rolled workflow engine with the Vercel Workflow Development Kit (WDK) backed by `@workflow/world-local`. This gives us event-sourced durability and deterministic replay: workflows that are mid-run when the daemon crashes or restarts **resume from the last completed step** instead of being marked failed. The Local World is filesystem-backed (no Postgres), single-instance, and zero external dependencies — a clean fit for tmpo's local-first model.

## Motivation

Today, if `tmpod` crashes, is killed, or the machine reboots mid-workflow:

1. `recoverInterruptedWorkflows()` marks every `running` step + workflow as **failed** with "interrupted: daemon shutdown" (`server/src/engine/recovery.ts:11`). There is no resume path — work is lost.
2. The in-process job queue (`server/src/engine/job-queue.ts`) is memory-only; pending jobs vanish.
3. `claude` child subprocesses are orphaned (no process group management).
4. JSONL run logs use `appendFileSync` with no fsync; the tail line can be partial.

The Vercel WDK solves (1) and (2) natively via event sourcing + deterministic replay. (3) and (4) remain our responsibility and are handled in a follow-up section below.

## Proposed Design

### Programming model

Each agent becomes a `"use step"` function; the orchestration loop becomes a `"use workflow"` function. Example (sketch, not final):

```ts
// server/src/workflows/run-workflow.ts
export async function runWorkflow(input: RunInput) {
  "use workflow";
  const proposal = await plan(input);
  let iteration = 0;
  while (iteration < input.maxIters) {
    const dev = await devIterate(input, proposal, iteration);
    const ci = await waitForCi(dev.prNumber);
    const review = await reviewDiff(dev.prNumber, proposal);
    const e2e = await runE2E(dev.prNumber, proposal);
    if (ci.ok && review.ok && e2e.ok) return { prNumber: dev.prNumber };
    iteration++;
  }
  throw new Error("max iterations exceeded");
}

export async function plan(input: RunInput) { "use step"; /* ... */ }
export async function devIterate(...) { "use step"; /* ... */ }
export async function waitForCi(pr: number) { "use step"; /* polling loop */ }
export async function reviewDiff(...) { "use step"; /* ... */ }
export async function runE2E(...) { "use step"; /* ... */ }
```

### Storage

`@workflow/world-local` writes to `~/.tmpo/workflow-data/` (via `WORKFLOW_EMBEDDED_DATA_DIR`):

```
~/.tmpo/
  workflow-data/
    runs/{runId}.json              # workflow run state + event log
    steps/{stepId}.json            # per-step inputs/outputs
    hooks/{hookId}.json            # external wake-ups (optional)
    streams/chunks/{chunkId}.bin   # streamed content (e.g. claude stdout)
  tmpo.db                          # SQLite — RETAINED for workflow index
  runs/                            # JSONL agent logs — RETAINED
```

SQLite is retained as the **user-facing index** (what `tmpo list` / `tmpo status` queries) and for configuration. The WDK event log is the **execution source of truth**. A small adapter syncs WDK run state → SQLite `workflows` / `steps` tables on step-completion events so the CLI/UI don't need to read from `workflow-data/`.

### Recovery model

On daemon startup, Local World's `reenqueueActiveRuns` scans `runs/` for non-terminal state and re-enqueues them. Deterministic replay means completed steps return cached outputs; the first incomplete step is re-executed. This replaces `recoverInterruptedWorkflows()` entirely.

### Concurrency

Local World's in-process HTTP queue supports concurrent workflows (default 100 workers, `WORKFLOW_LOCAL_QUEUE_CONCURRENCY`). Per-workflow sequencing is inherent to the step model. No changes needed to our concurrency guarantees.

### Subprocess lifecycle (addresses gap #3)

Wrap `claude` CLI spawns in a **process group** (`detached: true` + `process.kill(-pid)`). On daemon startup, before `reenqueueActiveRuns`, scan for stale PIDs recorded at step start and SIGTERM any survivors. Record PID in the step's event log so replay can reap it.

### Log durability (addresses gap #4)

Switch JSONL writes from `appendFileSync` to an `fs.WriteStream` with explicit `flush`/`fsync` on event boundaries, or accept the current behavior and add a defensive parser that tolerates partial tail lines. Recommended: explicit stream with periodic fsync.

## Non-Goals

- Swapping out SQLite as the CLI-facing index.
- Adopting Postgres or the Vercel-hosted World.
- Multi-daemon / distributed execution.
- Rewriting the CLI or daemon lifecycle (socket, PID file, doctor).

## Work Plan

1. **Add WDK + Local World dependencies** to `server/package.json`. Configure `WORKFLOW_EMBEDDED_DATA_DIR=~/.tmpo/workflow-data`.
2. **Port agents to `"use step"` functions.** One file per agent under `server/src/workflows/steps/`. The functions wrap the existing agent logic; no behavior change per step.
3. **Write `runWorkflow` orchestrator** as `"use workflow"`. Mirrors the current state machine in `server/src/engine/workflow-engine.ts` but uses linear async/await rather than a step dispatcher.
4. **Replace `job-queue.ts` and `workflow-engine.ts`** with a thin bridge that hands off to WDK. Delete `recovery.ts` once parity is proven.
5. **Index sync adapter.** On WDK step completion, update SQLite `workflows`/`steps` so `tmpo list` and the web UI keep working unchanged.
6. **Subprocess process groups.** Update `server/src/engine/streaming-claude.ts` to spawn with `detached: true`, record PID, and add startup reaper.
7. **JSONL fsync boundary.** Update `server/src/utils/run-logger.ts` to use a persistent `WriteStream` with `flush` on event boundaries.
8. **Delete dead code** (`recovery.ts`, old `job-queue.ts`). No migration shim — local-first tool, users re-run interrupted workflows once.
9. **Docs.** Update `README.md` architecture diagram and `proposals/open-source-readiness.md` to reflect the new storage layout.

## Acceptance Criteria

1. Starting a workflow, then `kill -9`ing the daemon mid-step, then restarting the daemon causes the workflow to **resume the in-progress step**, not fail with "interrupted: daemon shutdown".
2. Completed steps are **not re-executed** after daemon restart (verified by checking `claude` is not re-spawned for finished steps).
3. `tmpo list` and `tmpo status <id>` continue to show workflows and step states correctly after the switch.
4. `tmpo logs <id>` continues to stream the full JSONL agent transcript.
5. Killing the daemon while a `claude` subprocess is active: on next startup, the orphaned process is SIGTERM'd and its step is re-executed (not left running).
6. All existing `server/src/engine/*.test.ts` equivalents pass against the new implementation. Tests demonstrating crash-and-resume are added.
7. `make build` still produces a single `tmpod` binary (the WDK is JS, bundles into `bun build --compile`).
8. No Postgres, Redis, or external service dependency is introduced. `tmpo doctor` requires nothing new.

## Open Questions

- **WDK "dev-only" disclaimer.** Vercel labels Local World as development-only. Technically the persistence and recovery mechanics fit our single-instance daemon model. We should pin a specific version and track WDK releases; if Vercel adds a supported embedded world later, migration is cheap.
- **Event log retention.** `~/.tmpo/workflow-data/runs/` will grow with every workflow. Need a retention policy (e.g. delete entries for workflows completed > 30 days ago). Not blocking for first cut.
- **Determinism constraints.** The workflow body must be deterministic; nondeterministic I/O must happen inside steps. Need to audit the current orchestrator logic for any implicit nondeterminism (e.g. `Date.now()` used for branching).
