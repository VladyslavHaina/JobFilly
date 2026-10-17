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
| `packages/mail` | IMAP (imapflow, password or XOAUTH2), parsing (mailparser), building drafts, and building and sending one confirmed message (`composeOutgoing`; nodemailer, `src/smtp` only) | schema |
| `packages/ai` | Provider registry (AI SDK), per-task models, prompts, structured output, usage | schema |
| `apps/server` | HTTP API (Hono), sessions, workspace access, workers, live updates, config, logs | all packages |
| `apps/web` | React UI (Vite, Tailwind, TanStack Query, React Router) | schema; server types only |
| `e2e/` | Test stack fixtures, fake AI, fake RDAP and fake Google OAuth servers, mail seeding, Playwright specs (workspace package `@jobfilly/e2e`) | — |

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
  makes the workspace, so it has no id to take yet. Three background reads serve every workspace
  the way the job claim does: `listWorkspacesWithWork` and `listWorkspacesWithFailedLookups`
  (the pipeline sweep) and the sync scheduler's mailbox listing; each only finds the workspaces
  to work on, and then works through the workspace-scoped functions.
- The server resolves the session, then checks membership and role on every workspace route.
  Not a member: `404`. A member without the needed role: `403`. Each route module under
  `/api/workspaces/:workspaceId/<name>` is mounted once behind the membership check
  (`apps/server/src/access`) and applies `requireRole` on its own handlers.
- MVP 3: a member's scope (`memberships.scope`, F6.1) is everything or the job pipeline only.
  For a pipeline-only member, `mount` in `app.ts` closes every module (404, `requireFullAccess`)
  unless it is mounted with `pipeline: true`, so a new module is closed by default; and
  `requireJobMail` answers 404 for every route about one message (`/messages/:messageId/*`,
  `/senders/messages/:messageId/*`, reads and writes alike) unless it is job mail. Open: members,
  invites, events (without `drafts.updated` and `sends.updated`, and `messages.updated` without
  its Message-IDs), mailboxes, ai, scans, messages (the list job mail only, no draft status, never
  a body), intake, profiles, rules, history, cvs, senders, decisions, the assistant (its lookups
  apply the scope, F8.3), pipeline, oauth, activity, the workspace's own DELETE. Closed: drafts
  and sending, export; and, inside open modules, whatever decides where mail comes from or goes
  (`requireFullAccess` on the handler): connecting or testing a mailbox (`POST /mailboxes`,
  `POST /mailboxes/test`, `POST /oauth/google/start`), saving or testing its SMTP settings, and
  saving or testing the AI settings. The web mirrors it with `can.mail`.
- MVP 3 exceptions to "every query takes a workspace id", added by their slices: the Google
  callback (`/api/oauth/google/callback`) finds its waiting sign-in by the state's hash
  (`oauth_states`), which names the workspace and the user, and then checks that user's session;
  deleting an account works on the signed-in user's own view (their memberships, owned
  workspaces and invites to their email).
- Roles: `viewer` reads; `editor` also changes profiles, rules, decisions and drafts; `admin` also
  manages members, mailboxes and AI settings. The owner is an admin who can't be removed.
- Sessions: the cookie `jf_session` (HttpOnly, SameSite=Lax, Secure behind HTTPS) holds a random
  id of at least 128 bits; Postgres stores only its SHA-256 hash, with idle and absolute expiry.
  Any replica validates any session, so no sticky sessions are needed.
