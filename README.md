# Cadence

Autonomous software delivery pipeline. Describe a task, point it at a repo, and Cadence orchestrates AI agents to plan, implement, test, review, and ship a pull request — without manual intervention at each step.

## How it works

1. A **planner agent** reads the codebase and generates a structured proposal (summary, acceptance criteria, technical considerations)
2. A **dev agent** implements the proposal using TDD, commits, and opens a PR
3. The system polls **CI**, then a **reviewer agent** evaluates the diff against the proposal
4. An **E2E agent** runs real user journeys; a **verifier agent** checks the evidence against acceptance criteria
5. If any step fails, the workflow **regresses** — the dev agent gets failure context and tries again (up to a configurable iteration limit)
6. When all steps pass, the PR is ready for human review

Every agent invocation is recorded (prompt, response, exit code, duration) for full observability.

## Architecture

```
client/     React + TypeScript + Vite + Tailwind
server/     Bun + TypeScript + Express + PostgreSQL
cli/        Rust + Clap + Tokio
```

The server owns all state and orchestration. The CLI and web client are thin display layers that communicate via REST API and SSE for real-time progress.

## Project status

See `proposals/` for the full six-phase roadmap.

- [x] **Phase 1** — Data foundation, workflow CRUD, CLI, web dashboard
- [x] **Phase 2** — Workflow engine, planner agent, SSE streaming
- [ ] **Phase 3** — Dev agent, GitHub PR integration
- [ ] **Phase 4** — CI polling, review agent, regression loop
- [ ] **Phase 5** — E2E verification, signoff
- [ ] **Phase 6** — Run logs CLI, web client completion
