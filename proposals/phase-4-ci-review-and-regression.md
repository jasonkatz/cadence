# Proposal: Phase 4 — CI Polling, Review Agent & Regression Loop

## Summary

Complete the feedback loop by adding CI status polling, the review agent, and the regression mechanism. After this phase, the pipeline runs plan → dev → CI → review, and when CI or review fails, it regresses to dev with failure context and tries again — up to `max_iters` times. This is the phase that makes the pipeline self-correcting rather than a one-shot attempt.

## Acceptance Criteria

### CI Step

1. After the dev step passes, the ci step transitions to `running`. It monitors the GitHub Actions status for the PR's head commit. When all checks pass, `GET /v1/workflows/:id/steps` shows the ci step with status `passed`.

2. If any GitHub Actions check fails, the ci step transitions to `failed` with a `detail` field containing the failure information.

3. If no check result arrives within the timeout (default: 15 minutes), the ci step transitions to `failed` with a `detail` indicating timeout.

### Review Agent

4. After the ci step passes, the review step transitions to `running`. The reviewer agent reads the PR diff and evaluates it against the proposal's acceptance criteria.

5. If the reviewer's verdict is `review_pass: true`, the review step transitions to `passed`. If `review_pass: false`, the step transitions to `failed` with a `detail` containing the unmet criteria and blocking issues.

6. After the review step runs, `GET /v1/workflows/:id/runs` includes a run with `agent_role: "reviewer"` containing the structured JSON verdict in the `response` field.

7. After the review step passes, the engine stops — e2e, e2e_verify, and signoff steps remain `pending`.

### Regression Loop

8. When the ci or review step fails, `GET /v1/workflows/:id` shows the `iteration` field incremented by 1. `GET /v1/workflows/:id/steps` shows a new set of steps for the new iteration starting from `dev` (no `plan` step on iteration 2+).

9. After a regression, `GET /v1/workflows/:id/runs` shows the new dev run's `prompt` includes the failure context from the step that triggered the regression — CI failure logs for a ci failure, or review comments and unmet criteria for a review failure.

10. On regression iterations, the dev agent pushes additional commits to the same branch. The `pr_number` on the workflow remains unchanged — no new PR is created.

11. When `iteration` exceeds `max_iters`, `GET /v1/workflows/:id` shows status `failed` with an `error` indicating the iteration limit was reached.

### CLI

12. `cadence run` prints regression information as it happens — the failure reason, the new iteration number, and progress through the new iteration's steps.

13. `cadence status <workflow-id>` displays the current iteration number and all steps for the current iteration with their statuses. `cadence status` with `--json` includes steps for all iterations.

### Web Client

14. The workflow detail page shows the iteration count and displays steps grouped by iteration. When a regression occurs, the new iteration's steps appear in real-time via SSE.

15. Failed steps show their `detail` (failure context) in an expandable section.

## Technical Considerations

- **CI polling**: The GitHub Checks API (`/repos/{owner}/{repo}/commits/{ref}/check-runs`) returns check-run results. The step should aggregate all check runs and pass only when all have `conclusion: success`. Handle the `queued` and `in_progress` states by continuing to poll. The reviewer agent uses read-only tools (Bash, Read, Glob, Grep).
- **Failure context extraction**: CI failures should include the relevant log output (fetched from GitHub Actions logs API if available, or the check-run output summary). Review failures should include the structured verdict JSON and any PR comments left by the reviewer.
- **Regression step creation**: When creating steps for iteration 2+, skip the `plan` type. The step order is: dev, ci, review, e2e, e2e_verify, signoff.
- **PR diff**: The reviewer agent reads the diff via `gh pr diff` or the GitHub API. The diff should be scoped to the full PR (base branch vs head), not just the latest commit, so the reviewer sees the complete picture.
- **Fresh agent sessions**: Every agent gets a fresh session on each iteration. The dev agent's prompt is augmented with failure context but starts from a clean slate otherwise.

## Out of Scope

- **E2E testing** — The pipeline stops after review. E2E agent and verifier are Phase 5.
- **Signoff** — The signoff step is Phase 5 (after E2E passes).
- **PR comments by reviewer on GitHub** — The reviewer produces a verdict used by the pipeline. Posting inline comments to the PR is a nice-to-have that can be added within this phase or later.
- **Concurrent workflow execution** — Still one workflow at a time.