- Access ends at once, live streams included: removing a member, changing their role or scope,
  or ending a session (sign-out, a new sign-in, expiry) closes that member's or session's open
  event streams on every replica (see "Background work and live updates"); each stream's
  heartbeat also re-reads the session and the membership and closes when the role or scope is
  no longer the one it opened with.
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
  last UID, last success, failing since and why, the back-off's next attempt), `stage_failures`
  (per message and pipeline stage: the failure count, the last failure, the back-off's `retry_at`
  and the evaluation's `stale_since` when it failed; a sender check is stored under position -1),
  `jobs.dedupe_key`, `messages.language` (the body's language as the sender stage detected it)
  and `messages.sync_analysis_failures` (how many syncs failed to have the model sort the
  message). The migration also gives saved AI settings a model for each new task, from their
  extract model. Migration `0002_cv_preferred` adds `cvs.preferred`, the user's flag for the CV
  to use when nothing else in a role tells the CVs apart.
- MVP 3's tables and columns (migration `0003_mvp3`, add-only but for two constraints): several
  mailboxes per workspace (the one-per-workspace unique goes, one per address instead; old
  replicas can't connect a mailbox during the rolling update), with `auth_kind` (password or
  google, whose sealed secret is its OAuth tokens as JSON), the `reconnect_needed` status and
  SMTP settings; `messages.mailbox_id` (composite FK, cascade: disconnecting deletes its messages
  and all tied to them, F7.4, which `GET /mailboxes/:mailboxId/removal` counts first,
  `getMailboxRemovalSummary`; backfilled; null reads as the first mailbox; a Message-ID seen in a
  second mailbox stays the first one's message); `oauth_states`; `profiles.enabled`;
  `scans.hint` and `scans.focus` and the `rerun` kind; the role's profile on `role_evaluations`
  (`profile_id`, reason, source) and an editor's choice in `role_profile_choices`; `sends` (one
  waiting or running per draft) and the `sent` draft status; `jobs.run_at`; `role_stages` (a stage
  set by hand); `memberships.scope` and `invites.scope`; `activity_log`; `assistant_messages.sources`;
  `scans.started_by` set null when its account goes. The activity log holds ids, never a name or
  an address (actor and target user ids set null when the account goes: "Deleted user"), written
  through `recordActivity` wherever an outward or sharing action happens (`ACTIVITY_KINDS`):
  drafts saved and mail sent, member changes, an export when it starts, a mailbox connected (by
  password or Google) or disconnected, a mailbox's SMTP settings or the AI settings saved
  (mailbox id only, never a host, key or address), and an account deleted.
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
- MVP 3: a stage set by hand (`role_stages`) and an editor's profile for a role
  (`role_profile_choices`) belong to the role too, and `saveAnalysis` replaces a message's roles,
  so it carries both over by message and position in its own transaction: a re-run of setup
  analyses mail again and keeps what was chosen by hand. A position the new analysis no longer
  has takes its choices with it. The CV choice and the decision rows belong to the message, so a
  re-analysis leaves them as they are.
- A draft row holds only the reply text and where its copy is in the mailbox (folder, UID,
  UIDVALIDITY, the draft's Message-ID, a content hash, the name of the file attached to it); the
  quote of the original is added when the MIME message is built, so no mail body is stored. A partial unique index allows one live
  draft (any status but `discarded`) per role.
- Stored match answers: `match_ai_answers` keeps each match.v1 answer under the hash of exactly
  what the model saw (the role's title and skills, the profile's target roles and skills, the
  chosen CV's skills). A rule, pay or policy change leaves the hash alone, so re-scoring after
  it is pure and makes no model call; the impact preview never calls the model either. The
  profile's own skills are the words of its `extra.skills` entry (`PROFILE_SKILLS_KEY` in
  `packages/schema`), an extra question with the slug "skills"; the core questions name no
  skills, so a profile without that entry adds none and its skills come from the CVs alone.
- Secrets (mail passwords, OAuth tokens, AI keys) are encrypted with AES-256-GCM using
  `JOBFILLY_SECRET_KEY` before they are stored. They are never returned by the API or logged.
  Every place that hands a workspace's AI key to the AI port (the AI settings routes, the scan job,
  the intake.v1 call, the match stage's match.v1 call in `apps/server/src/pipeline/match.ts`, the
  assistant.v1 call in `apps/server/src/assistant/service.ts`) opens it with `openAiKey` in
  `apps/server/src/secrets.ts`, so a key that was never stored and one cleared on purpose
  (stored sealed as "") both read as no key.

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
  `drafts/jobs.ts`) and spread into `jobs/registry.ts`. MVP 3: `mail.send` (`send/jobs.ts`,
  dedupe `send:<sendId>`) runs once its `run_at` (the 10-second Undo delay, F4.2) has passed; the
  claim skips a job not yet due.
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
  UIDVALIDITY changed by Message-ID, and records its state and back-off in `mailbox_sync`
  (`apps/server/src/sync`). Its first cursor is where the first scan's stored INBOX mail ends.
  Every message after a known cursor is new; only when it reads the whole folder (no cursor yet,
  or a new UIDVALIDITY) does it leave out mail that arrived (`SyncedEnvelope.receivedAt`, the
  INTERNALDATE) before that scan's window. New likely job mail is sorted and extracted by
  `pipeline/analyze.ts`, the scan's own classify-then-extract step, within the workspace's budget
  per run; the cursor stays before mail the model couldn't sort yet, until syncs have failed on a
  message `MAX_SYNC_ANALYSIS_FAILURES` times (`messages.sync_analysis_failures`), which then
  waits for "Analyze them". A failed sync backs off from one interval, doubling to at most 15
  minutes, and the mailbox shows as failing since its first failure until a sync works again. The
  status carries a reason code (`MailboxSyncStatus.reason`, stored in
  `mailbox_sync.last_error_reason`) that the UI branches on; the words beside it come from
  packages/mail (`UNAVAILABLE_MESSAGES`) for the mail server's reasons, and from
  `apps/server/src/sync/run.ts` for `secret_error` and `error`.
- MVP 3 (F3.1): `connectMailbox(deps, ws, mailboxId)` opens one mailbox of several (none named:
  the first, where mail stored before MVP 3 lives); the pipeline's `mailboxSession` keeps one
  connection per mailbox; the body route, a draft's original, Message-ID domain and Drafts folder
  use the message's mailbox (`getMessageMailbox`); the scan and the sync file what they store
  under theirs (`saveEnvelopes`, `reindexMessages` and `newestStoredUid` take it).
- Every caller of `MailPort.connect` passes the mailbox's stored address
  (`MailClientOptions.address`): it is the From of every draft and the domain of its
  Message-ID, as the IMAP user name need not be an address.
- Each new job message, and every message whose evaluation or sender check is missing or stale,
  goes through `evaluateMessage` (`apps/server/src/pipeline/evaluate.ts`): the sender stage, then
  per role the cv-choice and match stages, then the reply stage. The stage contract is pinned in
  `pipeline/stages.ts` (`MessageInput`, `StageContext`, `CvChoiceResult`, the reply stage's
  input); each stage's body lives in its own file and slice (`sender.ts` and `cv-choice.ts`:
  cvs-senders, `match.ts`: rules-match, `reply.ts`: replies).
