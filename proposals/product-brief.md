# Product Brief: Cadence

## What is Cadence?

Cadence is an autonomous SDLC pipeline. You give it a task and a repo, and it implements the change, reviews it, validates it end-to-end, and delivers a PR ready for human sign-off. It does this by orchestrating multiple AI agents through a fixed pipeline with feedback loops — if review or E2E fails, it regresses and retries.

Today all of this logic lives in the Rust CLI. The CLI shells out to `claude` subprocesses, manages state as JSON files on disk, and talks to GitHub via `gh`. This works for a single developer on a single machine, but it can't scale beyond that.

## Why move to a server?

Three reasons:

1. **Workflows outlive terminal sessions.** A pipeline run can take 30+ minutes. If your laptop sleeps, your SSH disconnects, or you close the terminal, the workflow dies. The server runs workflows durably — you start one and walk away.

2. **Multiple clients, one source of truth.** The CLI, the web client, mobile notifications, webhooks — they all read from the same place. No more `~/.config/cadence/workflows/*.json` files that only exist on one machine.

3. **Multi-user and multi-repo.** Teams need to see all active workflows, not just their own. The server owns auth, tenancy, and coordination.

The CLI and web client become thin interfaces that create workflows, stream status, and display results. The server does everything else.

## Primitives

Cadence has four core primitives: **Workflows**, **Steps**, **Agents**, and **Runs**.

### Workflow

A Workflow is the top-level unit of work. It represents a single task being implemented against a single repo.

```
Workflow
├── id            uuid
├── task          text              # natural language description
├── repo          text              # owner/repo
├── branch        text              # feature branch (default: dev/<id>)
├── requirements  text | null       # path to requirements file in repo
├── pr_number     integer | null    # GitHub PR, set after first push
├── status        WorkflowStatus
├── iteration     integer           # current iteration (0 = fresh, 1+ = in progress)
├── max_iters     integer           # cap before forced failure
├── error         text | null       # set on failure
├── created_by    uuid              # user who created it
├── created_at    timestamp
├── updated_at    timestamp
```

**WorkflowStatus state machine:**

```
                    ┌─────────────────────────────┐
                    │                             │
                    ▼                             │
pending ──► running ──► complete          cancelled
                │                             ▲
                │                             │
                └──► failed                   │
                       │                      │
                       └──────────────────────┘
                         (can cancel from any
                          non-terminal state)
```

- `pending` — created, queued for execution
- `running` — actively executing steps
- `complete` — all steps passed, PR is ready for human review
- `failed` — hit max iterations or an unrecoverable error
- `cancelled` — cancelled by user

WorkflowStatus is coarse on purpose. The detailed progress lives in Steps.

### Step

A Step is one stage of the pipeline within a workflow iteration. Steps are the unit of progress tracking.

```
Step
├── id            uuid
├── workflow_id   uuid
├── iteration     integer           # which iteration this belongs to
├── kind          StepKind
├── status        StepStatus
├── started_at    timestamp | null
├── finished_at   timestamp | null
├── detail        text | null       # human-readable summary of outcome
```

**StepKind** (the fixed pipeline stages):

```
dev             # implement the task
ci              # wait for GitHub Actions
review          # code review
e2e             # end-to-end validation
e2e_verify      # verify E2E evidence against requirements
signoff         # finalize and mark complete
```

**StepStatus state machine:**

```
pending ──► running ──► passed
                │
                └──► failed ──► (triggers regression to dev)
```

When a Step fails, the Workflow creates a new iteration and a new set of Steps starting from `dev`, carrying the failure context forward as regression context.

An iteration's Steps execute sequentially: `dev → ci → review → e2e → e2e_verify → signoff`. The pipeline never skips a step or runs them out of order.

### Agent

An Agent is a configured AI actor that executes a Step. Each agent role has a fixed identity: system prompt, allowed tools, and default model.

```
Agent (configuration, not a database row)
├── role          AgentRole          # dev | reviewer | e2e | e2e_verifier
├── model         text               # claude model to use
├── budget_usd    float | null       # spend cap per invocation
├── timeout_secs  integer            # max wall-clock time
├── system_prompt text               # role-specific instructions
├── allowed_tools text               # comma-separated tool list
```

**AgentRole → StepKind mapping:**

| AgentRole     | Executes StepKind | Can write code? |
|---------------|-------------------|-----------------|
| dev           | dev               | Yes             |
| reviewer      | review            | No (read-only)  |
| e2e           | e2e               | Yes             |
| e2e_verifier  | e2e_verify        | No (read-only)  |

The `ci` and `signoff` steps don't use agents — `ci` polls GitHub Actions, and `signoff` is bookkeeping.

