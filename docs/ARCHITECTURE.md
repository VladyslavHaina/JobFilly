# Architecture

One TypeScript codebase: a server that serves both the API and the web UI, backed by PostgreSQL.

- **Development:** `pnpm dev` runs the server and the Vite dev server; Vite forwards `/api` to
  the server.
- **Docker / Kubernetes:** one image runs the server, which serves the API and the built UI.
  Replicas are interchangeable; all state lives in Postgres.

The UI only ever talks to the server over HTTP from the same origin.

## Packages

| Path | Owns | May import |
| --- | --- | --- |
| `packages/schema` | Zod schemas: every API payload, every AI structured output, job facts, profiles, rules | — |
| `packages/core` | Scan decisions, intake aggregation, profiles, rules engine, matching, decisions, CV choice. Pure logic, no I/O | schema |
| `packages/db` | PostgreSQL through Drizzle: tables, migrations, workspace-scoped queries, the job queue | schema |
| `packages/mail` | IMAP (imapflow), parsing (mailparser), building drafts and sending (nodemailer) | schema |
| `packages/ai` | Provider registry (AI SDK), per-task models, prompts, structured output, usage | schema |
| `apps/server` | HTTP API (Hono), sessions, workspace access, workers, live updates, config, logs | all packages |
| `apps/web` | React UI (Vite, Tailwind, TanStack Query, React Router) | schema; server types only |
| `e2e/` | Test stack fixtures, fake AI, mail seeding, Playwright specs (workspace package `@jobfilly/e2e`) | — |

Rules:

- Packages never import apps. `packages/core` never does I/O: it takes data and returns decisions,
  so every rule is testable without mail, a database or a model.
- Anything that crosses a package boundary, goes over HTTP, or comes back from a model has a
  schema in `packages/schema` and is validated where it enters.
- Workspace packages ship as TypeScript source. The server build bundles all JavaScript; native
  modules stay external and must be listed in the server's own dependencies. The bundle ships the
  migrations in `dist/migrations`.
- `e2e/` is a workspace package with its own dependencies, but it imports no app or package code,
  and nothing imports it. The wire contract between `packages/ai` and the fake AI is committed
  data in `e2e/fixtures/wire/` (per task id: the input, the exact OpenAI-compatible request, the
  fake AI's response and what `packages/ai` returns); both sides' tests read it from disk. The
  request is the body the AI SDK's openai-compatible provider sends (`strict` JSON Schema
  draft-07, no `stream` field); a `packages/ai` test captures it from the installed SDK and fails
  when an upgrade changes it.

## Workspaces, access and sessions

- Every workspace-owned row carries `workspace_id`. Data access goes through `packages/db`
  functions that require a workspace id, and `packages/db` exports no raw SQL. Three deliberate
  exceptions take something else: the invitee answering an invite (read, accept, decline by
  invite id, only after the server has checked the invite's email or token); the queue worker's
  lease operations (claim, renew, checkpoint, complete, hand back), which serve every workspace
  and are guarded by the lease owner; and the signed-in user's own view across workspaces, by
  user id or email: the workspaces they belong to, and the open invitations to their email (or
  to the invite's email once its token has been checked). Creating an account or a workspace
  makes the workspace, so it has no id to take yet.
- The server resolves the session, then checks membership and role on every workspace route.
  Not a member: `404`. A member without the needed role: `403`. Each route module under
  `/api/workspaces/:workspaceId/<name>` is mounted once behind the membership check
  (`apps/server/src/access`) and applies `requireRole` on its own handlers.
- Roles: `viewer` reads; `editor` also changes profiles, rules, decisions and drafts; `admin` also
  manages members, mailboxes and AI settings. The owner is an admin who can't be removed.
- Sessions: the cookie `jf_session` (HttpOnly, SameSite=Lax, Secure behind HTTPS) holds a random
  id of at least 128 bits; Postgres stores only its SHA-256 hash, with idle and absolute expiry.
  Any replica validates any session, so no sticky sessions are needed.
- Access ends at once, live streams included: removing a member or ending a session (sign-out,
  a new sign-in, expiry) closes that member's or session's open event streams on every replica
  (see "Background work and live updates").
- State-changing requests must come from the server's own origin (`Origin` check against
  `PUBLIC_URL`).

## Data

- PostgreSQL in every running mode, through Drizzle on node-postgres. Tests run against PGlite
  (Postgres compiled to WebAssembly) in memory, from `@jobfilly/db/testing`, so they need no
  Docker. One migration per release step; the sender and subject search uses the `pg_trgm`
  extension.
- A message is named by its RFC `Message-ID` (verbatim, angle brackets included) everywhere
  outside the database primary key: in the API, prompts, evidence, fixtures and web links. A
  header that isn't one lone `<...>` msg-id gets a stable synthetic id instead.
- The mailbox is the source of truth for mail. Postgres keeps message metadata, a short snippet,
  extracted job facts, and the local state: profiles, rules, CVs, decisions, drafts, corrections.
  Full message bodies are fetched from the mailbox when needed and not stored.
- CV files are stored in Postgres (size-limited), so replicas need no shared disk.
- Secrets (mail passwords, OAuth tokens, AI keys) are encrypted with AES-256-GCM using
  `JOBFILLY_SECRET_KEY` before they are stored. They are never returned by the API or logged.
  Every place that hands a workspace's AI key to the AI port (the AI settings routes, the scan job,
  the intake.v1 call) opens it with `openAiKey` in `apps/server/src/secrets.ts`, so a key that was
  never stored and one cleared on purpose (stored sealed as "") both read as no key.

