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
pnpm dev                                           # server on :8787, UI on http://localhost:5173
pnpm check                                         # lint, typecheck, tests
pnpm build                                         # web UI and server bundles
docker compose -f docker/compose.yaml up --build   # self-hosted, on http://127.0.0.1:8787
```

## Layout

```
apps/server     HTTP API, sessions, background jobs
apps/web        React UI
packages/       schema, core, db, mail, ai
docker/         Dockerfile and compose file
docs/           north star, architecture, MVP plans
```
