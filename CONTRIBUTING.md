# Contributing to Tmpo

Thanks for your interest in contributing! This guide will get you from clone to running tests quickly.

## Dev setup

### Prerequisites

- [Bun](https://bun.sh/) (runtime for the daemon and server)
- [Rust toolchain](https://rustup.rs/) (for the CLI)
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) (for running workflows end-to-end)

### Clone and install dependencies

```sh
git clone https://github.com/jasonkatz/tmpo.git
cd tmpo
bun install            # root dependencies (installs husky for git hooks)
cd server && bun install && cd ..
cd client && bun install && cd ..
```

### Start the daemon in dev mode

```sh
make dev
```

This runs the daemon with `bun --watch`, so it restarts on file changes. The CLI auto-detects the dev environment and connects to the local daemon.

## Running tests

```sh
make test
```

This runs:
- `bun test` in `server/` (daemon and service tests)
- `cargo test` in `cli/` (CLI tests)

For a faster feedback loop during server development:

```sh
cd server && bun test --watch
```

## Code style

- A pre-commit hook (husky + lint-staged) runs linting automatically on staged files.
- Read [AGENTS.md](./AGENTS.md) for coding rules — especially the dependency injection patterns and test isolation requirements.

## Branch and PR conventions

- Branch off `main` with a descriptive name (e.g. `feature/health-endpoint`, `fix/daemon-crash`).
- Keep PRs focused — one logical change per PR.
- PRs require passing CI before merge.
- Link to the related GitHub issue or proposal in the PR description.

## Where to find work

- **[proposals/](./proposals/)** — Roadmap phases with detailed specs and acceptance criteria.
- **GitHub Issues** — Bug reports and feature requests.

Pick something that interests you, open an issue or comment on an existing one to signal you're working on it, and submit a PR when ready.
