# Proposal: Phase 5 — E2E Verification & Signoff

## Summary

Add the E2E agent, E2E verifier, and signoff step to complete the full pipeline. After this phase, Cadence runs the entire sequence: plan → dev → CI → review → E2E → E2E verify → signoff. A workflow that passes all stages transitions to `complete`, and the PR is ready for human review. Failures in E2E or verification trigger regression back to dev, just like CI and review failures. This is the phase where Cadence delivers its full value proposition: a verified pull request.

## Acceptance Criteria

### E2E Agent

1. After the review step passes, the e2e step transitions to `running`. The E2E agent sets up a local environment, runs real user journeys against the implementation, and produces an evidence artifact. If the agent exits successfully, the step transitions to `passed`.

2. After the e2e step runs, `GET /v1/workflows/:id/runs` includes a run with `agent_role: "e2e"` containing the evidence output in the `response` field.

3. The E2E agent posts its evidence as a comment on the workflow's GitHub PR.

### E2E Verifier

4. After the e2e step passes, the e2e_verify step transitions to `running`. The verifier evaluates the evidence artifact against the proposal's acceptance criteria and outputs a structured JSON verdict. If `e2e_pass` is `true`, the step transitions to `passed`. If `false`, the step transitions to `failed` with a `detail` containing the verifier's feedback — which criteria passed, failed, or had missing evidence.

5. After the e2e_verify step runs, `GET /v1/workflows/:id/runs` includes a run with `agent_role: "e2e_verifier"` containing the structured verdict in the `response` field.

### Signoff

6. After the e2e_verify step passes, the signoff step transitions directly to `passed`. `GET /v1/workflows/:id` then shows the workflow with status `complete`. No agent is invoked for signoff.

### Regression from E2E Failures

7. When the e2e step fails, `GET /v1/workflows/:id` shows `iteration` incremented and new steps starting from `dev`. The new dev run's `prompt` includes the E2E failure output as context.

8. When the e2e_verify step fails, the same regression occurs. The new dev run's `prompt` includes the verifier's specific feedback — which criteria failed and what evidence was missing — so the dev agent knows what behavior to fix.

### CLI

9. When a workflow reaches `complete`, `cadence run` prints the PR URL and a confirmation that all stages passed. On `failed` after max iterations, it prints the last failure context and which step caused the final failure.

### Web Client

10. The workflow detail page shows all seven step types (plan through signoff) with their statuses and timing for each iteration.

11. When a workflow reaches `complete`, the detail page shows a success state with the PR link prominently displayed.

## Technical Considerations

- **E2E environment**: The E2E agent needs to set up a running local environment of the target project. This requires the cloned repo and the ability to run build/start commands. The agent's working directory should be the same clone used by the dev agent (or a fresh one with the latest branch state). The E2E agent uses read-write tools (Bash, Edit, Read, Write, Glob, Grep). The E2E verifier uses read-only tools (Bash, Read, Glob, Grep).
- **Evidence artifact passing**: The E2E agent produces an evidence artifact (via showboat). The verifier needs access to this. The simplest approach is to pass the E2E run's response as input to the verifier's prompt.
- **E2E tools**: The E2E system prompt references `uvx showboat` and `uvx rodney`. These tools need to be available in the agent's environment. Ensure the server's agent execution environment has `uvx` available.
- **Timeout considerations**: E2E steps may take longer than planning or review. The timeout should be configurable per role, with a higher default for E2E (e.g., 600 seconds).
- **Full regression coverage**: With this phase, all four failure-triggering steps (ci, review, e2e, e2e_verify) can cause regression. The failure context format should be consistent so the dev agent can handle any type of feedback.

## Out of Scope

- **Auto-merge** — Cadence produces a PR ready for human review. Auto-merge is explicitly not included.
- **Custom agent prompts** — System prompts are hardcoded from the product brief. User-customizable prompts are a follow-up.
- **Billing and usage tracking** — No metering or cost tracking.
- **Concurrent workflow execution** — Still one workflow at a time. A job queue is a follow-up.
