# JobFilly

**Connect your mail. JobFilly learns your job search and handles the busywork.**

An email client for people looking for professional roles, in any country. It reads your inbox,
works out what job search you're actually running, and does the tedious parts: sorting job mail,
pulling out role details, checking senders, matching roles against your profile with an
explanation, and drafting replies. Nothing is sent until you press send for that message. A
self-hosted server: several people can use it at once, each in their own workspace.

> **Status:** early. The product direction is in [docs/NORTH_STAR.md](docs/NORTH_STAR.md), the
> structure in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), the plan in
> [docs/mvp/](docs/mvp/README.md).

## Run it

Requires Node 24+ and pnpm 12.

```bash
pnpm install
pnpm dev                     # server on :8787, UI on http://localhost:5173 (needs the env below)
pnpm check                   # lint, typecheck, tests (no Docker: tests use PGlite in memory)
pnpm unused                  # unused files, exports and dependencies
pnpm build                   # web UI and server bundles
pnpm e2e                     # a fresh test stack (Docker), every Playwright spec, then down
pnpm e2e:stack up|down       # start or remove a test stack
pnpm e2e:specs [--mvp <n>]   # run the specs against the running stack

# self-hosted, on http://127.0.0.1:8787 (app + PostgreSQL)
JOBFILLY_SECRET_KEY=$(openssl rand -base64 32) docker compose -f docker/compose.yaml up --build
```

The server reads its configuration from the environment and stops with one clear message when
something is missing: `DATABASE_URL` (PostgreSQL), `JOBFILLY_SECRET_KEY` (32 bytes, base64; it
encrypts stored mail passwords and AI keys, so keep it) and `PUBLIC_URL` are required; the rest
is listed in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#configuration-environment). `node
dist/index.js migrate` applies the database migrations alone.

## Layout

```
apps/server     HTTP API, sessions, background jobs
apps/web        React UI
packages/       schema, core, db, mail, ai
e2e/            test stack: fixtures, fake AI, seeding, Playwright specs
docker/         Dockerfile and compose files
docs/           north star, architecture, MVP plans
```