## Background work and live updates

- Jobs (scans, mail sync, analysis, drafting) live in a Postgres queue table. Workers claim jobs
  with `FOR UPDATE SKIP LOCKED` and hold a lease they renew while working. A job whose lease runs
  out (its replica died) is picked up by another replica and resumes from its last checkpoint.
  Handlers are idempotent.
- Live updates reach the browser over Server-Sent Events
  (`GET /api/workspaces/:workspaceId/events`). Replicas publish events through Postgres
  `LISTEN/NOTIFY`, so a browser connected to any replica sees work done on any other.
- Each stream belongs to one member's session in one workspace: every subscriber to the live hub
  (`apps/server/src/live/hub.ts`) passes its owner (workspace, user and session), and there is no
  ownerless listener, in production or in tests. Removing a member or ending a session sends an
  access change (`member.removed`, `session.ended`) on the same NOTIFY channel; the replica that
  made the change closes its matching streams at once, and every other replica closes them as the
  notification arrives, in order with the events: nothing published after the change reaches
  them. Each stream also re-checks its session and membership when it opens and on every
  heartbeat, for whatever ends without a notification.
- Job handlers get the job's payload, its last checkpoint, the previous instance (after a
  takeover), `saveCheckpoint`, `renewLease` and an abort signal; `apps/server/src/jobs/registry.ts`
  maps each job type to its handler.
- The intake form's proposed answers are not stored: `aggregateIntake` (`packages/core`) computes
  them from the scan's stored findings on each `GET /intake`, and the scan job runs the same
  aggregation after every batch to track whether the answers still change (`deps.intake`, so
  tests can swap it). Confirm saves them as the profile "My job search", with each entry's
  sources.
- One model call runs outside the queue: intake.v1, which proposes the intake form's extra
  questions once per workspace. The first `GET /intake` after the first scan stops claims it
  through the workspace's `intake_extras` row (insert-or-skip) and makes the call after the
  response, as background work the replica tracks; everyone else sees `pending` until an
  `intake.updated` event. Confirm waits for it (409 while pending). Its outcome, `done` or
  `failed`, is final. An answer that arrives during shutdown is still stored with its usage, as
  the database closes only after the call has finished. When shutdown reaches the job hand-back
  step first, it aborts the call and releases the claim, and the next `GET /intake` on any
  replica takes it over at once. A claim left by a replica that died is taken over by one caller
  once it is 2 minutes old.

## AI

- Every model call goes through `packages/ai`. Each workspace picks a provider; each task
  (sorting, extraction, CV reading, matching, drafting, assistant) can use its own model.
- Prompts carry a stable task id (for example `classify.v1`) and refer to messages by their
  `Message-ID`. Structured output is validated against its schema; an invalid answer is retried
  once and then reported, never patched up. Output schemas use only shapes every provider can
  express: no open records (extra facts are a list of `{key, value}`, read back into a record).
- Mail content and CV text are passed as untrusted data, so instructions inside them can't steer
  the app.
- The assistant can only propose changes. Applying one is a separate request made by the user.

