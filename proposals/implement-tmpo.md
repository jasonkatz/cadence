# Proposal: Implement Tmpo

## Summary

Tmpo is an autonomous software delivery pipeline that takes a task description and a GitHub repository as input and produces a reviewed pull request with end-to-end verification proof as output. The system orchestrates a sequence of AI agents — planner, developer, reviewer, and E2E tester — through a fixed pipeline with automatic regression on failure. This proposal covers the full implementation: database schema, workflow engine, agent orchestration, GitHub integration, API endpoints, real-time progress streaming, CLI commands, and web client views. The goal is to go from the current scaffolding (auth-only) to a working system where a user can run `tmpo run --task "..." --repo owner/repo` and receive a verified PR.

## Acceptance Criteria

### Database & Data Model

1. A `workflows` table exists in PostgreSQL with columns: `id` (uuid PK), `task` (text, not null), `repo` (text, not null), `branch` (text, not null), `requirements` (text, nullable), `proposal` (text, nullable), `pr_number` (integer, nullable), `status` (text, not null, one of: pending/running/complete/failed/cancelled), `iteration` (integer, not null, default 0), `max_iters` (integer, not null, default 8), `error` (text, nullable), `created_by` (uuid FK to users, not null), `created_at` (timestamptz, default now()), `updated_at` (timestamptz, default now()).

2. A `steps` table exists with columns: `id` (uuid PK), `workflow_id` (uuid FK to workflows, not null), `iteration` (integer, not null), `type` (text, not null, one of: plan/dev/ci/review/e2e/e2e_verify/signoff), `status` (text, not null, one of: pending/running/passed/failed), `started_at` (timestamptz, nullable), `finished_at` (timestamptz, nullable), `detail` (text, nullable).

3. A `runs` table exists with columns: `id` (uuid PK), `step_id` (uuid FK to steps, not null), `workflow_id` (uuid FK to workflows, not null), `agent_role` (text, not null), `iteration` (integer, not null), `prompt` (text, not null), `response` (text, nullable), `exit_code` (integer, nullable), `duration_secs` (numeric, nullable), `created_at` (timestamptz, default now()).

### Workflow API

4. `POST /v1/workflows` accepts `{ task, repo, branch?, requirements?, max_iters? }` and returns a 201 with the created workflow (status: pending, iteration: 0). The workflow is scoped to the authenticated user.

5. `GET /v1/workflows` returns a paginated list of workflows belonging to the authenticated user, ordered by `created_at` descending. Supports `?status=` filter.

6. `GET /v1/workflows/:id` returns the full workflow object including its current steps (for the latest iteration) and the proposal. Returns 404 if the workflow doesn't exist or doesn't belong to the user.

7. `POST /v1/workflows/:id/cancel` transitions the workflow to `cancelled` if it is in a non-terminal state (pending or running). Returns 409 if already terminal.

8. `GET /v1/workflows/:id/steps` returns all steps for the workflow, ordered by iteration and step type. Supports `?iteration=` filter.

9. `GET /v1/workflows/:id/runs` returns all runs for the workflow, ordered by `created_at`. Supports `?agent_role=` and `?iteration=` filters.

### Workflow Engine

10. After a workflow is created, the engine picks it up and transitions it to `running`. It creates step records for the first iteration (plan, dev, ci, review, e2e, e2e_verify, signoff) all with status `pending`.

11. Steps execute sequentially in the defined order. Each step transitions from `pending` → `running` → `passed` or `failed`. The `started_at` and `finished_at` timestamps are recorded.

12. The `plan` step invokes the planner agent with the task description, repo, and requirements path. The agent's output (the proposal) is saved to the workflow's `proposal` field.

13. The `dev` step invokes the dev agent with the proposal and (on regression iterations) failure context from the previous iteration. The agent implements the proposal, commits, and pushes to the workflow's branch.

14. The `ci` step polls the GitHub Actions status for the head commit on the workflow's branch. It passes when all required checks pass, fails when any check fails, and times out after a configurable duration (default: 15 minutes).

15. The `review` step invokes the reviewer agent with the proposal and the PR diff. The agent outputs a structured JSON verdict. If `review_pass` is `true`, the step passes. If `false`, the step fails and the review comments are captured as failure context.

16. The `e2e` step invokes the E2E agent with the proposal and acceptance criteria. The agent produces an evidence artifact. The step passes if the agent exits successfully.

17. The `e2e_verify` step invokes the E2E verifier agent with the proposal and the evidence artifact. The agent outputs a structured JSON verdict. If `e2e_pass` is `true`, the step passes. If `false`, the step fails with the verifier's feedback as failure context.

18. The `signoff` step is a bookkeeping step that marks the workflow as `complete`. No agent is invoked.

19. When any step fails (ci, review, e2e, or e2e_verify), the workflow's iteration counter increments. A new set of steps is created starting from `dev` (plan is skipped on iteration 2+). The dev agent's prompt includes the failure context from the step that failed.

20. When the iteration counter exceeds `max_iters`, the workflow transitions to `failed` with an error message indicating the iteration limit was reached.

21. A cancelled workflow stops executing after its current step completes (or immediately if no step is running). No further steps are started.

### Agent Execution

22. Agent steps (plan, dev, review, e2e, e2e_verify) are executed via pi agent core with the role-specific system prompt, allowed tools, and model. The agent's prompt and response are recorded as a Run in the database.

23. Each agent invocation records: the full prompt sent, the full response received, the process exit code, and the wall-clock duration in seconds.

