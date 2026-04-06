# Proposal: Phase 6 — Run Logs & Web Client Completion

## Summary

Add observability and the remaining web client features. After this phase, users have full visibility into what every agent did via the `tmpo logs` command and expandable run logs in the web UI, and can create new workflows directly from the web client. This phase rounds out the user experience without changing the pipeline's behavior.

## Acceptance Criteria

### CLI: Run Logs

1. `tmpo logs <workflow-id>` prints all runs for the workflow ordered by `created_at`, showing: timestamp, agent role, iteration, exit code, duration, and the prompt and response content.

2. `tmpo logs <workflow-id> --agent <role>` filters to a specific agent role (planner, dev, reviewer, e2e, e2e_verifier).

3. `tmpo logs <workflow-id> --iteration <n>` filters to a specific iteration.

4. `tmpo logs` supports `--json` for structured output, consistent with other CLI commands.

### Web Client: Run Logs

5. The workflow detail page includes expandable run logs for each step. Clicking a step reveals the agent's prompt and response for that step's runs.

6. Run logs display the agent role, iteration, exit code, duration, and the full prompt and response content. Long content is scrollable.

### Web Client: New Workflow Form

7. The new workflow page (`/workflows/new`) has a form with fields: task (required textarea), repo (required text input with `owner/repo` format validation), branch (optional text input), requirements (optional text input), and max iterations (optional number input, default 8). Submitting the form creates the workflow and navigates to the detail page.

8. The dashboard page has a "New Workflow" button that navigates to the new workflow form.

### Web Client: Dashboard Polish

9. The dashboard table is sortable by status and created time.

10. The dashboard table shows a PR link column (clickable) for workflows that have a PR number.

11. The dashboard auto-refreshes to show new workflows and status changes (via polling or SSE).

## Technical Considerations

- **Run log size**: Agent prompts and responses can be large (especially dev agent responses with full code). The web UI should handle large text gracefully — use virtualized scrolling or truncation with "show full" expansion.
- **CLI formatting**: The `tmpo logs` command should use the existing `output.rs` module. The formatted output should be readable in a terminal — consider truncating very long prompts/responses with a `--full` flag to show everything.
- **Form validation**: The repo field should validate `owner/repo` format client-side before submitting. The server already validates on `POST /v1/workflows`.
- **API reuse**: The `GET /v1/workflows/:id/runs` endpoint from Phase 1 provides all the data needed for run logs. No new endpoints are required.

## Out of Scope

- **Webhook notifications** — The product brief mentions webhook callbacks on state transitions. This is a separate feature.
- **Model and budget overrides** — Per-role configuration in the new workflow form is a follow-up.
- **Mobile or responsive web design** — The web client targets desktop browsers.
- **Log streaming from running agents** — Logs are viewable after a run completes, not during execution.
- **OAuth scoping for GitHub** — The initial implementation assumes a pre-configured GitHub token. A GitHub App installation flow is a follow-up.
