# Tmpo

Autonomous software delivery pipeline. Describe a task, point it at a repo, and Tmpo orchestrates AI agents to plan, implement, test, review, and ship a pull request.

## How it works

1. **Planner agent** reads the codebase and generates a structured proposal
2. **Dev agent** implements the proposal, commits, and opens a PR
3. **CI** is polled; a **review agent** evaluates the diff against the proposal
4. **E2E agent** runs user journeys; a **verifier** checks evidence against acceptance criteria
5. If any step fails, the workflow **regresses** — the dev agent gets failure context (including CI logs) and tries again
6. When all steps pass, the PR is ready for human review

Every agent invocation is recorded as JSONL under `~/.tmpo/runs/` for full observability.

## Architecture

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
  ├── REST API over unix socket (~/.tmpo/tmpod.sock)
  ├── Workflow engine (in-process job queue)
  ├── Agent executor (claude CLI subprocess)
  ├── SQLite (~/.tmpo/tmpo.db)
  └── JSONL run logs (~/.tmpo/runs/)
```

The CLI talks to a local daemon over a Unix socket. The daemon manages all state, orchestration, and agent execution. No external database or infrastructure required.

## Prerequisites

- [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) installed and authenticated
- A GitHub token with repo and workflow scopes

## Install

### Option A: One-line install

```sh
curl -fsSL https://raw.githubusercontent.com/jasonkatz/tmpo/main/install.sh | bash
```

Downloads both `tmpo` (CLI) and `tmpod` (daemon) from the latest GitHub Release to `~/.tmpo/bin/` and offers to add it to your PATH. Override the install directory with `TMPO_INSTALL_DIR`:

```sh
TMPO_INSTALL_DIR=/usr/local/bin curl -fsSL https://raw.githubusercontent.com/jasonkatz/tmpo/main/install.sh | bash
```

### Option B: From source (recommended for contributors)

Requires [Rust](https://rustup.rs/) and [Bun](https://bun.sh/).

```sh
git clone https://github.com/jasonkatz/tmpo.git
cd tmpo
make build    # builds both CLI and daemon
make install  # installs CLI via cargo, copies tmpod to ~/.tmpo/bin/
```

### Option C: Download prebuilt binaries

Download both `tmpo` and `tmpod` for your platform from [GitHub Releases](https://github.com/jasonkatz/tmpo/releases), then:

```sh
chmod +x tmpo tmpod
mkdir -p ~/.tmpo/bin
mv tmpod ~/.tmpo/bin/
mv tmpo ~/.cargo/bin/   # or anywhere on your PATH
```

### Dev mode (no daemon build needed)

If you have the source checkout and [Bun](https://bun.sh/) installed, the CLI automatically detects this and runs the daemon via `bun run src/daemon.ts` — no need to build a `tmpod` binary during development.

```
$ tmpo daemon start
No tmpod binary found; using dev mode (bun run src/daemon.ts in /path/to/tmpo/server)
Daemon started.
```

## Quick start

```sh
# Configure your GitHub token
tmpo config set github-token <your-token>

# Run a task
tmpo run --task "Add a /health endpoint" --repo yourorg/yourrepo

# Check status
tmpo list
tmpo status <workflow-id>

# View agent logs
tmpo logs <workflow-id>

# Open the web dashboard
tmpo ui
```

## Daemon management

The daemon starts automatically when you run any command. You can also manage it explicitly:

```sh
tmpo daemon start    # start in background
tmpo daemon status   # show PID, uptime, socket path
tmpo daemon stop     # graceful shutdown
```

Data lives under `~/.tmpo/`:

```
~/.tmpo/
  tmpod.sock       # unix socket (daemon <-> CLI)
  tmpod.pid        # daemon PID file
  tmpo.db          # SQLite database
  config.toml      # user config
  bin/tmpod        # daemon binary (managed install)
  runs/
    {workflow_id}/
      plan-0.jsonl
      dev-0.jsonl
      review-0.jsonl
      ...
```

## Project status

See `proposals/open-source-readiness.md` for the full roadmap.

- [x] **Phase 1-2** — Auth simplification, self-hosted deployment (stepping stones)
- [x] **Phase 3** — Local storage (SQLite, JSONL logs, config.toml)
- [x] **Phase 4** — Daemon mode (unix socket, CLI lifecycle, graceful shutdown)
- [x] **Phase 5** — Distribution (GitHub Releases, install script, tmpo doctor)
- [x] **Phase 6** — Documentation and community
