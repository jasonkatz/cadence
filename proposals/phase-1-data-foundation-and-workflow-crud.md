# Proposal: Phase 1 — Data Foundation & Workflow CRUD

## Summary

Establish user configuration and basic CRUD operations for workflows, steps, and runs. After this phase, a user can configure their GitHub token, create a workflow via the API or CLI, list their workflows, check status, and cancel — and see their workflows on the web dashboard. No agents execute yet; workflows stay in `pending` status. This phase validates the full vertical: API endpoints, CLI commands, and web UI all working together against persisted data.

## Acceptance Criteria

### Settings

1. `PUT /v1/settings` with `{ "github_token": "ghp_abc123" }` returns 200 with the token masked in the response (e.g., `"github_token": "ghp_****c123"`). Calling `GET /v1/settings` afterward returns the same masked value. The raw token is never returned by the API.

2. `GET /v1/settings` for a user who has never configured settings returns 200 with `{ "github_token": null }`.

3. Settings are scoped to the authenticated user — one user's `GET /v1/settings` does not return another user's token.

### Workflow Creation

4. `POST /v1/workflows` with `{ "task": "add login page", "repo": "acme/webapp" }` returns 201 with a JSON body containing: `id` (uuid), `task`, `repo`, `branch` (auto-generated as `tmpo/<short-id>`), `status` ("pending"), `iteration` (0), `max_iters` (8), `created_at`, and `updated_at`. Fields `requirements`, `proposal`, `pr_number`, and `error` are null.

5. `POST /v1/workflows` with an explicit `branch`, `requirements`, and `max_iters` returns those values in the response instead of defaults.

6. `POST /v1/workflows` returns 400 if the authenticated user has not configured a GitHub token.

7. `POST /v1/workflows` returns 400 if `task` or `repo` is missing.

### Workflow Listing & Detail

8. `GET /v1/workflows` returns a list of workflows belonging to the authenticated user, ordered by `created_at` descending. Each item includes `id`, `task`, `repo`, `branch`, `status`, `iteration`, `pr_number`, `created_at`, and `updated_at`.

9. `GET /v1/workflows?status=pending` returns only workflows with that status.

10. `GET /v1/workflows` does not return workflows created by other users.

11. `GET /v1/workflows/:id` returns the full workflow object including a `steps` array for the latest iteration. Returns 404 for a non-existent ID or another user's workflow.

12. `GET /v1/workflows/:id/steps` returns all steps for the workflow ordered by iteration and step type. Each step includes `id`, `workflow_id`, `iteration`, `type`, `status`, `started_at`, `finished_at`, and `detail`. Supports `?iteration=` filter.

13. `GET /v1/workflows/:id/runs` returns all runs for the workflow ordered by `created_at`. Each run includes `id`, `step_id`, `workflow_id`, `agent_role`, `iteration`, `prompt`, `response`, `exit_code`, `duration_secs`, and `created_at`. Supports `?agent_role=` and `?iteration=` filters.

### Workflow Cancellation

14. `POST /v1/workflows/:id/cancel` on a workflow with status `pending` returns 200 and the workflow's status becomes `cancelled`. Subsequent `GET /v1/workflows/:id` confirms the status.

15. `POST /v1/workflows/:id/cancel` on a workflow with status `complete`, `failed`, or `cancelled` returns 409.

### CLI: Configuration

16. `tmpo config set github-token <value>` prints a confirmation with the masked token (e.g., "GitHub token saved: ghp_****c123"). Running `tmpo config get` afterward shows the masked token.

17. `tmpo config get` with no token configured prints a message indicating no GitHub token is set. Supports `--json` for structured output.

### CLI: Workflow Commands

18. `tmpo run --task "add login" --repo acme/webapp` prints the created workflow ID and status ("pending"). If no GitHub token is configured, prints an error directing the user to `tmpo config set github-token`.

19. `tmpo list` prints a table with columns: ID (first 8 chars), Task (truncated to ~50 chars), Repo, Status, Iteration, and Age (e.g., "2m ago"). Supports `--json`.

20. `tmpo status <workflow-id>` prints the workflow's status, task, repo, branch, iteration, and a table of steps for the current iteration showing type, status, and timing. Supports `--json`.

21. `tmpo cancel <workflow-id>` prints a confirmation that the workflow was cancelled.

### Web Client

22. The dashboard page (`/dashboard`) displays the user's workflows in a table with columns: Task (truncated), Repo, Status (color-coded), Iteration, and Created. Clicking a row navigates to `/workflows/:id`.

23. Workflow status is color-coded: pending (gray), running (blue), complete (green), failed (red), cancelled (yellow).

24. A settings page (`/settings`) has a form for the GitHub PAT — a password input showing the masked value when a token exists, a save button, and success/error feedback after save. The navigation includes a link to the settings page.

### Auth & Tenancy

25. All endpoints under `/v1/` require a valid bearer token. Requests without a token or with an expired token return 401.

26. A user cannot read, modify, or cancel another user's workflows. Attempting to access another user's workflow returns 404.

## Technical Considerations

- **Database migrations**: New tables (workflows, steps, runs, user_settings) should be created via the existing node-pg-migrate migration system. The workflows table needs a foreign key to the existing users table.
- **Token encryption**: The GitHub PAT must be encrypted at rest in the database. Use AES-256-GCM with a server-side encryption key configured via environment variable (`ENCRYPTION_KEY`). The key should be required in production and can default to a dev-only value in development.
- **Existing patterns**: The server already has a DAO/service/route layering pattern (see user-dao, user-service, auth routes). New code should follow this same pattern.
- **CLI output**: The Rust CLI already has an `output.rs` module for formatting. New commands should use this for consistent output, supporting both human-readable and `--json` modes.
- **Branch naming**: Default branch name should follow the pattern `tmpo/<workflow-id-short>` unless explicitly provided.
- **Pagination**: The `GET /v1/workflows` endpoint should support cursor-based or offset pagination from the start to avoid breaking changes later.
- **OpenAPI schema**: The `schema.yaml` should be updated with the new endpoints and response shapes.

## Out of Scope

- **Workflow execution** — Workflows are created in `pending` status and stay there. The engine that picks up and runs workflows is Phase 2.
- **Real-time updates (SSE)** — No streaming endpoint yet. The CLI `run` command returns after creation.
- **GitHub integration** — No PR creation, CI polling, or diff reading. The GitHub token is stored but not used until Phase 3.
- **Agent execution** — No agents are invoked.
- **Workflow detail page** — The web client shows a list; the full detail page with step timeline is Phase 2.
- **`tmpo proposal` and `tmpo logs` commands** — These depend on data that doesn't exist until agents run.
- **GitHub App OAuth flow** — Users provide a PAT directly. A GitHub App installation flow for more granular permissions is a follow-up.
