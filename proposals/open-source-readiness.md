# Open Source Readiness Plan

Make tmpo self-hostable and community-friendly. Each phase is independently shippable.

---

## Phase 1: Auth Simplification

Auth0 is the primary blocker for self-hosting. No one can run tmpo without your tenant.

### Goals

- Single-user self-hosted mode that requires zero auth configuration
- Preserve Auth0 as an optional adapter for multi-tenant deployments

### Work

- Add `AUTH_MODE` env var: `none | auth0`
- When `AUTH_MODE=none`:
  - Skip JWT validation middleware entirely
  - Auto-provision a default local user on first boot
  - Inject that user into all authenticated routes
  - Client skips login flow and renders directly
- Extract Auth0 logic into an auth adapter so it's isolated
- Remove Auth0 client ID / domain from client bundle defaults; read from env or runtime config endpoint (e.g. `GET /config`)
- Default `AUTH_MODE=none` for docker-compose dev and prod profiles

### Acceptance Criteria

- `docker compose up` → working app with no Auth0 credentials needed
- Auth0 mode still works when credentials are provided
- No user-facing auth UI in single-user mode

---

## Phase 2: Self-Hosted Deployment

Give users a single command to run the full stack in production.

### Goals

- One `docker compose up` runs server, client, and postgres
- No dependency on Railway, Vercel, or any managed platform

### Work

- Add `Dockerfile` for the server (Bun-based, multi-stage build)
- Add `Dockerfile` for the client (Vite build → nginx/static serve)
- Create `docker-compose.prod.yaml` bundling server + client + postgres
- Make CORS origins configurable via `ALLOWED_ORIGINS` env var (remove hardcoded `tmpo.sh`)
- Make all domain/URL references configurable
- Generate `ENCRYPTION_KEY` automatically on first boot if not set
- Add health check endpoints for docker orchestration

### Acceptance Criteria

- Clone repo → `docker compose -f docker-compose.prod.yaml up` → working app
- No references to tmpo.sh, Railway, or Vercel required at runtime
- Works behind a reverse proxy (configurable `BASE_URL`)

---

## Phase 3: Environment & Configuration Documentation

Users need to know what to configure and why.

### Goals

- Every env var documented with purpose, format, and default
- Copy-paste quickstart that works

### Work

- Create `.env.example` with all variables, grouped and commented:
  - Database (`DATABASE_URL`)
  - Auth (`AUTH_MODE`, `AUTH0_*` optional)
  - Security (`ENCRYPTION_KEY`)
  - GitHub (`GITHUB_TOKEN` — optional, can also set via UI)
  - Agent (`CLAUDE_CLI_PATH`, agent timeouts)
  - Server (`PORT`, `ALLOWED_ORIGINS`, `LOG_LEVEL`)
- Document the `claude` CLI dependency: what it is, how to install, what API access is needed
- Add configuration section to README

### Acceptance Criteria

- `cp .env.example .env` → edit 0-2 values → app starts
- No undocumented env vars that cause silent failures

---

## Phase 4: README & Community Scaffolding

Make the repo legible and welcoming to contributors.

### Goals

- Someone landing on the repo understands what tmpo does and how to run it in under 2 minutes
- Clear contribution path

### Work

- Rewrite `README.md`:
  - One-line description and motivation
  - Architecture overview (client / server / CLI / agents diagram)
  - Quickstart (docker compose)
  - CLI usage examples
  - Link to proposals/ for roadmap context
- Add `CONTRIBUTING.md`:
  - Local dev setup (docker compose + bun + rust toolchain)
  - Branch/PR conventions
  - Testing expectations
  - Where to find work (issues, proposals/)
- Add GitHub issue templates (bug report, feature request)
- Add PR template with checklist

### Acceptance Criteria

- New developer can go from clone to running tests in one page of instructions
- Issue and PR templates appear in GitHub UI

---

## Phase 5: Agent Backend Flexibility

Reduce hard coupling to the `claude` CLI subprocess model.

### Goals

- Users can run agents without the Claude Code CLI installed
- Path toward supporting alternative LLM backends

### Work

- Extract agent invocation into an `AgentBackend` interface:
  - `ClaudeCLIBackend` — current subprocess approach (default)
  - `ClaudeAPIBackend` — direct Anthropic API calls via SDK
- Configure backend via `AGENT_BACKEND` env var
- For API backend: use `@anthropic-ai/sdk`, pass `ANTHROPIC_API_KEY`
- Keep tool definitions and prompt construction shared across backends
- Document tradeoffs (CLI has tool use built-in; API backend needs tool orchestration)

### Acceptance Criteria

- `AGENT_BACKEND=api` + `ANTHROPIC_API_KEY=sk-...` → agents run without `claude` CLI
- CLI backend remains default and fully supported
- Agent prompts and behavior are identical across backends

---

## Phase 6: Hardening & Polish

Production readiness for community-run instances.

### Goals

- Secure defaults, graceful failures, observability

### Work

- Audit all error paths — no stack traces or internal details leaked to client
- Add structured logging with configurable log levels
- Rate limiting configurable via env vars (not just hardcoded)
- Database connection pooling configuration exposed
- Add `tmpo doctor` CLI command that checks prerequisites (postgres, claude CLI, env vars)
- Validate env vars on startup with clear error messages for missing/invalid values
- Add OpenAPI spec export for API consumers

### Acceptance Criteria

- Startup fails fast with actionable error messages for misconfigurations
- `tmpo doctor` reports all issues before user tries to run a workflow
- No sensitive information in logs at default log level