## Configuration (environment)

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string (required) |
| `JOBFILLY_SECRET_KEY` | 32-byte key, base64, for encrypting secrets (required) |
| `PUBLIC_URL` | The URL users open, e.g. `https://jobfilly.home.lan` (required) |
| `HOST`, `PORT` | Listen address, default `127.0.0.1:8787` |
| `WEB_DIST` | Built web UI to serve (set in the image) |
| `LOG_LEVEL` | `info` by default |
| `JOBFILLY_SYNC_INTERVAL_SECONDS` | Mail polling interval, default `120` |
| `JOBFILLY_RDAP_URL` | RDAP service for domain age, default `https://rdap.org` |
| `JOBFILLY_ALLOW_INSECURE_MAIL` | Allow plain-text IMAP/SMTP; only the test stack sets it |

The server validates all of them at start and exits with one clear message if one is missing or
invalid. Later MVPs add OAuth client settings to this table.

## Kubernetes readiness

Every MVP keeps these true; the Helm chart after MVP 3 relies on them.

- Stateless replicas; nothing on local disk except temporary files.
- `GET /api/health/live` (process up) and `GET /api/health/ready` (database reachable and
  migrations applied).
- Migrations run at start under a Postgres advisory lock, so replicas starting together apply
  them once (one `db.migrated` line). `node dist/index.js migrate` runs them alone, for a migration
  job. Migrations stay backward compatible with the previous release — add first, remove in a
  later release — because old and new replicas run side by side during a rolling update.
- On `SIGTERM`, in this order: readiness turns 503 at once; the replica keeps serving for a
  5-second drain so load balancers stop routing to it; it stops accepting connections and closes
  open live-update streams (browsers reconnect to another replica); in-flight requests finish
  within 20 seconds; running jobs hand back their leases, and background work still running (an
  intake.v1 call waiting for the model) is aborted and releases its claim, within 5 seconds
  (see "Background work and live updates"); the database closes; the process exits 0.
  Orchestrators must allow at least 30 seconds (`stop_grace_period`,
  `terminationGracePeriodSeconds`).
- Runs as a non-root user with a read-only root filesystem and listens on `$PORT`.

## Logs

- JSON lines on stdout with `time`, `level`, `instance` (the replica's hostname), `event`
  (dot-separated, e.g. `scan.stopped`), `requestId` for HTTP requests, and `workspaceId` / `userId`
  as ids. Every HTTP request logs `http.request` with method, route pattern, status and duration;
  the UI's files and deep links all log the route `/*`, never their path.
- Never logged: passwords, keys, tokens, cookies, message bodies, subjects, email addresses, CV
  text, assistant messages.

## Testing

- `pnpm check` runs lint, typecheck and unit/integration tests (Vitest, PGlite, fakes at package
  boundaries). Hermetic: no real mailbox, model or network. Server tests build their dependencies
  with `apps/server/src/testing` (`createTestDeps` with fake mail and AI ports, and seeding through
  the workspace-scoped `@jobfilly/db` functions). The PGlite projects run without per-file
  isolation, reusing each worker's databases, so they don't use `vi.mock`.
- `pnpm e2e` starts the test stack (`docker/compose.e2e.yaml`) and runs the Playwright specs.
  The root scripts run `node e2e/stack.ts run` (`pnpm e2e`), `node e2e/stack.ts stack up|down`
  and `node e2e/stack.ts specs [--mvp <n>]`.
- Test-stack conventions shared by the fixtures and the stack: persona mail lives in
  `e2e/fixtures/<persona>/mail/<inbox|sent>/<nnnn>.eml`; `e2e/fixtures/<persona>/envelopes.json`
  is an array whose entries carry at least `file` (relative to `mail/`), `folder`, `messageId`
  and `minutesAgo`, the only fields the seed reads besides the `.eml` files. The fake AI starts
  with `node e2e/fake-ai/main.ts`, listens on `PORT` (8080) and reads `FIXTURES_DIR`
  (`e2e/fixtures`), `FAKE_AI_DELAY_MS` and `FAKE_AI_SLOW_TEST_MS` (0). The seed starts with
  `e2e/seed/main.ts` and the fixture generator with `e2e/fixtures/build/main.ts`. Personas:
  `maria` (maria.santos@inbox.example) and `tom` (tom.okafor@inbox.example). How
  each MVP is validated is described in [docs/mvp/README.md](mvp/README.md).
