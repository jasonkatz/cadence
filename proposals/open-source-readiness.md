# Open Source Readiness Plan

Make tmpo a local-first tool that anyone can install and run on their machine in minutes. Each phase is independently shippable.

Phases 1 and 2 (auth simplification, Docker-based self-hosted deployment) are complete and served as stepping stones. The plan below supersedes the remaining phases with a new direction: **local-first, single-binary, no external dependencies.**

---

## Design Principles

1. **Zero infrastructure.** No Postgres, no Docker, no managed services. Clone/install, run.
2. **Single-user by default.** No user model, no auth. It's your machine, it's your data.
3. **Files over databases for logs.** Agent run logs are JSONL on disk, greppable and streamable. Structured data (workflows, steps) lives in SQLite.
4. **Daemon + CLI architecture.** Like Docker: a CLI that talks to a local daemon over a unix socket. The daemon is the engine; the CLI is the interface.
5. **Web UI is optional but included.** `tmpo ui` opens a dashboard in your browser against the local daemon. Not required for core usage.

---

## Architecture Overview

```
~/.tmpo/
  tmpod.sock              # unix socket (daemon <-> CLI)
  tmpo.db                 # SQLite (workflows, steps, settings)
  config.toml             # user config (github token, preferences)
  runs/
    {workflow_id}/
      plan-0.jsonl        # agent run logs per step per iteration
      dev-0.jsonl
      dev-1.jsonl
      ...
```

```
tmpo (CLI, Rust)
  │
  ├── tmpo run --task "..." --repo org/repo
  ├── tmpo list / status / cancel / logs / proposal
  ├── tmpo config set github-token <token>
  ├── tmpo daemon start|stop|status
  └── tmpo ui
        │
        │  HTTP (unix socket or localhost:7070)
        ▼
tmpod (daemon, Bun/TypeScript)
  │
  ├── REST API (/v1/...) over unix socket
  │     └── also binds localhost:PORT when web UI is active
  ├── workflow engine (in-process job queue)
  ├── agent executor (claude CLI subprocess)
  ├── SQLite (better-sqlite3)
  └── file I/O (JSONL run logs)
        │
        ▼
Web UI (React/Vite, static bundle)
  └── served by daemon at localhost:PORT
      talks to same /v1/ REST API
```

### Why REST over Unix Socket

The daemon speaks plain HTTP/REST over `~/.tmpo/tmpod.sock`. This gives us:

- **Reuse.** The existing `/v1/` route design carries over nearly unchanged.
- **Web UI compatibility.** When `tmpo ui` activates a TCP listener, the browser hits the same endpoints.
- **Debuggability.** `curl --unix-socket ~/.tmpo/tmpod.sock http://d/v1/workflows` just works.
- **SSE still works.** Event streaming over HTTP is the same on a socket as on TCP.

The daemon has two listeners:
1. **Always on:** unix socket at `~/.tmpo/tmpod.sock` (CLI, scripts, automation)
2. **On demand:** TCP `localhost:7070` when web UI is active or explicitly requested

No TCP port is exposed by default (good security posture for a local tool).

### Why Keep TypeScript for the Daemon

- All engine/agent/service logic already exists in TypeScript.
- The SQLite swap (pg -> better-sqlite3) is mechanical, not a rewrite.
- Bun compiles to a single executable (`bun build --compile`) — distributable without a runtime.
- The Rust CLI talks to the daemon over REST — clean process boundary.
- Ships faster than a full Rust rewrite.

A Rust rewrite of the daemon can happen later if bundle size or startup time becomes a concern.

---

## Phase 3: Local Storage

Drop Postgres. Drop the user model. Store everything locally.

### Goals

- No external database dependency
- All data lives under `~/.tmpo/`
- Agent logs are files, not database blobs

### Work

- Replace `pg` with `better-sqlite3`
  - Single file database at `~/.tmpo/tmpo.db`
  - Embed migrations in source, run on startup
  - Daemon is the single writer — no concurrency issues
- New schema (no `users` or `user_settings` tables):
  - `workflows` — same columns minus `created_by`
  - `steps` — unchanged
  - `runs` — lightweight index only: `id`, `step_id`, `workflow_id`, `agent_role`, `iteration`, `log_path`, `exit_code`, `duration_secs`, `created_at`
    - Full prompt/response content lives in the JSONL file at `log_path`
- Replace pg-boss with in-process job queue
  - Simple queue: run steps sequentially per workflow, concurrently across workflows
  - On startup, recover interrupted workflows from SQLite (mark incomplete steps as failed, re-enqueue from last good state)
- Move settings to `~/.tmpo/config.toml`
  - `github_token` (stored encrypted or via OS keychain)
  - `default_repo` (optional)
  - `max_iterations` (default: 8)
  - `log_level` (default: info)
- Agent run logs written to `~/.tmpo/runs/{workflow_id}/{step_type}-{iteration}.jsonl`
  - Each line: `{"ts": "...", "event": "prompt|response|tool_call|error", "data": {...}}`
  - `tmpo logs <workflow_id>` streams these files

### Acceptance Criteria