- MVP 3 (F1.3): the assign step (`pipeline/assign.ts`) runs before a role's cv-choice and match
  stages. The role goes to the best profile that is on (`assignProfile`, packages/core
  `src/assign`: places, title, languages, contract and the profile's hide rules, ties to the
  oldest, the reason in plain words), or to the one an editor chose (`role_profile_choices`);
  profiles that are off get no roles. Matching, CV choice and drafting then use that profile and
  its rules, and the evaluation stores it with its reason and source
  (`role_evaluations.profile_id`). Every later step that needs a role's profile (the reply stage,
  a draft, a decision's answer) reads it with `profileOfRole`: the profile the role was evaluated
  with, else the first that is on, else the first confirmed one.
- MVP 3 (F1.1): a re-run of setup (`POST /scans` with kind `rerun` and an optional hint) runs the
  scan again over the last 90 days. Its hint is read into a `ScanFocus` once (focus.v1) and
  stored with the scan (`scans.focus`); the run's intake proposal is the mail in focus
  (`focusIntakeInput`), and it reads the pending likely job mail with the focus's words first
  (`focusFirst`). Its Confirm makes a new profile next to the others.
- The sender stage runs only when the sender check is missing (new mail, the backlog) or stale (a
  sender mark changed, or its failed domain lookup has expired). It is the only stage that reads the
  mail body (`ctx.body()`, fetched once, never stored). A re-evaluation after a profile, rule,
  decision or CV change passes the stored check on, so re-scoring never touches the mailbox and
  works while it is down. A failed sender stage leaves the check missing for a later sweep; the
  reply waits for it.
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
  changed while it ran. Such a change ends the run at the next batch boundary, so it waits for no
  long run (the first scores after a CV upload).
