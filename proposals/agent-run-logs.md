# Proposal: Agent Run Logs

## Context

`tmpo run` orchestrates multiple agents (dev, reviewer, e2e,
e2e-verifier) through a pipeline. Each agent is a `claude` CLI
invocation that produces stdout/stderr. Today, agent responses are
consumed by the pipeline and discarded after use — there is no way to
inspect what an agent said or how long it took after the fact.

The existing `tmpo run --help` shows no logging-related flags:

```
Usage: tmpo run [OPTIONS] --task <TASK> --repo <REPO>

Options:
  -t, --task <TASK>
  -r, --repo <REPO>
      --repo-dir <REPO_DIR>
  -b, --branch <BRANCH>
      --requirements <REQUIREMENTS>
      --max-iters <MAX_ITERS>
      --model <MODEL>
      --feedback <FEEDBACK>
```

Workflow state is persisted to `~/.config/tmpo/workflows/{id}.json`
but contains only stage transitions and metadata — not agent
prompt/response content.

## Goal

Store each agent's interactions as a JSONL file (one file per agent per
workflow run) so users can:

1. View logs for a specific agent within a workflow
2. View all logs for an entire workflow, interleaved chronologically

## Design

### Log storage

Logs live alongside workflow state under the tmpo config directory:

```
~/.config/tmpo/logs/{workflow_id}/
  dev.jsonl
  reviewer.jsonl
  e2e.jsonl
  e2e-verifier.jsonl
```

Each line is a self-contained JSON object:

```json
{
  "timestamp": "2026-03-27T14:32:01Z",
  "workflow_id": "a1b2c3d4",
  "agent": "dev",
  "iteration": 1,
  "prompt": "Implement the login endpoint...",
  "response": "I'll start by creating...",
  "exit_code": 0,
  "duration_secs": 142.3
}
```

JSONL is chosen because:
- Append-only writes (no read-modify-write of a growing file)
- Each line is independently parseable (resilient to crashes mid-write)
- Easy to stream/pipe with standard tools (`jq`, `grep`, `wc -l`)

### New CLI command: `tmpo logs`

```
View agent run logs for a workflow

Usage: tmpo logs [OPTIONS] <WORKFLOW_ID>

Arguments:
  <WORKFLOW_ID>  Workflow ID

Options:
  -a, --agent <AGENT>  Filter by agent (dev, reviewer, e2e, e2e-verifier)
      --raw            Output as raw JSONL instead of formatted text
  -h, --help           Print help
```

Examples:

```bash
# All logs for a workflow, ordered by timestamp
tmpo logs a1b2c3d4

# Just the dev agent's logs
tmpo logs a1b2c3d4 --agent dev

# Raw JSONL for piping into jq
tmpo logs a1b2c3d4 --raw | jq '.duration_secs'
```

Formatted output (default) shows a human-readable view:

```
[2026-03-27 14:32:01 UTC] agent=dev iteration=1 exit_code=0 duration=142.3s

Prompt:
  Implement the login endpoint...

Response:
  I'll start by creating...

------------------------------------------------------------------------
[2026-03-27 14:35:22 UTC] agent=reviewer iteration=1 exit_code=0 duration=87.1s
...
```

### Write path

Logging happens inside `ClaudeAgent` after each `send()` call. The agent already captures stdout and exit code;
we add:

- A `std::time::Instant` before the subprocess spawns to measure
  wall-clock duration
- A `write_log()` method that serializes a `LogEntry` and appends it to
  the appropriate JSONL file
- `workflow_id` and `iteration` fields on `ClaudeAgent` (passed from
  `make_agent()` in the pipeline runner, which already has access to
  `WorkflowState`)

Failed invocations (non-zero exit with empty stdout) are also logged
with stderr as the response, so users can diagnose agent crashes.

Logging failures (e.g., disk full) print a warning to stderr but do not
abort the pipeline.

### Files changed

| File | Change |
|------|--------|
| `cli/src/logs.rs` | **New.** `LogEntry` struct, `append_log()`, `read_agent_logs()`, `read_workflow_logs()`, `list_agents_with_logs()` |
| `cli/src/commands/logs.rs` | **New.** `LogsArgs`, `run()` handler, formatted + raw output |
| `cli/src/commands/mod.rs` | Add `pub mod logs` |
| `cli/src/main.rs` | Register `Logs` variant in `Commands` enum, wire to handler |
| `cli/src/agent/claude.rs` | Add `workflow_id` and `iteration` fields to `ClaudeAgent`. Add timing + `write_log()` to `send()` |
| `cli/src/pipeline/runner.rs` | Pass `state.id` and `state.iteration` through `make_agent()` to `ClaudeAgent::new()` |

### What this does NOT include

- Log rotation or cleanup (logs accumulate until the user deletes them
  or the workflow directory is removed)
- Streaming/tailing logs from a running workflow (read-after-complete
  only)
- Changes to `tmpo run` flags (logging is always on, zero config)