- `tmpo run` works with zero setup beyond having `claude` CLI installed
- No Postgres process anywhere in the dependency chain
- `ls ~/.tmpo/` shows the database, config, and run logs
- Existing test patterns (DI, factory functions) still work against SQLite DAOs

---

## Phase 4: Daemon Mode

Turn the server into a background daemon that the CLI manages.

### Goals

- CLI commands start the daemon automatically if not running
- Daemon lifecycle is explicit and predictable
- Web UI is one command away

### Work

- Daemon socket listener
  - Listen on `~/.tmpo/tmpod.sock` for HTTP requests
  - Write PID to `~/.tmpo/tmpod.pid` for lifecycle management
  - Optionally bind TCP `localhost:<port>` when requested
- CLI daemon management
  - `tmpo daemon start` — start daemon in background (fork/detach)
  - `tmpo daemon stop` — graceful shutdown via socket command
  - `tmpo daemon status` — check if running, show PID and uptime
  - Auto-start: if CLI detects no socket/daemon, start one automatically before proceeding
- `tmpo ui`
  - Tell daemon to enable TCP listener and serve static web bundle
  - Open browser to `http://localhost:7070`
  - Web client is the existing React app, repointed at local API
- Graceful shutdown
  - On SIGTERM/SIGINT: finish current agent step, persist state, close socket, exit
  - On next startup: detect incomplete workflows, mark interrupted steps as failed, optionally resume
- Bun single-binary compilation
  - `bun build --compile` produces one executable for the daemon
  - Embed SQLite migrations and static web assets in the binary

### Acceptance Criteria

- `tmpo run` with no daemon running auto-starts one, runs the workflow, streams output
- `tmpo daemon stop` cleanly shuts down mid-workflow without data loss
- `tmpo ui` opens a working dashboard in the browser
- Daemon restarts recover state from SQLite

---

## Phase 5: Distribution

Make installation trivial on macOS and Linux.

### Goals

- Install in one command via package manager
- Or download a prebuilt binary from GitHub Releases
- Or build from source with standard toolchains

### Work

- GitHub Releases automation
  - CI builds on tag push (e.g. `v0.1.0`)
  - Produce artifacts:
    - `tmpo-darwin-arm64` (CLI)
    - `tmpo-darwin-x64` (CLI)
    - `tmpo-linux-x64` (CLI)
    - `tmpo-linux-arm64` (CLI)
    - `tmpod-darwin-arm64` (daemon)
    - `tmpod-darwin-x64` (daemon)
    - `tmpod-linux-x64` (daemon)
    - `tmpod-linux-arm64` (daemon)
  - Checksum file (`SHA256SUMS`) and signing
- Homebrew
  - `brew tap jasonkatz/tap && brew install tmpo`
  - Formula installs both CLI and daemon binaries
  - Optionally: `brew services start tmpo` for launchd integration
- Build from source docs
  - Prerequisites: Rust toolchain, Bun, Node (for client build)
  - `make build` produces both binaries
  - `make install` copies to `/usr/local/bin/`
- `tmpo doctor`
  - Check: `claude` CLI installed and accessible
  - Check: daemon binary found on PATH
  - Check: `~/.tmpo/` directory writable
  - Check: config.toml valid (if exists)
  - Check: GitHub token configured (warn if not)
  - Print versions of all components

### Acceptance Criteria

- `brew install tmpo && tmpo doctor && tmpo run --task "..." --repo org/repo` works end to end
- GitHub Release page has downloadable binaries for all supported platforms
- `make build` from a fresh clone produces working binaries
- `tmpo doctor` catches all common misconfigurations with actionable messages

---

## Phase 6: Documentation & Community

Make the repo welcoming and self-explanatory.

### Goals

- New user: install to first workflow in under 5 minutes
- New contributor: clone to running tests in one page of instructions

### Work

- Rewrite `README.md`
  - One-line description: what tmpo does
  - 30-second install (brew or binary download)
  - Quickstart: `tmpo config set github-token <token> && tmpo run --task "..." --repo org/repo`
  - Architecture diagram (CLI -> daemon -> agents)
  - Link to proposals/ for roadmap
- Add `CONTRIBUTING.md`
  - Dev setup: clone, install deps, `make dev`
  - Test: `make test`
  - Branch/PR conventions
  - Where to find work (issues, proposals/)
- GitHub issue templates (bug report, feature request)
- PR template with checklist
- `LICENSE` (MIT or Apache-2.0)

### Acceptance Criteria

- README quickstart works as written on a fresh macOS machine
- New contributor can run tests within 10 minutes of cloning

---

## Future Work (not blocking OSS launch)

These are valuable but explicitly deferred:

- **Agent backend flexibility** — support direct Anthropic API calls as an alternative to `claude` CLI subprocess. Useful but adds complexity; CLI-only is fine for launch.
- **Windows native support** — named pipes instead of unix sockets, `.exe` builds. WSL works in the meantime.
- **Multi-user / hosted mode** — re-introduce auth, Postgres, and user isolation for a hosted offering. The Docker Compose setup from Phase 2 continues to work for this path.
- **Launchd / systemd service recipes** — auto-start daemon on login. Nice polish, not essential.
- **Plugin system** — custom step types, webhook integrations, notification channels.