- The sweep (`pipeline/sweep.ts`) enqueues one deduped `pipeline.reevaluate` for every workspace
  with a confirmed profile and work (`listWorkspacesWithWork`): once at startup (`startWork` in
  `apps/server/src/start.ts`, before the queue and the scheduler start), so a deployment
  confirmed before MVP 2 is evaluated without anyone doing anything, and on every scheduler tick
  whatever the syncs did, so failed evaluations and drafts are retried within one interval. A
  stage that fails again then backs off: `stage_failures` (`packages/db`, so every replica
  agrees) holds the message's sender check or the role for one interval, doubling up to an hour,
  and `listWorkspacesWithWork` and `evaluateMessage` skip what still waits, so a deterministic
  failure doesn't repeat its calls and log lines on every tick. `requestReevaluation` and any
  change that marks the item stale end the wait at once. Each failure logs
  `pipeline.stage_failed` with why (`failureFields` in `apps/server/src/log.ts`: name, kind or
  code, a short masked reason) and when it is tried again; a failed sender check is stored
  incomplete with the `check_failed` reason, never "looks fine", and still counts as missing.
- The reply policy is one pure function, `replyEligibility` (`packages/core/src/policy`): reply_to
  (default recruiter outreach), the reply window (`reply_window_days`, default 14), the threshold
  (`reply_threshold`, default 70), a sender check present and not high risk, no hide, no_draft or
  ask_first rule, no open need, and a role that never had a draft and wasn't dismissed. Draft a
  reply (on_demand) is always eligible. The replies slice and the assistant's impact preview both
  use it. The reply stage then keeps at most one automatic draft per message (`capAutoDrafts` in
  `packages/core/src/decisions`, TBD-221): the best-scoring role the policy lets through, ties to
  the lowest position, and none once a role of the message had a draft; Draft a reply stays per
  role. The impact preview counts per role, without the cap.
- Decision needs are carried on match verdicts (`MatchVerdict.need`) and rule effects; the reply
  stage reads them and never works facts out again. Similar needs share a group key
  (`groupKeyFor`, e.g. `min_pay:CHF:year`).
- A draft's questions are recorded with what raised them (`decision_messages.source`): `draft`
  for an automatic draft's, `draft_on_demand` for Draft a reply's. Once the policy holds a role
  (its score dropped, a rule, a risky sender), it stops waiting on the match's, the rules' and
  an automatic draft's needs alike; only Draft a reply's questions wait whatever the policy says,
  and a "Don't ask for this message" on them is reopened by the next Draft a reply. Once those
  are answered, the reply stage claims the role's draft with origin `on_demand` even when the
  policy holds it; an answer to an automatic draft's question on a held role makes no draft.

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
  retried automatically. Only a failure before or in the append is the mailbox's: once the copy
  is there, a failure (recording it, a live event) leaves the row in `saving` for that same
  retry, and a draft that used up its attempts stays `failed` with its reason on the Drafts page,
  where Draft a reply takes it back.
- A retry is checked against the reply policy before the sweep re-claims it
  (`apps/server/src/pipeline/reply.ts` `retryPlan`, `replyEligibility` with origin `retry`):
  every hold applies but `already_drafted`, which the role's own row causes. A held retry (the
  message left the reply window, F1.6; a high-risk sender, F5.2; a rule; open needs) is marked
  `failed` with kind `content` and the hold's reason ("Not tried again: …");
  a role without a current evaluation or sender check waits for the next sweep. A failed Draft a
  reply is retried as `on_demand`, which nothing holds (F6.5).
