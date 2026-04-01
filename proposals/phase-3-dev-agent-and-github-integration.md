# Proposal: Phase 3 — Dev Agent & GitHub Integration

## Summary

Add the dev agent and GitHub PR creation to the pipeline. After this phase, the engine runs plan → dev → creates a PR, and the user gets a link to a real pull request with committed code. This is the first phase that produces a tangible artifact in GitHub — a branch with commits and an open PR. The pipeline still stops after the dev step; CI polling and review come next.

## Acceptance Criteria

### Dev Agent Execution

1. After the plan step passes, the dev step transitions to `running`. `GET /v1/workflows/:id/steps` shows the dev step with status `running` and a non-null `started_at`.

2. When the dev step completes successfully, the workflow's branch exists on the GitHub remote with at least one new commit containing the implementation.

3. After the dev step passes, `GET /v1/workflows/:id/runs` includes a run with `agent_role: "dev"`, a non-null `prompt` (containing the proposal), a non-null `response`, an `exit_code` of 0, and a `duration_secs` value.

4. If the dev agent fails (non-zero exit or timeout), `GET /v1/workflows/:id` shows the workflow with status `failed` and the dev step with status `failed`.

5. After the dev step passes, the engine stops — subsequent steps (ci, review, e2e, e2e_verify, signoff) remain `pending`.

### GitHub Pull Request

6. After the first dev step pushes code, `GET /v1/workflows/:id` returns a non-null `pr_number`. The corresponding GitHub PR exists, is open, targets the repo's default branch, and has the workflow's branch as the head.

7. The PR title is derived from the task description (first 72 characters). The PR body includes the full proposal text.

8. The server uses the authenticated user's stored GitHub token (from Phase 1 settings) for repo cloning, pushing, and PR creation.

### CLI

9. When the dev step completes and a PR is created, `cadence run` prints the PR URL to stdout.

10. `cadence status <workflow-id>` shows the PR number and URL when a PR exists.

### Web Client

11. The workflow detail page shows a clickable PR link when a PR has been created.

12. The dashboard table includes a PR link column for workflows that have a PR.

## Technical Considerations

- **Process isolation**: Each dev agent subprocess should run in its own working directory (a fresh clone of the target repo) to prevent interference between concurrent workflows. The clone should be cleaned up after the step completes. The dev agent uses read-write tools (Bash, Edit, Read, Write, Glob, Grep).
- **Branch naming**: The workflow's branch field (defaulting to `cadence/<short-id>`) is used as the target branch for the dev agent's pushes and the PR's head branch.
- **Git authentication**: The clone and push operations use the user's stored GitHub token. This can be injected via the `GIT_ASKPASS` mechanism or by configuring the clone URL with the token.
- **PR creation**: Use the GitHub REST API (or Octokit) to create the PR. The server should handle the case where the branch doesn't exist on the remote yet (the dev agent creates it by pushing).
- **Failure context propagation**: When the dev step fails, capture the agent's output as failure context. This context will be used in Phase 4 when regression iterations are implemented.

## Out of Scope

- **CI polling** — The pipeline stops after the dev step. Checking GitHub Actions is Phase 4.
- **Code review** — The review agent is Phase 4.
- **Regression iterations** — The iteration loop (dev → fail → dev with context) is Phase 4. This phase only handles the first iteration's dev step.
- **E2E testing** — E2E agent and verifier are Phase 5.
- **PR comments or inline feedback** — Review comments are Phase 4.
