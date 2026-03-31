# Proposal: Phase 1 — Data Foundation & Workflow CRUD

## Summary

Establish the data model, user configuration, and basic CRUD operations for workflows, steps, and runs. After this phase, a user can configure their GitHub token, create a workflow via the API or CLI, list their workflows, check status, and cancel — and see their workflows on the web dashboard. No agents execute yet; workflows stay in `pending` status. This phase validates the full vertical: database schema, API endpoints, CLI commands, and web UI all working together against real data.

## Acceptance Criteria

### Database & Data Model

1. A `workflows` table exists in PostgreSQL with columns: `id` (uuid PK), `task` (text, not null), `repo` (text, not null), `branch` (text, not null), `requirements` (text, nullable), `proposal` (text, nullable), `pr_number` (integer, nullable), `status` (text, not null, one of: pending/running/complete/failed/cancelled), `iteration` (integer, not null, default 0), `max_iters` (integer, not null, default 8), `error` (text, nullable), `created_by` (uuid FK to users, not null), `created_at` (timestamptz, default now()), `updated_at` (timestamptz, default now()).

2. A `steps` table exists with columns: `id` (uuid PK), `workflow_id` (uuid FK to workflows, not null), `iteration` (integer, not null), `type` (text, not null, one of: plan/dev/ci/review/e2e/e2e_verify/signoff), `status` (text, not null, one of: pending/running/passed/failed), `started_at` (timestamptz, nullable), `finished_at` (timestamptz, nullable), `detail` (text, nullable).

3. A `runs` table exists with columns: `id` (uuid PK), `step_id` (uuid FK to steps, not null), `workflow_id` (uuid FK to workflows, not null), `agent_role` (text, not null), `iteration` (integer, not null), `prompt` (text, not null), `response` (text, nullable), `exit_code` (integer, nullable), `duration_secs` (numeric, nullable), `created_at` (timestamptz, default now()).

4. A `user_settings` table exists with columns: `user_id` (uuid PK, FK to users), `github_token` (text, nullable, encrypted at rest), `updated_at` (timestamptz, default now()). One row per user, created on first settings update.

### Settings API

5. `PUT /v1/settings` accepts `{ github_token? }` and creates or updates the authenticated user's settings. Sensitive fields are stored encrypted. Returns 200 with the settings object (tokens are masked in the response, e.g., `ghp_****xxxx`).

6. `GET /v1/settings` returns the authenticated user's settings with sensitive fields masked. Returns a default (empty) settings object if the user has not configured settings yet.

### Workflow API

7. `POST /v1/workflows` accepts `{ task, repo, branch?, requirements?, max_iters? }` and returns a 201 with the created workflow (status: pending, iteration: 0). The workflow is scoped to the authenticated user. If `branch` is not provided, it defaults to `cadence/<short-id>`. Returns 400 if the user has not configured a GitHub token.

8. `GET /v1/workflows` returns a paginated list of workflows belonging to the authenticated user, ordered by `created_at` descending. Supports `?status=` filter.

9. `GET /v1/workflows/:id` returns the full workflow object including its current steps (for the latest iteration). Returns 404 if the workflow doesn't exist or doesn't belong to the user.

10. `POST /v1/workflows/:id/cancel` transitions the workflow to `cancelled` if it is in a non-terminal state (pending or running). Returns 409 if already terminal.

11. `GET /v1/workflows/:id/steps` returns all steps for the workflow, ordered by iteration and step type. Supports `?iteration=` filter.

12. `GET /v1/workflows/:id/runs` returns all runs for the workflow, ordered by `created_at`. Supports `?agent_role=` and `?iteration=` filters.

### CLI Commands

13. `cadence config set github-token <value>` saves the user's GitHub PAT to the server via the settings API. The token is validated with a basic format check before sending. On success, prints a confirmation with the masked token.

14. `cadence config get` displays the user's current configuration (GitHub token masked, settings status). Supports `--json` for structured output.

15. `cadence run --task <text> --repo <owner/repo> [--branch <name>] [--requirements <path>] [--max-iters <n>]` creates a workflow via the API and prints the workflow ID and status. The command returns immediately after creation (no streaming yet). If no GitHub token is configured, prints an error directing the user to run `cadence config set github-token`.

16. `cadence list` displays a table of the user's workflows showing: ID (short), task (truncated), repo, status, iteration, and age.

17. `cadence status <workflow-id>` displays the workflow's current state including all steps for the current iteration with their statuses and timing.

18. `cadence cancel <workflow-id>` sends a cancel request and confirms the cancellation.

### Web Client

19. The dashboard page (`/dashboard`) displays a list of the user's workflows in a table. Each row shows: task (truncated), repo, status (with color coding), iteration count, and created time. Clicking a row navigates to the workflow detail page.

20. Workflow status is color-coded throughout the UI: pending (gray), running (blue), complete (green), failed (red), cancelled (yellow).

21. A settings page (`/settings`) allows the user to configure their GitHub PAT via a form. The token field is a password input that shows the masked value when a token exists. A "Save" button calls the settings API. A success/error message is shown after save.

22. The navigation includes a link to the settings page.

### Auth & Tenancy

23. All workflow, step, run, and settings endpoints require authentication. Workflows are scoped to the authenticated user — a user cannot see or modify another user's workflows or settings.

## Technical Considerations

- **Database migrations**: New tables should be created via the existing migration system (node-pg-migrate). Migrations should be idempotent and ordered. The workflows table needs a foreign key to the existing users table.
- **Token encryption**: The GitHub PAT must be encrypted at rest in the database. Use AES-256-GCM with a server-side encryption key configured via environment variable (`ENCRYPTION_KEY`). The key should be required in production and can default to a dev-only value in development.
- **Existing patterns**: The server already has a DAO/service/route layering pattern (see user-dao, user-service, auth routes). New workflow/step/run/settings code should follow this same pattern.
- **CLI output**: The Rust CLI already has an `output.rs` module for formatting. New commands should use this for consistent output, supporting both human-readable and `--json` modes.
- **Branch naming**: Default branch name should follow the pattern `cadence/<workflow-id-short>` unless explicitly provided.
- **Pagination**: The `GET /v1/workflows` endpoint should support cursor-based or offset pagination from the start to avoid breaking changes later.
- **OpenAPI schema**: The `schema.yaml` should be updated with the new endpoints and types.
- **Settings extensibility**: The `user_settings` table and API should be designed so new fields (e.g., default model, notification preferences) can be added later without breaking changes.

## Out of Scope

- **Workflow execution** — Workflows are created in `pending` status and stay there. The engine that picks up and runs workflows is Phase 2.
- **Real-time updates (SSE)** — No streaming endpoint yet. The CLI `run` command returns after creation.
- **GitHub integration** — No PR creation, CI polling, or diff reading. The GitHub token is stored but not used until Phase 3.
- **Agent execution** — No agents are invoked.
- **Workflow detail page** — The web client shows a list only; the full detail page with step timeline is Phase 2.
- **`cadence proposal` and `cadence logs` commands** — These depend on data that doesn't exist until agents run.
- **GitHub App OAuth flow** — Users provide a PAT directly. A GitHub App installation flow for more granular permissions is a follow-up.