- The append is idempotent. The server chooses the copy's Message-ID before the append
  (`apps/server/src/drafts/mailbox.ts` `draftMessageIdFor`, on the mailbox address's domain),
  keeps it with the text (`saveDraftText`) and passes it as `DraftMailInput.draftMessageId`. A
  retry first deletes any copy with that Message-ID (`deleteDraft` with UIDVALIDITY 0, which no
  folder has, finds it by Message-ID), so an attempt that died after the append leaves no second
  copy; discarding a failed draft deletes such a copy the same way. The contract: the IMAP client
  (`MailClient.saveDraft`, `replaceDraft`) gives the copy the caller's `draftMessageId` when it is
  set; the mailbox slice owns that client and its contract test
  (`packages/mail/src/drafts.test.ts`, TBD-331), and the server's test double keeps it the same
  way.
- A run that lost its claim to another run of it deletes its own copy only by a ref that knows
  the copy's UID: both copies carry the kept Message-ID, so a ref with UIDVALIDITY 0 (a server
  without UIDPLUS) is left alone. When a superfluous copy can't be deleted (that case, or a
  failed delete after a losing edit) `draft.copy_left` (warn, the draft id and a reason code, no
  content) says so.
- An edit keeps the copy's attachment. It is the CV from `cvs` while that CV exists; once it is
  deleted (F2.5, `cv_id` goes null) the file is read back from the copy itself
  (`MailClient.draftAttachment`) before the copy is replaced, so no CV file outlives its delete
  in Postgres. `drafts.attachment_name` keeps that the copy has one, which the API shows as
  `Draft.cvAttached`.
- Edits and discards compare and set on the copy's Message-ID (`saveDraftEdit`,
  `markDraftDiscarded`): each copy has its own, so a change made from a copy the row no longer
  names writes nothing. A losing edit deletes the copy it appended and answers 409; a losing
  discard deletes the newer copy and tries again. Exactly one copy remains (F6.4).

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
  answered" is decided by group key (`answeredFor`), never by profile key. A rule is never stored
  without plain words: one added with a blank description, or updated with new conditions or
  action under its old description, is stored with the words built from its conditions
  (`describeRule`), so the Rules list and every outcome naming the rule show what it does (F3.1).
- A decision answer writes its entry (`writeProfileChanges`) inside the transaction that claims
  the decision (`answerDecision`), then re-evaluates (`afterProfileChanges`) once it is
  committed: of two answers racing for one decision only the one that claims it reaches the
  profile, and a refused entry leaves the decision open.
- `requestReevaluation(scope)` is the one way evaluations go stale: `{all}`, `{roles}`,
  `{messageIds}`, or a sender scope (`{senderAddress}`, `{senderDomain}`), which alone also makes
  the sender checks stale. It enqueues `pipeline.reevaluate` and tells open inboxes. Its triggers:
  intake confirm, a profile or rule change, a finished CV read and a CV delete, a CV-choice
  override, a sender mark, a decision answer, apply and undo, and a category correction
  (`{messageIds}`: the reply policy reads the category, so corrected mail gets or loses its
  draft).
- MVP 3 (F2.3): a change by hand answers how many roles it changed
  (`apps/server/src/profile/impact.ts`): the profile's roles (those last evaluated with it; one
  evaluated before MVP 3 counts for the first profile that is on), scored before and after by
  packages/core's `countChangedRoles` with each role's stored match.v1 answer, as the impact
  preview does. Database only, no model call and no mailbox, so the count comes at once; the
  re-evaluation that follows updates the roles.

### The assistant

- Each member has their own threads (`assistant_threads.user_id`). Only the thread lookups
  (`getLatestThread`, `getThread`) take the user id as well as the workspace id; the reads by
  thread or proposal id (`listThreadMessages`, `listThreadProposals`, `nextTurn`, `getProposal`)
  take only the workspace id, so the server calls them with a thread it got from a lookup, or
  checks the proposal's member (`ownProposal`) before acting. Another member's thread or proposal
  answers 404.
