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
  makes the workspace, so it has no id to take yet. Two background reads serve every workspace
  the way the job claim does: `listWorkspacesWithWork` (the pipeline sweep) and the sync
  scheduler's mailbox listing; each only finds the workspaces to enqueue a job for, and the job
  then works through the workspace-scoped functions.
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
- CV files are stored in Postgres (`cvs.content`, bytea, at most 5 MB by a check constraint), so
  replicas need no shared disk.
- MVP 2's tables (migration `0001_mvp2`, add-only): `cvs`, `profile_cvs`, `role_cv_choices`
  (an editor's CV per role), `rules`, `role_evaluations` (one per role: the match, the rule
  hiding it, every rule's effect, the chosen CV, `stale`), `match_ai_answers`, `sender_checks`
  (with `stale`), `sender_marks`, `domain_lookups` (the RDAP and MX cache, workspace-scoped),
  `drafts`, `decisions` and `decision_messages`, `assistant_threads`, `assistant_messages`,
  `assistant_proposals`, `profile_history`, `mailbox_sync` (per mailbox and folder: UIDVALIDITY,
  last UID, last success, failing since, the back-off's next attempt), `jobs.dedupe_key` and
  `messages.language` (the body's language as the sender stage detected it). The migration also
  gives saved AI settings a model for each new task, from their extract model.
- A reference from one workspace-owned row to another includes `workspace_id`: `cvs`,
  `profiles` and `assistant_threads` have a unique `(workspace_id, id)`, and every foreign key to
  them is composite, as those to `messages` and `roles` are. The database itself refuses a link,
  override, evaluation, draft, rule, proposal or history row that points into another workspace.
- Deleting a CV never hits a foreign key: its links (`profile_cvs`), overrides
  (`role_cv_choices`) and stored match answers go with it (CASCADE); drafts and role evaluations
  stay and forget it (`ON DELETE SET NULL (cv_id)`, which keeps `workspace_id`), so a draft
  already in the mailbox stays there (F2.5) and the next evaluation chooses a CV again.
  Evaluations and stored match answers belong to their role (`roles`), drafts, overrides, sender
  checks and decision rows to their message.
- A draft row holds only the reply text and where its copy is in the mailbox (folder, UID,
  UIDVALIDITY, the draft's Message-ID, a content hash); the quote of the original is added when
  the MIME message is built, so no mail body is stored. A partial unique index allows one live
  draft (any status but `discarded`) per role.
- Stored match answers: `match_ai_answers` keeps each match.v1 answer under the hash of exactly
  what the model saw (the role's title and skills, the profile's target roles and skills, the
  chosen CV's skills). A rule, pay or policy change leaves the hash alone, so re-scoring after
  it is pure and makes no model call; the impact preview never calls the model either.
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
- Dedupe keys (`jobs.dedupe_key`, keys from `jobDedupeKey` in `packages/schema`): jobs with the
  same key are one piece of work. At most one waits — a partial unique index while `queued`, so
  enqueueing while one waits is a no-op. At most one runs — the claim skips a queued job while
  another with its key runs under a live lease, and takes a per-key advisory lock for its own
  transaction so two workers can't both start one. A job enqueued while its key runs still
  queues, so a change made during a run always gets the next run. An expired lease is taken over
  as any other; a job handed back while another of its key waits ends as done (the waiting one
  does the work). Keys: `sync:<mailboxId>` (one sync per mailbox, F1.2), `reevaluate:<ws>`,
  `cv:<cvId>`, `draft:<ws>:<messageId>:<position>`.
- Job types and their owners: `scan.run`; `pipeline.reevaluate`; `mail.sync`, `cv.read` and
  `draft.create`, each registered in its slice's module (`sync/jobs.ts`, `cvs/jobs.ts`,
  `drafts/jobs.ts`) and spread into `jobs/registry.ts`.
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

### The analysis pipeline

- Continuous sync (`mail.sync`, every `JOBFILLY_SYNC_INTERVAL_SECONDS`, after the first scan has
  stopped) reads INBOX by UID per folder (`MailClient.fetchSince`), re-indexes a folder whose
  UIDVALIDITY changed by Message-ID, and records its state and back-off in `mailbox_sync`.
- Each new job message, and every message whose evaluation or sender check is missing or stale,
  goes through `evaluateMessage` (`apps/server/src/pipeline/evaluate.ts`): the sender stage, then
  per role the cv-choice and match stages, then the reply stage. The stage contract is pinned in
  `pipeline/stages.ts` (`MessageInput`, `StageContext`, `CvChoiceResult`, the reply stage's
  input); each stage's body lives in its own file and slice (`sender.ts` and `cv-choice.ts`:
  cvs-senders, `match.ts`: rules-match, `reply.ts`: replies).
- The sender stage runs only when the sender check is missing (new mail, the backlog) or stale (a
  sender mark changed). It is the only stage that reads the mail body (`ctx.body()`, fetched once,
  never stored). A re-evaluation after a profile, rule, decision or CV change passes the stored
  check on, so re-scoring never touches the mailbox and works while it is down. A failed sender
  stage leaves the check missing for a later sweep; the reply waits for it.
- A message no longer in the mailbox under its stored reference (`fetchBody` returns null, and
  `ctx.body()` throws `MessageGoneError`) gets an incomplete check, never better than caution,
  with the `message_gone` reason, so it leaves the work list instead of being fetched on every
  sweep. `saveEnvelopes` makes that check stale when a scan or sync sees the message again (a
  UIDVALIDITY re-index included), and its sender is checked again with its text.
- The sender stage also returns the body's language (ISO 639-1, or null), which the pipeline
  stores on the message (`messages.language`). The cv-choice stage reads it from `MessageInput`
  without the mailbox; when it changes, the message's roles are evaluated again.
- Without a confirmed profile only the sender stage runs; the roles stay unevaluated. Intake
  confirm asks for a re-evaluation of everything, which matches the first scan's backlog (F1.6).
  A stage that fails leaves its role missing or stale; it is never marked evaluated.
- `pipeline.reevaluate` (dedupe `reevaluate:<ws>`) snapshots what is missing or stale, evaluates
  each message at most once per run (a failing AI or mailbox can't make it loop) over one shared
  mailbox connection, re-claims the drafts to retry, and enqueues the next run only if something
  changed while it ran.
- The sweep (`pipeline/sweep.ts`) enqueues one deduped `pipeline.reevaluate` for every workspace
  with a confirmed profile and work (`listWorkspacesWithWork`): once at startup (`startWork` in
  `apps/server/src/start.ts`, before the queue and the scheduler start), so a deployment
  confirmed before MVP 2 is evaluated without anyone doing anything, and on every scheduler tick
  whatever the syncs did, so failed evaluations and drafts are retried within one interval.
- The reply policy is one pure function, `replyEligibility` (`packages/core/src/policy`): reply_to
  (default recruiter outreach), the reply window (`reply_window_days`, default 14), the threshold
  (`reply_threshold`, default 70), a sender check present and not high risk, no hide, no_draft or
  ask_first rule, no open need, and a role that never had a draft and wasn't dismissed. Draft a
  reply (on_demand) is always eligible. The replies slice and the assistant's impact preview both
  use it.
- Decision needs are carried on match verdicts (`MatchVerdict.need`) and rule effects; the reply
  stage reads them and never works facts out again. Similar needs share a group key
  (`groupKeyFor`, e.g. `min_pay:CHF:year`).

### The draft lifecycle

- `packages/db` `draft-claims.ts` owns who writes a role's draft. `claimDraft` inserts the role's
  one live row in status `saving`; only the claim holder writes to the mailbox. Draft a reply may
  take a `failed` row back instead. A claim whose draft.v1 answer raised questions is released
  (deleted) in the transaction that records the needs, so the role still counts as never drafted.
- `draft.create` catches `MailUnavailableError` (the mailbox can't be reached or refused the
  append) and marks the draft `failed` with kind `mailbox`; a draft.v1 call that gives no draft
  (the provider failed or timed out, the answer didn't fit after the client's retry, or no AI is
  set up) marks it `failed` with kind `ai` and a plain reason. The sweep re-claims both
  (`reclaimDraft`) and retries them, up to 5 attempts in all; a `saving` row older than 5 minutes
  (its job died) is retried the same way. Kind `content` (a placeholder twice, F6.2) is never
  retried automatically. No row is left in `saving`, and a draft that used up its attempts stays
  `failed` with its reason on the Drafts page, where Draft a reply takes it back.

### The profile change service

- Every change to a profile's entries and rules is a list of `Change`s (`packages/schema`)
  applied by `applyAndReevaluate` (`apps/server/src/profile/changes.ts`): the profile form
  (source you), a decision answer (decision), an applied assistant proposal (assistant), Undo.
  `packages/db`'s `applyProfileChanges` writes the profile, its rules and a `profile_history` row
  (who, when, source, request, before and after) in one transaction; the Change semantics come
  from `packages/core` (`applyChanges`), passed in, so `packages/db` imports only the schema.
- Change semantics: `add` on a list key (every core key) appends items and never replaces the
  list (an equal item is a no-op); on another key, or a missing one, it sets the entry. `update`
  replaces the value; `remove` with a value removes those items, with null the entry. A decision
  answer is always `add` of one item, so answering "CHF per year" keeps the EUR minimum. "Already
  answered" is decided by group key (`answeredFor`), never by profile key.
- `requestReevaluation(scope)` is the one way evaluations go stale: `{all}`, `{roles}`,
  `{messageIds}`, or a sender scope (`{senderAddress}`, `{senderDomain}`), which alone also makes
  the sender checks stale. It enqueues `pipeline.reevaluate` and tells open inboxes.

## AI

- Every model call goes through `packages/ai`. Each workspace picks a provider; each task
  (sorting, extraction, CV reading, matching, drafting, assistant) can use its own model.
- Prompts carry a stable task id (for example `classify.v1`) and refer to messages by their
  `Message-ID`. Structured output is validated against its schema; an invalid answer is retried
  once and then reported, never patched up. Output schemas use only shapes every provider can
  express: no open records (extra facts are a list of `{key, value}`, read back into a record).
- Mail content and CV text are passed as untrusted data, so instructions inside them can't steer
  the app: every content line starts with "| ", and structure and key lines are at column 0.
- MVP 2's tasks each have their module in `packages/ai/src/tasks`, keyed by a pinned key line the
  fake AI reads: cv.v1 `CV-SHA256: <hex>`, match.v1 `Message-ID:` and `Role: <position>`,
  draft.v1 `Message-ID:`, `Role: <position>` and `Attempt: <1|2>` (drafts are per role),
  assistant.v1 `Turn: <n>` with the user's words as the last block. The header, key lines and
  framing are fixed; each task's instruction text belongs to the slice that uses it, which
  regenerates its wire samples when it changes.
- Domain lookups for the sender check go through `deps.domains` (a `DomainPort`: `rdap(domain)`
  through `JOBFILLY_RDAP_URL`, `mx(domain)` through the system resolver), cached per workspace in
  `domain_lookups`; tests use a fake. A failed lookup makes the check incomplete, never "looks
  fine".
- The server makes every model call through `aiClientFor` (`apps/server/src/ai-usage.ts`), which
  records each call's usage (`ai_usage`, retries and failures included, at the clock's time), so
  the per-scan totals and Settings › AI's calls and tokens per day (`usagePerDay`, F1.5) count
  every task. Nothing calls `deps.ai.client` directly.
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
  later release — because old and new replicas run side by side during a rolling update. For
  the same reason, data an old replica writes stays readable: `ai_settings.models` is merged on
  save, not replaced, and a task model missing from a row an MVP 1 replica wrote is read as the
  extract model.
- On `SIGTERM`, in this order: the scheduler stops starting syncs and sweeps; readiness turns 503
  at once; the replica keeps serving for a 5-second drain so load balancers stop routing to it;
  it stops accepting connections and closes open live-update streams (browsers reconnect to
  another replica); in-flight requests finish within 20 seconds; running jobs hand back their
  leases, and background work still running (an intake.v1 call waiting for the model) is aborted
  and releases its claim, within 5 seconds (see "Background work and live updates"); the
  database closes; the process exits 0. Orchestrators must allow at least 30 seconds
  (`stop_grace_period`, `terminationGracePeriodSeconds`).
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
  isolation, reusing each worker's databases, so they don't use `vi.mock`. The doubles every
  slice tests with live there too: a fake mailbox (`createFakeMailbox`: INBOX with UIDs and
  UIDVALIDITY, `deliver`, a Drafts folder recording each draft, `pause`/`resume`, `failNext`,
  `setUidValidity`, `expunge`, call counts), a fake AI (`createFakeAi`, keyed like the test
  stack's fake AI), a fake `DomainPort`, `seedCv`, and recording pipeline stages.
- `pnpm e2e` starts the test stack (`docker/compose.e2e.yaml`) and runs the Playwright specs.
  The root scripts run `node e2e/stack.ts run` (`pnpm e2e`), `node e2e/stack.ts stack up|down`
  and `node e2e/stack.ts specs [--mvp <n>]`.
- Test-stack conventions shared by the fixtures and the stack: persona mail lives in
  `e2e/fixtures/<persona>/mail/<inbox|sent>/<nnnn>.eml`; `e2e/fixtures/<persona>/envelopes.json`
  is an array whose entries carry at least `file` (relative to `mail/`), `folder`, `messageId`
  and `minutesAgo`, the only fields the seed reads besides the `.eml` files. The fake AI starts
  with `node e2e/fake-ai/main.ts`, listens on `PORT` (8080) and reads `FIXTURES_DIR`
  (`e2e/fixtures`), `FAKE_AI_DELAY_MS` and `FAKE_AI_SLOW_TEST_MS` (0). The seed starts with
  `e2e/seed/main.ts` and the fixture generator with `e2e/fixtures/build/main.ts`. From MVP 2 the
  fake RDAP service starts with `node e2e/rdap/main.ts` (`PORT` 8080, data in
  `e2e/rdap/domains.json`) and CoreDNS reads `e2e/dns/Corefile` and `e2e/dns/zones`; the
  generator writes both from the fixtures' sender domains. The seed's `inspect smtp` and
  `reset-uidvalidity` use the test mail server's REST API (`GREENMAIL_API_URL`). Personas:
  `maria` (maria.santos@inbox.example) and `tom` (tom.okafor@inbox.example). How
  each MVP is validated is described in [docs/mvp/README.md](mvp/README.md).