24. Agent execution respects a configurable timeout per role (default: 300 seconds). If the timeout is exceeded, the agent process is killed and the step fails.

### GitHub Integration

25. After the first `dev` step pushes code, the server creates a GitHub pull request from the workflow's branch to the repo's default branch. The PR number is saved to the workflow's `pr_number` field.

26. The PR title is derived from the task description (first 72 characters). The PR body includes the proposal.

27. On regression iterations, the dev agent pushes additional commits to the same branch; no new PR is created.

28. The `ci` step reads check-run status from the GitHub API for the PR's head SHA.

29. The `review` step reads the PR diff from the GitHub API.

### Real-Time Progress

30. `GET /v1/workflows/:id/events` returns a Server-Sent Events (SSE) stream. Events are emitted when: a step transitions status, the workflow transitions status, or a new run is created. Each event includes the updated resource as JSON.

31. The SSE connection stays open until the workflow reaches a terminal state (complete, failed, cancelled), at which point the server sends a final event and closes the stream.

### CLI Commands

32. `tmpo run --task <text> --repo <owner/repo> [--branch <name>] [--requirements <path>] [--max-iters <n>]` creates a workflow via the API and streams progress to stdout. Each step's status is printed as it transitions. When the workflow completes, the PR URL is printed.

33. `tmpo list` displays a table of the user's workflows showing: ID (short), task (truncated), repo, status, iteration, and age.

34. `tmpo status <workflow-id>` displays the workflow's current state including all steps for the current iteration with their statuses, timing, and detail.

35. `tmpo proposal <workflow-id>` prints the workflow's proposal to stdout.

36. `tmpo logs <workflow-id> [--agent <role>] [--iteration <n>]` prints run logs for the workflow. Without filters, prints all runs. With `--agent`, filters to a specific role. With `--iteration`, filters to a specific iteration.

37. `tmpo cancel <workflow-id>` sends a cancel request and confirms the cancellation.

### Web Client

38. The dashboard page (`/dashboard`) displays a list of the user's workflows in a table. Each row shows: task (truncated), repo, status (with color coding), iteration count, PR link (if exists), and created time. The table is sortable by status and created time. Clicking a row navigates to the workflow detail page.

39. The workflow detail page (`/workflows/:id`) shows: the full task description, the proposal (rendered as markdown), the current status, a step timeline showing each step's status with timing, and expandable run logs for each step. The page updates in real-time via SSE — step transitions and new runs appear without manual refresh.

40. The new workflow page (`/workflows/new`) has a form with fields: task (required textarea), repo (required text input with owner/repo format validation), branch (optional text input), requirements (optional text input), and max iterations (optional number input, default 8). Submitting the form creates the workflow and navigates to the detail page.

41. Workflow status is color-coded throughout the UI: pending (gray), running (blue/animated), complete (green), failed (red), cancelled (yellow).

### Auth & Tenancy

42. All workflow, step, and run endpoints require authentication. Workflows are scoped to the authenticated user — a user cannot see or modify another user's workflows.

## Technical Considerations

- **Agent runtime**: The product brief specifies [pi agent core](https://github.com/badlogic/pi-mono/tree/main/packages/agent) as the runtime for spawning and managing agents. The server should integrate this as a dependency for agent lifecycle management.
- **Database migrations**: New tables should be created via the existing migration system (node-pg-migrate). Migrations should be idempotent and ordered.
- **GitHub API access**: The server needs a GitHub App or personal access token to create PRs, read CI status, and manage comments. The token/app credentials should be configurable via environment variables.
- **SSE implementation**: Use Express response streaming for SSE. The server should maintain a registry of active SSE connections per workflow and fan-out events to all connected clients.
- **Branch naming**: Default branch name should follow the pattern `tmpo/<workflow-id-short>` unless explicitly provided.
- **Failure context propagation**: When a step fails, the relevant context (CI logs, review comments, test output) must be extracted and formatted into the dev agent's prompt for the next iteration. This is the mechanism that makes regressions productive rather than blind retries.
- **Process isolation**: Each agent subprocess should run in its own working directory (a fresh clone or worktree of the target repo) to prevent interference between concurrent workflows.
- **Graceful shutdown**: The server should handle SIGTERM by finishing the current step of any running workflow before shutting down, to avoid orphaned agent processes.
- **Existing patterns**: The server already has a DAO/service/route layering pattern (see user-dao, user-service, auth routes). New workflow/step/run code should follow this same pattern.
- **CLI output**: The Rust CLI already has an `output.rs` module for formatting. New commands should use this for consistent output, supporting both human-readable and `--json` modes.

## Out of Scope

- **Webhook notifications** — The product brief mentions webhook callbacks on state transitions. This is a separate feature that can be added after the core pipeline works.
- **Model and budget overrides** — Per-role configuration of model, budget, and timeout can use hardcoded defaults initially. A configuration system for overrides is a follow-up.
- **Multi-user concurrency** — The engine should handle one workflow at a time initially. A job queue for concurrent execution across users is a follow-up.
- **PR merge** — Tmpo produces a PR ready for human review. Auto-merge is explicitly not included.
- **Billing and usage tracking** — No metering or cost tracking in this phase.
- **Custom agent prompts** — System prompts are hardcoded from the product brief. User-customizable prompts are a follow-up.
- **OAuth scoping for GitHub** — The initial implementation assumes a pre-configured GitHub token. A GitHub App installation flow is a follow-up.
- **Mobile or responsive web design** — The web client targets desktop browsers.