- A message gets one assistant.v1 call (`apps/server/src/assistant/service.ts`), a question up to
  `MAX_LOOKUP_ROUNDS` (below). packages/ai asks
  the provider for `AssistantRequestSchema` (every change one flat shape, with the rule and the
  entry's value as JSON text, so the schema stays small enough for every provider's grammar),
  reads the answer back into Changes and checks it against `AssistantAnswerSchema`,
  which also lets through changes outside rules and entries, so the server can refuse such a
  proposal in words with the reply kept (F8.7). A proposal is kept only when it is a list of rule
  and entry Changes that apply to the profile, and with a clarifying question no proposal is
  kept; otherwise the reply says why nothing was proposed.
  Its card is stored with its impact preview and worded from its before and after
  (`changeLines`, packages/core).
- The impact preview (`previewImpact`, packages/core) runs `applyChanges`, the rules engine, the
  match and `replyEligibility` over `listRoleStates` before and after, with each role's stored
  match.v1 answer (`listStoredMatchAnswers`) picked by its CV and input hash, as the match stage
  picks it: no model call, no mailbox. A role with no answer for that hash (its target roles or
  skills changed and the re-evaluation hasn't asked the model yet) is previewed with none, its
  title not compared yet, never with an older answer.
- Apply marks the proposal applied and Undo marks the history entry undone in the transaction
  that runs `applyAndReevaluate` on it (a savepoint), so each happens once; live events raised
  inside are sent only after the commit. Undo restores the entry's `before` (`restoreChanges`)
  by hand (source you), so the restore is in the history too. Neither writes a draft.
- A question (MVP 3, F8) is a turn where assistant.v1 asks for read-only lookups: the server runs
  them in `apps/server/src/assistant/lookups.ts` with the asking member's access (a pipeline-only
  member gets no message text and no draft data), in rounds over one view: at most
  `MAX_LOOKUP_ROUNDS` (3, packages/schema), each of at most five lookups not run before. `role`
  and `message_text` take a Message-ID the model doesn't know at first, in any form the
  conversation shows it (bare or in angle brackets, or a whole "<Message-ID>#<position>" ref,
  whose position is the role's: `lookupId`, packages/core). So after a round whose searches
  (`find_roles`, `waiting`, `pipeline`) returned refs, or where a `role` or `message_text`
  Message-ID was not found (its result says to search with `find_roles`), assistant.v1 is asked
  again with the results so far (a `Round: <n>` key line and the results as answer.v1's
  "lookup <n>" blocks); every role line names its Message-ID and position, and an answer with no
  new lookups ends the rounds. answer.v1 answers from all the results only (its text without a raw
  "(refs: …)" note: refs are links), and any proposal or clarifying question in that turn is
  dropped, so mail can never become a change. `assistant.answered` logs the tools, the rounds
  and the number of refs kept. Only refs a lookup returned are kept; they become links in
  `assistant/links.ts` when the thread is read, re-checked against the member's current access.
  A turn whose lookups read full-access data (message text, draft lines) is stored with
  `assistant_messages.full_access` (true for rows from before 0004, so it fails closed): once the
  member sees the pipeline only, the thread shows it as "Not available with your access" without
  links, and the turn is left out of the history sent to the model.
- With several profiles a proposal targets one profile (named in the message or the thread, or
  the only one; otherwise the reply asks which) and its impact preview counts only that
  profile's roles.

## AI

- Every model call goes through `packages/ai`. Each workspace picks a provider; each task
  (sorting, extraction, CV reading, matching, drafting, assistant) can use its own model.
- Prompts carry a stable task id (for example `classify.v1`) and refer to messages by their
  `Message-ID`. Structured output is validated against its schema; an invalid answer is retried
  once and then reported, never patched up. Output schemas use only shapes every provider can
  express: no open records (extra facts are a list of `{key, value}`, read back into a record),
  and at most 16 parameters with union types, nullable ones included (Anthropic's limit): the
  text facts of extract.v1 are written as "" when not stated and read back as null.
- Mail content and CV text are passed as untrusted data, so instructions inside them can't steer
  the app: every content line starts with "| ", and structure and key lines are at column 0.
- MVP 2's tasks each have their module in `packages/ai/src/tasks`, keyed by a pinned key line the
  fake AI reads: cv.v1 `CV-SHA256: <hex>`, match.v1 `Message-ID:` and `Role: <position>`,
  draft.v1 `Message-ID:`, `Role: <position>` and `Attempt: <1|2>` (drafts are per role),
  assistant.v1 `Turn: <n>` with the user's words as the last block (MVP 3: and `Round: <n>` from
  a question's second round of lookups on). The header, key lines and
  framing are fixed; each task's instruction text belongs to the slice that uses it, which
  regenerates its wire samples when it changes.
- Domain lookups for the sender check go through `deps.domains` (a `DomainPort`: `rdap(domain)`
  through `JOBFILLY_RDAP_URL`, `mx(domain)` through the system resolver), cached per workspace in
  `domain_lookups`; tests use a fake. The RDAP answer is validated with `RdapDomainAnswerSchema`
  where it comes in, and the cache is read back through the lookup result schemas (a row that
  doesn't parse is a miss). A failed lookup makes the check incomplete, never "looks fine"; the
  failure is cached 15 minutes, twice as long each time it repeats (up to a day), and once it has
  expired the sweep marks that check stale (`apps/server/src/senders/retry.ts`), so it is done
  again on its own.
- The server makes every model call through `aiClientFor` (`apps/server/src/ai-usage.ts`), which
  records each call's usage (`ai_usage`, retries and failures included, at the clock's time), so
  the per-scan totals and Settings › AI's calls and tokens per day (`usagePerDay`, F1.5) count
  every task. Nothing calls `deps.ai.client` directly.
- The same way, the server opens a workspace's stored mailbox only through
  `apps/server/src/mailbox.ts`, which opens the sealed password with `JOBFILLY_SECRET_KEY`
  (`MailboxSecretError` when it won't open) and connects through `deps.mail` with
  `JOBFILLY_ALLOW_INSECURE_MAIL`. `connectMailbox(deps, workspaceId)` reads the stored
  connection itself and answers null when there is none; the body route and the pipeline use it.
  `connectStoredMailbox(deps, mailbox)` opens a row the caller has already read; the scan and the
  sync use it (they need the address too), and the drafts use `connectMailbox`. Nothing else
  calls `deps.mail.connect` with a stored mailbox; the connection test in Settings connects with
  the settings being tested, not a stored row.
- MVP 3: `mailboxLogin(deps, mailbox)` (same module) is the login itself: the password, or a
  Google mailbox's access token, refreshed and stored sealed again when it is about to expire.
  The send job signs in to SMTP with it for a Google mailbox (XOAUTH2,
  `apps/server/src/send/outgoing.ts`); any other sends with its SMTP password, or its IMAP one
  when it has none of its own. A refresh Google refuses turns the mailbox to `reconnect_needed`
  and throws `ReconnectNeededError`, a `MailUnavailableError`, so every caller treats it as a
  mailbox it can't reach now (drafts wait, scans stop) and nothing stored is lost.
- The assistant can only propose changes. Applying one is a separate request made by the user.
- MVP 3's prompts, pinned like MVP 2's (header, key lines, framing; the instruction is the
  slice's): `focus.v1` reads a re-run's hint into `ScanFocus` (countries, cities, languages, work
  modes, contract words, other words) on the intake model, keyed by the hint in its "message"
  block; `answer.v1` answers a question from read-only lookup results (`Turn:` key line, one
  "lookup <n>" block per result, the question last) on the assistant model, with the refs it used.
  assistant.v1's answer carries `lookups` (default none) for a question. No new model slot, so
  `ai_settings.models` doesn't change. Answers come back as JSON, never as provider tool calls.
- MVP 3's ports: `deps.smtp` (`SmtpPort`: send one message's exact bytes, and Test; packages/mail
  `src/smtp`) and `deps.oauth` (`OAuthPort`: Google's token endpoint, exchange and refresh,
  `OAuthRefusedError` when a refresh is refused; `apps/server/src/oauth/google.ts`). Sending
  happens only in the send job, one confirmed message at a time; `MailClient.appendSent` files it
  in Sent once per Message-ID.

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
| `JOBFILLY_GOOGLE_CLIENT_ID`, `JOBFILLY_GOOGLE_CLIENT_SECRET` | Google's OAuth client, set together; without them there is no Sign in with Google (MVP 3, F3.2). Redirect URI: `${PUBLIC_URL}/api/oauth/google/callback` |
| `JOBFILLY_GOOGLE_AUTHORIZE_URL`, `JOBFILLY_GOOGLE_TOKEN_URL` | Google's endpoints, by default `https://accounts.google.com/o/oauth2/v2/auth` and `https://oauth2.googleapis.com/token`; the test stack's fake overrides them |
| `JOBFILLY_GOOGLE_IMAP_HOST`, `JOBFILLY_GOOGLE_SMTP_HOST` | Gmail's servers as URLs, by default `imaps://imap.gmail.com:993` and `smtps://smtp.gmail.com:465`; `imap://`/`smtp://` is plain text (test stack only) |

The server validates all of them at start and exits with one clear message if one is missing or
invalid.

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
- Never logged: passwords, keys, tokens (OAuth access, refresh and id tokens, the PKCE verifier
  and the client secret included), cookies, message bodies, subjects, email addresses, CV text,
  assistant messages, a re-run's hint, the assistant's search words.

## Testing

- `pnpm check` runs lint, typecheck and unit/integration tests (Vitest, PGlite, fakes at package
  boundaries). Hermetic: no real mailbox, model or network. Server tests build their dependencies
  with `apps/server/src/testing` (`createTestDeps` with fake mail and AI ports, and seeding through
  the workspace-scoped `@jobfilly/db` functions). The PGlite projects run without per-file
  isolation, reusing each worker's databases, so they don't use `vi.mock`. The doubles every
  slice tests with live there too: a fake mailbox (`createFakeMailbox`: INBOX with UIDs and
  UIDVALIDITY, `deliver`, a Drafts folder recording each draft, `pause`/`resume`, `failNext`,
  `setUidValidity`, `expunge`, call counts; MVP 3: `appendSent`), a fake AI (`createFakeAi`,
  keyed like the test stack's fake AI), a fake `DomainPort`, `seedCv`, real PDF and DOCX files to
  upload (`pdfWithText`, `docxWithText`), recording pipeline stages, and (MVP 3) a fake SMTP server
  (`createFakeSmtp`) and Google token endpoint (`createFakeOAuth`).
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
  generator writes both from the fixtures' sender domains. The stack network has the fixed
  subnet `10.253.53.0/24` (CoreDNS at `.53`), so `stack up` refuses to start while another
  Docker network overlaps it, and before loading mail it checks from inside `app-a` that MX
  lookups get the fixture zone's answer and `JOBFILLY_RDAP_URL` answers. The seed's
  `inspect smtp` and `reset-uidvalidity` use the test mail server's REST API
  (`GREENMAIL_API_URL`). Personas:
  `maria` (maria.santos@inbox.example) and `tom` (tom.okafor@inbox.example). From MVP 3 the mail
  server also has Maria's personal mailbox (maria.home@post.example) and her Gmail test account
  (maria.gmail@gmail.example; `EXTRA_ACCOUNTS` in `e2e/seed/accounts.ts`), and the fake Google
  authorisation server starts with `node e2e/oauth/main.ts` (`PORT` 8080; `OAUTH_CLIENT_ID`,
  `OAUTH_CLIENT_SECRET`, `OAUTH_EMAIL`, `OAUTH_ACCESS_TOKEN`, which is that account's mail
  password, for XOAUTH2), reached by the browser through the proxy at `127.0.0.1:8084` and by the
  app at `http://oauth:8080`. The fake AI answers focus.v1 from `ai/focus.json` and answer.v1
  from `ai/answer.json`. From MVP 3 the stack runs a third replica, `app-c` (direct port
  `:8083`), and `node e2e/scripts/rolling-restart.ts` runs S10's rolling restart. How
  each MVP is validated is described in [docs/mvp/README.md](mvp/README.md).