Agents are not persisted as rows. They are constructed from config at execution time. The config can override model and budget per role.

### Run

A Run is a single agent invocation — one prompt sent, one response received. Runs are the observability primitive. They capture what was said, how long it took, and whether it succeeded.

```
Run
├── id            uuid
├── step_id       uuid
├── workflow_id   uuid
├── agent_role    AgentRole
├── iteration     integer
├── prompt        text
├── response      text | null
├── exit_code     integer | null
├── duration_secs float | null
├── created_at    timestamp
```

A Step may produce multiple Runs (e.g., the dev step does an implementation run and then a PR-update run via `resume_send`). Runs are append-only and immutable.

## State machine: how a Workflow executes

A single workflow iteration looks like this:

```
1. [dev]         Agent implements the task, commits, pushes
2. [ci]          Pipeline polls GHA until pass/fail/timeout
3. [review]      Agent reads PR diff, leaves comments or approves
4. [e2e]         Agent spins up local env, runs real user journeys
5. [e2e_verify]  Agent checks E2E evidence against requirements
6. [signoff]     Pipeline marks workflow complete
```

At any point, a step failure triggers **regression**:

```
ci failed       → new iteration, dev step gets CI failure logs
review failed   → new iteration, dev step gets review comments
e2e failed      → new iteration, dev step gets verifier feedback
```

Regression increments the iteration counter and creates a fresh set of Steps. The dev agent receives the failure context as its prompt, so it knows what to fix. The dev agent's session is preserved across iterations (via `resume_send`) so it retains memory of prior work. Reviewer, E2E, and E2E verifier get fresh sessions each iteration.

If `iteration > max_iters`, the workflow transitions to `failed`.

## How it looks to use

### CLI

```bash
# Start a workflow
cadence run --task "add user profiles with avatar upload" --repo acme/webapp

# Start with a requirements doc
cadence run --task "implement billing" --repo acme/api --requirements docs/billing-spec.md

# Check on it
cadence status a1b2c3d4
cadence list

# Iterate on a completed PR with feedback
cadence run --task "implement billing" --repo acme/api --feedback "the webhook handler needs idempotency"

# View agent logs
cadence logs a1b2c3d4
cadence logs a1b2c3d4 --agent dev

# Cancel
cadence cancel a1b2c3d4
```

The CLI is a thin client. `cadence run` sends a request to the server and streams status updates. `cadence status` and `cadence list` are reads. The CLI does not execute agents or manage state.

### Web client

The web client shows:

- **Dashboard**: list of workflows with status, repo, PR link, iteration count, elapsed time
- **Workflow detail**: step-by-step progress with live updates, expandable agent logs (prompt + response), links to the PR and CI
- **New workflow form**: task, repo, branch, requirements, model overrides

Real-time updates come via SSE or WebSocket — when a step completes or a workflow transitions, the client updates without polling.

### Notifications

The server sends webhook notifications on stage transitions (configurable per-user). The current `notify` config moves to the server. Notifications fire on:

- Workflow started
- Step completed (pass or fail)
- Workflow completed or failed

## Server responsibilities

The server owns:

1. **Workflow lifecycle** — create, execute, cancel, resume
2. **Agent orchestration** — spawn `claude` subprocesses, manage sessions, collect responses
3. **State persistence** — PostgreSQL, not JSON files
4. **GitHub integration** — PR creation, comment management, CI polling
5. **Auth and tenancy** — who can see and control what
6. **Notifications** — webhooks on transitions
7. **Run logging** — every agent invocation is recorded and queryable

The CLI and web client own:

1. **Input** — collecting task, repo, options from the user
2. **Display** — rendering status, logs, progress
3. **Auth flow** — login/logout via Auth0

## What stays the same

The pipeline logic — the stage ordering, regression behavior, prompt construction, and agent roles — is proven and doesn't change conceptually. It moves from Rust to TypeScript on the server, but the state machine is identical.

The `claude` CLI remains the execution engine for agents. The server shells out to it the same way the Rust CLI does today.

## What changes

| Today (CLI) | Future (Server) |
|-------------|-----------------|
| State in `~/.config/cadence/workflows/*.json` | State in PostgreSQL |
| Pipeline runs in the CLI process | Pipeline runs on the server |
| `gh` CLI for GitHub operations | GitHub API via `gh` or direct REST |
| Config in `~/.config/cadence/config.toml` | Config in database + server env |
| Logs discarded (proposal pending) | Runs table captures everything |
| Single user, single machine | Multi-user, durable |
| CLI is the orchestrator | CLI is a thin client |
