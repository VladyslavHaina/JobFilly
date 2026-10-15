# TBD — for the owner to review

The build runs unattended and never stops to ask. Every important decision it makes on its own,
and everything it could not finish, is recorded here. Nothing in this file changes the spec: the
owner goes through the entries, then the spec or the code is updated, or the entry is accepted as
it is.

Only the build workflow's record step adds entries (agents working in parallel report them, one
agent writes them), so the numbering stays continuous. Entries are never deleted; the owner sets
their status. When a decision is recorded again with a later choice, the earlier entry is marked
"superseded by" the later one, so each open decision appears once, with one answer.

## Entry format

```
## TBD-<n> · <title>
- **Kind:** decision | open item
- **Where:** MVP <n> · <phase> (<slice or scenario>)
- **Context:** what came up
- **Options:** the alternatives considered
- **Chosen:** what the build did, and why
- **If you decide otherwise:** what would change
- **Refs:** criteria, files, commits, run folders
- **Status:** open | accepted | changed | superseded by TBD-<n>
```

## Needed from the owner

These make sign-off possible; without them the build goes on and records an open item.

- **Real-AI quality runs (every MVP):** set `JOBFILLY_E2E_AI_PROVIDER` (`anthropic`, `openai`,
  `google` or `openai-compatible`) and `JOBFILLY_E2E_AI_KEY`, optionally `JOBFILLY_E2E_AI_BASE_URL`
  and `JOBFILLY_E2E_AI_MODEL`, in the environment the session runs in.
- **MVP 3, F3.3:** a Gmail test account and a Google OAuth client (`JOBFILLY_GOOGLE_CLIENT_ID`,
  `JOBFILLY_GOOGLE_CLIENT_SECRET`) for the one run with real Google sign-in, done with the owner
  after the unattended build.
- **Helm chart, H5:** the name of your local cluster's kube context in
  `JOBFILLY_E2E_KUBE_CONTEXT`. The build never uses the current context or any other one.

## Entries

## TBD-1 · How 'Couldn't analyze' works when classification is batched
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** F3.4 says output that fails its schema is retried once and then 'the item' is marked Couldn't analyze. Stage two classifies 20 messages per call, so one bad answer could take a whole batch down with it.
- **Options:**
  1. Validate the batch as a whole: if it fails, retry the whole batch once, then mark all 20 messages Couldn't analyze
  2. Validate each item: keep the valid items, retry only the invalid or missing ones in a single follow-up call (it counts toward the run budget), then mark only those as Couldn't analyze
- **Chosen:** Validate each item and retry only the invalid or missing ones once. F3.4 speaks of 'the item', and users see far fewer false 'Couldn't analyze' labels. The retry is a model call and counts toward the budget, as F4's definition of a model call requires.
- **If you decide otherwise:** packages/ai's batch validation and the scan worker's handling of failed items would change, and the fake-AI fixture for the invalid message would need a whole batch to fail.
- **Refs:** F3.4, F4.4, F4.5; packages/ai, apps/server/src/jobs/scan, e2e/fixtures/ai
- **Status:** superseded by TBD-17

## TBD-2 · The name of the personal workspace
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** F1.1 gives the example "Maria's workspace" for Maria Santos, but the registration form takes one name field.
- **Options:**
  1. Use the first word of the name: "<first word>'s workspace"
  2. Use the full name: "Maria Santos's workspace"
- **Chosen:** Use the first word of the name, so 'Maria Santos' gets "Maria's workspace". It matches the spec's example and S1's expected text. The workspace can be renamed later, so this is easy to change.
- **If you decide otherwise:** Change the workspace naming in the foundation's register handler and its test.
- **Refs:** F1.1, S1; apps/server/src/routes/auth.ts
- **Status:** superseded by TBD-18

## TBD-3 · When the intake extra questions are asked for
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** F6 lets the model propose the wording of up to five extra questions (task intake.v1). Either the scan worker asks when the first scan stops, or the intake route asks the first time the form is opened after that stop.
- **Options:**
  1. The scan worker calls intake.v1 when the first scan stops, inside the run budget
  2. The intake route calls intake.v1 once, the first time proposals are requested after the first scan stops, caches the answer and records the usage
- **Chosen:** The intake route calls it once and caches the result. The intake slice owns the call from end to end, so the scan and intake slices can be built in parallel without one writing the other's tables. The call is still made only once and its usage is still recorded and shown.
- **If you decide otherwise:** The scan worker would make the call when the first scan stops and store the questions, the intake route would only read them, and the call would count toward the run budget.
- **Refs:** F6.1, F3.6, F4.4; apps/server/src/routes/intake.ts, apps/server/src/jobs/scan
- **Status:** superseded by TBD-19

## TBD-4 · e2e becomes a pnpm workspace package
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** Playwright, the seed loader and the fake AI need their own dependencies, and the rules say dependencies go in the package that uses them. pnpm-workspace.yaml lists only apps/* and packages/*.
- **Options:**
  1. Add e2e to pnpm-workspace.yaml with its own package.json
  2. Put the e2e dependencies in the root package.json
- **Chosen:** Add e2e as a workspace package. ARCHITECTURE is updated, and e2e still imports no app or package code. It keeps the rule of putting dependencies in the package that uses them, and keeps the test-stack images small and on their own.
- **If you decide otherwise:** Move the e2e dependencies to the root and drop e2e from pnpm-workspace.yaml and the vitest projects.
- **Refs:** F7.8; pnpm-workspace.yaml, e2e/package.json, docs/ARCHITECTURE.md
- **Status:** superseded by TBD-21

## TBD-5 · How 'Couldn't analyze' works when classification is batched
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** F3.4 says output that fails its schema is retried once and then 'the item' is marked Couldn't analyze. Stage two classifies 20 messages per call, so one bad answer could take a whole batch down with it.
- **Options:**
  1. Validate the batch as a whole: if it fails, retry the whole batch once, then mark all 20 messages Couldn't analyze
  2. Validate each item: keep the valid items, retry only the invalid or missing ones in a single follow-up call (it counts toward the run budget), then mark only those as Couldn't analyze
- **Chosen:** Validate each item and retry only the invalid or missing ones once. When the budget has no call left for the retry, those items stay pending (not_retried) instead of being marked Couldn't analyze, so a later Analyze them run can pick them up. F3.4 speaks of 'the item', and users see far fewer false 'Couldn't analyze' labels. The retry is a model call and counts toward the budget, as F4's definition of a model call requires, and S8's 'exactly 5 calls' stays exact.
- **If you decide otherwise:** packages/ai's batch validation and the scan worker's handling of failed items would change, and the fake-AI fixture for the invalid message would need a whole batch to fail.
- **Refs:** F3.4, F4.4, F4.5; packages/ai, apps/server/src/jobs/scan, e2e/fixtures/ai
- **Status:** superseded by TBD-17

## TBD-6 · The name of the personal workspace
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** F1.1 gives the example "Maria's workspace" for Maria Santos, but the registration form takes one name field.
- **Options:**
  1. Use the first word of the name: "<first word>'s workspace"
  2. Use the full name: "Maria Santos's workspace"
- **Chosen:** Use the first word of the name, so 'Maria Santos' gets "Maria's workspace". It matches the spec's example and S1's expected text. The workspace can be renamed later, so this is easy to change.
- **If you decide otherwise:** Change the workspace naming in the foundation's register handler and its test.
- **Refs:** F1.1, S1; apps/server/src/routes/auth.ts
- **Status:** superseded by TBD-18

## TBD-7 · When the intake extra questions are asked for, and how it stays one call
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** F6 lets the model propose the wording of up to five extra questions (task intake.v1). Either the scan worker asks when the first scan stops, or the intake route asks the first time the form is opened after that stop. Asked lazily, two replicas, two tabs or a viewer opening the form at the same moment could each make the call.
- **Options:**
  1. The scan worker calls intake.v1 when the first scan stops, inside the run budget
  2. The intake route calls intake.v1 once, the first time proposals are requested after the first scan stops, claimed through an intake_extras row (insert-or-skip); other callers get 'pending' and an SSE update; usage recorded with no scan id
- **Chosen:** The intake route calls it once, claimed through the intake_extras row; anyone who can open the form (viewers too) may trigger it; usage is recorded with scan_id null; a claim stuck for more than 2 minutes can be taken over by one caller. The intake slice owns the call from end to end, so the scan and intake slices are built in parallel without one writing the other's tables. The claim row makes it exactly one call across replicas and tabs, and the call never holds a transaction open while the model answers.
- **If you decide otherwise:** The scan worker would make the call when the first scan stops and store the questions, the intake route would only read them, the call would count toward the run budget, and intake_extras would lose its claim columns.
- **Refs:** F6.1, F3.6, F4.4; apps/server/src/routes/intake.ts, packages/db intake_extras, apps/server/src/jobs/scan
- **Status:** superseded by TBD-19

## TBD-8 · e2e becomes a pnpm workspace package
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** Playwright, the seed loader and the fake AI need their own dependencies, and the rules say dependencies go in the package that uses them. pnpm-workspace.yaml lists only apps/* and packages/*.
- **Options:**
  1. Add e2e to pnpm-workspace.yaml with its own package.json
  2. Put the e2e dependencies in the root package.json
- **Chosen:** Add e2e as a workspace package (@playwright/test and imapflow). ARCHITECTURE is updated, and e2e still imports no app or package code. It keeps the rule of putting dependencies in the package that uses them, and keeps the test-stack images small and on their own.
- **If you decide otherwise:** Move the e2e dependencies to the root and drop e2e from pnpm-workspace.yaml and the vitest projects.
- **Refs:** F7.8; pnpm-workspace.yaml, e2e/package.json, docs/ARCHITECTURE.md
- **Status:** superseded by TBD-21

## TBD-9 · The test stack is built by the e2e-fixtures slice, not the foundation
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** The foundation carried the whole F7 platform, all of F1, every schema and stub, and the whole Docker test stack. No slice starts Docker, so nothing waits on the stack, while the fake AI's lookup, the fixture format and the fixtures were split across two owners.
- **Options:**
  1. Keep the test stack (compose.e2e, proxy, seed, fake AI, stack.ts, Playwright, F7.8) in the foundation
  2. Move it to the e2e-fixtures slice and keep only the wire contract (golden samples) in the foundation
- **Chosen:** Move it to the e2e-fixtures slice, which now owns F7.8 and F5.3; the foundation pins the packages/ai <-> fake-AI wire contract as golden samples in e2e/fixtures/wire, and lists a commit order so a partial foundation still unblocks the slices. It shrinks the one serial step, puts the format, the fake-AI lookup and the fixtures under one owner, and the golden samples make the contract checkable on both sides before they meet.
- **If you decide otherwise:** The foundation would build compose.e2e, the proxy, seed, fake AI and stack.ts again, and e2e-fixtures would only write persona content.
- **Refs:** F7.8, F5.3; e2e/, docker/compose.e2e.yaml, docker/proxy, e2e/fixtures/wire
- **Status:** superseded by TBD-22

## TBD-10 · Prompt layout and escaping of untrusted mail (F3.5)
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** The fake AI must find the task id and Message-IDs in the prompt, and F3.5 requires mail content to be clearly separated and delimiter look-alikes neutralised, without mangling '<...@...>' Message-IDs. The response mode (JSON content versus tool calls) must also match the fake AI.
- **Options:**
  1. Escape delimiter character sequences inside the content (e.g. replace <<< and >>>)
  2. Write Message-IDs verbatim on their own column-0 line and prefix every untrusted content line with '| ', so no content line can look like a delimiter or a Message-ID line; answers as JSON in choices[0].message.content with response_format json_schema
- **Chosen:** Column-0 structure lines, verbatim Message-ID lines, every untrusted line prefixed with '| '; json_schema structured output read from the message content, never tool calls, for the openai-compatible provider. The prefix can't be defeated by any content and changes nothing else in the mail, Message-IDs stay exact for the fake AI and the stored ids, and JSON content is what every OpenAI-compatible server (Ollama, LM Studio) supports.
- **If you decide otherwise:** The golden samples in e2e/fixtures/wire, the packages/ai prompt builder and the fake AI's parser change together.
- **Refs:** F3.5, F3.4, S2, S3; packages/ai, e2e/fake-ai, e2e/fixtures/wire
- **Status:** superseded by TBD-25

## TBD-11 · Messages are named by their RFC Message-ID everywhere
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** Evidence links, AI prompts, fixtures, expected.json and the API all need to point at a message, and a takeover must upsert the same message idempotently.
- **Options:**
  1. Use the database uuid in the API and map Message-IDs to it
  2. Use the RFC Message-ID (verbatim, with angle brackets; a stable synthetic id when missing) as the message id outside the database, unique per workspace
- **Chosen:** The RFC Message-ID, with a unique key on (workspace_id, message_id). One id from the mailbox to the model to the UI means no mapping step, fixtures and ground truth line up directly, and the unique key makes re-running a batch harmless.
- **If you decide otherwise:** Add a mapping from Message-ID to uuid in the inbox and intake routes and translate evidence ids.
- **Refs:** F4.8, F5.3, F6.2; packages/schema, packages/db messages, apps/server/src/routes/messages.ts
- **Status:** superseded by TBD-26

## TBD-12 · Sender and subject search uses the pg_trgm extension
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** F5.5 needs search by sender or subject and a fast first page; substring search can't use a plain btree index.
- **Options:**
  1. A GIN pg_trgm index on a generated lower-case search_text column (CREATE EXTENSION in the migration; PGlite loads its pg_trgm contrib extension in tests)
  2. Plain ILIKE scans within the workspace's date index, no extension
- **Chosen:** pg_trgm with a GIN index on search_text. It keeps search fast as mailboxes grow past MVP 1 sizes, and pg_trgm is a trusted extension available on standard Postgres images and managed services.
- **If you decide otherwise:** Drop the extension and the GIN index from the migration and search with ILIKE; any Postgres that can't create the extension would need this.
- **Refs:** F5.5; packages/db/migrations, packages/db/src/testing.ts, packages/db/src/queries/inbox.ts
- **Status:** superseded by TBD-28

## TBD-13 · How intake answers are aggregated, and what 'equal to expected.json' means
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** F6.6 requires Maria's proposals to equal expected.json, but the generator and aggregateIntake are built by different slices, and the evidence available at a confident stop depends on how much mail was read.
- **Options:**
  1. Let intake-profile choose its own rules and fit expected.json afterwards
  2. Fix the aggregation rules in the plan (replies win for a key they state; job facts need 5 messages; no evidence means empty); values and evidence ids must match exactly over the full fixtures, only the confidence level and the reason wording are calibrated; at a confident stop values must match exactly and evidence must be a non-empty subset
- **Chosen:** Fixed shared rules; exact values and evidence over the full fixtures; on the stack and at the confident stop, exact values with evidence a subset of the ground truth. Neither slice reverse-fits the other's numbers, and the stop-point check proves S4 sees the right answers (Amsterdam, both minimum pays) whatever point the scan stops at.
- **If you decide otherwise:** The generator, aggregateIntake and the fixture tests change together, and the S4 check might need the full evidence set.
- **Refs:** F6.2, F6.3, F6.6, S4; packages/core/src/intake, e2e/fixtures/build
- **Status:** superseded by TBD-29

## TBD-14 · Confident-stop details: replies first, at least one answer, done wins
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** F4.4's confident rule would be vacuously true with no answers (Tom's thin inbox would stop as 'confident' instead of 'done'), and it would fire before the user's replies are read if they came last.
- **Options:**
  1. Apply the rule literally
  2. Read the user's replies for preferences before the first classify batch; confident needs at least one answered core question; when nothing likely is left the reason is done even if confident also holds
- **Chosen:** Replies first, at least one answered core question, and done wins. It matches S7 ('stops with done') and keeps a confident stop meaningful; the user's own words are the strongest evidence.
- **If you decide otherwise:** The tracker and the worker's ordering in the scan slice change, and Tom's fixture would need a different outcome.
- **Refs:** F4.4, F4.5, S3, S7; packages/core/src/scan, apps/server/src/jobs/scan
- **Status:** superseded by TBD-32

## TBD-15 · A slow request for the shutdown scenario
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** S11 needs a slow request open on app-b while SIGTERM arrives; the fake AI answers in 300 ms and a debug route in production code is not allowed.
- **Options:**
  1. A debug delay route in the server
  2. FAKE_AI_SLOW_TEST_MS on the fake-ai service (default 0) that delays only ai.test.v1; S11 restarts the stateless fake-ai with 15000 and holds a Settings › AI Test request open
- **Chosen:** The FAKE_AI_SLOW_TEST_MS variable on the fake AI. No production code changes, the delay stays under the 20 s in-flight limit, and normal runs are unaffected.
- **If you decide otherwise:** Another long-running request would be needed in S11.
- **Refs:** F7.4, S11; e2e/fake-ai, docker/compose.e2e.yaml
- **Status:** superseded by TBD-33

## TBD-16 · No extra mail dependencies; haproxy for the test-stack proxy
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** packages/mail needs sanitised text from HTML parts and its tests need an IMAP server; the test proxy must route only to ready replicas.
- **Options:**
  1. Add html-to-text and a fake IMAP server package; use nginx
  2. Use mailparser's text (it derives text from HTML-only messages) and a scripted IMAP responder over node:net; use haproxy with active health checks
- **Chosen:** mailparser's text, a scripted responder in the tests, and the official haproxy image. Fewer dependencies under the 7-day release-age rule, and open-source nginx has no active health checks.
- **If you decide otherwise:** The foundation would install the extra packages and the proxy config would change.
- **Refs:** F2.1, F5.2, F7.8; packages/mail, docker/proxy
- **Status:** superseded by TBD-34

## TBD-17 · How 'Couldn't analyze' works when classification is batched
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** F3.4 says output that fails its schema is retried once and then 'the item' is marked Couldn't analyze. Stage two classifies 20 messages per call, so one bad answer could take a whole batch down with it.
- **Options:**
  1. Validate the batch as a whole: if it fails, retry the whole batch once, then mark all 20 messages Couldn't analyze
  2. Validate each item: keep the valid items, retry only the invalid or missing ones in a single follow-up call (it counts toward the run budget), then mark only those as Couldn't analyze
- **Chosen:** Validate each item and retry only the invalid or missing ones once. When the budget has no call left for the retry, those items stay pending (not_retried) instead of being marked Couldn't analyze, so a later Analyze them run can pick them up. F3.4 speaks of 'the item', and users see far fewer false 'Couldn't analyze' labels. The retry is a model call and counts toward the budget, as F4's definition of a model call requires, and S8's 'exactly 5 calls' stays exact.
- **If you decide otherwise:** packages/ai's batch validation and the scan worker's handling of failed items would change, and the fake-AI fixture for the invalid message would need a whole batch to fail.
- **Refs:** F3.4, F4.4, F4.5; packages/ai, apps/server/src/jobs/scan, e2e/fixtures/ai
- **Status:** open

## TBD-18 · The name of the personal workspace
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** F1.1 gives the example "Maria's workspace" for Maria Santos, but the registration form takes one name field.
- **Options:**
  1. Use the first word of the name: "<first word>'s workspace"
  2. Use the full name: "Maria Santos's workspace"
- **Chosen:** Use the first word of the name, so 'Maria Santos' gets "Maria's workspace". It matches the spec's example and S1's expected text. The workspace can be renamed later, so this is easy to change.
- **If you decide otherwise:** Change the workspace naming in the foundation's register handler and its test.
- **Refs:** F1.1, S1; apps/server/src/routes/auth.ts
- **Status:** open

## TBD-19 · When the intake extra questions are asked for, and how it stays one call
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** F6 lets the model propose the wording of up to five extra questions (task intake.v1). Either the scan worker asks when the first scan stops, or the intake route asks the first time the form is opened after that stop. Asked lazily, two replicas, two tabs or a viewer opening the form at the same moment could each make the call.
- **Options:**
  1. The scan worker calls intake.v1 when the first scan stops, inside the run budget
  2. The intake route calls intake.v1 once, the first time proposals are requested after the first scan stops, claimed through an intake_extras row (insert-or-skip); other callers get 'pending' and an SSE update; usage recorded with no scan id
- **Chosen:** The intake route calls it once, claimed through the intake_extras row; anyone who can open the form (viewers too) may trigger it; usage is recorded with scan_id null; a claim stuck for more than 2 minutes can be taken over by one caller. The intake slice owns the call from end to end, so the scan and intake slices never write each other's tables. The claim row makes it exactly one call across replicas and tabs, and the call never holds a transaction open while the model answers.
- **If you decide otherwise:** The scan worker would make the call when the first scan stops and store the questions, the intake route would only read them, the call would count toward the run budget, and intake_extras would lose its claim columns.
- **Refs:** F6.1, F3.6, F4.4; apps/server/src/routes/intake.ts, packages/db intake_extras, apps/server/src/jobs/scan
- **Status:** open

## TBD-20 · The intake.v1 input: its shape, its summary line format, and snippets as item text
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** aiClient.intake and the intake.v1 wire sample take an IntakeExtraInput that the plan never defined, while intake-profile builds it and the connect slice consumes it in parallel. The prompt's summary block of current answers was described only loosely, and the route would need full bodies to give the model more than the snippet.
- **Options:**
  1. Leave the input loosely described and let the two slices agree on it later
  2. Pin IntakeExtraInput in packages/schema as {items: AiMailItem[] (at most 20), answers: [{key, value, confidence}]}, and the summary as `=== summary ===`, one `| <key> [<confidence|none>]: <single-line JSON value>` line per answer, `=== end summary ===`; items are the answered entries' evidence messages, newest first, with the stored snippet as text
- **Chosen:** The pinned schema and line format, committed in the foundation's intake.v1 wire sample; the items carry the stored snippet, so the intake route never fetches bodies. Both slices and the fake AI can be built and checked against the same golden sample before they meet. The summary lines are prefixed like mail content, so values worded in the mail can't break out of the data block. Using snippets keeps the route fast and adds no mailbox round trips; the model only proposes question wording, which the snippet and the current answers are enough for.
- **If you decide otherwise:** If the owner wants richer extra questions, the intake route would fetch bodies through fetchBody, the items' text would change, and the intake.v1 wire sample, the fake AI's tests and the intake route tests would be updated together.
- **Refs:** F6.1, F3.5; packages/schema ai, e2e/fixtures/wire/intake.v1.*, packages/ai, apps/server/src/routes/intake.ts
- **Status:** open

## TBD-21 · e2e becomes a pnpm workspace package
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** Playwright, the seed loader and the fake AI need their own dependencies, and the rules say dependencies go in the package that uses them. pnpm-workspace.yaml lists only apps/* and packages/*.
- **Options:**
  1. Add e2e to pnpm-workspace.yaml with its own package.json
  2. Put the e2e dependencies in the root package.json
- **Chosen:** Add e2e as a workspace package (@playwright/test and imapflow). ARCHITECTURE is updated, and e2e still imports no app or package code. It keeps the rule of putting dependencies in the package that uses them, and keeps the test-stack images small and on their own.
- **If you decide otherwise:** Move the e2e dependencies to the root and drop e2e from pnpm-workspace.yaml and the vitest projects.
- **Refs:** F7.8; pnpm-workspace.yaml, e2e/package.json, docs/ARCHITECTURE.md
- **Status:** open

## TBD-22 · How the work is cut: a test-stack slice of its own, mailbox and AI provider merged, scan kept whole
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** The e2e-fixtures slice carried the fixture generator for about 750 multilingual messages, every fake-AI answer, the fake AI, the seed, compose.e2e with haproxy, e2e.Dockerfile, stack.ts, the Playwright config and a smoke spec: too much for one agent, and none of the Docker parts run before Validate. The workflow allows at most six slices, and the foundation is the one serial step. The mailbox and AI-provider slices were each small, and scan sits at the size limit.
- **Options:**
  1. Move the stack plumbing back into the foundation
  2. Give the stack plumbing (compose.e2e, proxy, e2e.Dockerfile, seed, stack.ts, Playwright config, smoke spec; F7.8) its own test-stack slice, merge mailbox and ai-provider into one connect slice to stay at six, and leave e2e-fixtures with the format, generator, fixtures and fake AI (F5.3)
- **Chosen:** A test-stack slice, a merged connect slice, and e2e-fixtures limited to the test data and the fake AI. The two e2e slices share only the file conventions the foundation pins (mail layout, the envelopes.json fields the seed reads, the fake AI's entry point and variables). Scan stays one slice; moving the scan queries to the foundation takes part of its load away, and splitting stage one from the worker would bring back the cross-slice stub problem. It keeps the foundation from growing, splits the heaviest slice in two independent halves that run in parallel, and the merged connect slice is still a moderate size because the foundation now owns the mailbox and AI-settings queries.
- **If you decide otherwise:** The foundation would build the Docker test stack, adding to the one serial step, and mailbox and AI provider could stay separate slices.
- **Refs:** F7.8, F5.3, F2, F3; e2e/, docker/compose.e2e.yaml, docker/proxy, docker/e2e.Dockerfile
- **Status:** open

## TBD-23 · The foundation implements the mailbox, AI-settings and scan queries
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** The scan worker and the job-inbox body endpoint read the workspace's mailbox connection and AI settings, and the intake routes read the latest scan. Those queries were stubs owned by slices built in parallel, so the dependent tests couldn't pass on their own branches, and seeding the rows through raw Drizzle would break the workspace-scoped data-access rule.
- **Options:**
  1. Keep the queries slice-owned and accept tests that pass only after integration
  2. The foundation fully implements and tests getMailboxConnection, createMailbox, deleteMailbox, getAiSettings, saveAiSettings and the scans queries (createScan, getScan, getLatestScan, updateScanProgress, stopScan), plus seedMailbox, seedAiSettings and seedScan test helpers that seal secrets and write through them; the connect and scan slices own only routes, validation, sealing, workers and UI
- **Chosen:** The foundation implements them. They take and return ciphertext only; sealing, input checks, the 'one mailbox' message and the public response shapes stay with the connect slice. Every level-1 slice's tests can pass on its own branch, seeding stays workspace-scoped, and intake-profile's route tests no longer depend on the scan slice merging.
- **If you decide otherwise:** The queries would move back to the connect and scan slices and the scan worker, job-inbox body and intake route tests would be written against fakes of them or only pass after integration.
- **Refs:** F2.3, F3.3, F4.1, F5.2, F6.1; packages/db/src/queries/mailboxes.ts, ai-settings.ts, scans.ts, apps/server/src/testing
- **Status:** open

## TBD-24 · The test stack is exercised only in Validate
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** No slice may start Docker, so compose.e2e.yaml, the proxy config and e2e.Dockerfile can't be run before Validate.
- **Options:**
  1. Leave them untested until Validate
  2. Check them with pure tests that parse the compose file and the haproxy config, inject the command runner into stack.ts, and test the seed against a double
- **Chosen:** Pure tests in the test-stack slice; the real stack starts first in Validate, whose fix rounds own anything only Docker can show. It catches most mistakes on the slice's branch without breaking the hermetic-test rule.
- **If you decide otherwise:** A Docker smoke step would have to be added to the slice build, which the workflow forbids.
- **Refs:** F7.8, F7.7; docker/compose.e2e.yaml, docker/proxy, e2e/stack.ts, e2e/seed
- **Status:** open

## TBD-25 · Prompt layout and escaping of untrusted mail (F3.5)
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** The fake AI must find the task id and Message-IDs in the prompt, and F3.5 requires mail content to be clearly separated and delimiter look-alikes neutralised, without mangling '<...@...>' Message-IDs. The response mode (JSON content versus tool calls) must also match the fake AI.
- **Options:**
  1. Escape delimiter character sequences inside the content (e.g. replace <<< and >>>)
  2. Write Message-IDs verbatim on their own column-0 line and prefix every untrusted content line with '| ', so no content line can look like a delimiter or a Message-ID line; answers as JSON in choices[0].message.content with response_format json_schema
- **Chosen:** Column-0 structure lines, verbatim Message-ID lines, every untrusted line (and every intake summary line) prefixed with '| '; json_schema structured output read from the message content, never tool calls, for the openai-compatible provider. The prefix can't be defeated by any content and changes nothing else in the mail, Message-IDs stay exact for the fake AI and the stored ids, and JSON content is what every OpenAI-compatible server (Ollama, LM Studio) supports.
- **If you decide otherwise:** The golden samples in e2e/fixtures/wire, the packages/ai prompt builder and the fake AI's parser change together.
- **Refs:** F3.5, F3.4, S2, S3; packages/ai, e2e/fake-ai, e2e/fixtures/wire
- **Status:** open

## TBD-26 · Messages are named by their RFC Message-ID everywhere
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** Evidence links, AI prompts, fixtures, expected.json and the API all need to point at a message, and a takeover must upsert the same message idempotently.
- **Options:**
  1. Use the database uuid in the API and map Message-IDs to it
  2. Use the RFC Message-ID (verbatim, with angle brackets; a stable synthetic id when missing) as the message id outside the database, unique per workspace
- **Chosen:** The RFC Message-ID, with a unique key on (workspace_id, message_id). One id from the mailbox to the model to the UI means no mapping step, fixtures and ground truth line up directly, and the unique key makes re-running a batch harmless.
- **If you decide otherwise:** Add a mapping from Message-ID to uuid in the inbox and intake routes and translate evidence ids.
- **Refs:** F4.8, F5.3, F6.2; packages/schema, packages/db messages, apps/server/src/routes/messages.ts
- **Status:** open

## TBD-27 · A message-detail deep link in the web app
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** S4 and F6.2 need the intake form's evidence links to open a message, the user's own replies included, which the inbox list doesn't show. The inbox slice could build the detail as in-page state only, and the intake slice can't add a route to routes.tsx.
- **Options:**
  1. Detail as in-page state of InboxPage, reachable only from the list
  2. A URL per message, /w/:workspaceId/inbox/<URL-encoded Message-ID>, registered by the foundation with a paths.message helper and a messageId prop on InboxPage, used by both the inbox and the intake slices
- **Chosen:** The deep link, registered by the foundation; Enter on the list navigates to it and Esc navigates back to the list. Evidence links become ordinary links that work in a new tab and after a reload, Back behaves as people expect, and both slices build against the same route without touching routes.tsx.
- **If you decide otherwise:** InboxPage would hold the open message in state and the intake page would need another way (a drawer or a dialog of its own) to show evidence messages.
- **Refs:** F6.2, F5.2, S4, S5; apps/web/src/routes.tsx, apps/web/src/paths.ts, apps/web/src/pages/inbox, apps/web/src/pages/intake
- **Status:** open

## TBD-28 · Sender and subject search uses the pg_trgm extension
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** F5.5 needs search by sender or subject and a fast first page; substring search can't use a plain btree index.
- **Options:**
  1. A GIN pg_trgm index on a generated lower-case search_text column (CREATE EXTENSION in the migration; PGlite loads its pg_trgm contrib extension in tests)
  2. Plain ILIKE scans within the workspace's date index, no extension
- **Chosen:** pg_trgm with a GIN index on search_text. It keeps search fast as mailboxes grow past MVP 1 sizes, and pg_trgm is a trusted extension available on standard Postgres images and managed services.
- **If you decide otherwise:** Drop the extension and the GIN index from the migration and search with ILIKE; any Postgres that can't create the extension would need this.
- **Refs:** F5.5; packages/db/migrations, packages/db/src/testing.ts, packages/db/src/queries/inbox.ts
- **Status:** open

## TBD-29 · How intake answers are aggregated, and what 'equal to expected.json' means
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** F6.6 requires Maria's proposals to equal expected.json, but the generator and aggregateIntake are built by different slices, and the evidence available at a confident stop depends on how much mail was read.
- **Options:**
  1. Let intake-profile choose its own rules and fit expected.json afterwards
  2. Fix the aggregation rules in the plan (replies win for a key they state; job facts need 5 messages; no evidence means empty); values and evidence ids must match exactly, only the confidence level and the reason wording are calibrated, and an answer's confidence depends only on its own evidence
- **Chosen:** Fixed shared rules; exact values and evidence over the full fixtures and at the confident stop (which the fixture property below makes possible). Neither slice reverse-fits the other's numbers, and S4 sees the right answers (Amsterdam, both minimum pays, their evidence) whatever point the scan stops at.
- **If you decide otherwise:** The generator, aggregateIntake and the fixture tests change together.
- **Refs:** F6.2, F6.3, F6.6, S4; packages/core/src/intake, e2e/fixtures/build
- **Status:** open

## TBD-30 · Maria's replies state every answer she has, in at least two replies each
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** The tracker compares answers after every classify batch and the replies are read first, so if nothing changes in batches 1 and 2 the run stops after 40 analysed messages. Answers derived from job mail need 5 job messages with the same value (rule 3); nothing guaranteed those were among the first 40, so the stop could come with target_roles or seniority empty or different from expected.json.
- **Options:**
  1. Require Maria's replies to state every core key she has an answer for, target_roles and seniority included, in at least 2 replies each
  2. Keep job-derived answers and pin that every job-derived value reaches 5 messages (10 for medium) within the first classify batch, checked from recorded stage-one verdicts
- **Chosen:** Every answered key of Maria's comes from at least 2 of her replies (reply_to and deal_breakers are stated in at least 2 or left empty). Each message's intended stage-one verdict is still recorded in the source of truth, and the e2e-fixtures consistency tests check the property, the placement rules and that her prefs answers alone already give the full ground truth. The proposal is final before the first classify batch, so the confident stop after 40 messages is deterministic and exact, and the property can be checked from the fixtures alone. It matches the persona: her 15 replies state her preferences. Rule 3 stays fully tested in intake-profile's unit tests.
- **If you decide otherwise:** The generator would make some of Maria's answers job-derived and place 5 (or 10) matching job messages inside the first classify batch, and the consistency tests would check that instead.
- **Refs:** F4.4, F4.5, F6.6, S3, S4; e2e/fixtures/build, e2e/fixtures/consistency.test.ts, packages/core/src/intake/confidence-stop.test.ts
- **Status:** open

## TBD-31 · Who owns the proof of Maria's confident stop
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** confidence-stop.test.ts lives in intake-profile, which is built after scan, but exercises the scan slice's stageOne, toBatches and createConfidenceTracker. The scan slice can't own it because aggregateIntake and the fixtures are built in parallel with it, and once scan is merged nobody else may change those files.
- **Options:**
  1. The scan slice owns an equivalent test
  2. intake-profile owns it, depends on scan, and may change packages/core/src/scan/** to fix a root cause this test exposes, reporting it under outsideChanges
- **Chosen:** intake-profile owns it, with dependsOn e2e-fixtures and scan, and may fix core/src/scan with a pinning unit test, keeping the scan tests green and reporting the change. If scan failed verification and isn't merged, intake-profile builds everything else against foundation code (scan rows come from the foundation's queries), doesn't reimplement scan, and reports this test as not done for the scan fix task to add. Only a level-2 slice has the real stageOne, tracker, aggregation and fixtures together; letting it fix the cause avoids a dead end where a failing proof has no owner.
- **If you decide otherwise:** A dedicated fix task after integration would own the test and any change to core/src/scan.
- **Refs:** F4.5, F6.6, S3; packages/core/src/intake/confidence-stop.test.ts, packages/core/src/scan
- **Status:** open

## TBD-32 · Confident-stop details: replies first, at least one answer, done wins
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** F4.4's confident rule would be vacuously true with no answers (Tom's thin inbox would stop as 'confident' instead of 'done'), and it would fire before the user's replies are read if they came last.
- **Options:**
  1. Apply the rule literally
  2. Read the user's replies for preferences before the first classify batch; confident needs at least one answered core question; when nothing likely is left the reason is done even if confident also holds
- **Chosen:** Replies first, at least one answered core question, and done wins. It matches S7 ('stops with done') and keeps a confident stop meaningful; the user's own words are the strongest evidence.
- **If you decide otherwise:** The tracker and the worker's ordering in the scan slice change, and Tom's fixture would need a different outcome.
- **Refs:** F4.4, F4.5, S3, S7; packages/core/src/scan, apps/server/src/jobs/scan
- **Status:** open

## TBD-33 · A slow request for the shutdown scenario
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** S11 needs a slow request open on app-b while SIGTERM arrives; the fake AI answers in 300 ms and a debug route in production code is not allowed.
- **Options:**
  1. A debug delay route in the server
  2. FAKE_AI_SLOW_TEST_MS on the fake-ai service (default 0) that delays only ai.test.v1; S11 restarts the stateless fake-ai with 15000 and holds a Settings › AI Test request open
- **Chosen:** The FAKE_AI_SLOW_TEST_MS variable on the fake AI. No production code changes, the delay stays under the 20 s in-flight limit, and normal runs are unaffected.
- **If you decide otherwise:** Another long-running request would be needed in S11.
- **Refs:** F7.4, S11; e2e/fake-ai, docker/compose.e2e.yaml
- **Status:** open

## TBD-34 · No extra mail dependencies; haproxy for the test-stack proxy
- **Kind:** decision
- **Where:** MVP 1 · Plan
- **Context:** packages/mail needs sanitised text from HTML parts and its tests need an IMAP server; the test proxy must route only to ready replicas.
- **Options:**
  1. Add html-to-text and a fake IMAP server package; use nginx
  2. Use mailparser's text (it derives text from HTML-only messages) and a scripted IMAP responder over node:net; use haproxy with active health checks
- **Chosen:** mailparser's text, a scripted responder in the tests, and the official haproxy image. Fewer dependencies under the 7-day release-age rule, and open-source nginx has no active health checks.
- **If you decide otherwise:** The foundation would install the extra packages and the proxy config would change.
- **Refs:** F2.1, F5.2, F7.8; packages/mail, docker/proxy
- **Status:** open

## TBD-35 · Build plan accepted with known problems
- **Kind:** open item
- **Where:** MVP 1 · Plan
- **Context:** After two revisions the plan still had:
  1. Job alerts are contradictory across the scan, e2e-fixtures and intake-profile slices. stageOne puts every alertSenders message in `handled` with verdict job_alert, so it is never a candidate or in a classify batch. But the e2e-fixtures consistency test requires 'a multi-role job alert' to be among 'Maria's newest 40 likely candidates', computed from the recorded verdicts, and with a job_alert verdict it can never be a likely_job candidate. The confident-stop test also asserts the alert 'was analysed', yet the plan never says when the worker makes the extract calls for job_alert messages (all before batch 1, interleaved by date with the classify batches, or after them), whether those calls count toward 'likely' (Y), 'analyzed' (X), notAnalyzed and the budget, or whether the tracker sees their facts. Fix: pin this in the foundation summary, e.g. 'job_alert messages enter the newest-first stream with the candidates, take a slot in the batch window, skip classify and get one extract call; likely = likely_job + job_alert; the S5 placement rule counts both'. Then fixture placement, the worker, the budget arithmetic (S8's 5 calls) and the confident-stop test all agree.
  2. The scan slice has no workspace-scoped query it can call or own for the message rows it has to read back. analyze_rest has to select the pending likely messages newest first, including the not_retried ones left pending, with their uid, uidValidity and snippet to build AiMailItems. NotAnalyzedBanner and ScanProgress.notAnalyzed need a count of likely-but-pending messages. A resumed run may need the rows of the batch it checkpointed. The foundation's messages module only has saveEnvelopes, saveAnalysis, markAnalysisFailed, savePreferences and loadIntakeInput. The scan slice owns no packages/db file, so it would have to edit the foundation's messages.ts or use raw Drizzle in apps/server, and both break the plan or the hard rules. Fix: the foundation implements and tests listPendingCandidates(db, workspaceId, {limit, before?}) and countNotAnalyzed(db, workspaceId) (and getMessagesByMessageIds if the resume needs it), or gives scan its own empty module, e.g. packages/db/src/queries/scan-messages.ts, re-exported from index.ts.
  3. The state of a message row is not pinned between its writer (scan) and its reader (job-inbox), which are built in parallel. saveEnvelopes 'does not touch analysis columns', so it is undefined whether stage-one not_job rows get category=not_job/categorySource=scan, what a job_alert row's category is before its extract runs, and whether a likely row that is still pending (category null, analysis_status pending) is listed, counted as non-job or only counted in 'N more not analyzed'. job-inbox's list query, nonJobCount and the 'Couldn't analyze' rows depend on exactly this. Fix: put a small state table in the foundation (stage_one × category × analysis_status → listed / counted as non-job / counted as not analyzed / Couldn't analyze), have saveEnvelopes set category not_job (source scan, status done) for stage-one not_job, and test it in messages.test.ts.
  4. `pnpm check` will pick up the Playwright specs. The root vitest projects include e2e, and Vitest's default include matches `*.spec.ts`, so the test-stack slice's e2e/specs/mvp-1/*.spec.ts would run under Vitest and fail when it calls @playwright/test's test(). No slice owns e2e/vitest.config.ts. Fix: the foundation adds e2e/vitest.config.ts (defineProject, exclude specs/** and .stack) to its owned paths.
  5. Biome formats the generated fixtures, but no slice can change biome.json. `pnpm lint` is `biome check .` with the formatter on and files.includes '**'. The e2e-fixtures generator must reproduce its committed JSON (envelopes.json, expected.json, ai/*.json) byte for byte, and JSON.stringify(x, null, 2) output differs from what Biome's formatter produces with lineWidth 100, so lint fails or `pnpm format` rewrites the files and the byte-for-byte check breaks. biome.json belongs to the foundation. Fix: the foundation excludes generated fixture data (e2e/fixtures/{maria,tom,ai}/**, and e2e/fixtures/wire/** unless it hand-formats those) in biome.json, or pins that the generator writes Biome-formatted output.
  6. knip.jsonc gives no entry points for the e2e package. e2e/fake-ai/main.ts and the seed entry are started only from compose and the Dockerfile, and the e2e/fixtures/build generator is run by hand, so knip reports them as unused files and `pnpm unused` fails after integration. The integrator is told only to remove ignore entries. Fix: the foundation's knip.jsonc declares the e2e workspace entries (stack.ts, fake-ai/main.ts, seed/main.ts or its fixed name, fixtures/build/main.ts or its fixed name, playwright.config.ts, specs/**), and section 8 pins the seed and generator entry file names.
  7. The e2e-fixtures slice is too big for one agent: a deterministic generator for about 750 multilingual messages with ground truth, the expected profiles under the exact aggregation rules, four answer files per persona, the full consistency suite, the server-side schema test, and also the fake-AI HTTP server with its wire-contract tests. The test-stack slice is small by comparison. Fix: move e2e/fake-ai/** and its tests to test-stack, and pin the e2e/fixtures/ai/<persona>/<task>.json answer format (keyed by Message-ID, the {invalid: true} form, ai.test.json, none/intake.json) in foundation section 8 so the two slices still need nothing from each other.
  8. The mailbox contract can't carry the Sent folder path. createMailbox requires sentFolderPath, but MailTestResult is {ok: true, folders: string[]} and MailClient has no way to report the Sent folder it found by special-use flag. MailConnection has no sentFolderPath either, so the stored value is never used by fetchEnvelopes({folder: 'sent'}). The connect slice would have to change a foundation schema. Fix: MailTestResult ok carries {folders, inboxPath, sentPath} (or the client takes sentFolderPath in its options), pinned in packages/schema.
  9. Gaps in the queue and scan contracts the scan slice relies on. The jobs module lists claim, renew, take over and hand back, but no enqueue, so it is unclear how POST /scans creates the 'scan.run' job, or whether createScan and enqueue happen in one transaction so a queued scan can't be left without a job. Cancel semantics are not pinned either: updateScanProgress takes a status and can move a scan that stopScan has just stopped as cancelled back to running. Fix: add enqueueJob (or createScan({..., enqueue: true}) in one transaction), and make updateScanProgress a no-op on stopped scans, with tests.
  10. intake-profile's fallback covers an unmerged scan slice but not an unmerged e2e-fixtures slice. Its fixture tests (F6.6) and the confident-stop test read e2e/fixtures, so if e2e-fixtures fails verification the slice has no stated behaviour. Fix: the same rule as for scan — build everything else, report the fixture-based tests under notDone, never commit them skipped or failing, and the fix task adds them.
  11. Message-IDs in API paths are tested only on the web side (App.test.tsx, InboxPage). Nothing pins that Hono's /:messageId and /:messageId/body handle an encoded '/', '%' and '+' in a Message-ID. Fix: add a route test to job-inbox's messages.test.ts with a Message-ID containing <, >, @, /, + and %.
- **Options:** —
- **Chosen:** —
- **If you decide otherwise:** —
- **Refs:** —
- **Status:** open

## TBD-36 · MailTestResult reports the Sent folder
- **Kind:** decision
- **Where:** MVP 1 · Foundation
- **Context:** createMailbox needs sentFolderPath, but MailTestResult {ok:true, folders} had no way to carry the Sent folder found by special use (TBD-35 item 8).
- **Options:**
  1. Keep {ok:true, folders} and let the connect slice guess Sent from folder names
  2. Add sentPath: string | null to the ok variant
- **Chosen:** MailTestResult ok = {ok: true, folders: string[], sentPath: string | null}. The connect slice can store the folder the server marks \Sent without changing a foundation schema; it is a superset of the pinned shape.
- **If you decide otherwise:** Remove sentPath from packages/schema/src/mailbox.ts; packages/mail would find Sent another way when fetching envelopes.
- **Refs:** F2.1, F4.1; packages/schema/src/mailbox.ts; TBD-35 item 8
- **Status:** open

## TBD-37 · State of a message row from stage one to analysis
- **Kind:** decision
- **Where:** MVP 1 · Foundation
- **Context:** saveEnvelopes 'doesn't touch analysis columns', but the scan (writer) and job-inbox (reader) slices need a pinned state for new rows (TBD-35 item 3).
- **Options:**
  1. Leave category null for every new row
  2. Set the initial state by stage-one verdict on insert only
- **Chosen:** On insert: not_job -> category not_job/scan/done; job_alert -> category job_alert/scan/pending; likely_job and own_reply -> null/pending. Re-saving the same Message-ID refreshes headers and verdict and never touches category, analysis or roles. The table sits in packages/db/src/queries/messages.ts with listing, non-job and 'not analyzed' rules. The inbox can count non-job mail and show alerts from the headers alone; a resumed scan stays idempotent.
- **If you decide otherwise:** Change initialAnalysis() in messages.ts and its test; job-inbox's list query follows.
- **Refs:** F4.2, F5.1, F4.10; packages/db/src/queries/messages.ts
- **Status:** open

## TBD-38 · Who may accept an invite
- **Kind:** decision
- **Where:** MVP 1 · Foundation
- **Context:** F1.6 has invites by email and a link to copy; the link needs a meaning.
- **Options:**
  1. Only the signed-in user whose email matches
  2. Email match, or anyone signed in who holds the link's token
- **Chosen:** Accept, decline or view an invite when the signed-in email matches it, or the request carries the link's token (stored as SHA-256). Otherwise the answer is 404. It makes the copied link useful when the invitee uses another address. The admin hands the link out on purpose, and the token is 256 bits.
- **If you decide otherwise:** Drop tokenMatches from routes/invites.ts; the link would only bring the invitee to the page.
- **Refs:** F1.6; apps/server/src/routes/invites.ts, routes/workspaces.ts
- **Status:** open

## TBD-39 · A session endpoint that never answers 401
- **Kind:** decision
- **Where:** MVP 1 · Foundation
- **Context:** Every signed-out page load produced a failed 401 request in the browser console, which the validation protocol counts as a finding.
- **Options:**
  1. Keep /api/auth/me and accept a console error
  2. Add GET /api/auth/session returning 200 {user: null} and keep /me at 401
- **Chosen:** GET /api/auth/session (SessionStateSchema); the UI uses it, and /api/auth/me stays 401 for probes. The console stays clean, and the S10 probe (old cookie gets 401) still holds on /me and on workspace routes.
- **If you decide otherwise:** The UI would call /me again and the walkthrough would allow that error.
- **Refs:** F1.4, S10; apps/server/src/routes/auth.ts, apps/web/src/hooks/useSession.ts
- **Status:** open

## TBD-40 · PGlite test projects run without per-file isolation
- **Kind:** decision
- **Where:** MVP 1 · Foundation
- **Context:** Starting PGlite costs about 7 s of CPU per test file; with isolated files the db tests timed out under parallel load.
- **Options:**
  1. Raise the timeouts and keep isolation
  2. Run packages/db and apps/server with isolate:false, reuse each worker's PGlite instances (emptied between tests), maxWorkers 4
- **Chosen:** isolate:false for @jobfilly/db and @jobfilly/server (30 s hook timeout), maxWorkers 4; openTestDatabase pools instances per process and truncates on close. The whole suite runs in about 15 s instead of timing out. Slices are told (vitest.config.ts and ARCHITECTURE) to inject fakes rather than use vi.mock in those projects.
- **If you decide otherwise:** Set isolate back to true in vitest.config.ts and accept much slower db and server tests.
- **Refs:** F7.7; vitest.config.ts, packages/db/src/testing.ts
- **Status:** open

## TBD-41 · Typed Hono client replaced by fetch with schema validation
- **Kind:** decision
- **Where:** MVP 1 · Foundation
- **Context:** The web used hc<AppType>, which only types routes mounted in one chain. Route modules that slices replace would break the type chain and couple web to server.
- **Options:**
  1. Keep hc and chain every route
  2. A small api(path, schema) fetch helper that parses answers with @jobfilly/schema
- **Chosen:** apps/web/src/api.ts with api() and apiVoid() plus ApiError. The web dropped its hono and @jobfilly/server dependencies. It is decoupled from route module internals and validates answers where they enter, per the schemas-first rule.
- **If you decide otherwise:** Re-add hono and the server dev dependency and chain every route in app.ts.
- **Refs:** apps/web/src/api.ts, apps/web/package.json
- **Status:** open

## TBD-42 · Values of extra intake answers and the task in usage rows
- **Kind:** decision
- **Where:** MVP 1 · Foundation
- **Context:** The spec fixes the core keys' value shapes but not extra.<slug> ones, and Usage {task} could be a task (classify) or a task id.
- **Options:**
  1. extra value as string; Usage.task as the four tasks
  2. extra value as string[] (empty = []); Usage.task as the TaskId
- **Chosen:** Extra answers are string[] (the chosen option or the words), so every empty answer is []. Usage.task is a TaskId including ai.test.v1. The rule 'empty value is []' from IntakeExtraInput holds for every key, and the Test call's usage can be recorded too.
- **If you decide otherwise:** Change ExtraValueSchema and UsageSchema in packages/schema plus the wire samples.
- **Refs:** F6, F3.6; packages/schema/src/profile.ts, ai.ts
- **Status:** open

## TBD-43 · Password hash cost and where migrations ship
- **Kind:** decision
- **Where:** MVP 1 · Foundation
- **Context:** F1.5 needs scrypt; the server bundle has to find its migrations both in Docker and in a local `node dist/index.js`.
- **Options:**
  1. N=2^17, r=8, p=1 (128 MiB per hash)
  2. N=2^15, r=8, p=3 (OWASP equivalent, 32 MiB)
  3. Ship migrations in a separate Docker COPY, or in dist/migrations
- **Chosen:** scrypt N=2^15, r=8, p=3, with the parameters stored per hash. Test seeding uses cheap parameters that verify through the same code. The build copies the migrations to dist/migrations, which pnpm deploy ships in the image. Memory per sign-in stays bounded in small containers. One folder layout works in Docker and locally.
- **If you decide otherwise:** Change PASSWORD_PARAMS in auth/password.ts (old hashes still verify), or the tsup onSuccess copy and MIGRATIONS_FOLDER lookup.
- **Refs:** F1.5, F7.5; apps/server/src/auth/password.ts, apps/server/tsup.config.ts, packages/db/src/migrate.ts
- **Status:** open

## TBD-44 · The owner can't be demoted, and the e2e scripts' subcommands
- **Kind:** decision
- **Where:** MVP 1 · Foundation
- **Context:** The spec says the owner can't be removed and fixes the root scripts as 'node e2e/stack.ts ...' without the subcommand names.
- **Options:**
  1. Allow changing the owner's role
  2. Refuse it (409) like removal
- **Chosen:** Changing or removing the owner's role answers 409 'The owner is always an admin'. The root scripts are e2e = 'node e2e/stack.ts run', e2e:stack = 'node e2e/stack.ts stack' (+ up|down), e2e:specs = 'node e2e/stack.ts specs' (+ --mvp n), pinned in ARCHITECTURE for the test-stack slice. ARCHITECTURE says the owner is an admin who can't be removed. Fixed subcommands let the test-stack slice write stack.ts without editing package.json.
- **If you decide otherwise:** Allow setMemberRole on the owner in packages/db workspaces.ts; rename the script arguments in package.json and stack.ts together.
- **Refs:** F1.8, F7.8; packages/db/src/queries/workspaces.ts, package.json, docs/ARCHITECTURE.md
- **Status:** open

## TBD-45 · Wire request samples use the SDK default strict: true; prefs.v1's optional keys conflict with OpenAI strict mode
- **Kind:** decision
- **Where:** MVP 1 · Foundation
- **Context:** The finding asked for the samples to match the request the AI SDK sends, or for a documented strictJsonSchema choice. The openai-compatible provider sends json_schema.strict = true by default. The prefs.v1 output schema (PreferencesSchema) leaves every key optional, so its properties are not all in `required`. OpenAI's strict structured-output mode rejects such a schema, while the fake AI and many other compatible servers accept it.
- **Options:**
  1. Keep the SDK default strict: true in the samples and leave the prefs.v1 schema question to the connect slice
  2. Pin strictJsonSchema: false through providerOptions and put strict: false in the samples
  3. Make every PreferencesSchema key required and nullable now
- **Chosen:** I kept the SDK default, strict: true, in every sample, and pinned it with packages/ai/src/wire.test.ts. The samples should be what the SDK really sends, with no extra options for the connect slice to copy. Changing PreferencesSchema is a cross-slice schema change that this fix task should not make.
- **If you decide otherwise:** If prefs.v1 is meant to work against OpenAI proper, the connect slice either makes the PreferencesSchema keys required and nullable, or passes strictJsonSchema: false. In both cases it regenerates prefs.v1.request.json (or all samples) with the wire test's capture.
- **Refs:** e2e/fixtures/wire/*.request.json; packages/ai/src/wire.test.ts; packages/schema/src/wire.test.ts; packages/schema/src/profile.ts (PreferencesSchema); docs/ARCHITECTURE.md (wire contract)
- **Status:** open

## TBD-46 · Boundary change: two deliberate unscoped @jobfilly/db operations
- **Kind:** decision
- **Where:** MVP 1 · Foundation
- **Context:** The hard rule says workspace data goes only through packages/db functions that take a workspace id. Two groups of functions cannot take one by design. The invitee answering an invite is not a member yet. The queue worker serves every workspace and acts on the job it holds.
- **Options:**
  1. Give these functions a workspace id too
  2. Keep them id-only and name them as deliberate exceptions
- **Chosen:** I kept getInviteForResponse, acceptInvite and declineInvite (called after the server checks the invite's email or token) and claimJob, renewLease, saveJobCheckpoint, completeJob and handBackJob (guarded by the lease owner) without a workspace id. I named them as exceptions in ARCHITECTURE › Workspaces, access and sessions, in packages/db/src/index.ts and in the module comments. getJob is now workspace-scoped, and there is no raw-SQL export. There is no workspace id the caller could rightly supply before the invitee joins or before a worker claims a job. Passing the row's own workspace id back in would add nothing.
- **If you decide otherwise:** Invite answering would need a separate token-to-workspace lookup step, and the worker functions would take the claimed job's workspaceId, which changes their signatures and callers in the scan slice.
- **Refs:** packages/db/src/index.ts; packages/db/src/queries/invites.ts; packages/db/src/queries/jobs.ts; docs/ARCHITECTURE.md
- **Status:** open

## TBD-47 · A malformed path id gets 404 not_found, not 400
- **Kind:** decision
- **Where:** MVP 1 · Foundation
- **Context:** validJson and validQuery answer 400 with a message. The finding asked for a 404, not a 500, when a :userId or :inviteId is malformed.
- **Options:**
  1. 400 invalid, like the body and query validators
  2. 404 not_found, the same answer as an id that does not exist
- **Chosen:** validParam answers 404 { error: "not_found" }. IdSchema is z.guid() (any 8-4-4-4-12 hex), which matches the regex the server used before for workspace and invite ids. An id that cannot parse names nothing. Answering the same way as for a missing row reveals nothing extra, and it matches workspaceMember's behaviour.
- **If you decide otherwise:** Change validParam's failure answer to the validator's 400 and update the two new route tests.
- **Refs:** apps/server/src/access/validate.ts; packages/schema/src/common.ts; apps/server/src/routes/workspaces.test.ts; apps/server/src/routes/invites.test.ts
- **Status:** open

## TBD-48 · TBD.md duplicates marked 'superseded by', including TBD-9 by TBD-22
- **Kind:** decision
- **Where:** MVP 1 · Foundation
- **Context:** The rules say TBD entries are never deleted and the owner sets their status. The finding asked that each open decision appear once, with one answer. TBD-9 ('test stack built by the e2e-fixtures slice') is contradicted by TBD-22 (a test-stack slice of its own), but the finding did not list that pair.
- **Options:**
  1. Merge the entries and delete the earlier ones
  2. Mark the earlier ones 'superseded by TBD-<n>' and keep them
- **Chosen:** I marked 16 earlier entries 'superseded by' their latest version, TBD-9 by TBD-22 among them. I also added the status to the entry format and the intro. This keeps the never-delete rule while giving the owner one open answer per decision.
- **If you decide otherwise:** The owner can set TBD-9 back to open if it is meant as a separate decision from TBD-22.
- **Refs:** TBD.md
- **Status:** open

## TBD-49 · A third unscoped db exception: the signed-in user's own view across workspaces
- **Kind:** decision
- **Where:** MVP 1 · Foundation
- **Context:** listWorkspacesForUser(db, userId) and listPendingInvitations(db, email, now) read workspace-owned rows (memberships, invites, workspace names) without a workspace id, and the documented list of exceptions left them out. registerAccount and createWorkspace also take no workspace id, because they create the workspace.
- **Options:**
  1. Document a third exception (by user id or matched email) and note that creating a workspace has no id yet
  2. Restructure the queries so that only the two existing exceptions remain
- **Chosen:** Documented it in docs/ARCHITECTURE.md (Workspaces, access and sessions) and in the packages/db/src/index.ts comment, and added comments to both query functions. Listing your own workspaces and your own pending invitations is cross-workspace by nature: before choosing a workspace, or before being a member, there is no workspace id to scope by. Restructuring would only move the same cross-workspace read somewhere else. The server already limits these reads to the session user's id, or to an email it has matched to them through the session or a checked invite token.
- **If you decide otherwise:** These reads would need a new design, for example a per-user index table or a server-side loop over memberships, and the routes in apps/server/src/routes/workspaces.ts and invites.ts would change.
- **Refs:** docs/ARCHITECTURE.md (Workspaces section); packages/db/src/index.ts; packages/db/src/queries/workspaces.ts; packages/db/src/queries/invites.ts; apps/server/src/routes/invites.ts:43,60; apps/server/src/routes/workspaces.ts:49; commits b1755f7, 75cade7
- **Status:** open

## TBD-50 · Stage one's outcome keeps its three lists, but every entry is a full StageOneResult
- **Kind:** decision
- **Where:** MVP 1 · Foundation
- **Context:** core's StageOneOutcome had handled entries of {messageId, verdict, reason}, while candidates and ownReplies were bare Envelopes. db's saveEnvelopes takes {envelope, verdict, reason}, so the two contracts didn't match.
- **Options:**
  1. stageOne returns one flat StageOneResult[]
  2. Keep handled/candidates/ownReplies (the shape the scan slice's plan refers to), with each entry a StageOneResult whose verdict is restricted to its list
- **Chosen:** Kept the three lists, built on StageOneResultSchema: handled allows not_job or job_alert, candidates allows likely_job, ownReplies allows own_reply. [...handled, ...candidates, ...ownReplies] is exactly saveEnvelopes' input. This keeps the names the plan and TBD-35 use for the scan slice, and makes the outcome exactly what db stores, including the envelope of handled messages, which the old shape dropped.
- **If you decide otherwise:** Switching to a flat list would change StageOneOutcomeSchema and the scan slice's callers. db would not change.
- **Refs:** packages/schema/src/scan.ts; packages/core/src/scan/index.ts; packages/db/src/queries/messages.ts; commits b63c130, 64b1d91, 09c8d3f
- **Status:** open

## TBD-51 · The suggested compose password is hex, not base64
- **Kind:** decision
- **Where:** MVP 1 · Foundation
- **Context:** The finding suggested $(openssl rand -base64 24) for POSTGRES_PASSWORD. The same value is put into DATABASE_URL (postgres://jobfilly:<password>@...), and base64 can contain '/' and '+', which break or change the meaning of the URL.
- **Options:**
  1. openssl rand -base64 24 as suggested
  2. openssl rand -hex 24
- **Chosen:** openssl rand -hex 24 in the compose error message, the header comment and the README. A hex password always fits the connection URL unescaped, so the suggested command can't produce a broken install.
- **If you decide otherwise:** The suggested command would need URL-encoding, or DATABASE_URL would have to be built differently.
- **Refs:** docker/compose.yaml; README.md; commit 8fc830e
- **Status:** open

## TBD-52 · The body is fetched from the folder stored with the message, not from the mailbox's Sent path
- **Kind:** decision
- **Where:** MVP 1 · Build (job-inbox)
- **Context:** The test plan says the body route reads the stored host, credentials and Sent path. Each stored message already records the folder path, UIDVALIDITY and UID where the scan found it, and a UID only means something within that folder.
- **Options:**
  1. Fetch from the message's stored folderPath/uidValidity/uid
  2. For Sent messages, fetch from mailboxes.sent_folder_path instead
- **Chosen:** The message's stored folderPath, UIDVALIDITY and UID. The host, port, TLS mode, user name and sealed password come from getMailboxConnection. UIDs only count inside the folder they came from. Using another folder path would fetch the wrong message, or nothing. If the folder changes, UIDVALIDITY won't match and the user gets the plain 'no longer in the mailbox' answer.
- **If you decide otherwise:** In the /:messageId/body handler, swap ref.folderPath for mailbox.sentFolderPath when the message is in Sent.
- **Refs:** F5.2, F4.9; apps/server/src/routes/messages.ts
- **Status:** open

## TBD-53 · Plain answers when the body can't be fetched
- **Kind:** decision
- **Where:** MVP 1 · Build (job-inbox)
- **Context:** The spec covers only a changed UIDVALIDITY. It doesn't say what to do when no mailbox is connected or the mailbox can't be reached.
- **Options:**
  1. Answer {gone:true} for every failure
  2. Use separate plain error answers
- **Chosen:** No mailbox connected: 409 no_mailbox. Mailbox unreachable: 502 mail_unreachable, 'Couldn't reach your mailbox. Try again in a moment.', with nothing logged, because the error could name the server or the account. A changed UIDVALIDITY or a missing UID: 200 {gone:true}. Saying the message is gone when the mailbox is only unreachable would be wrong. The reason may contain account details, which must never be logged or returned.
- **If you decide otherwise:** Change the three branches in the body handler and the matching tests.
- **Refs:** F5.2; apps/server/src/routes/messages.ts
- **Status:** open

## TBD-54 · Which rows the list shows, and corrections of own replies
- **Kind:** decision
- **Where:** MVP 1 · Build (job-inbox)
- **Context:** The state table lists rows with a job category or failed analysis. It doesn't cover a failed message that a person has corrected to not_job, or a correction of an own reply.
- **Options:**
  1. Always list failed rows
  2. List failed rows only while they have no category; refuse corrections of own replies
- **Chosen:** Listed: a job category, or failed with no category. Corrected to not_job: moves behind the Show toggle and is counted. A category filter returns exactly that category. nonJobCount follows the search. Correcting an own reply answers 409, since replies are never listed. A person's 'not job' correction should take the message out of the job list. Own replies have no category; the intake form reads them for preferences.
- **If you decide otherwise:** Adjust the conditions at the top of packages/db/src/queries/inbox.ts and their tests.
- **Refs:** F5.1, F5.4; packages/db/src/queries/inbox.ts
- **Status:** open

## TBD-55 · The index tests seed 5,000 rows and vacuum, and pay and dates are formatted in the UI's language
- **Kind:** decision
- **Where:** MVP 1 · Build (job-inbox)
- **Context:** With about 600 rows, Postgres judges scanning the job categories cheaper than the trigram index, so it doesn't pick the trigram index for search. Normalised pay ('€450–550 per day') also needs a fixed locale for the format to be predictable.
- **Options:**
  1. Assert index use on 600 rows
  2. Seed 5,000 rows, VACUUM ANALYZE (as autovacuum would) and forbid sequential scans while explaining
- **Chosen:** 5,000 rows with VACUUM ANALYZE for the two EXPLAIN tests. The 600-message timing test stays as the plan says. Numbers, dates and country names use the UI's language, 'en', with a range like '€450–550'. ISO codes are interpreted by Intl; no market data is built in. This shows the query the planner can and does take on a realistic table. A fixed locale keeps the output identical in every environment and matches the app's English copy.
- **If you decide otherwise:** Change UI_LOCALE in apps/web/src/pages/inbox/format.ts (for example to navigator.language) and its tests.
- **Refs:** F5.2, F5.5; packages/db/src/queries/inbox.test.ts, apps/web/src/pages/inbox/format.ts
- **Status:** open

## TBD-56 · Test-stack credentials are fixed, committed test values
- **Kind:** decision
- **Where:** MVP 1 · Build (test-stack)
- **Context:** The replicas need DATABASE_URL and JOBFILLY_SECRET_KEY. The hard rule says secrets never go in the repo. But validation commands such as `docker compose -p <project> -f docker/compose.e2e.yaml kill|logs|run`, and restarting fake-ai with FAKE_AI_SLOW_TEST_MS, read the compose file without any extra env file. Required `${VAR:?}` variables would break those commands.
- **Options:**
  1. Generate a key and password at `up` and require them as environment variables
  2. Fixed test-only values in compose.e2e.yaml, named like the other test secrets
- **Chosen:** Fixed values. The Postgres password is E2E-SECRET-postgres, and the secret key is the readable 32-byte base64 string E2ESECRETjobfillyTestStackOnlyKeyNotForUse0=. Both are commented as test-only for a loopback, disposable stack. Every infrastructure step in the validation protocol keeps working with plain compose commands. The E2E-SECRET naming means the leak checks also catch the database password if it ever reaches a log. These protect nothing real, like the committed E2E-SECRET mailbox passwords the spec already uses.
- **If you decide otherwise:** stack.ts would generate the values and write them to an env file in e2e/.stack. Every documented compose command would then need `--env-file e2e/.stack/env`, and compose.e2e.yaml would use `${VAR:?}`.
- **Refs:** F7.8; docker/compose.e2e.yaml; e2e/stack.test.ts; docs/mvp/README.md (Fixtures, sentinels)
- **Status:** open

## TBD-57 · `stack up` loads both personas' mail before it reports the stack ready
- **Kind:** decision
- **Where:** MVP 1 · Build (test-stack)
- **Context:** The commands table only says `up` starts a fresh stack and prints its name. But the Validate step runs specs and the S1 walkthrough straight after `up`, and S1 expects 'Connected: Inbox, Sent' with Maria's mail present. A second load into a non-empty mailbox is refused, so seeding has to happen exactly once per stack.
- **Options:**
  1. Seed in `up` after readiness
  2. Leave seeding to the specs or to the walkthrough agent
- **Chosen:** After the proxy and both replicas answer ready, `up` runs `docker compose ... run --rm seed load maria` and `... load tom`. A seed failure fails `up` and takes the stack down. A stack from `up` is then ready for any run in the same state every time, and nobody can forget the seed step or run it twice.
- **If you decide otherwise:** Remove the PERSONAS loop from up() in e2e/stack.ts and its tests. The first spec or walkthrough step would have to run seed load.
- **Refs:** F7.8, S1; e2e/stack.ts; .claude/workflows/build-mvp.js (validation run)
- **Status:** open

## TBD-58 · The seed runs on demand in a compose profile; down removes one-off containers by label
- **Kind:** decision
- **Where:** MVP 1 · Build (test-stack)
- **Context:** The seed is a command tool (`seed load|deliver|inspect`), not a server. I tested compose v5: `down --volumes --remove-orphans` leaves `compose run` one-off containers behind (also with --profile), and with them the network and volumes they hold.
- **Options:**
  1. A long-running seed container driven with `compose exec`
  2. `compose run --rm seed <command>` with the service in a `tools` profile, and down removing leftover containers by the compose project label
- **Chosen:** The seed is in profile `tools`, so `up` doesn't start it, and its entrypoint is `node e2e/seed/main.ts`. `down` runs compose down, removes any container still labelled with the project, runs compose down again, and checks by label that no container, network or volume is left before forgetting the stack. Seed commands then read as `run --rm seed load maria`, matching the spec's `seed <command>` wording. Down also guarantees F7.8's 'no container, network or volume remains' even after an interrupted seed run, and proves it.
- **If you decide otherwise:** Give the seed a long-running command and switch stack.ts to `compose exec seed node e2e/seed/main.ts ...`. The leftover-container step could then go.
- **Refs:** F7.8; docker/compose.e2e.yaml (seed); e2e/stack.ts down(); e2e/stack.test.ts
- **Status:** open

## TBD-59 · How seed load writes the envelopes.json folder values and flags
- **Kind:** decision
- **Where:** MVP 1 · Build (test-stack)
- **Context:** The foundation sets the envelopes.json fields but not the exact values of `folder` or the IMAP flags. The e2e-fixtures slice writes these files in parallel. GreenMail has only INBOX until a folder is created.
- **Options:**
  1. Accept exactly "inbox"/"sent"
  2. Accept inbox/sent in any case (also "INBOX", "Sent")
- **Chosen:** Any case of inbox/sent is accepted (matching mail/<inbox|sent>). Mail goes to INBOX and a created "Sent" folder (GreenMail and imapflow then report it as \Sent). Inbox mail is appended unread, Sent mail with \Seen. The file's Message-ID must equal envelopes.json's messageId, or the load stops before touching the mailbox. The slices can't disagree on the folder spelling, and a mismatched fixture fails loudly instead of loading wrong data.
- **If you decide otherwise:** Change FLAGS or the folder check in e2e/seed/load.ts and its tests.
- **Refs:** ARCHITECTURE › Testing (test-stack conventions); e2e/seed/load.ts; e2e/seed/load.test.ts
- **Status:** open

## TBD-60 · Pinned images for the proxy and the mail server
- **Kind:** decision
- **Where:** MVP 1 · Build (test-stack)
- **Context:** The test stack needs images for the proxy and the mail server. TBD-16/34 chose haproxy and GreenMail.
- **Options:**
  1. Floating tags (latest)
  2. Version tags released more than 7 days ago
- **Chosen:** haproxy:3.2 (LTS; `haproxy -c` passes on 3.2.26) and greenmail/standalone:2.1.14 (released 2026-09-19). The stack's own images are named jobfilly-e2e-app and jobfilly-e2e-node. These single-component names fall under Docker Hub's official `library` namespace, which no outside account can publish to, so a squatted image can never be pulled. Runs are repeatable, in the spirit of the 7-day release-age rule. Fixed local image names are reused across runs instead of piling up one image set per project name.
- **If you decide otherwise:** Change the tags in docker/compose.e2e.yaml; the compose test accepts any haproxy tag and any x.y.z GreenMail version.
- **Refs:** F7.8; docker/compose.e2e.yaml; TBD-16, TBD-34
- **Status:** open

## TBD-61 · Provider catalog with default models lives in packages/schema
- **Kind:** decision
- **Where:** MVP 1 · Build (connect)
- **Context:** F3.2 needs default models pre-selected in the UI and the line 'Your mail is read by <provider> (<host>)'. The web may import only schema, and the foundation contract had no defaults.
- **Options:**
  1. Serve defaults from a new server route
  2. Put a provider catalog (label, default host, key/base-URL needs, default models per task) and aiReadBy() in packages/schema
- **Chosen:** AI_PROVIDERS and aiReadBy() in packages/schema/src/ai.ts. Defaults: Anthropic claude-haiku-5-5 for classify and claude-sonnet-5-5 for the rest; OpenAI gpt-5.4-mini for classify and gpt-5.5 for the rest; Google gemini-3.5-flash-lite for classify and gemini-3.5-flash for the rest; OpenAI-compatible llama3.1 for all four tasks. One source of truth that the UI and the server share without a round trip. Every default can be changed in Settings › AI, and a cheaper model sorts mail while a stronger one extracts facts.
- **If you decide otherwise:** Change the defaultModels values in AI_PROVIDERS. Nothing else depends on the exact ids. Moving the catalog behind an API would add a route and a response schema.
- **Refs:** F3.2; packages/schema/src/ai.ts; commit b334d60
- **Status:** open

## TBD-62 · GET /ai answers {settings: null | AiSettingsPublic}
- **Kind:** decision
- **Where:** MVP 1 · Build (connect)
- **Context:** Before an admin saves anything there are no settings. A 404 would show as a failed request in the browser console, which the validation protocol counts as a finding.
- **Options:**
  1. 404 when nothing is saved
  2. 200 with {settings: null}
- **Chosen:** AiSettingsResponseSchema {settings: AiSettingsPublic | null}, also returned by PUT. Keeps the console clean in onboarding and matches the mailboxes list pattern ({items: []}).
- **If you decide otherwise:** Change aiRoutes GET/PUT and AiForm's parsing, and drop AiSettingsResponseSchema.
- **Refs:** F3.1, F3.2; apps/server/src/routes/ai.ts; apps/web/src/pages/ai/AiForm.tsx
- **Status:** open

## TBD-63 · A stored AI key only goes to the provider and base URL it was saved for
- **Kind:** decision
- **Where:** MVP 1 · Build (connect)
- **Context:** 'A PUT without a key keeps the stored one' could let an admin point a stored key at a different host without retyping it, which would hand the key to that host.
- **Options:**
  1. Keep the stored key whatever changes
  2. Keep it only when provider and base URL are unchanged; otherwise require a new key (vendors) or clear it (OpenAI-compatible)
- **Chosen:** Saving or testing with the same provider and base URL and no key reuses the stored key. A changed endpoint without a key answers 400 'Enter the API key for <provider>' for the vendors. For an OpenAI-compatible endpoint the key is cleared, stored as a sealed empty string, because saveAiSettings' null means keep. The key is never returned by the API (F3.3), so it must not be sendable to a host the user didn't enter it for.
- **If you decide otherwise:** Drop sameEndpoint() in routes/ai.ts. A dedicated clear-key db function would replace the sealed-empty-string convention.
- **Refs:** F3.3; apps/server/src/routes/ai.ts; apps/server/src/routes/ai.test.ts 'is dropped, not carried over…'
- **Status:** open

## TBD-64 · Saving a mailbox tests it again; test results list only Inbox and Sent
- **Kind:** decision
- **Where:** MVP 1 · Build (connect)
- **Context:** createMailbox needs sentFolderPath, which only a connection can find. MailTestResult.folders could list every folder or only the ones the app reads.
- **Options:**
  1. Trust a sentPath sent by the browser
  2. Re-test on save and store the Sent folder found; folders = [Inbox path, Sent path]
- **Chosen:** POST /mailboxes checks for an existing mailbox (409), runs test() again, stores only a working mailbox with the sentPath found (400 with the plain reason otherwise). folders holds the Inbox and Sent paths the app will read. No broken mailbox is stored and the Sent path can't be tampered with. 'Connected: Inbox, Sent' is exactly what F2.1 and S1 show.
- **If you decide otherwise:** Return list() in full from packages/mail test() and render it in TestOutcome. Saving without a re-test would need sentPath in MailboxInputSchema.
- **Refs:** F2.1, TBD-36; apps/server/src/routes/mailboxes.ts; packages/mail/src/client.ts
- **Status:** open

## TBD-65 · OpenAI gets non-strict JSON Schema for extract.v1 and prefs.v1 (follow-up to TBD-45)
- **Kind:** decision
- **Where:** MVP 1 · Build (connect)
- **Context:** @ai-sdk/openai defaults to strict structured output. The extract.v1 and prefs.v1 schemas have optional keys and an open `extra` record, which OpenAI's strict mode rejects, so every extract and prefs call to OpenAI would fail.
- **Options:**
  1. Change the shared schemas (cross-slice, changes golden samples)
  2. Pass providerOptions.openai.strictJsonSchema=false for those two tasks on the openai provider only
- **Chosen:** The registry adds strictJsonSchema:false for extract and prefs when the provider is openai. classify and intake stay strict, the openai-compatible golden requests are unchanged (strict:true), and every answer is still validated against its zod schema. Keeps OpenAI usable without touching the wire contract or the shared schemas.
- **If you decide otherwise:** If the schemas become strict-compatible (all keys required and nullable, no records), drop NOT_STRICT in packages/ai/src/registry.ts and regenerate the wire samples.
- **Refs:** TBD-45; packages/ai/src/registry.ts; packages/ai/src/registry.test.ts 'asks OpenAI for strict output except…'
- **Status:** open

## TBD-66 · What counts as a call and what is retried
- **Kind:** decision
- **Where:** MVP 1 · Build (connect)
- **Context:** Budgets count model calls (F4), and F3.4 retries output that fails its schema.
- **Options:**
  1. Let the SDK retry transport errors (default 2 retries)
  2. No SDK retries; only schema failures are retried once; every request adds one Usage entry
- **Chosen:** maxRetries 0. Auth, unreachable and HTTP errors are returned at once as plain AiError kinds (auth, unreachable, provider_error), never retried. Each request, failed ones included, adds one Usage entry (0 tokens when the provider reported none). The Test button always makes exactly one call. The scan's budget and S8's 'exactly 5 calls' stay exact, and a hidden SDK retry can't spend calls.
- **If you decide otherwise:** Raise maxRetries in client.ts request(); budget counting in the scan worker would then be approximate.
- **Refs:** F3.4, F4.4, F4.5, TBD-17; packages/ai/src/client.ts
- **Status:** open

## TBD-67 · The route-module test checks 'not 403' instead of the stubs' 501
- **Kind:** decision
- **Where:** MVP 1 · Build (connect)
- **Context:** apps/server/src/app.test.ts pinned 501 for every slice-owned route, so implementing any route failed it. The file is outside this slice's paths.
- **Options:**
  1. Leave it failing
  2. Change the one assertion to .not.toBe(403), keeping the 403-below and 404-outsider checks
- **Chosen:** One-line change to .not.toBe(403). It keeps the test's intent (the needed role reaches the handler) and works for every slice, stubbed or built. An identical change from other slices merges cleanly.
- **If you decide otherwise:** The integrator would pick a different assertion for the shared test.
- **Refs:** apps/server/src/app.test.ts:130
- **Status:** open

## TBD-68 · Job alerts count as likely candidates for the S5 placement rule
- **Kind:** decision
- **Where:** MVP 1 · Build (e2e-fixtures)
- **Context:** Stage one gives every message from an alert address the verdict job_alert, so it is never a likely_job candidate. Yet the criterion asks for a multi-role job alert among Maria's newest 40 likely candidates (TBD-35 item 1).
- **Options:**
  1. Count only likely_job verdicts (the alert could never be placed)
  2. Count likely_job and job_alert together, as TBD-35 suggests
  3. Send one alert from an address not on the list (breaks 'job alerts come only from them')
- **Chosen:** The placement test ranks likely_job and job_alert together, newest first, and requires all five S5 messages in the top 40. The other four are then also in the newest 40 of likely_job alone. The '≥250 likely' check counts likely_job only, and Tom's '≤20' counts both. It is the only reading that keeps both rules: alerts only from the listed addresses, and an alert in the newest 40. It holds whichever way the scan slice counts.
- **If you decide otherwise:** If alerts must not count, the criterion can't be met with alert-only senders. The spec would need an alert from a non-listed sender, or the S5 rule would drop the alert.
- **Refs:** e2e/fixtures/consistency.test.ts ('places the five S5 messages…'), e2e/fixtures/format.ts MARIA_KEY_MESSAGES, TBD-35 item 1
- **Status:** open

## TBD-69 · Ground truth for the user's own replies
- **Kind:** decision
- **Where:** MVP 1 · Build (e2e-fixtures)
- **Context:** The fake AI needs a classify answer for every message in both folders, and expected.json needs a category for each, but the scan only reads own replies for preferences.
- **Options:**
  1. category null for own replies
  2. other_job for replies about a role (facts []), not_job for personal replies (facts null)
- **Chosen:** Maria's 15 job replies are other_job with facts []. Her 5 personal replies and Tom's 6 are not_job with facts null. Every Sent message is an own reply to an Inbox message and has a prefs answer (empty when it states nothing). Job replies also get an extract answer with no roles. It keeps the category field one of the nine categories, follows the coverage rule (extract for every job category), and adds no job facts that could affect the profile.
- **If you decide otherwise:** Switching to null categories would change the Sent entries in build.ts and the coverage checks in consistency.test.ts. The fake AI would then answer classify only for Inbox messages.
- **Refs:** e2e/fixtures/build/maria.ts, e2e/fixtures/build/tom.ts, format.ts ExpectedMessage
- **Status:** open

## TBD-70 · Order and wording of expected values; EU citizenship without a country
- **Kind:** decision
- **Where:** MVP 1 · Build (e2e-fixtures)
- **Context:** The aggregation rules say values are worded as in the newest reply stating them, but don't say how they are ordered. 'EU citizen' names no ISO 3166 country.
- **Options:**
  1. Compare values as sets
  2. Fix an order: first appearance going through the stating replies newest first
  3. For work permits: country PT (inferred) or null
- **Chosen:** Values are listed in order of first appearance, going through the stating replies newest first; evidence is newest first. Older replies word some values differently ('70k EUR per year', 'backend engineer'), so the dedup-by-normalised-form rule is exercised. work_permits is {country: null, text: 'EU citizen'}; remote is {scope: 'EU', timeZones: null}, as in the wire sample. A fixed order lets intake-profile compare its proposals exactly. Writing PT would be a guess, and the rules forbid guessing.
- **If you decide otherwise:** intake-profile's comparison would have to ignore order, or the order rule in the expected.json comments in format.ts would change.
- **Refs:** e2e/fixtures/format.ts ExpectedAnswer, consistency.test.ts aggregate()
- **Status:** open

## TBD-71 · Job alerts carry List-Unsubscribe; the scam is recruiter outreach
- **Kind:** decision
- **Where:** MVP 1 · Build (e2e-fixtures)
- **Context:** Real job alerts carry List-Unsubscribe. The scam message offers a job, but the persona has exactly one offer.
- **Options:**
  1. Leave bulk headers off alerts
  2. Keep List-Unsubscribe on alerts, which means stage one must check alert senders before bulk headers
  3. Label the scam as an offer
- **Chosen:** Alerts carry List-Unsubscribe, and the recorded verdict is still job_alert: the alert-sender rule comes before the bulk rule. The scam's ground truth is recruiter_outreach, so exactly one message is an offer. Realistic alerts test the rule order the scan needs on real mailboxes. Unsolicited mail asking for a fee and a passport is outreach, not an offer that follows an application.
- **If you decide otherwise:** If the scan checks bulk headers first, Maria's 40 alerts would become not_job. Either the scan fixes its rule order, or the generator drops the header (one line in alerts.ts).
- **Refs:** e2e/fixtures/build/alerts.ts, consistency.test.ts stageOneFromHeaders, MARIA_KEY_MESSAGES.scam
- **Status:** open

## TBD-72 · Message-IDs, fixed .eml dates, and extra fake-AI endpoints
- **Kind:** decision
- **Where:** MVP 1 · Build (e2e-fixtures)
- **Context:** The scenarios and later specs need stable ids for the key messages. Fixture dates are relative, but the files must not change from run to run.
- **Options:**
  1. Random opaque ids
  2. <persona-nnnn@sender-domain> numbered in source order, with the key messages created first
- **Chosen:** Message-IDs are <persona-nnnn@sender-domain>, and MARIA_KEY_MESSAGES in format.ts names the eight messages the scenarios open. The .eml Date header is FIXTURE_REFERENCE_TIME minus minutesAgo, and the seed rewrites it. The fake AI also answers GET /health (for a compose healthcheck) and HTTP 400 for a request without a task line. The ids stay the same across regenerations and reveal nothing about a message's role. Fixed dates keep the files byte-for-byte reproducible.
- **If you decide otherwise:** Changing the id scheme would change MARIA_KEY_MESSAGES and every fixture file, and the seed would need to know.
- **Refs:** e2e/fixtures/build/spec.ts MessageBook, e2e/fixtures/format.ts, e2e/fake-ai/server.ts
- **Status:** open

## TBD-73 · How a Message-ID of the wrong shape is handled
- **Kind:** decision
- **Where:** MVP 1 · Build (connect)
- **Context:** The finding asked parse.ts to keep a Message-ID only when it has the msg-id shape, and asked prompt.ts to either prefix or refuse an id of any other shape.
- **Options:**
  1. Whole header must match one <...> token; otherwise synthetic id
  2. Extract the first <...> token from a malformed header and keep it
  3. Stable hash of the raw value
- **Chosen:** The whole unfolded header must be a single <...> token with no whitespace, '<', '>', control, format (zero-width, bidi) or separator character; UTF-8 is allowed (RFC 6532). Otherwise the stable synthetic <folder.uidvalidity.uid@jobfilly.invalid> id is used. In the prompt, an id that still fails the check goes under a 'Message-ID (untrusted):' line with '| ' lines. Refusing it would fail the whole batch. This rule is the simplest one that cannot carry text onto a structure line. The synthetic id is already the documented fallback, and it stays unique per message. Taking the first token would let two crafted messages share an id, and a hash would add a third id scheme.
- **If you decide otherwise:** A reply whose References names a malformed original won't thread to it, because the original now has the synthetic id. To keep the first token instead, change parse.ts to take messageIds(header)[0] whenever isMsgId accepts that token.
- **Refs:** packages/schema/src/mailbox.ts (isMsgId); packages/mail/src/parse.ts; packages/mail/src/parse.test.ts; packages/ai/src/prompt.ts; packages/ai/src/prompt.test.ts; docs/ARCHITECTURE.md; commits c49ec7b, e9bc76f, 74ebb1d
- **Status:** open

## TBD-74 · Wire shape of `extra` for extract.v1 and prefs.v1 (schema change, for TBD.md)
- **Kind:** decision
- **Where:** MVP 1 · Build (connect)
- **Context:** @ai-sdk/anthropic's sanitizeJsonSchema sets additionalProperties:false on every object, so the open `extra` record could only come back as {}, with no error raised. The spec (MVP-1 F5) defines extra as { key: value }.
- **Options:**
  1. Send extra as an array of {key, value} and turn it back into the record when parsing
  2. Keep the record and accept the silent loss on Anthropic
  3. Patch the Anthropic schema in packages/ai
- **Chosen:** ExtraAnswerSchema is an array of closed {key, value} objects, refined so that each key appears once and transformed into Record<string,string>. JobFactsAnswerSchema and PreferencesAnswerSchema use it in ExtractOutputSchema and PrefsOutputSchema. The AI SDK builds the JSON Schema from the input side (io: 'input'), so the model sees the list, and parsing returns the spec's record. A key given twice makes the answer invalid rather than letting one value silently win. Every provider can express a list of closed objects. The stored and API shapes, and the spec's { key: value }, stay unchanged. Nothing in packages/ai has to special-case a vendor.
- **If you decide otherwise:** Reverting means going back to z.record in the output schemas, re-capturing e2e/fixtures/wire/{extract,prefs}.v1.request.json and changing extract.v1.response.json back to extra:{}. Anthropic users would then silently get no extra facts again.
- **Refs:** packages/schema/src/facts.ts; packages/schema/src/profile.ts; packages/schema/src/ai-output.ts; packages/schema/src/index.test.ts; packages/schema/src/wire.test.ts; packages/ai/src/registry.test.ts; e2e/fixtures/wire/*; commits 83f34de, 9e2305b
- **Status:** open

## TBD-75 · extract.v1 stays non-strict on OpenAI
- **Kind:** decision
- **Where:** MVP 1 · Build (connect)
- **Context:** Now that extra is a list, extract.v1's schema has every key required and no open records, so OpenAI's strict mode could likely take it. The reason given in registry.ts for keeping it non-strict (TBD-45) no longer fully applies.
- **Options:**
  1. Switch extract.v1 to strict on OpenAI now
  2. Keep it non-strict and update the comment
- **Chosen:** I kept extract.v1 non-strict and rewrote the comment and the test title to say why: it stays that way until a run against OpenAI shows strict mode accepts its regex patterns. It was not part of the findings, and enabling it would change OpenAI behaviour in a way that can't be checked without a real-provider run.
- **If you decide otherwise:** Remove 'extract' from NOT_STRICT in packages/ai/src/registry.ts and change the expected ['extract_v1', false] to true in registry.test.ts.
- **Refs:** packages/ai/src/registry.ts; packages/ai/src/registry.test.ts
- **Status:** open

## TBD-76 · How the F5.3 comparison set is expressed
- **Kind:** decision
- **Where:** MVP 1 · Build (e2e-fixtures)
- **Context:** expected.json gives own replies a category (other_job/not_job) that the pinned pipeline never stores (TBD-37), so a literal F5.3 comparison would fail on 26 messages.
- **Options:**
  1. Export a predicate comparedForF53 = !ownReply && !invalid and document own replies' category as descriptive only
  2. Make ExpectedMessage.category Category | null with null for own replies and regenerate the fixtures
- **Chosen:** Export the predicate and document it; the fixture JSON stays unchanged. The data, the generator output and the byte-for-byte build test stay as they are, and the comparison set lives in one exported place that the validator, the e2e specs and the real-AI quality scorer can all use. The real-AI ground truth for own replies is also kept, in case a later MVP classifies replies.
- **If you decide otherwise:** Change category to Category | null in format.ts and in apps/server/src/e2e-fixtures.test.ts, set null for own replies in e2e/fixtures/build, and regenerate with node e2e/fixtures/build/main.ts. comparedForF53 could then become !invalid && category !== null.
- **Refs:** F5.3; e2e/fixtures/format.ts (ExpectedMessage, comparedForF53); TBD-37; packages/db/src/queries/messages.ts
- **Status:** open

## TBD-77 · Keep the fake AI's classify answers for Sent messages
- **Kind:** decision
- **Where:** MVP 1 · Build (e2e-fixtures)
- **Context:** ai/<persona>/classify.json answers every message, own replies included, and e2e/fake-ai/fake-ai.test.ts tests classify batches of Sent messages. The verifier pointed out that this suggests the scan classifies replies, which the pinned pipeline does not, and which the S8 budget arithmetic does not plan for.
- **Options:**
  1. Keep the answers and document that the scan never classifies own replies
  2. Remove the Sent classify answers so that a classify call for a reply gets a loud HTTP 500 from the fake AI
- **Chosen:** Keep them, documented in format.ts as answers the scan never asks for. The task was to fix exactly the finding and keep everything else. Removing them would mean regenerating fixtures and rewriting a fake-AI test. The F5.3 ambiguity is resolved by the predicate.
- **If you decide otherwise:** In e2e/fixtures/build/build.ts, write classify answers only for non-ownReply messages, regenerate, change the consistency test's classify-keys check to Inbox ids, and change the fake-ai test's 'sent' classify case to expect a 500 for a missing fixture.
- **Refs:** e2e/fixtures/build/build.ts:114; e2e/fake-ai/fake-ai.test.ts:154; F4.5/S8
- **Status:** open

## TBD-78 · A Message-ID answered twice is invalid even when both answers are the same
- **Kind:** decision
- **Where:** MVP 1 · Build (connect)
- **Context:** The finding says the first of two contradictory answers silently won. A model could also repeat an item with identical data.
- **Options:**
  1. Refuse any repeated id
  2. Refuse only repeated ids whose data differs
- **Chosen:** Refuse any repeated id. This matches the fix as specified and the rule ExtraAnswerSchema already follows (a key given twice is refused). It is simpler, and it never picks between model outputs. The only cost is one retry in a rare case.
- **If you decide otherwise:** An answer that repeats an item word for word would be accepted without a retry.
- **Refs:** packages/ai/src/client.ts checkItems; packages/ai/src/client.test.ts
- **Status:** open

## TBD-79 · Base URL check is a strict authority test, not a WHATWG URL parse
- **Kind:** decision
- **Where:** MVP 1 · Build (connect)
- **Context:** packages/schema has no DOM or Node types, so `URL` doesn't typecheck there. The refine has to find a user part without a URL parser.
- **Options:**
  1. Add DOM or Node lib types to packages/schema and use new URL()
  2. Match the scheme://authority and refuse an '@' in it, and also refuse any URL whose authority can't be found
  3. Leave the check to the server only
- **Chosen:** Match the scheme://authority and refuse an '@' in it, and also refuse any URL whose authority can't be found. This keeps the schema package free of runtime lib types and keeps the check where the data enters, as the schemas-first rule asks. A backslash ends the authority, the way URL parsers read http(s). Rejecting a URL whose authority can't be found errs toward refusing rather than storing a hidden secret. One shared helper now serves this check and aiReadBy.
- **If you decide otherwise:** Odd inputs such as https:\\user:pw@host could slip past a looser check and be stored in clear.
- **Refs:** packages/schema/src/ai.ts authorityOf, AiBaseUrlSchema, aiReadBy
- **Status:** open

## TBD-80 · What F5.3's comparison counts as a difference
- **Kind:** decision
- **Where:** MVP 1 · Build (e2e-fixtures)
- **Context:** The finding asked for a diff of the analysed messages. Taken literally, a pipeline that analyses nothing, or fails every message, would give an empty diff. A category corrected by the user (F5.4) would also show up as a false difference.
- **Options:**
  1. Compare only messages with analysisStatus done
  2. Also report failed analyses of valid messages, unknown ids, and (opt-in complete mode) pending or missing messages; skip categories a person corrected
- **Chosen:** Report failed analyses of messages the fake AI answers validly, and listed ids missing from expected.json. A `complete` option also reports compared messages that are pending or not listed. Categories with source 'you' are not compared, but their roles are. Roles are compared as an order-free set of whole JobFacts. Without these, the check would pass even if the pipeline were missing or broken, which is the gap the verifier pointed out. A correction is the user's choice, not the analysis's output.
- **If you decide otherwise:** If role order should count as a fact, change the sort in compareRoles to keep order. If corrected categories should be compared, drop the categorySource check.
- **Refs:** F5.3, F5.4; e2e/fixtures/compare.ts
- **Status:** open

## TBD-81 · Where the F5.3 probe against the integrated app lives
- **Kind:** decision
- **Where:** MVP 1 · Build (e2e-fixtures)
- **Context:** The fix asks for the MVP 1 spec, or a probe in S5 or after S8, owned by test-stack, to call compareWithExpected. The Playwright config, seed and spec harness exist only on mvp-1-test-stack.
- **Options:**
  1. Add a spec on this branch
  2. Ship the comparison and collector here and leave the call to test-stack or the validation stage
- **Chosen:** Ship compareWithExpected and collectStored here, so the probe is a single call, and report the wiring as not done. A spec on this branch would not typecheck without test-stack's harness, and it would conflict with the slice that owns the specs.
- **If you decide otherwise:** If this slice were meant to own the probe, it would need test-stack merged first and a spec under e2e/specs/mvp-1.
- **Refs:** F5.3; e2e/fixtures/compare.ts, e2e/specs/mvp-1 (test-stack)
- **Status:** open

## TBD-82 · How sure an answer is, and where its reason is stored
- **Kind:** decision
- **Where:** MVP 1 · Build (intake-profile)
- **Context:** aggregateIntake may calibrate the confidence level and the reason wording within two constraints. The schema has no field for a reason on the whole answer, only evidence[{messageId, reason}].
- **Options:**
  1. Reply-stated answers: 1 reply low, 2 medium, 3 or more high. Job-derived answers: fewer than 10 messages low, 10 or more medium, never high. Each evidence item carries the answer's reason sentence
  2. Let job-derived answers reach high with many messages
  3. Add an answer-level reason field to packages/schema
- **Chosen:** Reply-stated: 1 low, 2 medium, 3+ high. Job-derived: under 10 low, 10+ medium, capped at medium. Every evidence item's reason is the answer's sentence ('from one of your replies', 'from N of your replies', 'in N job emails'), and the UI shows it. Blank values ("" or whitespace) never count as a statement. Job mail shows what is being offered, not what the user wants, so it shouldn't look as certain as the user's own words. Both constraints hold, and Maria's fixture answers (3-4 replies each) come out high. No shared schema change was needed.
- **If you decide otherwise:** Change replyConfidence/jobConfidence in packages/core/src/intake/aggregate.ts and their unit tests. An answer-level reason field would need a schema commit and changes in the core, the routes and IntakePage.
- **Refs:** F6.2, F6.3, F4.4; packages/core/src/intake/aggregate.ts
- **Status:** open

## TBD-83 · One profile per workspace: Confirm happens once, later changes go through the profile page
- **Kind:** decision
- **Where:** MVP 1 · Build (intake-profile)
- **Context:** MVP 1 has one confirmed profile. The spec doesn't say what a second Confirm, or an intake edit after Confirm, should do.
- **Options:**
  1. A second Confirm and intake edits after Confirm answer 409; changes go through PATCH /profiles/:id
  2. A second Confirm overwrites the profile
  3. A second Confirm makes another profile
- **Chosen:** 409 'confirmed' for both. The intake page then says 'Saved as …' with a link to the profile and makes the form read-only. The profile page lets editors rename the profile and change answers with the same click editors (source you). This keeps 'Analyze them never changes the confirmed profile' simple, and a second click can't wipe hand edits. Several profiles are MVP 3 scope.
- **If you decide otherwise:** MVP 3's several profiles would let Confirm (or re-run setup) create a new profile; createConfirmedProfile's existence check would change.
- **Refs:** F6.5, F4.10; packages/db/src/queries/profiles.ts, apps/server/src/routes/intake.ts
- **Status:** open

## TBD-84 · A failed intake.v1 call is final
- **Kind:** decision
- **Where:** MVP 1 · Build (intake-profile)
- **Context:** The extra-questions call is made once per workspace. If the provider is unreachable, or no AI settings exist, the call fails.
- **Options:**
  1. Store status failed and never ask again
  2. Allow a retry after a while
- **Chosen:** Status failed with no questions; the form goes on without extra questions and never asks again. Only a claim left pending by a replica that died is retried, after 2 minutes. It keeps the 'once per workspace' guarantee and the cost bounded. The core questions don't depend on it.
- **If you decide otherwise:** Let takeOverIntakeExtras also take a failed row once it is older than a cut-off; tests in profiles.test.ts and intake.test.ts would change.
- **Refs:** F6.1, TBD-19; apps/server/src/routes/intake.ts
- **Status:** open

## TBD-85 · Typed places and minimum pay use ISO codes
- **Kind:** decision
- **Where:** MVP 1 · Build (intake-profile)
- **Context:** Tom fills empty answers by typing. A place needs an ISO 3166 country and a minimum pay needs an ISO 4217 currency, but the web app has no country or currency list.
- **Options:**
  1. Text fields for the two-letter country code and the three-letter currency code, checked with the schema's regexes
  2. A country and currency picker with names
- **Chosen:** Code fields (e.g. GB, GBP) with a plain error message. Chips show countries by name and pay formatted with Intl. No market-specific lists are built in, and nothing new needs to be maintained. A user who corrects by clicking never sees these fields.
- **If you decide otherwise:** Add a picker (for example from Intl.DisplayNames over a list of ISO codes) in apps/web/src/pages/intake/answers.tsx.
- **Refs:** F6.4, F6.6; apps/web/src/pages/intake/answers.tsx
- **Status:** open

## TBD-86 · Edited answers in a confirmed profile keep their evidence but lose their confidence
- **Kind:** decision
- **Where:** MVP 1 · Build (intake-profile)
- **Context:** ProfileEntry has confidence and evidence. When the user edits an answer, the scan's estimate no longer describes the value.
- **Options:**
  1. Keep the proposal's evidence and set confidence to null for source=you
  2. Keep the proposal's confidence too
- **Chosen:** Confidence null and evidence kept, for intake edits and profile edits alike. Extra questions are saved as entries too: empty with source scan when unanswered. The user set the value, so the app no longer estimates it, but the messages behind it still help explain it.
- **If you decide otherwise:** Change confirmedEntries/patchEntries in packages/core/src/intake/profile.ts.
- **Refs:** F6.5; packages/core/src/intake/profile.ts
- **Status:** open

## TBD-87 · Fixture-based proofs wait for the sibling branches instead of merging them into this slice
- **Kind:** decision
- **Where:** MVP 1 · Build (intake-profile)
- **Context:** Three findings (the F6.6 fixtures test, the F6.1 extras fixture test, and confidence-stop.test.ts) need e2e/fixtures from mvp-1-e2e-fixtures, and one also needs the scan from mvp-1-scan. Neither is merged into mvp-1. mvp-1-scan has only a schema commit so far. The findings themselves say to add the tests after those merges.
- **Options:**
  1. Merge mvp-1-e2e-fixtures (and mvp-1-scan) into mvp-1-intake-profile now and write the tests
  2. Copy the fixture files into this branch
  3. Leave these tests to after integration and report them as not done
- **Chosen:** Leave them to after integration and report them as not done. I checked independently that the fake AI's extra-question evidence for Maria survives the new filter. Merging unverified sibling slices would carry their work into mvp-1 even if they fail verification. It would also break the plan's disjoint owned paths. Copying the fixtures would duplicate them. The scan doesn't exist yet, so the confidence-stop test can't be written at all.
- **If you decide otherwise:** If the owner prefers the slice to carry the proof itself, merge mvp-1-e2e-fixtures into mvp-1-intake-profile and add packages/core/src/intake/fixtures.test.ts as the finding describes. confidence-stop.test.ts still has to wait for the scan.
- **Refs:** packages/core/src/intake/extras.ts; mvp-1-e2e-fixtures:e2e/fixtures/ai/maria/intake.json; docs/mvp/MVP-1.md F6.6; TBD-29
- **Status:** open

## TBD-88 · Confirm waits for the extra questions, in the UI and on the server
- **Kind:** decision
- **Where:** MVP 1 · Build (intake-profile)
- **Context:** Confirming while the one intake.v1 call was pending saved a profile without the extra questions. They could then never be answered: PUT /intake returns 409 once a profile exists, and PATCH refuses unknown keys.
- **Options:**
  1. Disable Confirm while pending (UI only)
  2. Disable in the UI and refuse on the server with 409 extras_pending
  3. Let a confirmed profile take extra questions later
- **Chosen:** Disable in the UI, with a short note, and also refuse on the server with 409 extras_pending. The UI rule alone could be bypassed by a second tab or a probe. Letting the profile take new keys later would change the profile contract. Users can see the wait: about the fake AI's 300 ms delay in the test stack, and up to one model call with a real provider. A stuck claim is taken over through the form's 5-second poll after 2 minutes.
- **If you decide otherwise:** To let users confirm early, drop the server check and the disabled state, and add a way to append extra questions to a confirmed profile (a PATCH that accepts new extra.* keys).
- **Refs:** apps/server/src/routes/intake.ts (POST /confirm, EXTRAS_PENDING); apps/web/src/pages/intake/IntakePage.tsx (extrasPending)
- **Status:** open

## TBD-89 · Shutdown during the background intake.v1 call abandons it instead of tracking it in the shutdown sequence
- **Kind:** decision
- **Where:** MVP 1 · Build (intake-profile)
- **Context:** The intake.v1 call runs outside the job queue, so shutdown() could close the database while the call was still writing.
- **Options:**
  1. Track background promises in AppDeps and await them in shutdown() before closeDatabase
  2. Run the call as a queue job
  3. Check health.shuttingDown after the model answers and write nothing more, leaving the claim to the 2-minute takeover
- **Chosen:** Check health.shuttingDown after the model answers and write nothing more. Any failure is logged at warn with the error name only. This stays inside the slice's paths. Shutdown waits at least the 5-second drain between beginShutdown and closeDatabase, so writes that start before the flag finish long before the database closes. Tracking promises or adding a queue job would change the shared deps, shutdown and registry files.
- **If you decide otherwise:** If the abandoned call's tokens must always be counted, add a small background-task tracker to AppDeps that shutdown() awaits, or move intake.v1 into a queue job type.
- **Refs:** apps/server/src/routes/intake.ts askForExtras; apps/server/src/shutdown.ts
- **Status:** open

## TBD-90 · New log event intake.extras_failed (warn)
- **Kind:** decision
- **Where:** MVP 1 · Build (intake-profile)
- **Context:** The background call's failure was logged as http.error at error level with the raw error, whose database message can quote the model's questions. MVP-1.md's log events list has no event for this.
- **Options:**
  1. Reuse job.failed
  2. Keep http.error but log only the error name
  3. Add intake.extras_failed at warn with { workspaceId, error: name }
- **Chosen:** Add intake.extras_failed at warn with { workspaceId, error: name }. It names what failed, and the form goes on without extras, which is degraded rather than broken. That makes it a warning, and validation does not flag warnings as unexpected errors. It is not a queue job, so job.failed would mislead.
- **If you decide otherwise:** Rename the event or change its level in apps/server/src/log.ts and apps/server/src/routes/intake.ts. The owner may want to add it to MVP-1.md's log events list.
- **Refs:** apps/server/src/log.ts LogEvent; apps/server/src/routes/intake.ts errorName
- **Status:** open

## TBD-91 · Where an unstorable string is refused: a refinement on the shared schemas, plus a final 'failed' as a fallback
- **Kind:** decision
- **Where:** MVP 1 · Build (intake-profile)
- **Context:** The model's intake.v1 output (and user values) could pass the schema but hold a NUL character, which Postgres jsonb and text refuse. That left the extra-questions claim pending forever, kept the model being called again after each takeover, and kept Confirm refused.
- **Options:**
  1. Strip control characters in foundExtraQuestions only
  2. Refuse NUL in packages/schema with a regex (adds a pattern to the JSON Schema the models get and changes the wire golden samples)
  3. Refuse NUL in packages/schema with a refinement (JSON Schema unchanged), and also close the claim as 'failed' when the store still fails
- **Chosen:** Refuse NUL in packages/schema with a refinement (TextSchema), applied to the extra questions, the profile value strings, the prefs extra record and the profile names. If storing still fails, close the claim as 'failed' with no questions. Model output and user values are checked where they enter, as the schemas-first rule asks. The refinement keeps the JSON Schema sent to providers and the committed wire samples unchanged. The 'failed' fallback covers any other schema-valid but unstorable answer, so a deterministic failure can never cause repeated model calls or block Confirm.
- **If you decide otherwise:** With a regex instead, the wire samples in e2e/fixtures/wire and the golden tests would be regenerated. Stripping instead of refusing would change foundExtraQuestions and drop the TextSchema refinement.
- **Refs:** packages/schema/src/common.ts TextSchema; packages/schema/src/profile.ts; apps/server/src/routes/intake.ts askForExtras; apps/server/src/routes/intake.test.ts 'fails for good, without logging the questions, when storing them fails'
- **Status:** open

## TBD-92 · The unmerged slices land through fix tasks that continue their branches
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1
- **Context:** Run 0 could not start the stack because mvp-1-e2e-fixtures, mvp-1-connect, mvp-1-intake-profile and mvp-1-scan were not merged. Each failed verification for reasons listed in the problems, and scan was never built. A fix branch made from a slice branch carries the whole slice, so integrating a verified fix also merges the slice.
- **Options:**
  1. Merge the four slice branches into mvp-1 as they are, then fix on top
  2. Continue each slice branch in its own fix task, so the slice merges only once its fix passes verification
- **Chosen:** Continue each slice branch in its own fix task (continueBranch). The connect task first merges mvp-1 and resolves the apps/server/src/app.test.ts conflict that a dry run found. The integrator should still expect conflicts between connect and intake-profile in apps/server/src/app.test.ts and packages/schema/src/index.test.ts. It keeps the rule that only verified work is merged, and it is the only way the fix workflow can bring the slices in. The dry runs show e2e-fixtures, intake-profile and scan merge cleanly with mvp-1.
- **If you decide otherwise:** Merging them as they are would let the stack start sooner, but would put known-defective code (the comparator bug, locale parsing, the shutdown leak) on mvp-1 without review.
- **Refs:** docs/mvp/README.md 'Fix rounds'; branches mvp-1-e2e-fixtures, mvp-1-connect, mvp-1-intake-profile, mvp-1-scan
- **Status:** open

## TBD-93 · The AI provider catalogue moves to packages/ai and is served over HTTP
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1
- **Context:** The connect slice put the provider catalogue (vendor hosts, default per-task models, aiProvider, aiReadBy) in packages/schema. ARCHITECTURE gives that role to packages/ai, and mail presets already live in packages/mail and are served over GET /mailboxes/presets. The other fix, editing ARCHITECTURE instead, would touch docs/ARCHITECTURE.md, which the intake-profile task must also change this round.
- **Options:**
  1. Move the catalogue into packages/ai, define its wire shape in packages/schema, serve GET /ai/providers, and have AiForm read it through api()
  2. Keep it in packages/schema and widen the ARCHITECTURE package table
- **Chosen:** Option 1: Move the catalogue into packages/ai, define its wire shape in packages/schema, serve GET /ai/providers, and have AiForm read it through api(). It matches the ARCHITECTURE table and the mail-presets pattern, keeps vendor defaults out of the shared contract (all AI knowledge goes through packages/ai), and needs no ARCHITECTURE edit, so no two tasks share a path. The cost is a loading state in AiForm and a few moved tests.
- **If you decide otherwise:** With option 2, the connect task would own docs/ARCHITECTURE.md, and the intake-profile ARCHITECTURE changes (intake.v1 shutdown, rewrap) would have to wait a round.
- **Refs:** F3.1-F3.3; packages/schema/src/ai.ts:90-142; docs/ARCHITECTURE.md:16,20; packages/mail/src/presets.ts
- **Status:** open

## TBD-94 · F6.6 at the confident stop is deferred to the round after scan merges
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1
- **Context:** TBD-31 gives the confident-stop proof (confidence-stop.test.ts) to intake-profile, but that test needs the scan slice's stageOne, batches and tracker, which another task builds in parallel this round. No branch has all three of fixtures, scan and aggregateIntake.
- **Options:**
  1. Give the test to the scan task and let it merge intake-profile and e2e-fixtures
  2. Have intake-profile stub or reimplement the scan code
  3. Prove F6.6 now over the full fixtures (intake merges mvp-1-e2e-fixtures for read-only data) and add the confident-stop test in the next round
- **Chosen:** Prove it over the full fixtures now (Maria's answers and extra questions equal expected.json, and Tom's answers are empty), and defer the confident-stop variant to the next round, after scan is merged. The intake and scan tasks may merge mvp-1-e2e-fixtures for read-only fixture data. It commits the proof the reviewer found missing, with no stubs, and keeps unverified intake code from riding into mvp-1 through the scan branch.
- **If you decide otherwise:** The scan task would carry the unverified intake-profile slice, and if the intake fix failed, its defects would reach mvp-1 anyway.
- **Refs:** F6.6, TBD-30, TBD-31, TBD-35 item 10; packages/core/src/intake
- **Status:** open

## TBD-95 · F5.3 is proven by a stack spec now, and by a hermetic pipeline test after integration
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1
- **Context:** F5.3 needs the stored categories and facts compared with expected.json through the real pipeline. The hermetic option needs the scan worker and packages/ai, which are not merged. The stack spec can be written now but runs only in Validate.
- **Options:**
  1. A Playwright spec in e2e/specs/mvp-1 using compareWithExpected and collectStored
  2. A hermetic apps/server integration test over e2e/fixtures
  3. Both
- **Chosen:** The e2e-fixtures task writes the stack spec now. The hermetic integration test is added in a later round, once scan and connect are merged. F5.3 is not claimed as passed until one of them runs green. The spec is the proof the criterion describes (fake AI, both personas), and it does not depend on code built in parallel.
- **If you decide otherwise:** Waiting for the hermetic test would leave F5.3 with no executable proof for another round.
- **Refs:** F5.3, F5.4, S5; e2e/fixtures/compare.ts
- **Status:** open

## TBD-96 · Scan is rebuilt as one task against the mvp-1 AI and mail interfaces
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1
- **Context:** The scan builder returned nothing, probably because the slice is large. Splitting it into core and server parts would bring back cross-task stubs (TBD-22). The real AiClient and MailClient are on the unmerged connect branch.
- **Options:**
  1. One scan task, building against the interfaces on mvp-1 with fakes
  2. Split into core, worker and UI tasks
  3. Have scan merge mvp-1-connect
- **Chosen:** One task from mvp-1-scan, built against the AiClient and MailClient interfaces on mvp-1, which mvp-1-connect keeps unchanged. It commits small green steps so partial work survives, and it may merge e2e-fixtures for fixture tests. The interfaces match, so the worker compiles against the real clients after integration, and nothing unverified rides in with scan.
- **If you decide otherwise:** A split would need stubs between the parts, and merging connect into scan would carry connect in unverified.
- **Refs:** F4.1-F4.10, TBD-22, TBD-23; packages/core/src/scan, apps/server/src/jobs/scan
- **Status:** open

## TBD-97 · Minimum pay is parsed with the locale's separators, and ambiguous input is refused
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1
- **Context:** answers.tsx saved '70.000' as 70. The personas are in Lisbon and Berlin, and the inbox formats amounts with Intl in the user's locale.
- **Options:**
  1. Parse with the locale's group and decimal separators
  2. Refuse ambiguous input and ask the user to retype
  3. Both
- **Chosen:** Both: parse with the separators of the locale the inbox formats in, and refuse whatever that locale can't read unambiguously, with a message asking the user to retype. A silently wrong minimum pay distorts matching. Asking costs one retype, and guessing is against 'Unknown means ask'.
- **If you decide otherwise:** Parsing alone would still guess on forms like '1.500' typed in an English locale.
- **Refs:** F6.4; CLAUDE.md 'Nothing market- or user-specific in code'; apps/web/src/pages/intake/answers.tsx:320
- **Status:** open

## TBD-98 · An intake.v1 call cut off by shutdown releases its claim at once
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1
- **Context:** Today a claim interrupted by shutdown waits 2 minutes to go stale, and the call is then paid for again. ARCHITECTURE documents that 2-minute hold.
- **Options:**
  1. Keep the stale-claim takeover
  2. Track the call, write the result while the database is open, abort on hand-back and set claimed_at to null
- **Chosen:** Track, write, abort and release. ARCHITECTURE is updated to match. It matches how queue jobs hand back their leases (F7.4) and avoids a 409 on Confirm and a second paid call.
- **If you decide otherwise:** Confirm can be blocked for up to 2 minutes after every deploy that interrupts the call.
- **Refs:** F6.1, F7.4; apps/server/src/routes/intake.ts:135,198; docs/ARCHITECTURE.md:92-99,143-144
- **Status:** open

## TBD-99 · Problems that need a running stack get no code task
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1
- **Context:** The leak checks (F1.5, F2.3, F3.3, F4.9), F7.6 log checks, F7.8 lifecycle, 'served by both replicas', the S1-S10 probes and the 'no passing evidence' list all failed only because the stack never came up. report.md was not written because the subagent's Write tool refuses report files.
- **Options:**
  1. Make tasks for them
  2. Leave them to the next validation run
- **Chosen:** No code task. They follow from the integration blocker, which the tasks above fix, and the next full validation run re-checks them. The orchestrator writes report.md itself. A fix task cannot start Docker, so it could neither prove nor fix these. The suite tests that already prove the stored formats (auth.test.ts F1.5, and connect's AES-256-GCM tests) arrive with the merges.
- **If you decide otherwise:** Tasks for them would fail verification and block the slice merges.
- **Refs:** F1.5, F2.3, F3.3, F4.9, F7.6, F7.8; e2e/reports/mvp-1/20261015T084131Z-r0-walkthrough
- **Status:** open

## TBD-100 · When the F5.3 proof runs and how it signs in
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1 (e2e-fixtures)
- **Context:** F5.3 has to compare stored data after Maria's and Tom's first scans and after 'Analyze them'. The MVP 1 scenario specs are not codified yet, so their file names are unknown. After a confident first scan, Maria still has unanalysed mail, so a complete comparison would fail at that point.
- **Options:**
  1. One spec that sorts last in specs/mvp-1 and runs a complete comparison for both personas after S9 ends 'done', with a vitest guard on file order
  2. Specs placed between scenarios, for example right after S3 with a partial comparison
  3. A self-contained spec that registers its own users, connects the mailboxes, scans and analyses through the API
  4. A Playwright project dependency that runs after all specs
- **Chosen:** One spec, 99-f5.3-stored-equals-expected.spec.ts, that only reads. It signs in through the API with its own session, like the scenario probes, so the browser sessions stay as they are. It runs a complete comparison for Maria and Tom. stack.test.ts fails if any other entry in specs/mvp-1 sorts after it. After S7 and S9 every message has been analysed, so a complete comparison covers everything the first scans and the Analyze runs produced, and it does not depend on what the scenario specs are named. A self-contained spec would add users, scans and AI load, which would change the state later specs and MVP 2 start from. A project dependency would run after the MVP 2 specs, which deliver new mail that expected.json does not describe.
- **If you decide otherwise:** If the codified scenario specs use names that sort after '99-' (for example 's1-…'), the guard test fails and the spec must be renamed so it sorts last. If the owner also wants a partial comparison right after S3, add a second spec named to sort just after the S3 spec, using `complete: false`.
- **Refs:** e2e/specs/mvp-1/99-f5.3-stored-equals-expected.spec.ts, e2e/stack.test.ts ('e2e/specs/mvp-1'), e2e/playwright.config.ts
- **Status:** open

## TBD-101 · How the comparator handles corrected categories
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1 (e2e-fixtures)
- **Context:** The task allowed two fixes: read the detail roles of every row with categorySource 'you', or skip null roles for those rows in compareRoles.
- **Options:**
  1. Read the detail of every corrected row and keep comparing its roles
  2. Skip null roles in compareRoles for corrected rows
- **Chosen:** Read the detail of every corrected row and keep comparing its roles. correctCategory changes only the category, so the roles the analysis extracted are still stored and can still be checked against expected.json. Skipping them would hide a role lost or altered on a corrected message.
- **If you decide otherwise:** If a later change drops roles when a message is corrected to not_job, this check reports a roles difference for that message. compareRoles would then need to skip roles on corrected not_job rows.
- **Refs:** e2e/fixtures/compare.ts collectStored; packages/db/src/queries/inbox.ts correctCategory
- **Status:** open

## TBD-102 · Where the base-URL host parsing lives
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1 (connect)
- **Context:** The form must work out the live 'read by' host from a typed base URL. apps/web depends only on packages/schema, not packages/ai. The parser (authorityOf) was already in schema because the base-URL credential refusal uses it.
- **Options:**
  1. Export a small baseUrlHost() from packages/schema, shared by the server's aiReadBy and the form
  2. Have the web app parse with new URL().host itself
  3. Add an @jobfilly/ai dependency to apps/web
- **Chosen:** Export baseUrlHost() from packages/schema/src/ai.ts, next to the credential refusal that uses the same parser. The privacy line reads the same while typing and after saving, because both sides use one parser that never shows a user part and handles the backslash case. Keeping the parser beside the schema refusal means they can't drift apart. The web app takes no packages/ai dependency, and no vendor data goes into schema.
- **If you decide otherwise:** If ARCHITECTURE must keep packages/schema strictly to Zod schemas with no helper functions, baseUrlHost could move to apps/web and packages/ai as two copies, which risks the copies diverging.
- **Refs:** packages/schema/src/ai.ts (baseUrlHost), packages/ai/src/providers.ts (aiReadBy), apps/web/src/pages/ai/AiForm.tsx (readByOf)
- **Status:** open

## TBD-103 · New endpoint GET /ai/providers is not named in the MVP-1 spec text
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1 (connect)
- **Context:** The fix task required serving the catalogue at /api/workspaces/:workspaceId/ai/providers. MVP-1.md lists '/api/workspaces/:id/ai (get, save, test)', and spec text is never edited.
- **Options:**
  1. Add the read-only viewer route as instructed and leave the spec text as it is
  2. Embed the catalogue in GET /ai instead
- **Chosen:** Added GET /ai/providers (viewer role) and left the spec text unchanged. The fix task names this endpoint, and it mirrors GET /mailboxes/presets. It is additive and read-only, and the route table test in app.test.ts covers its roles.
- **If you decide otherwise:** If the owner wants the spec or ARCHITECTURE to list it, the task that owns docs/ARCHITECTURE.md can add one line.
- **Refs:** apps/server/src/routes/ai.ts, apps/server/src/routes/ai.test.ts, apps/server/src/app.test.ts
- **Status:** open

## TBD-104 · Abort the intake.v1 wait without an AI-client signal
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1 (intake-profile)
- **Context:** The fix needs the call aborted with an AbortSignal, but packages/ai CallOptions has no signal (here and on mvp-1-fix-r1-connect), and packages/ai is not in my allowed paths.
- **Options:**
  1. Race client.intake() against the AbortSignal in the route and release the claim when the signal wins
  2. Add a signal to packages/ai CallOptions (outside my paths)
  3. Pass an untyped signal property past the type
- **Chosen:** Race the call against the signal in apps/server/src/routes/intake.ts (untilAborted). The late result is ignored and the HTTP request ends when the process exits. It stays within my paths and gives the behaviour the criterion asks for: the claim is released before the database closes, and only the new replica's call is recorded.
- **If you decide otherwise:** When packages/ai gains CallOptions.signal, pass it to client.intake so the HTTP request itself is cancelled.
- **Refs:** apps/server/src/routes/intake.ts untilAborted; packages/ai/src/index.ts CallOptions
- **Status:** open

## TBD-105 · Strict locale reading of typed amounts
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1 (intake-profile)
- **Context:** The min_pay amount must be read with the inbox locale (UI_LOCALE 'en'), and ambiguous input refused.
- **Options:**
  1. Accept only that locale's group and decimal separators and refuse a 3-digit decimal part
  2. Guess the separator from its position
- **Chosen:** Strict: 'en' accepts '70,000' and '450.50' and refuses '70.000', '450,50', '1.234,56', '70 000', '70k' and signs. A locale that groups with a space accepts any typed space. Unknown means ask: a guessed amount would be saved silently.
- **If you decide otherwise:** If the UI locale ever follows the user, parseAmount already takes a locale argument.
- **Refs:** apps/web/src/pages/inbox/format.ts parseAmount; apps/web/src/pages/intake/answers.tsx
- **Status:** open

## TBD-106 · New operational log event intake.extras_handed_back
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1 (intake-profile)
- **Context:** Releasing a claim on shutdown should be visible in the logs without being an error.
- **Options:**
  1. Log at info level with workspaceId
  2. Log nothing
- **Chosen:** info 'intake.extras_handed_back' with workspaceId. It follows job.handed_back and logs no AI output or Message-IDs.
- **If you decide otherwise:** Remove it from LogEvent and the route.
- **Refs:** apps/server/src/log.ts
- **Status:** open

## TBD-107 · Every message the user wrote is read as an own reply
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1 (scan)
- **Context:** The fixtures' rule makes a Sent message an own reply only when it answers an Inbox message in the window. A Sent message that answers nothing would then go to the classifier as likely job mail. The spec only says the user's own replies are read for preferences.
- **Options:**
  1. Follow the fixture rule literally: Sent non-replies become likely_job
  2. Treat every Sent message, and Inbox mail from the user's own address, as own_reply
  3. Mark Sent non-replies not_job
- **Chosen:** Every Sent message, and Inbox mail from one of the mailbox's own addresses, is own_reply and read with prefs.v1. A Message-ID that appears in both Inbox and Sent is kept once, as the Sent copy. Whatever the user writes is the strongest evidence of what they want, and asking the classifier about one's own mail makes no sense. Keeping each Message-ID once also stops saveEnvelopes from hitting the same row twice in one upsert. The fixtures have no Sent non-replies, so every expected.json verdict still matches.
- **If you decide otherwise:** Change isOwn in packages/core/src/scan/stage-one.ts and its unit test.
- **Refs:** F4.2, F4.3; packages/core/src/scan/stage-one.ts; apps/server/src/jobs/scan/fixtures.test.ts
- **Status:** open

## TBD-108 · Job alerts skip classify and get one extract call each
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1 (scan)
- **Context:** TBD-35 item 1 and TBD-68 left open how job_alert messages move through stage two and the budget.
- **Options:**
  1. Extract alerts before batch 1
  2. Alerts take a slot in the newest-first batches, skip classify and get one extract call each; likely = likely_job + job_alert
  3. Never extract alerts
- **Chosen:** Alerts take a slot in the newest-first batches, skip classify and get one extract call each. They count in 'handled without AI' (sorted from headers) and in the likely total; a category a person corrected decides instead. This is what TBD-35 suggested. It lets the S5 multi-role alert be analysed among the newest 40 and keeps S8's budget sums exact.
- **If you decide otherwise:** Change analyze() in apps/server/src/jobs/scan/run.ts and the call-order assertions in scan.test.ts.
- **Refs:** TBD-35 item 1, TBD-68; F4.2, F4.3, S5, S8
- **Status:** open

## TBD-109 · A message classified but not yet extracted when the budget runs out stays pending
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1 (scan)
- **Context:** With the budget at 5, a batch gets 1 classify call and 4 extract calls. The other job messages in that batch are classified but have no facts yet, and the database has no state for 'classified, facts pending'.
- **Options:**
  1. Store the category with no roles (facts silently lost)
  2. Leave the message pending and drop the classification
  3. Add a new analysis state
- **Chosen:** Leave it pending: the next Analyze them run classifies it again. Nothing is stored that the model didn't fully produce, the state table in messages.ts stays as it is, and S8 still shows the not-analyzed count shrink. The cost is one classify call more later.
- **If you decide otherwise:** Add a 'classified' state to packages/db's messages and save the category before extracting.
- **Refs:** F4.4, F4.5, S8, TBD-17, TBD-37
- **Status:** open

## TBD-110 · What X and Y mean in 'after X of Y likely job emails'
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1 (scan)
- **Context:** The spec doesn't define the counts for a resumed run or for an Analyze them run.
- **Options:**
  1. Y = every likely message in the window
  2. Y = the likely messages waiting when the run began; X = the likely messages this run analysed or marked Couldn't analyze
- **Chosen:** Y is what was waiting when the run began (all likely mail for a fresh first scan, what is left for Analyze them). X is what this run analysed or marked Couldn't analyze, counted from the rows. It stays true after a takeover and for every kind of run, and it matches the S3 wording on a fresh first scan.
- **If you decide otherwise:** Change how sortWindow sets likely and how countScanAnalysis counts.
- **Refs:** F4.4, S3, S8; packages/db/src/queries/messages.ts countScanAnalysis
- **Status:** open

## TBD-111 · How the confidence tracker compares answers, and which stop reason wins
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1 (scan)
- **Context:** F4.4 says 'two batches in a row changed no intake answer' without defining a change, a baseline, or an order when several reasons hold at once.
- **Options:**
  1. Compare whole proposals, evidence included
  2. Compare each key's value and confidence, ignoring evidence and the order of a value's items; baseline = the proposal after the replies; done > confident > budget
- **Chosen:** Each key's value and confidence are compared, ignoring evidence and item order. The baseline is the proposal right after the replies are read. When several reasons hold, done wins, then confident, then budget. More mail repeating the same answer is not a change, and confidence firming up is. This order keeps TBD-32 ('done wins') and the deterministic 40-message stop of TBD-30.
- **If you decide otherwise:** Change snapshot() and the order in afterBatch in packages/core/src/scan/tracker.ts and their tests.
- **Refs:** F4.4, TBD-30, TBD-32
- **Status:** open

## TBD-112 · A run that can't go on stops as 'failed' with a plain message
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1 (scan)
- **Context:** The schema has a 'failed' stop reason, but what triggers it and what the user sees were not defined.
- **Options:**
  1. Leave the scan running and let the job fail
  2. Stop the scan as failed so another can start
- **Chosen:** A missing mailbox or AI settings, a provider auth/unreachable/provider error, a mail error, or any unexpected error stops the scan as failed. The log line is scan.stopped at warn with a cause code (never the provider's message). The user sees 'Stopped: couldn't go on after X of Y likely job emails. Check the mailbox and AI settings, then try again.' Otherwise the one-active-scan rule would block the workspace forever, and nothing that could carry a host or account detail is logged.
- **If you decide otherwise:** Change fail() in jobs/scan/index.ts, stop() in run.ts, and stopMessage.
- **Refs:** F4.4, F3.4; ARCHITECTURE › Logs
- **Status:** open

## TBD-113 · When the first scan can be started again
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1 (scan)
- **Context:** The spec only describes starting the first scan once.
- **Options:**
  1. Never
  2. Only after it failed or was cancelled (UI); the server accepts POST /scans whenever no run is active
  3. Always
- **Chosen:** The UI offers 'Start scan again' only after a failed or cancelled first scan. After any other stop it offers Analyze them. The server refuses a start only while a run is queued or running. Re-running is harmless (stage one upserts, and only pending mail is analysed again), and it gets users out of a failed or cancelled first scan.
- **If you decide otherwise:** Add a 409 for an existing first scan in routes/scans.ts.
- **Refs:** F4.1, F4.10; apps/web/src/pages/scan/index.tsx
- **Status:** open

## TBD-114 · Merged mvp-1 into the fix branch and updated the shared route-table test
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1 (scan)
- **Context:** apps/server/src/app.test.ts pinned the stubs' 501 for the scan routes, so implementing them failed it. The file is outside this task's paths, and mvp-1 had already changed it to a per-route 'reached' column.
- **Options:**
  1. Leave pnpm check red
  2. Merge mvp-1 and set 'reached' for the four scan rows
  3. Change the test to .not.toBe(403) as the connect slice did (TBD-67)
- **Chosen:** Merged mvp-1 (clean) and set reached = 200/409/404/409 for the scan rows. The 403 and 404 checks are unchanged. It is the smallest change that keeps the test's intent and makes integration conflict-free.
- **If you decide otherwise:** The integrator resolves the app.test.ts rows during the merge instead.
- **Refs:** apps/server/src/app.test.ts; TBD-67
- **Status:** open

## TBD-115 · Access changes share the live NOTIFY channel instead of a separate one
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1 (live-access)
- **Context:** Removing a member or signing out must close streams on every replica before any later event reaches them.
- **Options:**
  1. Same channel jobfilly_live, payload is either an event envelope or an access change (LiveNotificationSchema)
  2. A separate channel for access changes
- **Chosen:** Same channel, with a union payload; LiveEnvelopeSchema is left unchanged. One channel keeps the access change in order with the events, so an event published after the removal can never reach the removed stream first. A separate channel would not guarantee that order.
- **If you decide otherwise:** With a separate channel, a race could deliver an event to a removed member before the close arrives.
- **Refs:** packages/schema/src/events.ts, apps/server/src/live/hub.ts
- **Status:** open

## TBD-116 · LiveHub.subscribe still accepts a bare workspace id for server-side listeners
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1 (live-access)
- **Context:** apps/server/src/routes/messages.test.ts, which is outside this task's paths, calls deps.live.subscribe(workspaceId, ...). Making StreamOwner the only accepted argument would break typecheck there.
- **Options:**
  1. Accept StreamOwner | string, where a string is a server-side listener with no user or session that no access change closes
  2. Require StreamOwner and edit messages.test.ts
- **Chosen:** Accept StreamOwner | string. The SSE route always passes the full owner. This keeps the change inside the allowed paths. Every browser stream is still keyed by user and session, and the string form is documented as server-only.
- **If you decide otherwise:** Once messages.test.ts can be edited, the string form can be removed so that StreamOwner is required.
- **Refs:** apps/server/src/live/hub.ts subscribe()
- **Status:** open

## TBD-117 · Fail closed when a heartbeat re-check errors, and never fail the request when the revoke notification fails
- **Kind:** decision
- **Where:** MVP 1 · Fix round 1 (live-access)
- **Context:** The heartbeat re-check reads the database, and revoke() sends a NOTIFY after the change is already saved.
- **Options:**
  1. Close the stream if the check throws; log live.error and continue if the notify fails
  2. Keep the stream open on error; surface the notify error as a 500
- **Chosen:** Close on a check error (the browser reconnects and is checked again). A failed notify is logged and does not fail sign-out or member removal. Access must never be kept by mistake. The removal or sign-out is already saved, so a 500 would only confuse the user, and the heartbeat re-check on the other replicas still closes their streams.
- **If you decide otherwise:** Keeping streams open on errors would leave the original leak open whenever the database misbehaves.
- **Refs:** apps/server/src/live/routes.ts, apps/server/src/live/hub.ts revoke()
- **Status:** open

## TBD-118 · Fixture-based proofs wait one round; intake and scan drop their merges of mvp-1-e2e-fixtures
- **Kind:** decision
- **Where:** MVP 1 · Fix round 2
- **Context:** TBD-94 allowed the intake and scan fix tasks to merge the unmerged mvp-1-e2e-fixtures for read-only fixture data. Verification rejected both branches for exactly that ([scope] findings on 8bd9b4e and bbb36f4): it carries an unverified slice into mvp-1 and makes fix tasks share paths. The F6.6 fixtures test, the scan's F4.2/F4.5 persona proofs and the confident-stop test all need e2e/fixtures in mvp-1, which only the e2e-fixtures task can deliver this round.
- **Options:**
  1. Keep the sibling merges (as TBD-94 chose) and accept the scope findings
  2. Copy the fixtures into each branch
  3. Rebuild intake and scan without the merge, land e2e-fixtures this round, and add the fixture-based proofs in the next round
- **Chosen:** Option 3. intake-live continues from mvp-1-intake-profile (no merge). The scan task rebases its own commits without bbb36f4 and leaves apps/server/src/jobs/scan/fixtures.test.ts out (it stays in mvp-1-fix-r1-scan's history). packages/core/src/intake/fixtures.test.ts, the scan fixtures test and confidence-stop.test.ts are listed as notDone for round 3. This reverses TBD-94's choice. It keeps each slice's work verifiable on its own and stops unverified work from reaching mvp-1 through another branch, as the verifiers and TBD-87 require. It also gives fixture data one owner and no copies. The next validation run with the fake AI still checks F6.6, F4.2 and F4.5 end to end, as soon as the stack starts.
- **If you decide otherwise:** If the owner prefers the proofs now, merge mvp-1-fix-r2-e2e-fixtures into the intake and scan branches after it passes verification, and add the tests there. The integrator then has to merge e2e-fixtures first.
- **Refs:** F6.6, F4.2, F4.5, TBD-31, TBD-87, TBD-94; branches mvp-1-fix-r1-intake-profile (8bd9b4e), mvp-1-fix-r1-scan (bbb36f4), mvp-1-e2e-fixtures (1843f88)
- **Status:** open

## TBD-119 · Intake-profile and live-access fixes share one task, because both must edit docs/ARCHITECTURE.md
- **Kind:** decision
- **Where:** MVP 1 · Fix round 2
- **Context:** Three fixes this round must change docs/ARCHITECTURE.md: intake (the intake.v1 shutdown behaviour and the 102-column line), live-access (a new NOTIFY message kind and session-bound streams) and e2e-fixtures (the new coupling from apps/server/src/e2e-fixtures.test.ts). The triage rule forbids two tasks sharing a path.
- **Options:**
  1. Give ARCHITECTURE to one task and let the others fail verification on the docs rule again
  2. Combine intake and live-access into one task that owns ARCHITECTURE, and make the e2e fix one that needs no ARCHITECTURE change
  3. Let several tasks edit different sections of ARCHITECTURE in parallel
- **Chosen:** Option 2. Task intake-live continues mvp-1-intake-profile, cherry-picks the two live-access commits (327b8bd, bb7a842), fixes both sets of findings and owns docs/ARCHITECTURE.md. The e2e-fixtures task removes apps/server/src/e2e-fixtures.test.ts instead of documenting it (see the next decision). Both server fixes can then land this round with their docs, and the no-shared-path rule holds. Live-access is two small commits that touch only live/, auth/session.ts, routes/workspaces.ts and the events schema, so folding them in barely grows the task.
- **If you decide otherwise:** Split mvp-1-fix-r2-intake-live back into two branches (the live-access commits are separable) and give ARCHITECTURE to one of them per round.
- **Refs:** docs/ARCHITECTURE.md; mvp-1-fix-r1-live-access (327b8bd, bb7a842); mvp-1-intake-profile (de9cac6); CLAUDE.md 'Update ARCHITECTURE when you change a boundary'
- **Status:** open

## TBD-120 · The server-side schema check of the persona fixtures is removed now and comes back next round in packages/schema
- **Kind:** decision
- **Where:** MVP 1 · Fix round 2
- **Context:** apps/server/src/e2e-fixtures.test.ts reads e2e/fixtures/{maria,tom,ai} and validates them against the real schemas. That is a cross-boundary coupling ARCHITECTURE doesn't document, and it sits in the wrong project. Documenting it needs docs/ARCHITECTURE.md, which belongs to intake-live this round. The e2e-fixtures branch must pass verification this round, or the stack still can't start.
- **Options:**
  1. Move the test to packages/schema and edit ARCHITECTURE (conflicts with intake-live)
  2. Remove the test from the e2e branch now and re-add it in packages/schema next round, with the other fixture-based proofs and one ARCHITECTURE sentence
- **Chosen:** Remove it now and re-add it as a packages/schema test next to wire.test.ts in round 3. The same ARCHITECTURE sentence will then cover every package test that reads persona fixtures (schema, F6.6 intake, F4.2/F4.5 scan). Unblocking the test stack matters most, since every validation criterion waits on it. The test was passing, not failing, and removing it removes the undocumented coupling. Until it returns, the fixtures are still checked inside e2e (consistency, build and compare tests), and in the live stack packages/ai validates the fake AI's answers.
- **If you decide otherwise:** Give docs/ARCHITECTURE.md to the e2e-fixtures task, move the test to packages/schema/src now, and defer the intake shutdown and live-access ARCHITECTURE updates one round.
- **Refs:** apps/server/src/e2e-fixtures.test.ts; packages/schema/src/wire.test.ts; docs/ARCHITECTURE.md e2e/ bullet
- **Status:** open

## TBD-121 · One helper opens the AI key; connect and scan switch to it after integration
- **Kind:** decision
- **Where:** MVP 1 · Fix round 2
- **Context:** intake, connect (routes/ai.ts `|| null`) and scan (jobs/scan/index.ts openSecret) each open the sealed AI key their own way. Intake passes "" through where the others pass null. The three live on separate unmerged branches with disjoint paths this round.
- **Options:**
  1. Fix intake only, with a shared openAiKey helper in apps/server/src/secrets.ts, and switch connect and scan to it after integration
  2. Make all three use it now (they would share paths across tasks)
- **Chosen:** intake-live adds openAiKey(secretKey, sealed) to apps/server/src/secrets.ts ("" becomes null) and uses it. After integration, connect's routes/ai.ts and scan's jobs/scan/index.ts should switch to it in a later round. It fixes the behaviour that is wrong (intake) now and keeps fix tasks disjoint. The other two already behave correctly.
- **If you decide otherwise:** Add the switch-over to the next fix round's server task, or let the integrator do it during the merge.
- **Refs:** apps/server/src/routes/intake.ts:127; mvp-1-fix-r1-connect:apps/server/src/routes/ai.ts:57; mvp-1-fix-r1-scan:apps/server/src/jobs/scan/index.ts:41-45
- **Status:** open

## TBD-122 · No code task for the report.md the harness refused to write, or for the validation-only checks
- **Kind:** decision
- **Where:** MVP 1 · Fix round 2
- **Context:** The close step could not write e2e/reports/mvp-1/<run>/report.md: the harness refuses report files from subagents ('Subagents should return findings as text'). The probes S1-S10, leak-app-log, leak-pg-dump, the per-scenario log checks and every 'no passing evidence' item failed only because the stack never started.
- **Options:**
  1. Change the workflow script so the orchestrator writes report.md from the close result
  2. Treat the close result as the run's report and leave the workflow unchanged
  3. Give these items to a code task
- **Chosen:** No code task. The report-file refusal is a harness limitation, not a repo defect: for now the run's report is the close step's structured result. The validation-only items are listed in the e2e-fixtures task for context only, and the next full validation run re-checks them. A fix agent can't change harness behaviour, and editing the workflow scripts is not a build fix task. Putting validation-only checks in a hermetic fix task would fail verification, because they can only be shown on a running stack.
- **If you decide otherwise:** The owner can let the close step write report.md, or have build-mvp.js write it from the CLOSE result, so the run folder holds a report again.
- **Refs:** e2e/reports/mvp-1/20261015T100402Z-r1-walkthrough/; .claude/workflows/build-mvp.js close step; docs/mvp/README.md 'Fix rounds'
- **Status:** open

## TBD-123 · Where mvp-1 is merged into the rebuilt scan branch
- **Kind:** decision
- **Where:** MVP 1 · Fix round 2 (scan)
- **Context:** The task allowed either replaying all scan commits linearly onto mvp-1, or replaying onto mvp-1-scan and then merging mvp-1. The later commits (eb42dd7, especially its app.test.ts edit) were written on top of the merged state.
- **Options:**
  1. Linear replay of every commit onto mvp-1
  2. Replay onto mvp-1-scan, merge mvp-1 after the worker commit as 46aa985 did, then replay the HTTP and web commits
- **Chosen:** Replay onto mvp-1-scan, merge mvp-1 after 4092f70's replay, then cherry-pick eb42dd7, 0080bf7 and 167e55f. It keeps the original history, so each later commit applies to the same tree it was written against. Every step applied without conflicts, and app.test.ts got only the change eb42dd7 already had.
- **If you decide otherwise:** A linear rebase onto mvp-1 would give the same final tree with a different history. Anyone who prefers that can rebase the branch without changing the content.
- **Refs:** 825716a (merge), 46aa985 (original merge), bbb36f4 (dropped sibling merge)
- **Status:** open

## TBD-124 · How the scan-window test proves the page follows the constant
- **Kind:** decision
- **Where:** MVP 1 · Fix round 2 (scan)
- **Context:** A test that checks for the text `last ${SCAN_WINDOW_DAYS} days` passes against the hard-coded '90 days' as long as the constant stays 90, so it would not catch the drift. Root vitest config says PGlite projects should avoid vi.mock; the web project is isolated and does not use PGlite.
- **Options:**
  1. Assert text built from the real constant
  2. Mock @jobfilly/schema for the whole file
  3. vi.doMock in one test with fresh imports of the page and its test helpers
- **Chosen:** vi.doMock in one test: SCAN_WINDOW_DAYS becomes 37, the page and components/testing are imported fresh, and the mock is undone in finally. It fails against the old hard-coded text (I checked) and leaves the other tests on the real schema.
- **If you decide otherwise:** A file-wide mock would change the constant for every test in scan.test.tsx; asserting against the real constant would not catch the hard-coding.
- **Refs:** apps/web/src/pages/scan/scan.test.tsx, apps/web/src/pages/scan/index.tsx, packages/schema/src/scan.ts:89
- **Status:** open

## TBD-125 · Which file is the single source of persona names and addresses
- **Kind:** decision
- **Where:** MVP 1 · Fix round 2 (e2e-fixtures)
- **Context:** The persona list and addresses were copied in fixtures/format.ts, stack.ts and seed/accounts.ts, and no test checked that the copies agreed. The task allowed either direction.
- **Options:**
  1. fixtures/format.ts holds PERSONAS and PERSONA_ADDRESSES; seed/accounts.ts and stack.ts derive from it
  2. seed/accounts.ts holds the accounts; format.ts builds PERSONA_ADDRESSES from ACCOUNTS[p].user
- **Chosen:** fixtures/format.ts is the source. ACCOUNTS is built from PERSONAS and PERSONA_ADDRESSES, with passwords E2E-SECRET-<persona>-imap, and is typed Record<Persona, Account>. format.ts already describes every fixture file, and the generator writes the persona addresses into the .eml headers. With imports running one way only (seed and stack import fixtures), there is no import cycle. Adding a persona now fails typecheck until every Record<Persona, …> is filled in, and stack.test.ts fails until compose's GreenMail users include it.
- **If you decide otherwise:** Make accounts.ts the source and have format.ts import ACCOUNTS. format.ts and the generator would then depend on seed/.
- **Refs:** e2e/fixtures/format.ts, e2e/seed/accounts.ts, e2e/stack.ts, e2e/seed/main.ts
- **Status:** open

## TBD-126 · How to show the seed entry point works without Docker or a real mailbox
- **Kind:** decision
- **Where:** MVP 1 · Fix round 2 (e2e-fixtures)
- **Context:** Running seed/main.ts against real fixtures needs an IMAP server. Tests must be hermetic and must never start the Docker stack.
- **Options:**
  1. Spawn seed/main.ts against a loopback IMAP stand-in that refuses LOGIN, recording the user name
  2. Implement enough IMAP in the stand-in to accept the full load (LIST, STATUS, APPEND)
  3. Only test loadPersona in-process (already done in load.test.ts)
- **Chosen:** A loopback stand-in that greets the client, answers CAPABILITY and refuses LOGIN. The test expects the seed to exit 1 with 'refused the login' and to have logged in with the persona's account. loadPersona reads and checks every fixture before it connects, and load.test.ts tests that. So reaching LOGIN proves the real entry point, run with compose's arguments, environment and working directory, resolved every fixture. A full IMAP fake would be large and fragile, and the in-process load test already checks how messages are appended.
- **If you decide otherwise:** A fuller IMAP fake would also exercise APPEND through imapflow, at the cost of a lot of protocol code in e2e.
- **Refs:** e2e/seed/main.test.ts, e2e/seed/load.test.ts
- **Status:** open

## TBD-127 · How the abandoned intake.v1 claim is released
- **Kind:** decision
- **Where:** MVP 1 · Fix round 2 (intake-live)
- **Context:** The task asks to release the claim by setting claimed_at to null. packages/db has no function that does that, and packages/db is outside this task's paths. The no-shared-paths rule for this round and the rule that workspace data goes only through packages/db rule out both editing it and writing raw SQL.
- **Options:**
  1. Add releaseIntakeExtras to packages/db (outside the allowed paths)
  2. Raw SQL in the server (against the workspace-scoping rule)
  3. Backdate the claim to the epoch through the existing takeOverIntakeExtras, guarded to this claim
- **Chosen:** releaseClaim in routes/intake.ts calls takeOverIntakeExtras with at = new Date(0) and staleBefore = claim.at + 1 ms. A claim dated at the epoch is stale for every caller, so the next GET /intake on any replica takes it over at once, as a null claimed_at would. The cut-off releases only this claim: a later takeover, or an outcome already stored, is left alone. The intake.test.ts test shows another replica taking over with no time passing and Confirm then returning 201.
- **If you decide otherwise:** Add releaseIntakeExtras(db, workspaceId, claim) to packages/db. It would set claimed_at to null where status is pending and the claim matches, and releaseClaim would call it. That is a one-line swap, and the route's existing claimedAt === null branch already takes such a claim over.
- **Refs:** apps/server/src/routes/intake.ts (releaseClaim, askForExtras); packages/db/src/queries/profiles.ts (takeOverIntakeExtras)
- **Status:** open

## TBD-128 · The abort stops waiting for the model but does not cancel the request
- **Kind:** decision
- **Where:** MVP 1 · Fix round 2 (intake-live)
- **Context:** The task asks to abort the running call with an AbortSignal. packages/ai's CallOptions has no signal field, and packages/ai is outside this task's paths.
- **Options:**
  1. Add signal to packages/ai CallOptions (outside the allowed paths)
  2. Race the call against the signal in the server and ignore its later answer
- **Chosen:** askForExtras checks signal.throwIfAborted() before the call, and races client.intake against the signal (untilAborted). Once aborted, the answer is never used and the claim is released. Shutdown can't be held up by a slow provider, and the claim is free for another replica right away. The leftover HTTP request ends when the process exits a moment later.
- **If you decide otherwise:** Once packages/ai accepts CallOptions.signal, pass the same signal to client.intake so the provider request is cancelled too.
- **Refs:** apps/server/src/routes/intake.ts (untilAborted); packages/ai/src/index.ts (CallOptions)
- **Status:** open

## TBD-129 · Connect and scan switch to openAiKey after integration
- **Kind:** decision
- **Where:** MVP 1 · Fix round 2 (intake-live)
- **Context:** routes/ai.ts and jobs/scan/index.ts already map a sealed "" to null their own way. Their files are outside this task's paths.
- **Options:**
  1. Edit them now (outside the allowed paths)
  2. Leave them; switch them after integration
- **Chosen:** Only routes/intake.ts uses openAiKey on this branch. The task says so, and no two tasks this round may share a path.
- **If you decide otherwise:** After integration, replace the `|| null` in routes/ai.ts:57 and openSecret in jobs/scan/index.ts with openAiKey(deps.config.secretKey, sealed).
- **Refs:** apps/server/src/secrets.ts (openAiKey)
- **Status:** open

## TBD-130 · Minimum pay amounts are read in the UI's English locale
- **Kind:** decision
- **Where:** MVP 1 · Fix round 2 (intake-live)
- **Context:** The parser must use the same locale the inbox formats in. That is UI_LOCALE = "en", so dot decimals and comma groups. Users who write '70.000' or '450,50' will see 'Retype the amount, written like 1,234.50' instead of a silently wrong number.
- **Options:**
  1. Read with the browser's locale (navigator.language)
  2. Read with the inbox's UI_LOCALE
- **Chosen:** parseAmount defaults to UI_LOCALE. Spaces are read as digit grouping in any locale, and only 3-digit groups are accepted. Amounts are then read in the same notation they are shown in, and nothing locale-specific is hard-coded. The separators come from Intl, and anything ambiguous is refused, never guessed.
- **If you decide otherwise:** If the UI gains a user locale, pass it to both formatPay and parseAmount. The tests already cover a comma-decimal locale (de).
- **Refs:** apps/web/src/pages/inbox/format.ts (parseAmount); apps/web/src/pages/intake/answers.tsx (MinPayEditor)
- **Status:** open

## TBD-131 · Walk S2 through Settings > AI instead of the onboarding step
- **Kind:** decision
- **Where:** MVP 1 · Validate (S2)
- **Context:** S1 ended on Settings > Mailbox, after its walker left the 'Pick your AI' onboarding step. No visible link leads back to onboarding, and the protocol forbids typing internal URLs.
- **Options:**
  1. Type the onboarding URL by hand
  2. Walk S2 in Settings > AI and continue through the Scan nav link
  3. Mark S2 not walked
- **Chosen:** Walk S2 in Settings > AI and continue through the Scan nav link. Settings > AI is the same 'Pick your AI' form (same accessible form name and fields), and visible links reach it. Typing a URL would break the protocol. The missing route back is recorded as a finding.
- **If you decide otherwise:** If the owner wants the onboarding path itself walked, S1 must end on the onboarding step and S2 must start from there. Or the app needs a visible way back into onboarding, for example a setup prompt on the empty inbox.
- **Refs:** docs/mvp/MVP-1.md S2; docs/mvp/README.md Validation protocol 1; e2e/reports/mvp-1/20261015T113934Z-r2-walkthrough/s1-07-saved-next-step.png
- **Status:** open

## TBD-132 · Pressed 'Start scan again' after the first scan failed
- **Kind:** decision
- **Where:** MVP 1 · Validate (S3)
- **Context:** The first scan failed after 3.3 s, before a second view on the other replica could be opened, so F4.6 could not be observed at all.
- **Options:**
  1. Stop after the first failure
  2. Open the app-b direct view, then press 'Start scan again' through the proxy to try to see a live update across replicas
- **Chosen:** Opened the app-b direct view, then pressed 'Start scan again' through the proxy. It is an ordinary user action, and it was the only way to collect any evidence about live updates across replicas and the one-replica rule in this run.
- **If you decide otherwise:** Maria's workspace now holds two failed first scans (c0ad366e… on app-a, 2d694adf… on app-b) instead of one. Later scenarios on this stack start from that state. A fresh stack is needed for a clean S3 after the intake merge anyway.
- **Refs:** app.log 11:55:08.694Z and 11:56:06.895Z scan.started lines; e2e/reports/mvp-1/20261015T113934Z-r2-walkthrough/s3-04-proxy-view-after-second-start.png
- **Status:** open

## TBD-133 · Did not press 'Analyze them' to work around the failed first scan
- **Kind:** decision
- **Where:** MVP 1 · Validate (S5)
- **Context:** S5 depends on the analysis from S3's first scan, which failed because of the aggregateIntake stub. 'Analyze them' is a visible admin button, but it is S8's step and would change the state S8 and S9 start from.
- **Options:**
  1. Press Analyze them to try to fill the inbox
  2. Walk S5 against the state S3 left and report the blocked steps
- **Chosen:** Walk S5 against the state S3 left; every step that does not need analysis was walked, and the rest are reported as failed with the root cause. The protocol has later scenarios start from the state earlier ones leave. An extra scan run here would spoil S8 (budget stop and 'not analyzed' count shrinking) and S9. It would most likely also fail on the same stub.
- **If you decide otherwise:** A walker would press Analyze them first. That changes the not-analyzed count S8 relies on, and F5.3 compares whatever got analysed.
- **Refs:** docs/mvp/MVP-1.md S5, S8; packages/core/src/intake/index.ts; apps/server/src/deps.ts
- **Status:** open

## TBD-134 · Correction target for the 'correct one category' step
- **Kind:** decision
- **Where:** MVP 1 · Validate (S5)
- **Context:** Only 40 stage-one job alerts and the 235 non-job messages were in the app, all categorised correctly. Any correction makes a correct category 'wrong'.
- **Options:**
  1. Correct a job alert to Other job mail
  2. Correct a non-job message to a job category
  3. Correct and then revert
- **Chosen:** <maria-0002@linkedin.com> was changed from Job alert to Other job mail and left that way. It shows persistence on a visible job-inbox row. The F5.3 compare leaves out categories a person corrected in S5 and S6, so it does not disturb later checks.
- **If you decide otherwise:** A different message would carry the correction. There is no functional effect on later scenarios.
- **Refs:** e2e/specs/mvp-1/99-f5.3-stored-equals-expected.spec.ts header comment
- **Status:** open

## TBD-135 · Set up Tom's AI through Settings > AI rather than the onboarding step
- **Kind:** decision
- **Where:** MVP 1 · Validate (S7)
- **Context:** S7 says Tom 'sets up the AI in his own workspace'. After reconnecting the mailbox from Settings > Mailbox, the onboarding flow was no longer in view.
- **Options:**
  1. Settings > AI
  2. Navigate back into the onboarding 'Pick your AI' step
- **Chosen:** Settings > AI, reached by clicking the visible 'AI' settings link. It uses the same 'Pick your AI' form (test, 'Your mail is read by…' line, Saved.). It is the visible path a person would take from where Tom was, and the criterion only requires the AI to be set up in his own workspace.
- **If you decide otherwise:** The onboarding route would exercise the same form component and endpoints. No change to the result is expected.
- **Refs:** docs/mvp/MVP-1.md S7; e2e/reports/mvp-1/20261015T113934Z-r2-walkthrough/s7-04-tom-ai-saved.png
- **Status:** open

## TBD-136 · Extra screenshots for a scenario with no camera marks
- **Kind:** decision
- **Where:** MVP 1 · Validate (S8)
- **Context:** S8 has no camera-marked step, but the result needs visual evidence for a failing criterion.
- **Options:**
  1. Take no screenshots
  2. Save evidence screenshots named s8-*
- **Chosen:** Saved s8-01-budget-5-saved.png, s8-02-inbox-before-analyze-345.png, s8-03-analyze-run-failed-not-budget.png and s8-04-budget-back-300.png in /Users/admin/Desktop/Repos/newrepo/JobFilly/e2e/reports/mvp-1/20261015T113934Z-r2-walkthrough. The validation protocol says to report with evidence. The run folder is git-ignored, so the extra screenshots add nothing to the tree.
- **If you decide otherwise:** Remove the four s8-*.png files; the log lines alone still prove the failure.
- **Refs:** docs/mvp/README.md 'Validation protocol' 1 and 6
- **Status:** open

## TBD-137 · Budget restored to 300 even though the budget stop never happened
- **Kind:** decision
- **Where:** MVP 1 · Validate (S8)
- **Context:** The scenario ends by setting the budget back to 300; S9 depends on a normal budget.
- **Options:**
  1. Leave the budget at 5
  2. Restore it to 300 through Settings > AI
- **Chosen:** Restored it to 300 with Save; 'Saved.' showed, and ai.settings_saved was logged at 12:15:54.696Z on app-b (s8-04-budget-back-300.png). Keeps the stack in the state the scenario leaves it in, so later scenarios are not affected.
- **If you decide otherwise:** S9 would stop for budget after 5 calls instead of running to 'done'.
- **Refs:** docs/mvp/MVP-1.md S8, S9
- **Status:** open

## TBD-138 · Still perform the kill/restart infrastructure step although the run had already failed
- **Kind:** decision
- **Where:** MVP 1 · Validate (S9)
- **Context:** S9 says to kill the scan's replica while the run is in progress, but the Analyze run failed 35 ms after scan.started, before anyone (or any script) could kill it.
- **Options:**
  1. Stop the scenario at the failure
  2. Kill and restart the replica anyway to cover what can still be observed (proxy failover, sessions surviving the restart, F1.3)
  3. Press Analyze them again repeatedly hoping to catch it mid-run
- **Chosen:** Killed app-a (the instance of the latest scan.started) once, then restarted it and did 20 page loads as Maria. This keeps to the scenario's listed infrastructure steps and still gives real evidence for F1.3. Pressing again would only reproduce the same immediate failure, and those extra presses are not in the scenario.
- **If you decide otherwise:** F1.3 would have no S9 evidence from this run. F4.8 stays unproven either way until aggregateIntake is implemented.
- **Refs:** app.log 12:17:36.865Z scan.started app-a; kill at 12:17:55Z; server.ready app-a 12:18:12.948Z
- **Status:** open

## TBD-139 · Which email to use for Maria's sign-in
- **Kind:** decision
- **Where:** MVP 1 · Validate (S10)
- **Context:** S10 says only 'she signs in again', and the email typed at registration in S1 is not written in the scenario. The rules forbid reading the database during the walkthrough.
- **Options:**
  1. Use the persona address from e2e/fixtures (maria.santos@inbox.example), which the F5.3 spec also uses
  2. Search app.log for the email
- **Chosen:** maria.santos@inbox.example with E2E-SECRET-maria-login. It is the persona's canonical address in the fixtures and in the specs. app.log does not log emails, as intended. The sign-in succeeded and landed in 'Maria's workspace' (fe531aa2-…), the same workspace S1 created.
- **If you decide otherwise:** If S1 had registered a different address, the re-sign-in would show 'Email or password is incorrect' and the step would need the S1 email.
- **Refs:** e2e/specs/mvp-1/99-f5.3-stored-equals-expected.spec.ts:20, e2e/fixtures/format.ts (PERSONA_ADDRESSES)
- **Status:** open

## TBD-140 · How to place both the slow request and the live stream on app-b
- **Kind:** decision
- **Where:** MVP 1 · Validate (S11)
- **Context:** The proxy round-robins every request, and the scenario needs a slow request and a live-update stream open on app-b at the moment of SIGTERM. Writes through the direct :8082 port fail the Origin check by design, and a person cannot choose a replica.
- **Options:**
  1. Use one tab and retry until both land on app-b
  2. Open the same page in a second browser tab (a person's action) so the two streams and two Test requests spread over both replicas, then confirm placement from the logs
  3. Drive app-b directly on :8082
- **Chosen:** A second tab of Settings › AI, with Test clicked in both tabs and SIGTERM sent right away. The logs confirmed tab 1's stream and tab 0's Test POST were both on app-b. It stays within human actions through the proxy, it is deterministic enough, and it avoids repeated 15-second retries.
- **If you decide otherwise:** The codified spec could pin placement differently, for example by retrying until the logs show app-b, but this changes no app behaviour.
- **Refs:** S11, F7.4, TBD-15/TBD-33; e2e/reports/mvp-1/20261015T113934Z-r2-walkthrough/s11-01..03*.png
- **Status:** open

## TBD-141 · How to get the intake-profile slice onto mvp-1
- **Kind:** decision
- **Where:** MVP 1 · Fix round 3
- **Context:** aggregateIntake on mvp-1 is still the throwing stub, so every scan fails and S3-S9 are blocked. The real slice is on three unmerged branches: mvp-1-intake-profile (de9cac6), mvp-1-fix-r1-intake-profile (8bd9b4e) and mvp-1-fix-r2-intake-live (ba9f264), which contains the other two plus the live-access and shutdown fixes from round 2. It is 59 commits behind mvp-1, and git merge-tree finds only two test-file conflicts.
- **Options:**
  1. Continue mvp-1-fix-r2-intake-live: merge mvp-1 into it, resolve, verify, then let the integrator merge it
  2. Merge the older mvp-1-intake-profile only
  3. Rebuild the slice from scratch on mvp-1
- **Chosen:** Continue mvp-1-fix-r2-intake-live, and add a server-level test that drives a scan through the real aggregateIntake. It is the newest branch and already holds the round 1 and round 2 intake fixes and the live-stream revocation. Merging it keeps reviewed work, and the conflicts are small. The scan tests passed only because they used the stand-in in jobs/scan/fakes.ts. A test through createDeps with the real aggregateIntake stops the slice from going missing again unnoticed.
- **If you decide otherwise:** Merging only the older branch would drop the round 1 and round 2 fixes (live revocation, shutdown of the intake.v1 call, locale pay parsing). A rebuild would throw away verified work and cost a round.
- **Refs:** packages/core/src/intake/index.ts; apps/server/src/deps.ts:116; apps/server/src/jobs/scan/run.ts:195,337; apps/server/src/jobs/scan/fakes.ts:185; branches mvp-1-fix-r2-intake-live ba9f264
- **Status:** open

## TBD-142 · F5.3 proof spec when the scenario specs aren't codified yet
- **Kind:** decision
- **Where:** MVP 1 · Fix round 3
- **Context:** The 99-f5.3 proof reads the state S1-S9 create. In MVP 1's walkthrough round, `pnpm e2e:specs` ran with only 00-stack and 99-f5.3 present, so the proof got 401 before any persona existed. In the confirm run, the codified S1-S9 specs run first and the proof is meaningful.
- **Options:**
  1. Guard: skip the proof, with a stated reason, while the S1-S9 spec files it needs are absent, and run it as soon as they exist (pinned in stack.test.ts)
  2. Leave it, and accept a known failure in every walkthrough-round spec run
  3. Move the proof out of specs/ into a separate command the workflow would have to call
- **Chosen:** Guard on the presence of the named scenario spec files, with an explicit skip reason; never skip once they exist. The failure is an ordering artefact, not an app defect, and it hides real regressions in specs.log. The guard depends only on whether the files exist, not on the outcome, so the proof can't be silenced once the scenarios are codified, and the confirm run still requires it to pass. During walkthrough rounds, S5 covers F5.3. The workflow files are not the build's to edit, so a separate command would not be run.
- **If you decide otherwise:** Each walkthrough round reports two false spec failures, and triage keeps re-raising them. Moving the proof would mean changing .claude/workflows.
- **Refs:** e2e/specs/mvp-1/99-f5.3-stored-equals-expected.spec.ts; e2e/stack.test.ts:206; .claude/workflows/build-mvp.js:345-352
- **Status:** open

## TBD-143 · Wording and storage of a failed scan's cause
- **Kind:** decision
- **Where:** MVP 1 · Fix round 3
- **Context:** Every failed run says 'Check the mailbox and AI settings, then try again.' even for an internal error, which sends users in circles. Only the log knows cause=error. Telling causes apart in the UI means keeping the cause class with the scan, which is a new column and migration.
- **Options:**
  1. Store a cause class (mailbox, ai, internal) on the scan and word the stop message for each one
  2. Make the single failed message neutral ('something went wrong') with no cause
  3. Keep the current text
- **Chosen:** Store the cause class and word the message for each cause. An internal fault says the problem is on JobFilly's side and that the settings are fine. Users would notice the difference. It points them to the right fix when mailbox or AI is at fault, and avoids a pointless settings hunt when the fault is internal. F4.4 asks that the stop be said in plain words. 'failed' is not one of F4.4's four reasons, so this only words the failure honestly and doesn't change the criterion.
- **If you decide otherwise:** A neutral message loses useful guidance for real mailbox or AI faults. Keeping the current text keeps a finding that four scenarios reported.
- **Refs:** packages/core/src/scan/tracker.ts:110; apps/server/src/jobs/scan/run.ts:224-237,372; packages/db/src/queries/scans.ts
- **Status:** open

## TBD-144 · Search over likely job mail that isn't analysed yet
- **Kind:** decision
- **Where:** MVP 1 · Fix round 3
- **Context:** S5: searching for a recruiter whose mail is still unanalysed returns 'No messages match.' with no explanation. F5.1 and F5.5 describe the job inbox as job messages, which are known only after analysis.
- **Options:**
  1. Keep search over analysed job mail, and make empty or partial results say how many likely job emails aren't analysed and how to analyse them
  2. Include unanalysed likely-job messages in search results
  3. Leave as is
- **Chosen:** Keep the search scope and explain it in the inbox, with the count and the way to Analyze them. Unanalysed mail has no category or facts, so mixing it into the job inbox would blur F5.1's 'job messages' and the category filter. Saying what is left out removes the dead end without a server or schema change.
- **If you decide otherwise:** Searching unanalysed mail would change the messages API and the list's meaning for every user, and would need a server change in a file the intake task merges.
- **Refs:** apps/web/src/pages/inbox/InboxPage.tsx; apps/web/src/pages/scan/NotAnalyzedBanner.tsx; docs/mvp/MVP-1.md F5.1, F5.5
- **Status:** open

## TBD-145 · Strip SQL and parameters from logged database errors at the logger
- **Kind:** decision
- **Where:** MVP 1 · Fix round 3
- **Context:** db.connection_error logs Drizzle's 'Failed query: <SQL> params: <values>'. If a write that carries content fails, the content would reach stdout, which breaks ARCHITECTURE › Logs and F7.6. It was not observed in this run.
- **Options:**
  1. Sanitize database errors in the logger's error serializer (name, pg code, cause message only)
  2. Change each call site to log a hand-picked field
  3. Leave it, because it was not observed
- **Chosen:** Sanitize in the logger's error serializer, so every call site, present and future, is covered. One choke point is harder to bypass than seven call sites, and it also cuts the 1 KB-per-second noise during outages.
- **If you decide otherwise:** Fixing each call site leaves the next new call site exposed. Leaving it keeps a latent leak of user content.
- **Refs:** apps/server/src/log.ts:110; apps/server/src/jobs/queue.ts:194,204,225,228; apps/server/src/index.ts:24,38,84
- **Status:** open

## TBD-146 · Keep the pg cause's message even though some pg messages quote a value
- **Kind:** decision
- **Where:** MVP 1 · Fix round 3 (db-error-logging)
- **Context:** The task says to log the name, the pg code and the cause's message. Some Postgres messages quote input, for example 'invalid input syntax for type uuid: "..."'. The detail field ('Key (email)=(...) already exists') does too, but it is dropped.
- **Options:**
  1. Log the cause's message with the existing masking (as specified)
  2. Drop the cause's message and log only the name and code
- **Chosen:** Log the cause's message, masked for emails and Message-IDs; never log detail, where, query or params. This follows the fix task. The message is what tells an operator why the query failed (such as a connection reset or a constraint name). The bulk leak, the parameter list and the SQL, is closed.
- **If you decide otherwise:** If even the occasional quoted scalar in a pg message is unacceptable, change redactError in apps/server/src/log.ts to drop `message` for failed queries and keep only name and code.
- **Refs:** apps/server/src/log.ts (redactError), apps/server/src/log.test.ts
- **Status:** open

## TBD-147 · Reuse the current-scan query, not the NotAnalyzedBanner component, inside InboxPage
- **Kind:** decision
- **Where:** MVP 1 · Fix round 3 (inbox-search-unanalysed)
- **Context:** The task said to reuse the current-scan query and NotAnalyzedBanner by importing them. But routes.tsx (which this task may not change) already renders NotAnalyzedBanner above InboxPage on the inbox routes. NotAnalyzedBanner also says neither 'aren't included' nor 'an admin can run it'.
- **Options:**
  1. Render NotAnalyzedBanner again inside InboxPage's empty state
  2. Add a filter-specific note in InboxPage built on the same useCurrentScan/useScanAction/likelyJobEmails from pages/scan/queries
- **Chosen:** A LeftOutNote in InboxPage, built on the same current-scan query and scan action from pages/scan/queries. Rendering the banner again would put two identical banners on the page, each with its own Analyze them button. It also couldn't say the mail is left out of the results or tell non-admins who can run it, which the fix requires. Sharing the query keeps the count consistent with the banner and shares its cache and live updates.
- **If you decide otherwise:** Importing NotAnalyzedBanner into InboxPage would mean removing it from routes.tsx (outside this task's paths) to avoid the duplicate, and changing its wording inside pages/scan.
- **Refs:** apps/web/src/pages/inbox/InboxPage.tsx (LeftOutNote), apps/web/src/routes.tsx (Inbox), apps/web/src/pages/scan/NotAnalyzedBanner.tsx
- **Status:** open

## TBD-148 · Exact file names the codified MVP 1 scenario specs must use
- **Kind:** decision
- **Where:** MVP 1 · Fix round 3 (e2e-f53-proof-order)
- **Context:** The guard has to list exact spec files, but no scenario specs exist yet; the codify step will create them. Their names also have to sort before 99-f5.3 under localeCompare.
- **Options:**
  1. NN-sN-<slug>.spec.ts with fixed slugs (01-s1-maria-registers, 03-s3-first-scan, 05-s5-job-inbox, 06-s6-inviting-tom, 07-s7-toms-thin-inbox, 08-s8-budget-stop, 09-s9-replica-dies), enforced by stack.test.ts
  2. Match by scenario-id prefix only (e.g. any 'NN-sN-*') instead of exact names
  3. Leave naming unenforced
- **Chosen:** Fixed NN-sN-<slug>.spec.ts names listed in F53_PROOF_NEEDS. stack.test.ts requires every scenario spec in specs/mvp-1 to follow NN-sN-<slug>, and requires the specs for S1/S3/S5–S9 to use exactly the listed names. The task asks for the exact files. Without enforcement, a codifier picking other names would leave the proof skipped silently and for good. With it, pnpm check fails at once and points at the list.
- **If you decide otherwise:** The codify agent either names its specs as listed or updates F53_PROOF_NEEDS and the pinned list in stack.test.ts together. If the guard matched by prefix instead, the naming test could be relaxed.
- **Refs:** e2e/playwright.config.ts (F53_PROOF_NEEDS), e2e/stack.test.ts (describe 'e2e/specs/mvp-1')
- **Status:** open

## TBD-149 · Where the guard lives
- **Kind:** decision
- **Where:** MVP 1 · Fix round 3 (e2e-f53-proof-order)
- **Context:** Only the spec, stack.test.ts and playwright.config.ts could be changed. The spec cannot be imported under Vitest because it calls test() at the top level.
- **Options:**
  1. Export the guard from playwright.config.ts and import it in both the spec and stack.test.ts
  2. Duplicate the list in the spec and check it by parsing the spec's source in stack.test.ts
  3. Use Playwright project dependencies
- **Chosen:** Export F53_PROOF_NEEDS and f53ProofSkipReason from playwright.config.ts. This gives one source of truth that both Playwright and Vitest can import. Project dependencies would break the single name-ordered run across specs/mvp-1 and specs/mvp-2 (the proof must run before MVP 2 specs change the state), and they can't skip with a reason when files are missing.
- **If you decide otherwise:** If a shared e2e fixture module is preferred, the helper can move to e2e/fixtures in a later change.
- **Refs:** e2e/playwright.config.ts, e2e/specs/mvp-1/99-f5.3-stored-equals-expected.spec.ts
- **Status:** open

## TBD-150 · How the merged mvp-1 scan tests subscribe to live events
- **Kind:** decision
- **Where:** MVP 1 · Fix round 3 (intake-live-merge)
- **Context:** After the merge, the branch's live hub requires a StreamOwner {workspaceId, userId, sessionId} so that streams can be revoked (F1.4, F1.9). mvp-1's apps/server/src/jobs/scan/scan.test.ts and routes/scans.test.ts call deps.live.subscribe(workspaceId, ...), so the server failed to typecheck. Both test files are outside this task's allowed paths.
- **Options:**
  1. Edit scan.test.ts and scans.test.ts to pass a fake owner (outside the allowed paths)
  2. Let LiveHub.subscribe also take a bare workspace id as an in-process listener that belongs to no member, so no access change revokes it
  3. Leave the typecheck broken
- **Chosen:** Let subscribe take StreamOwner | string. A string registers a listener with userId and sessionId set to null, which member.removed and session.ended never match; closeAll() still closes it. It stays inside the allowed paths (apps/server/src/live/), keeps both sides' tests unchanged, and does not weaken revocation: the SSE route (live/routes.ts) still always passes the member's owner, and the new hub test shows a member's stream is revoked while the ownerless listener is not.
- **If you decide otherwise:** If the owner prefers that every subscriber have an owner, change scan.test.ts:169 and scans.test.ts:49 to pass {workspaceId, userId, sessionId} as messages.test.ts and intake.test.ts already do, then drop the string overload in hub.ts.
- **Refs:** apps/server/src/live/hub.ts (subscribe, Stream.owner); apps/server/src/live/hub.test.ts 'never closes a listener that belongs to no member'; commit bf19143
- **Status:** open

## TBD-151 · Role-dependent wording of the Intake and Profile empty states (S4)
- **Kind:** decision
- **Where:** MVP 1 · Fix round 3 (intake-live-merge)
- **Context:** The Intake and Profile nav links led to dead ends before the first scan stopped or before any profile existed. Only admins can start a scan (scan page), and only editors and admins can confirm the intake form.
- **Options:**
  1. One message for every role
  2. Wording by role and scan state, all linking to Scan or Intake
- **Chosen:** No scan yet: an admin gets 'No scan has run yet. Start it once your mailbox and AI are set up.' with a link 'Start the first scan'; editors and viewers get 'An admin of this workspace starts it.' with a link 'See the scan'. First scan running: 'The first scan is still reading your mail.' with 'Go to the scan'. Profile page with the form open and no profile: an editor or admin gets 'Check the answers on the intake form and confirm them to save it.' with 'Open the intake form'; a viewer gets 'It is saved when an editor or admin confirms the intake form.' with 'See the intake form'. Users see this wording. It matches what each role can actually do, it reuses the scan page's existing phrasing ('Start it once your mailbox and AI are set up.' / 'An admin of this workspace…'), and it never offers an action the role can't take.
- **If you decide otherwise:** Change the strings in apps/web/src/pages/intake/ScanFirst.tsx and NoProfileYet in apps/web/src/pages/profile/ProfilePage.tsx, and their tests.
- **Refs:** apps/web/src/pages/intake/ScanFirst.tsx; apps/web/src/pages/intake/queries.ts useFormOpen (firstScan); apps/web/src/pages/profile/ProfilePage.tsx NoProfileYet; commit cbe2933
- **Status:** open

## TBD-152 · Which failures count as mailbox, AI or internal
- **Kind:** decision
- **Where:** MVP 1 · Fix round 3 (scan-failure-feedback)
- **Context:** The task asks for a cause class per failed run. Some failure points are ambiguous: the AI client throwing, a stored secret that won't decrypt, and a batch where the model produced nothing usable.
- **Options:**
  1. A throw from the AI client counts as AI, since it happened during the call
  2. A throw from the AI client counts as internal, because packages/ai returns every provider failure (auth, unreachable, provider_error) as a value
  3. A secret that won't decrypt counts as a mailbox or AI fault
  4. A secret that won't decrypt counts as internal (it was sealed under a different JOBFILLY_SECRET_KEY)
- **Chosen:** AI: provider auth, unreachable or provider_error, no AI settings, failure to create the AI client, and a batch with no progress (log code no_progress). Mailbox: body or envelope read errors, no mailbox, failure to create the mail client. Internal: a throw from the AI client (log code ai_client_error), a secret that won't decrypt (secret_error), and any unexpected error (error). packages/ai turns provider and transport failures into values, so a throw from the client is a fault in JobFilly. Sending the user to Settings › AI for it would be misleading. A secret that won't decrypt comes from the server's key configuration, not from anything the user typed.
- **If you decide otherwise:** Change the first argument of the RunFailed and fail() calls in apps/server/src/jobs/scan/run.ts and index.ts. The wording lives in FAILED in packages/core/src/scan/tracker.ts.
- **Refs:** TBD-112; F4.4; apps/server/src/jobs/scan/run.ts; apps/server/src/jobs/scan/index.ts
- **Status:** open

## TBD-153 · New wording for a failed stop (replaces the message in TBD-112)
- **Kind:** decision
- **Where:** MVP 1 · Fix round 3 (scan-failure-feedback)
- **Context:** TBD-112 recorded one message for every failed run: 'Check the mailbox and AI settings, then try again.' This task needs a message for each cause. TBD.md is outside this task's allowed paths.
- **Options:**
  1. Keep one generic message
  2. Word the message for each cause, with a neutral fallback for a failed run stored without a cause
- **Chosen:** Mailbox: 'Stopped: couldn't read your mailbox after X of N likely job emails. Check Settings › Mailbox, then try again.' AI: 'Stopped: the AI provider couldn't be used after X of N likely job emails. Check Settings › AI, then try again.' Internal: 'Stopped: something went wrong on JobFilly's side after X of N likely job emails. Your settings don't need changing; trying again later may help.' Failed with no cause stored: 'Stopped: couldn't go on after X of N likely job emails. Try again.'. It follows the task's instruction and uses the 'Settings › …' names the app already uses. The fallback makes no claim about where the fault was when the cause is unknown.
- **If you decide otherwise:** Edit FAILED and the fallback in stopMessage in packages/core/src/scan/tracker.ts, and the expected strings in the tracker, worker, route and web tests.
- **Refs:** TBD-112; packages/core/src/scan/tracker.ts
- **Status:** open

## TBD-154 · Fold the stop_cause column into the one MVP 1 migration
- **Kind:** decision
- **Where:** MVP 1 · Fix round 3 (scan-failure-feedback)
- **Context:** Adding scans.stop_cause needs a schema change. packages/db/src/index.test.ts (outside my paths) asserts there is exactly one MVP 1 migration, and ARCHITECTURE says one migration per release step. MVP 1 has not been released.
- **Options:**
  1. Add a 0001 migration
  2. Add the column and its check constraint to 0000_mvp1.sql and its snapshot
- **Chosen:** Added to 0000_mvp1.sql and meta/0000_snapshot.json. drizzle-kit generate reports no schema changes. No release has applied 0000 yet, the existing migration test requires a single migration, and it follows the 'one migration per release step' rule.
- **If you decide otherwise:** If an MVP 1 database already exists somewhere, add ALTER TABLE scans ADD COLUMN stop_cause text plus the check constraint as 0001, and update the migration count in packages/db/src/index.test.ts.
- **Refs:** docs/ARCHITECTURE.md (migrations); packages/db/migrations/0000_mvp1.sql
- **Status:** open

## TBD-155 · Show the stop time so a repeated failure reads as the new run
- **Kind:** decision
- **Where:** MVP 1 · Fix round 3 (scan-failure-feedback)
- **Context:** S8: a run that fails again must be visibly different from the earlier one. The stop message has to stay a server-computed string, and the live event schema must not change.
- **Options:**
  1. Put the time inside the server's stop message (the server doesn't know the user's time zone)
  2. Add stoppedAt to the HTTP CurrentScan response and show it next to the message, formatted in the browser's locale and time zone
- **Chosen:** CurrentScan gains stoppedAt (HTTP only; ScanProgress and the live events are unchanged). The Scan page and the banner show 'Ended <time>': time with seconds, plus the date when it wasn't today. The message stays the same server string everywhere, no time zone is hard-coded, and the live event schema owned by the other task is untouched. A scan.stopped event already triggers a refetch of /scans/current, so the time arrives with it.
- **If you decide otherwise:** Remove stoppedAt from CurrentScanSchema and the route, and drop StopTime.tsx and its uses.
- **Refs:** S8; packages/schema/src/scan.ts; apps/web/src/pages/scan/StopTime.tsx
- **Status:** open

## TBD-156 · Untracked .claude/worktrees/ handled with a local git exclude instead of a stash
- **Kind:** decision
- **Where:** MVP 2 · Preflight
- **Context:** The only thing making the tree dirty was the untracked .claude/worktrees/ directory. It holds 95 live git worktrees that the workflow harness created during the MVP 1 run. The preflight says to stash anything untracked with 'git stash push -u'. But stash -u removes untracked files after stashing them, so it would have deleted those registered worktrees, or failed on them as embedded repositories.
- **Options:**
  1. git stash push -u as written
  2. Add .claude/worktrees/ to the committed .gitignore
  3. Add .claude/worktrees/ to the local .git/info/exclude
- **Chosen:** Added '.claude/worktrees/' to .git/info/exclude. This is local only and nothing was committed. The tree is now clean and no files were moved or deleted. It keeps the harness's worktrees safe and gets a clean tree without committing a change to the repo for a tooling artifact.
- **If you decide otherwise:** A stash -u would have wiped or broken 95 registered worktrees. Changing .gitignore would add a repo commit that has nothing to do with MVP 2. The owner can add it to .gitignore later, or prune the stale worktrees with 'git worktree prune' after removing them.
- **Refs:** .git/info/exclude; git worktree list
- **Status:** open

## TBD-157 · mvp-2 branched from mvp-1, not from main
- **Kind:** decision
- **Where:** MVP 2 · Preflight
- **Context:** MVP 1 is signed off on branch mvp-1 (status 'accepted with open items', commit b3d20f1, sign-off commit b662b79) but is not merged into main.
- **Options:**
  1. Create mvp-2 from main
  2. Create mvp-2 from mvp-1
- **Chosen:** Created mvp-2 from mvp-1 at b662b79. The preflight rule says to branch from mvp-1 when MVP 1 is not merged into main. MVP 2 builds on MVP 1's code.
- **If you decide otherwise:** Branching from main would leave out all of MVP 1's code.
- **Refs:** docs/mvp/MVP-1.md sign-off table; git merge-base --is-ancestor mvp-1 main -> not merged
- **Status:** open

## TBD-158 · Merge MVP 1's unmerged intake/profile/live branch into mvp-2 first
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** mvp-2 does not contain MVP 1's F6: profiles.ts and intake.ts answer 501, packages/db/src/queries/profiles.ts is empty, and ProfilePage and IntakePage are stubs. That work is on mvp-1-fix-r4-intake-live-merge, 30 commits ahead and 1 behind mvp-2, along with live-stream revocation. MVP 2's rules, matching, reply policy, decisions and assistant all rest on the confirmed profile.
- **Options:**
  1. Merge mvp-1-fix-r4-intake-live-merge into mvp-2 as foundation step 0
  2. Rebuild a minimal profile store inside MVP 2
  3. Leave it and build MVP 2 without a profile
- **Chosen:** Merge it first, with --no-ff (a dry-run git merge-tree shows no conflicts), then pnpm check, fixing only what the merge breaks. MVP 2 can't serve its criteria without the profile, and the branch holds finished and reviewed MVP 1 work. Rebuilding it would duplicate that work and diverge from it.
- **If you decide otherwise:** The foundation would have to build its own profile storage and page, and MVP 1's F6 would stay missing.
- **Refs:** branch mvp-1-fix-r4-intake-live-merge; TBD-35; TBD-150; TBD-151; apps/server/src/routes/profiles.ts; packages/db/src/queries/profiles.ts
- **Status:** open

## TBD-159 · Six slices: drafts and decisions together; the assistant waits for rules-match
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** Eight function areas (F1 to F8) plus the test-stack work, but at most 6 slices. Decisions come from draft questions and from match unknowns, and answering one creates drafts. The assistant's impact preview has to run the real rules engine and match.
- **Options:**
  1. drafts and decisions as one 'replies' slice; assistant dependsOn rules-match
  2. cvs and sender-check merged; drafts and decisions separate
  3. The test stack folded into the foundation
- **Chosen:** The foundation takes F1. The slices are cvs, sender-check, rules-match, replies (F6 and F7), assistant (F8, depends on rules-match) and e2e-fixtures (no criteria). The reply-or-ask decision is one point in the pipeline, so giving it one owner removes a fragile contract between two slices. A preview built against a stub engine would prove nothing.
- **If you decide otherwise:** Splitting replies needs a pinned decide-stage signature between drafts and decisions. Removing the dependency means the preview tests only become meaningful after integration.
- **Refs:** docs/mvp/MVP-2.md F6, F7, F8
- **Status:** open

## TBD-160 · The foundation owns all four new AI tasks and their wire samples
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** The prompt layout and the e2e/fixtures/wire samples pin the exact request bodies. If each slice edited packages/ai/src/prompt.ts, client.ts and the wire files, they would collide, and the fake AI couldn't rely on the key lines.
- **Options:**
  1. The foundation implements cv.v1, match.v1, draft.v1 and assistant.v1 with pinned key lines
  2. Each slice adds its own task to packages/ai
- **Chosen:** The foundation implements the four tasks with these key lines: CV-SHA256, Message-ID with Role, Message-ID with Attempt, and Turn. It also writes their wire samples. Prompt wording is tuned in fix rounds. One owner for the wire contract keeps packages/ai and the fake AI in step, and it lets the e2e-fixtures slice build answers at the same time as the others.
- **If you decide otherwise:** The wire files would need per-task ownership, and every prompt change would touch e2e/fixtures/wire.
- **Refs:** docs/ARCHITECTURE.md › AI; e2e/fixtures/wire/wire.test.ts; packages/ai/src/prompt.ts
- **Status:** open

## TBD-161 · The analysis pipeline as a foundation orchestrator with stage files owned by slices
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** F1's pipeline (sort → facts → sender check → match → draft or decision) calls four slices' logic, and F1 comes first in the build order.
- **Options:**
  1. The orchestrator lives in pipeline/evaluate.ts, with stub stages in slice-owned files (sender.ts, cv-choice.ts, match.ts, reply.ts)
  2. Each slice hooks itself into the sync job
- **Chosen:** The orchestrator and a re-evaluation job for missing or stale evaluations (which also covers the first scan's backlog) are in the foundation. The stage types are pinned in pipeline/stages.ts. The slices stay disjoint and can be tested on their own, and one mechanism serves new mail, the backlog, profile and rule changes, decision answers and undo.
- **If you decide otherwise:** The slices would all edit the sync job.
- **Refs:** apps/server/src/pipeline; F1.1; F1.6; F3.5; F4.6; F7.4; F8.3
- **Status:** open

## TBD-162 · Policy keys and the new profile sources
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** F6 names reply_threshold (default 70) and reply_window_days (default 14) as profile entries. F7.4 and F8.3 need the sources decision and assistant, but ProfileSource has only scan and you.
- **Options:**
  1. Add them as valid profile keys outside CORE_PROFILE_KEYS, as one-element lists, and extend ProfileSource
  2. Add them to the intake's core questions
- **Chosen:** Valid keys outside the intake form, with POLICY_DEFAULTS applied when they aren't set. ProfileSource gains decision and assistant. The intake form MVP 1 validated stays unchanged, and every profile value stays a list.
- **If you decide otherwise:** The intake form and its fixtures would change.
- **Refs:** packages/schema/src/profile.ts
- **Status:** open

## TBD-163 · Only one sync per mailbox through a dedupe key on jobs
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** F1.2 needs a single sync per mailbox across replicas, with takeover. The queue already has leases but nothing stops a job being queued twice.
- **Options:**
  1. jobs.dedupe_key with a partial unique index while queued or running; every replica's scheduler tries to enqueue
  2. Elect one scheduler with an advisory lock
- **Chosen:** The dedupe key. Replicas stay interchangeable, and the existing lease takeover covers a replica that is killed.
- **If you decide otherwise:** An advisory-lock leader with its own failover.
- **Refs:** packages/db/src/tables.ts jobs; F1.2
- **Status:** open

## TBD-164 · Sync starts after the first scan and reads the Inbox only
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** Continuous sync and the first scan both read the mailbox. Users would notice if new mail were analysed before the first scan's proposal.
- **Options:**
  1. Sync starts once the workspace's first scan has stopped, from the highest stored UID
  2. Sync from the moment the mailbox connects
- **Chosen:** After the first scan stops, INBOX UIDs above the highest stored UID. This avoids racing the first scan and double analysis, and the scan already covers everything before it.
- **If you decide otherwise:** The sync and the scan would need coordination over the same UIDs.
- **Refs:** F1.1; apps/server/src/sync
- **Status:** open

## TBD-165 · The domain lookup cache is workspace-scoped in Postgres
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** F5 asks for cached RDAP and DNS lookups. A global cache table would be a fourth unscoped db exception.
- **Options:**
  1. A domain_lookups table with workspace_id
  2. A global table (an ARCHITECTURE exception)
  3. Memory per replica
- **Chosen:** Workspace-scoped table. It keeps the workspace-scoping rule, and replicas share the cache.
- **If you decide otherwise:** Add an exception to ARCHITECTURE for a shared cache.
- **Refs:** docs/ARCHITECTURE.md › Workspaces; F5
- **Status:** open

## TBD-166 · New dependencies: unpdf and mammoth for CV text; fixture CVs without dependencies
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** F2.1 accepts PDF and DOCX uploads, so their text has to be read. The fixture generator has to write the PDF and DOCX files.
- **Options:**
  1. unpdf and mammoth in apps/server, added by the foundation; the generator hand-writes the PDFs and a store-only DOCX zip
  2. pdfjs-dist and docx libraries in e2e
- **Chosen:** unpdf and mammoth in apps/server (knip-ignored until the cvs slice imports them); no new e2e dependencies. Both are pure-JavaScript and need no native modules or install scripts. Adding them up front keeps pnpm-lock.yaml out of the parallel slices.
- **If you decide otherwise:** Swap the libraries in apps/server/src/cvs.
- **Refs:** apps/server/package.json; knip.jsonc; pnpm-workspace.yaml minimumReleaseAge
- **Status:** open

## TBD-167 · Proposals in their own assistant_proposals table
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** F8 names assistant_threads, assistant_messages and profile_history. Apply and discard address /proposals/:id.
- **Options:**
  1. A separate assistant_proposals table with status
  2. A proposal JSON column on assistant_messages
- **Chosen:** A separate table. Apply, discard and editing before Apply need a row with its own id and status.
- **If you decide otherwise:** Store proposals inside messages and look them up by message id.
- **Refs:** F8.2; F8.3
- **Status:** open

## TBD-168 · Existing AI settings get the new per-task models from their extract model
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** AI_TASKS gains cv, match, draft and assistant, but saved settings hold only four models.
- **Options:**
  1. Backfill in the migration from the extract model
  2. Make the new keys optional, with a fallback at runtime
- **Chosen:** Migration backfill; the schema requires every task. Every task always has a model, and MVP 1 workspaces keep working without anyone opening Settings.
- **If you decide otherwise:** Optional keys, with fallback logic in packages/ai.
- **Refs:** packages/schema/src/ai.ts AiModelsSchema; ai_settings.models
- **Status:** open

## TBD-169 · Merge MVP 1's unmerged intake/profile/live branch into mvp-2 first, and record that fix round 4 is unrecorded
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** mvp-2 does not contain MVP 1's F6: profiles.ts and intake.ts answer 501, packages/db/src/queries/profiles.ts is empty, and ProfilePage and IntakePage are stubs. That work is on mvp-1-fix-r4-intake-live-merge, 30 commits (+6.5k lines) ahead and 1 behind mvp-2. TBD.md has no record of fix round 4 or of that branch passing verification; the MVP 1 sign-off row names fix rounds but its commit b3d20f1 predates the merge.
- **Options:**
  1. Merge it as foundation step 0, with the merge reviewed as its own unit and the gap recorded in TBD.md
  2. Rebuild a minimal profile store inside MVP 2
  3. Leave it and build MVP 2 without a profile
- **Chosen:** Merge it first with --no-ff as its own commit (a dry-run git merge-tree shows no conflicts), then run pnpm check, fixing only what the merge breaks. TBD.md records that fix round 4 and this branch's verification have no entry. The foundation verifiers review the merge diff separately from the contract diff. MVP 2 can't serve its criteria without the confirmed profile. Reviewing the merge on its own keeps 6.5k unreviewed lines from hiding inside the foundation diff.
- **If you decide otherwise:** The foundation would have to build its own profile storage and page, and MVP 1's F6 would stay missing on mvp-2.
- **Refs:** branch mvp-1-fix-r4-intake-live-merge; TBD-150; TBD-151; docs/mvp/MVP-1.md Sign-off; apps/server/src/routes/profiles.ts
- **Status:** open

## TBD-170 · Six slices: a mailbox slice for the F1 runtime; CVs and the sender check together; drafts and decisions stay one slice, made smaller
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** The foundation was too large for one agent. The README caps the plan at 6 slices, and F1 runtime, F2, F3/F4, F5, F6, F7, F8 and the test stack are eight units. Splitting drafts from decisions as well as moving sync out would need 7 slices.
- **Options:**
  1. mailbox (F1.1–F1.5, F6.3, F6.6), cvs-senders, rules-match, replies (F6 rest, F7), assistant, e2e-fixtures
  2. Split replies into drafts and decisions and merge sync with drafts
  3. Keep sync in the foundation
- **Chosen:** mailbox; cvs-senders; rules-match; replies, made smaller; assistant (depends on rules-match); e2e-fixtures. Replies loses the reply policy table (now replyEligibility in the foundation), MIME and Drafts-folder I/O (now mailbox), and fact-based need derivation (now verdict.need from rules-match). All IMAP work has one owner. The draft-or-ask point keeps one owner, so there is no fragile contract between drafts and decisions. Replies drops from 14 criteria across 7 code areas to 12, with no mail-package work.
- **If you decide otherwise:** Splitting replies needs a pinned reply → decide stage contract and a seventh slot, which means merging two other areas.
- **Refs:** docs/mvp/README.md Plan phase (3–6 slices); docs/mvp/MVP-2.md F1, F6, F7
- **Status:** open

## TBD-171 · F1.1 and F1.6 are proven with fake stages at slice level and re-checked by an integration test
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** F1.1 needs sender check and match, and F1.6 needs the backlog to get them. The stage implementations land in parallel slices, so the foundation and the mailbox slice only have stub stages.
- **Options:**
  1. The foundation (F1.6) and mailbox (F1.1) prove the orchestration with injected fake stages, and the integrator adds pipeline.integration.test.ts with real stages
  2. Give F1.1 and F1.6 to a slice that depends on every stage slice
- **Chosen:** The slice-level proof uses fake stages. After all merges, the integrator writes apps/server/src/pipeline/pipeline.integration.test.ts with real stages and fakes only at the ports. A dependent slice would serialize the build behind four slices for two criteria. The integration test proves the real chain once all stages exist, and S2 and S7 walk it.
- **If you decide otherwise:** Add a seventh, final slice for these two criteria, or accept that they are proven only by the walkthrough.
- **Refs:** F1.1; F1.6; apps/server/src/pipeline/evaluate.ts
- **Status:** open

## TBD-172 · The foundation owns all four new AI tasks and their wire samples
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** The prompt layout and the e2e/fixtures/wire samples pin the exact request bodies. If each slice edited packages/ai or the wire files, they would collide, and the fake AI couldn't rely on the key lines.
- **Options:**
  1. The foundation implements cv.v1, match.v1, draft.v1 and assistant.v1 with pinned key lines
  2. Each slice adds its own task
- **Chosen:** The foundation implements the four tasks with the key lines CV-SHA256, Message-ID+Role, Message-ID+Attempt and Turn, and writes their wire samples. Prompt wording is tuned in fix rounds. One owner of the wire contract keeps packages/ai and the fake AI in step, and lets e2e-fixtures build answers in parallel.
- **If you decide otherwise:** The wire files would need per-task ownership.
- **Refs:** docs/ARCHITECTURE.md › AI; e2e/fixtures/wire/wire.test.ts; packages/ai/src/prompt.ts
- **Status:** open

## TBD-173 · The pipeline backbone in the foundation: orchestrator, re-evaluation and the profile change service
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** F1's pipeline calls four slices' logic. Re-evaluation has many triggers: profile and rule changes, decision answers, undo, intake confirm, a finished CV read, CV delete, a CV-choice override and a sender mark.
- **Options:**
  1. evaluate.ts, reevaluate.ts and requestReevaluation(scope) in the foundation, with slice-owned stage files
  2. Each slice hooks into the sync job
- **Chosen:** The orchestrator, the pipeline.reevaluate job and requestReevaluation with scopes all, roles, messages, sender address and sender domain. Each trigger is pinned to its owner: intake confirm (foundation), cv.read and CV delete (cvs-senders), sender marks (cvs-senders), rules (rules-match), answers (replies), apply and undo (assistant). One mechanism serves new mail, the backlog and every change, and the slices stay disjoint.
- **If you decide otherwise:** The slices would all edit the sync job.
- **Refs:** apps/server/src/pipeline; apps/server/src/profile/changes.ts; F1.6; F2.3; F3.5; F4.6; F5.4; F7.4; F8.3
- **Status:** open

## TBD-174 · With no confirmed profile, only the sender check runs; the backlog is matched when the intake is confirmed
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** The re-evaluation after the first scan and the first syncs both run before the user confirms the intake form, so there is no profile to match against.
- **Options:**
  1. Run the sender stage, leave the roles unevaluated, and enqueue re-evaluation on intake confirm
  2. Mark the roles evaluated with no match
  3. Delay sync until confirm
- **Chosen:** Without a profile, only the sender stage runs and the roles stay in listToEvaluate. Intake confirm calls requestReevaluation({all}). F1.6 then actually happens in the end-to-end flow. Sender verdicts appear early because they don't depend on the profile.
- **If you decide otherwise:** Matching would need a default profile, which would mean guessing.
- **Refs:** apps/server/src/routes/intake.ts confirm; F1.6; CLAUDE.md 'Unknown means ask'
- **Status:** open

## TBD-175 · Fuzzy match answers are stored, so re-scoring is pure
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** F3.5 and F4.6 need re-scoring within a minute, and the impact preview runs the real match. Calling match.v1 again for hundreds of backlog roles at about 300 ms on 2×2 worker slots would miss the minute and would make the preview call the AI.
- **Options:**
  1. Store match.v1 answers per (message, position, CV, input hash) in match_ai_answers
  2. Call match.v1 on every re-evaluation
- **Chosen:** Store them. The input hash covers exactly what match.v1 sees, so rule, pay and policy changes re-score without AI calls, and the preview never calls the AI. It meets the one-minute criteria, keeps AI cost flat, and makes the preview deterministic.
- **If you decide otherwise:** Re-scoring time and cost grow with the backlog, and the preview needs its own AI budget.
- **Refs:** packages/db match_ai_answers; F3.5; F4.6; F8.2
- **Status:** open

## TBD-176 · The sender check reads message signals from per-language phrase lists in data files and the transient body
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** Mail bodies are never stored, no AI task covers sender signals, and both scams, including the backlog one, must be high risk (F5.5). Market-specific lists (free-mail providers) can't live in code.
- **Options:**
  1. Phrase lists per language and the free-mail domain list in packages/core/src/sender/data/*.json; the body is fetched lazily through ctx.body() for the backlog and re-evaluation, and never stored
  2. Add sender signals to the extract task, which would mean re-extracting the backlog
  3. A new AI task, which the spec doesn't name
- **Chosen:** Data files with en, de and pt phrase lists, plus the transient body. A message in a language without lists gets complete=false, so it is never 'looks fine'. It is deterministic and hermetic, costs no AI calls, works for the backlog, and stays within the no-market-specific-code rule.
- **If you decide otherwise:** Add a signals field to extract.v1 and re-run extraction for the backlog.
- **Refs:** packages/core/src/sender/data; apps/server/src/pipeline/stages.ts StageContext.body; F5.1; F5.3; F5.5
- **Status:** open

## TBD-177 · Decision needs are carried on match verdicts and rule effects; reply eligibility is a shared pure function
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** Replies has to turn 'pay unknown — different currency' into 'Minimum pay in CHF per year?', grouped across messages. The assistant's preview has to know which drafts won't be created.
- **Options:**
  1. verdict.need and ruleEffects.need as NeedSpec {groupKey, profileKey, question, choices}, with groupKeyFor in packages/schema, and replyEligibility in packages/core/src/policy
  2. Replies derives needs from facts itself, and the assistant depends on replies
- **Chosen:** Needs on verdicts and effects; replyEligibility in the foundation. The only module that knows why something is unknown says so, and neither replies nor the assistant recomputes facts or depends on another parallel slice.
- **If you decide otherwise:** Replies duplicates the match's fact logic, and the assistant waits for replies.
- **Refs:** packages/schema/src/match.ts, decisions.ts; packages/core/src/policy/reply.ts; F7.1; F7.3; F8.2; F8.5
- **Status:** open

## TBD-178 · Job dedupe: one waiting and one running per key
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** A single sync per mailbox (F1.2) needs dedupe, but a unique key held 'while queued or running' would stop a change made during a re-evaluation from queuing the next one (F4.6).
- **Options:**
  1. A unique index only while queued, with the claim skipping a key that has a running job
  2. A unique key while queued or running
  3. An advisory-lock scheduler
- **Chosen:** Queued-only uniqueness plus a single-flight claim, and pipeline.reevaluate keeps going while anything is stale. Each mailbox still has at most one sync running, every change gets a later re-evaluation, and replicas stay interchangeable.
- **If you decide otherwise:** Changes made during a re-evaluation wait for the next trigger.
- **Refs:** packages/db/src/queries/jobs.ts; apps/server/src/jobs/queue.ts; F1.2; F4.6
- **Status:** open

## TBD-179 · One live draft per role, enforced by the database
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** Inline evaluation during sync can race pipeline.reevaluate, which could append two mailbox drafts (F6.4 needs exactly one copy).
- **Options:**
  1. A partial unique index on (workspace, message, position) where status <> discarded, claimed by insert with status saving before the IMAP append
  2. An application-level lock
- **Chosen:** The partial unique index plus a saving claim state. Only the process that inserts the row writes to the mailbox. It holds across replicas and still allows a new draft after a discard.
- **If you decide otherwise:** Use an advisory lock per role.
- **Refs:** packages/db drafts; packages/schema/src/drafts.ts status saving; F6.4
- **Status:** open

## TBD-180 · Sync starts after the first scan and reads the Inbox only
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** Continuous sync and the first scan both read the mailbox.
- **Options:**
  1. Sync once the workspace's first scan has stopped, from the highest stored UID
  2. Sync from connect
- **Chosen:** After the first scan stops, INBOX UIDs above the highest stored UID. This avoids racing the first scan and analysing messages twice.
- **If you decide otherwise:** The sync and the scan would need coordination over the same UIDs.
- **Refs:** F1.1; apps/server/src/sync
- **Status:** open

## TBD-181 · The domain lookup cache is workspace-scoped in Postgres
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** F5 asks for cached RDAP and DNS lookups. A global table would be a fourth unscoped db exception.
- **Options:**
  1. domain_lookups with workspace_id
  2. A global table
  3. Memory per replica
- **Chosen:** Workspace-scoped table. It keeps the workspace-scoping rule, and replicas share the cache.
- **If you decide otherwise:** Add an exception to ARCHITECTURE.
- **Refs:** docs/ARCHITECTURE.md › Workspaces; F5
- **Status:** open

## TBD-182 · Dependencies and knip: unpdf and mammoth up front; the integrator removes ignore entries
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** F2.1 reads PDF and DOCX. The ignore list in knip.jsonc may only hold dependencies a later MVP needs, and several slices would otherwise edit it.
- **Options:**
  1. The foundation adds unpdf and mammoth to apps/server with knip ignores; the integrator removes the unpdf, mammoth and nodemailer entries when it merges the slice that imports them
  2. Each slice edits knip.jsonc
- **Chosen:** The first option. The fixture generator hand-writes the PDFs and a store-only DOCX zip, so e2e gets no new dependencies. pnpm-lock.yaml and knip.jsonc stay out of the parallel slices, and pnpm unused runs at integration anyway.
- **If you decide otherwise:** Swap the libraries in apps/server/src/cvs.
- **Refs:** apps/server/package.json; knip.jsonc; pnpm-workspace.yaml minimumReleaseAge
- **Status:** open

## TBD-183 · Policy keys and the new profile sources
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** F6 names reply_threshold and reply_window_days, and F7.4 and F8.3 need the sources decision and assistant.
- **Options:**
  1. Valid keys outside CORE_PROFILE_KEYS with POLICY_DEFAULTS; extend ProfileSource
  2. Add them to the intake form
- **Chosen:** Valid keys outside the intake form, with POLICY_DEFAULTS, and ProfileSource gains decision and assistant. The validated intake form stays unchanged.
- **If you decide otherwise:** The intake form and its fixtures would change.
- **Refs:** packages/schema/src/profile.ts
- **Status:** open

## TBD-184 · Proposals in their own assistant_proposals table
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** Apply, discard and editing before Apply address /proposals/:id.
- **Options:**
  1. A separate table
  2. A JSON column on assistant_messages
- **Chosen:** A separate table. A proposal needs its own id and status.
- **If you decide otherwise:** Look proposals up by message id.
- **Refs:** F8.2; F8.3
- **Status:** open

## TBD-185 · Existing AI settings get the new per-task models from their extract model
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** AI_TASKS gains cv, match, draft and assistant, but saved settings hold only four models.
- **Options:**
  1. A backfill in the migration
  2. Optional keys with a fallback at runtime
- **Chosen:** The migration backfill; the schema requires every task. Every task always has a model.
- **If you decide otherwise:** Optional keys, with a fallback in packages/ai.
- **Refs:** packages/schema/src/ai.ts; ai_settings.models
- **Status:** open

## TBD-186 · Merge all three unmerged MVP 1 fix-round-4 branches into mvp-2 first, and record that fix round 4 is unrecorded
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** mvp-2 does not contain MVP 1's F6: profiles.ts and intake.ts answer 501, packages/db/src/queries/profiles.ts is empty, and ProfilePage and IntakePage are stubs. That work is on mvp-1-fix-r4-intake-live-merge, 30 commits (+6.5k lines, 54 files) ahead and 1 behind mvp-2. Two more fix-round-4 branches are unmerged, each 3 commits ahead. mvp-1-fix-r4-inbox-search-unanalysed changes InboxPage.tsx and its test plus pages/scan. mvp-1-fix-r4-e2e-f53-proof-order changes e2e/stack.test.ts and e2e/fixtures/f53-proof.ts and adds specs/mvp-1/99-f5.3-stored-equals-expected.spec.ts. The three touch disjoint files and git merge-tree is clean for every pair. TBD.md has no record of fix round 4 (the last entry is TBD-149).
- **Options:**
  1. Merge all three as separate --no-ff commits in foundation step 0, each reviewed as its own unit, with the gap recorded in TBD.md
  2. Merge only the intake branch and leave the other two
  3. Rebuild a minimal profile store inside MVP 2
- **Chosen:** Merge all three, in the order intake-live-merge, inbox-search-unanalysed, e2e-f53-proof-order, each with --no-ff as its own commit. Then run pnpm check and pnpm unused, and fix only what the merges break, in separate commits. A branch that unexpectedly conflicts is left out and recorded in TBD.md. TBD.md records that fix round 4 and these branches' verification have no entry. The foundation verifiers review each merge diff separately from the contract diff. MVP 2 can't serve its criteria without the confirmed profile. Leaving out the two small branches would lose their fixes, or make them conflict later with the foundation's InboxPage slot edits and the e2e-fixtures slice's stack.test.ts, and S12 could fail. Separate reviews keep 6.5k unreviewed lines from hiding in the foundation diff.
- **If you decide otherwise:** The search/Analyze-them fix and the F5.3 proof-order fix would have to be redone on top of MVP 2's InboxPage and stack.test.ts, and MVP 1's F6 would stay missing on mvp-2.
- **Refs:** branches mvp-1-fix-r4-intake-live-merge, mvp-1-fix-r4-inbox-search-unanalysed (fc0bcc7), mvp-1-fix-r4-e2e-f53-proof-order (ff12d97); TBD-141; TBD-142; TBD-144; TBD-147; docs/mvp/MVP-1.md Sign-off
- **Status:** open

## TBD-187 · Six slices: a mailbox slice for the F1 runtime; CVs and the sender check together; drafts and decisions stay one slice, made smaller
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** The foundation was too large for one agent. The README caps the plan at 6 slices, and F1 runtime, F2, F3/F4, F5, F6, F7, F8 and the test stack are eight units. Splitting drafts from decisions as well as moving sync out would need 7 slices.
- **Options:**
  1. mailbox (F1.1–F1.5, F6.3, F6.6), cvs-senders, rules-match, replies (F6 rest, F7), assistant, e2e-fixtures
  2. Split replies into drafts and decisions and merge sync with drafts
  3. Keep sync in the foundation
- **Chosen:** mailbox; cvs-senders; rules-match; replies, made smaller; assistant (depends on rules-match); e2e-fixtures. Replies loses the reply policy table and the role-level draft lifecycle (now replyEligibility and draft-claims in the foundation), MIME and Drafts-folder I/O (now mailbox), and fact-based need derivation (now verdict.need from rules-match). cvs-senders gets the CV base queries from the foundation and stays one slice, because the cap rules out a seventh. All IMAP work has one owner. The draft-or-ask point keeps one owner, so there is no fragile contract between drafts and decisions. Replies drops from 14 criteria across 7 code areas to 12, with no mail-package work.
- **If you decide otherwise:** Splitting replies needs a pinned reply → decide stage contract and a seventh slot, which means merging two other areas.
- **Refs:** docs/mvp/README.md Plan phase (3–6 slices); docs/mvp/MVP-2.md F1, F2, F5, F6, F7
- **Status:** open

## TBD-188 · F1.1 and F1.6 are proven with fake stages at slice level and re-checked by an integration test
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** F1.1 needs sender check and match, and F1.6 needs the backlog to get them. The stage implementations land in parallel slices, so the foundation and the mailbox slice only have stub stages.
- **Options:**
  1. The foundation (F1.6) and mailbox (F1.1) prove the orchestration with injected fake stages, and the integrator adds pipeline.integration.test.ts with real stages
  2. Give F1.1 and F1.6 to a slice that depends on every stage slice
- **Chosen:** The slice-level proof uses fake stages. After all merges, the integrator writes apps/server/src/pipeline/pipeline.integration.test.ts with real stages and fakes only at the ports. A dependent slice would serialize the build behind four slices for two criteria. The integration test proves the real chain once all stages exist, and S2 and S7 walk it.
- **If you decide otherwise:** Add a seventh, final slice for these two criteria, or accept that they are proven only by the walkthrough.
- **Refs:** F1.1; F1.6; apps/server/src/pipeline/evaluate.ts
- **Status:** open

## TBD-189 · The foundation pins the four AI task contracts; the slices own the prompt bodies
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** The prompt layout and the e2e/fixtures/wire samples pin the exact request bodies, and the fake AI depends on the key lines. Writing four full prompts and their wire samples kept the foundation, already the largest unit, on everyone's critical path.
- **Options:**
  1. The foundation registers the tasks and writes tasks/<task>.ts with the pinned header, key lines, framing and a provisional instruction plus initial wire samples; each slice owns its task's instruction body and wire files afterwards
  2. The foundation implements all four prompts in full
  3. Each slice adds its whole task, schema and registration included
- **Chosen:** The first option. The key lines (CV-SHA256, Message-ID+Role, Message-ID+Attempt, Turn), the output schemas and the framing are fixed in the foundation. cv → cvs-senders, match → rules-match, draft → replies, assistant → assistant. A slice that changes its body regenerates its own four wire files, and the TASK_IDS-driven wire tests cover them. The fake AI and the e2e fixtures rely only on what stays pinned, so e2e-fixtures can build answers in parallel. Prompt wording sits with the code that interprets the answer, and the foundation gets smaller.
- **If you decide otherwise:** The foundation writes the full prompts, and wording is tuned in fix rounds.
- **Refs:** docs/ARCHITECTURE.md › AI; packages/ai/src/prompt.ts; packages/ai/src/wire.test.ts; e2e/fixtures/wire/wire.test.ts
- **Status:** open

## TBD-190 · The pipeline backbone in the foundation: orchestrator, re-evaluation, the sweep and the profile change service
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** F1's pipeline calls four slices' logic. Re-evaluation has many triggers: profile and rule changes, decision answers, undo, intake confirm, a finished CV read, CV delete, a CV-choice override and a sender mark.
- **Options:**
  1. evaluate.ts, reevaluate.ts, sweep.ts and requestReevaluation(scope) in the foundation, with slice-owned stage files
  2. Each slice hooks into the sync job
- **Chosen:** The orchestrator, the pipeline.reevaluate job, the sweep, and requestReevaluation with scopes all, roles, messages, sender address and sender domain. Each trigger is pinned to its owner: intake confirm, startup and interval sweep (foundation), cv.read and CV delete (cvs-senders), sender marks (cvs-senders), rules (rules-match), answers (replies), apply and undo (assistant). One mechanism serves new mail, the backlog and every change, and the slices stay disjoint.
- **If you decide otherwise:** The slices would all edit the sync job.
- **Refs:** apps/server/src/pipeline; apps/server/src/profile/changes.ts; F1.6; F2.3; F3.5; F4.6; F5.4; F7.4; F8.3
- **Status:** open

## TBD-191 · A startup and per-interval sweep evaluates any backlog and retries failed evaluations and mailbox-failed drafts
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** Intake confirm was the only F1.6 trigger. A deployment whose profile was confirmed before MVP 2 code runs never gets that trigger. A role whose evaluation failed (AI 500, IMAP down) stayed missing until some unrelated change happened.
- **Options:**
  1. sweep(deps) at startup and on every scheduler interval enqueues a deduped pipeline.reevaluate for each workspace with work (listWorkspacesWithWork)
  2. Only mail.sync enqueues re-evaluation after a successful sync
  3. A one-off migration-time job
- **Chosen:** The sweep, on startup and every JOBFILLY_SYNC_INTERVAL_SECONDS, whatever the sync outcome. pipeline.reevaluate processes each item at most once per run, so failures wait for the next sweep instead of looping. listWorkspacesWithWork is a cross-workspace read like the job claim and the scheduler's mailbox listing, and ARCHITECTURE records it. An upgraded deployment and every failed item are picked up within one interval with no user action. Dedupe keeps it at one run per workspace, and it doesn't depend on the mail server being reachable.
- **If you decide otherwise:** Failed roles wait for an unrelated change, and an upgraded deployment needs a manual re-confirm.
- **Refs:** apps/server/src/pipeline/sweep.ts; packages/db/src/queries/evaluations.ts listWorkspacesWithWork; F1.6; S11
- **Status:** open

## TBD-192 · The sender stage runs only when the check is missing or stale
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** evaluateMessage ran the sender stage first every time, and it reads ctx.body(), a lazy IMAP fetch. An {all} re-evaluation after a rule, profile, decision or CV change would have fetched every backlog body over IMAP. That threatens the one-minute bound of F3.5, F4.6, F7.4 and F8.3, and fails while IMAP is paused (S11).
- **Options:**
  1. Skip the stage when a current check exists; only new mail (missing) and sender-scoped requests (stale) run it
  2. Always re-run it
  3. Cache bodies (not allowed: bodies are never stored)
- **Chosen:** Skip unless missing or stale. A failed sender stage leaves the check missing for the next sweep. The roles are still matched, and the reply is held as sender_check_pending until the check exists. Re-scoring stays pure and IMAP-free, and the sender check still reflects marks and new mail. No draft is ever made without a sender check.
- **If you decide otherwise:** Every global change costs one IMAP fetch per backlog message.
- **Refs:** apps/server/src/pipeline/evaluate.ts; F3.5; F4.6; F5.4; F7.4; F8.3; S11
- **Status:** open

## TBD-193 · An automatic draft is created only for a role that never had a draft and was not dismissed
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** The one-live-draft index excludes 'discarded', and replyEligibility didn't look at a role's draft history. So the next re-evaluation after a discard would have recreated an automatic draft: S5's CHF answer and S8's Apply/Undo both re-evaluate. That undoes S4's discard, against 'nothing changes without the user's say'.
- **Options:**
  1. replyEligibility takes origin and draftHistory {hadDraft, dismissed}: auto and decision drafts need no prior draft row of any status and no dismissal; only Draft a reply (on_demand) drafts after a discard
  2. Keep discarded rows live in the index
  3. Record a per-role 'no more drafts' flag on discard
- **Chosen:** The draftHistory input. A claim released because draft.v1 raised questions is deleted, not kept, so the role still counts as never drafted and gets its draft after the decision. A content failure (placeholder twice) counts as a draft and is not retried automatically. Discard is final unless the user asks again. Decisions still release held roles, and the impact preview counts drafts the same way.
- **If you decide otherwise:** Discarded drafts reappear in the mailbox after any rule, profile or decision change.
- **Refs:** packages/core/src/policy/reply.ts; packages/db/src/queries/draft-claims.ts; F6.1; F6.4; F6.5; F7.5; S4; S5; S8
- **Status:** open

## TBD-194 · A draft whose mailbox write fails is marked failed (kind mailbox) and retried by the sweep
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** The claim inserts a 'saving' row before the IMAP append. If draft.create fails (IMAP paused in S11), the row would stay in saving and block that role for good, since the queue doesn't retry failed jobs.
- **Options:**
  1. Mark it failed with failureKind mailbox and a reason; the sweep re-claims it up to 5 attempts, along with saving rows older than 5 minutes
  2. Delete the claim on failure
  3. Leave it in saving
- **Chosen:** Mark it failed with kind mailbox and retry it from the sweep. The Drafts page shows the failed reason meanwhile (F6.7). Draft a reply can reuse a failed row. No role is blocked for good. The user sees what happened, and drafts held during an outage appear after recovery, still with at most one live draft per role.
- **If you decide otherwise:** Failed rows need a manual Draft a reply to recover.
- **Refs:** packages/db drafts.failure_kind, attempts, claimed_at; apps/server/src/pipeline/reevaluate.ts; F6.4; F6.7; S11
- **Status:** open

## TBD-195 · Decision answers append to list-valued profile keys, and 'already answered' is decided by group key
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** min_pay is a list (z.array(MinPaySchema)), and Maria already has an EUR minimum from MVP 1. Checking F7.6 by profile key would never create S5's CHF decision. Turning the answer into an 'update' of min_pay would replace her EUR minimum.
- **Options:**
  1. Pin the Change semantics in core/profile/changes.ts: add appends to list keys, update replaces; a decision answer is an add of one item; answeredFor(profile, groupKey) decides F7.6
  2. Store per-currency keys (min_pay_chf …)
  3. Ask the user whether to replace or append
- **Chosen:** Append semantics, plus answeredFor by group key. min_pay:CHF:year is answered only by a CHF per-year item. S5 gets its decision, Maria's EUR minimum survives, and F7.6 holds for the second Zurich role. No market-specific keys are added.
- **If you decide otherwise:** The schema would need per-currency profile keys, or every answer would ask how to merge.
- **Refs:** packages/core/src/profile/changes.ts; packages/schema/src/profile.ts LIST_PROFILE_KEYS; packages/schema/src/decisions.ts; F7.3; F7.6; S5
- **Status:** open

## TBD-196 · The foundation pins CvChoiceResult and the base CV read queries
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** Replies needs the CV bytes, file name and media type for the attachment (F6.3/S3), and the CV text and skills for draft.v1 (F6.2). The match stage needs the chosen CV's skills (F4.4) and the input hash. Only cvs-senders could read CVs, and neither slice depended on it.
- **Options:**
  1. Pin CvChoiceResult {cvId, name, language, skills, reason, source} in pipeline/stages.ts and implement insertCv, getCv, getCvFile, listCvs and listProfileCvs in the foundation, plus a seedCv test helper
  2. Make replies and rules-match depend on cvs-senders
- **Chosen:** Pin them in the foundation. cvs-senders extends cvs.ts afterwards and keeps those signatures. The three slices stay parallel, and the stage boundary carries exactly what the match needs.
- **If you decide otherwise:** Replies and rules-match wait for cvs-senders, which serializes most of the build.
- **Refs:** apps/server/src/pipeline/stages.ts; packages/db/src/queries/cvs.ts; F2.3; F4.4; F6.2; F6.3
- **Status:** open

## TBD-197 · CV foreign keys: SET NULL on drafts and evaluations, CASCADE on links, overrides and stored match answers
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** F2.5 deletes a CV while its drafts stay. cvs-senders' delete would otherwise hit a foreign key on a table owned by the foundation or replies.
- **Options:**
  1. drafts.cv_id and role_evaluations.cv_id nullable with ON DELETE SET NULL; profile_cvs, role_cv_choices and match_ai_answers ON DELETE CASCADE
  2. Soft-delete CVs
  3. No foreign keys
- **Chosen:** The first option, pinned in the migration and tested there. Deleting removes the file and every link at once, keeps the drafts (S4), and the follow-up re-evaluation re-chooses a CV.
- **If you decide otherwise:** CV delete needs per-table cleanup code spread across slices.
- **Refs:** packages/db/migrations/0001_mvp2; F2.5; S4
- **Status:** open

## TBD-198 · With no confirmed profile, only the sender check runs; the backlog is matched when the intake is confirmed
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** The re-evaluation after the first scan and the first syncs both run before the user confirms the intake form, so there is no profile to match against.
- **Options:**
  1. Run the sender stage, leave the roles unevaluated, and enqueue re-evaluation on intake confirm
  2. Mark the roles evaluated with no match
  3. Delay sync until confirm
- **Chosen:** Without a profile, only the sender stage runs and the roles stay in listToEvaluate. Intake confirm calls requestReevaluation({all}), and the sweep covers an already-confirmed profile. F1.6 then actually happens in the end-to-end flow. Sender verdicts appear early because they don't depend on the profile.
- **If you decide otherwise:** Matching would need a default profile, which would mean guessing.
- **Refs:** apps/server/src/routes/intake.ts confirm; F1.6; CLAUDE.md 'Unknown means ask'
- **Status:** open

## TBD-199 · Fuzzy match answers are stored, so re-scoring is pure
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** F3.5 and F4.6 need re-scoring within a minute, and the impact preview runs the real match. Calling match.v1 again for hundreds of backlog roles at about 300 ms on 2×2 worker slots would miss the minute and would make the preview call the AI.
- **Options:**
  1. Store match.v1 answers per (message, position, CV, input hash) in match_ai_answers
  2. Call match.v1 on every re-evaluation
- **Chosen:** Store them. The input hash covers exactly what match.v1 sees, including CvChoiceResult.skills. Rule, pay and policy changes re-score without AI calls, and the preview never calls the AI. It meets the one-minute criteria, keeps AI cost flat, and makes the preview deterministic.
- **If you decide otherwise:** Re-scoring time and cost grow with the backlog, and the preview needs its own AI budget.
- **Refs:** packages/db match_ai_answers; F3.5; F4.6; F8.2
- **Status:** open

## TBD-200 · The sender check reads message signals from per-language phrase lists in data files and the transient body
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** Mail bodies are never stored, no AI task covers sender signals, and both scams, including the backlog one, must be high risk (F5.5). Market-specific lists (free-mail providers) can't live in code.
- **Options:**
  1. Phrase lists per language and the free-mail domain list in packages/core/src/sender/data/*.json; the body is fetched lazily through ctx.body() and never stored
  2. Add sender signals to the extract task, which would mean re-extracting the backlog
  3. A new AI task, which the spec doesn't name
- **Chosen:** Data files with en, de and pt phrase lists, plus the transient body. A message in a language without lists gets complete=false, so it is never 'looks fine'. It is deterministic and hermetic, costs no AI calls, works for the backlog, and stays within the no-market-specific-code rule.
- **If you decide otherwise:** Add a signals field to extract.v1 and re-run extraction for the backlog.
- **Refs:** packages/core/src/sender/data; apps/server/src/pipeline/stages.ts StageContext.body; F5.1; F5.3; F5.5
- **Status:** open

## TBD-201 · Decision needs are carried on match verdicts and rule effects; reply eligibility is a shared pure function
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** Replies has to turn 'pay unknown — different currency' into 'Minimum pay in CHF per year?', grouped across messages. The assistant's preview has to know which drafts won't be created.
- **Options:**
  1. verdict.need and ruleEffects.need as NeedSpec {groupKey, profileKey, question, choices}, with groupKeyFor in packages/schema, and replyEligibility in packages/core/src/policy
  2. Replies derives needs from facts itself, and the assistant depends on replies
- **Chosen:** Needs on verdicts and effects; replyEligibility in the foundation. The only module that knows why something is unknown says so, and neither replies nor the assistant recomputes facts or depends on another parallel slice.
- **If you decide otherwise:** Replies duplicates the match's fact logic, and the assistant waits for replies.
- **Refs:** packages/schema/src/match.ts, decisions.ts; packages/core/src/policy/reply.ts; F7.1; F7.3; F8.2; F8.5
- **Status:** open

## TBD-202 · Job dedupe: one waiting and one running per key
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** A single sync per mailbox (F1.2) needs dedupe, but a unique key held 'while queued or running' would stop a change made during a re-evaluation from queuing the next one (F4.6).
- **Options:**
  1. A unique index only while queued, with the claim skipping a key that has a running job
  2. A unique key while queued or running
  3. An advisory-lock scheduler
- **Chosen:** Queued-only uniqueness plus a single-flight claim, and pipeline.reevaluate enqueues the next run while anything is stale. Each mailbox still has at most one sync running, every change gets a later re-evaluation, and replicas stay interchangeable.
- **If you decide otherwise:** Changes made during a re-evaluation wait for the next trigger.
- **Refs:** packages/db/src/queries/jobs.ts; apps/server/src/jobs/queue.ts; F1.2; F4.6
- **Status:** open

## TBD-203 · One live draft per role, enforced by the database
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** Inline evaluation during sync can race pipeline.reevaluate, which could append two mailbox drafts (F6.4 needs exactly one copy).
- **Options:**
  1. A partial unique index on (workspace, message, position) where status <> discarded, claimed by insert with status saving before the IMAP append
  2. An application-level lock
- **Chosen:** The partial unique index plus a saving claim state. Only the process that holds the claim writes to the mailbox. It holds across replicas and still allows a new draft (through Draft a reply) after a discard.
- **If you decide otherwise:** Use an advisory lock per role.
- **Refs:** packages/db drafts; packages/schema/src/drafts.ts status saving; F6.4
- **Status:** open

## TBD-204 · Sync starts after the first scan and reads the Inbox only
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** Continuous sync and the first scan both read the mailbox.
- **Options:**
  1. Sync once the workspace's first scan has stopped, from the highest stored UID
  2. Sync from connect
- **Chosen:** After the first scan stops, INBOX UIDs above the highest stored UID. This avoids racing the first scan and analysing messages twice.
- **If you decide otherwise:** The sync and the scan would need coordination over the same UIDs.
- **Refs:** F1.1; apps/server/src/sync
- **Status:** open

## TBD-205 · The domain lookup cache is workspace-scoped in Postgres
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** F5 asks for cached RDAP and DNS lookups. A global table would be a fourth unscoped db exception.
- **Options:**
  1. domain_lookups with workspace_id
  2. A global table
  3. Memory per replica
- **Chosen:** Workspace-scoped table. It keeps the workspace-scoping rule, and replicas share the cache.
- **If you decide otherwise:** Add an exception to ARCHITECTURE.
- **Refs:** docs/ARCHITECTURE.md › Workspaces; F5
- **Status:** open

## TBD-206 · Dependencies and knip: unpdf and mammoth up front, the e2e entry points registered by the foundation, and the integrator removes ignore entries
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** F2.1 reads PDF and DOCX. The ignore list in knip.jsonc may only hold dependencies a later MVP needs, and several slices would otherwise edit it. e2e-fixtures adds scripts that compose starts and nothing imports (e2e/rdap/main.ts, possibly e2e/dns/main.ts), which knip's e2e entry list didn't include.
- **Options:**
  1. The foundation adds unpdf and mammoth with knip ignores and the e2e entries rdap/main.ts and dns/main.ts; the slices never edit knip.jsonc; the integrator removes the unpdf, mammoth and nodemailer ignores as the importing slices merge, and dns/main.ts if unused
  2. Each slice edits knip.jsonc
- **Chosen:** The first option. With knip 6.40.0, an entry pattern with no file yet is only a configuration hint and exits 0 (checked). The fixture generator hand-writes the PDFs and a store-only DOCX zip, so e2e gets no new dependencies. pnpm-lock.yaml and knip.jsonc stay out of the parallel slices, and pnpm unused passes at integration.
- **If you decide otherwise:** Swap the libraries in apps/server/src/cvs, or let e2e-fixtures edit the e2e entry list.
- **Refs:** apps/server/package.json; knip.jsonc; pnpm-workspace.yaml minimumReleaseAge
- **Status:** open

## TBD-207 · Policy keys and the new profile sources
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** F6 names reply_threshold and reply_window_days, and F7.4 and F8.3 need the sources decision and assistant.
- **Options:**
  1. Valid keys outside CORE_PROFILE_KEYS with POLICY_DEFAULTS; extend ProfileSource
  2. Add them to the intake form
- **Chosen:** Valid keys outside the intake form, with POLICY_DEFAULTS, and ProfileSource gains decision and assistant. The validated intake form stays unchanged.
- **If you decide otherwise:** The intake form and its fixtures would change.
- **Refs:** packages/schema/src/profile.ts
- **Status:** open

## TBD-208 · Proposals in their own assistant_proposals table
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** Apply, discard and editing before Apply address /proposals/:id.
- **Options:**
  1. A separate table
  2. A JSON column on assistant_messages
- **Chosen:** A separate table. A proposal needs its own id and status.
- **If you decide otherwise:** Look proposals up by message id.
- **Refs:** F8.2; F8.3
- **Status:** open

## TBD-209 · Existing AI settings get the new per-task models from their extract model
- **Kind:** decision
- **Where:** MVP 2 · Plan
- **Context:** AI_TASKS gains cv, match, draft and assistant, but saved settings hold only four models.
- **Options:**
  1. A backfill in the migration
  2. Optional keys with a fallback at runtime
- **Chosen:** The migration backfill; the schema requires every task. Every task always has a model.
- **If you decide otherwise:** Optional keys, with a fallback in packages/ai.
- **Refs:** packages/schema/src/ai.ts; ai_settings.models
- **Status:** open

## TBD-210 · Build plan accepted with known problems
- **Kind:** open item
- **Where:** MVP 2 · Plan
- **Context:** After two revisions the plan still had: Every criterion F1.1–F8.10 is assigned exactly once, S1–S12 are all covered, slice paths don't overlap except for the planned foundation-then-slice handovers (db/queries/cvs.ts, senders.ts, sync.ts, ai/tasks/*.ts, mail/src, sync/, cvs/, drafts/, senders/lookup.ts, e2e/fixtures/format.ts), and the step-0 facts check out: the intake branch is 30 ahead with 54 files and +6578 lines, the other two are 3 ahead each, and all three are 1 behind. The problems below are in the pinned contracts, which no slice may change afterwards.
  1. A failed draft.v1 call has no defined handling. Drafts.failureKind is only mailbox|content, and listDraftsToRetry retries only kind mailbox and saving rows older than 5 minutes. Nothing says what draft.create does when draft.v1 fails: provider 500, timeout, invalid output after the AI client's retries, or no AI configured. If the row is marked failed (any kind), draftHistory.hadDraft becomes true and replyEligibility holds that role's automatic draft forever. If it is left in saving, that breaks 'a row is never left in saving' and only gets picked up by the 5-minute reclaim. Fix: pin an 'ai' failure kind that the sweep retries with the same attempt cap (or delete the claim on an AI error, the way releaseDraftClaim does), and add it to the foundation's draft-claims and sweep tests.
  2. Drafts are per role, but the pinned draft.v1 key line is only `Message-ID` + `Attempt`, with no Role/position. Maria's MVP 1 fixtures already have 40 multi-role messages. Two eligible roles in one message would then get two drafts replying to the same thread, and the fake AI can't tell their draft.v1 answers apart (the same key for both). F6.1 says 'a message gets a reply draft' and S3 checks 'exactly one draft in reply to the Berlin message'. Whether that means one automatic draft per message or one per role is a choice users would notice, and the plan doesn't record it as a decision. Either pin at most one automatic draft per message (for example the best-scoring eligible role; on_demand stays per role for F6.5), or add `Role: <position>` to the draft.v1 key lines and the fixture key (Message-ID#position#attempt) before the foundation freezes them.
  3. The score formula isn't pinned anywhere, but e2e-fixtures is built in parallel with rules-match and has to produce fixtures that land on exact thresholds: Berlin, the remote-EU role and one APAC role ≥ 70; data engineering < 70; Amsterdam and Singapore ≤ 40. It must also make sure no backlog role inside the 14-day window reaches 70, or the role gets a draft.v1 call with no fixture answer, a fake-AI 500 and a failed draft. With rules-match free to choose weights, the fixtures and the scorer will disagree, and that only shows up in validation. Fix: pin the scoring weights (or a pure scoreFor() contract with reference cases) in the foundation, or make e2e-fixtures depend on rules-match. In either case, add a post-integration consistency test that runs the real scorer over every fixture role and checks the threshold side expected.json records.
  4. F1.5 usage is recorded by hand at each call site (recordAiUsage in jobs/scan/run.ts, routes/ai.ts and the merged intake.ts), and the plan pins no shared recording point for the four new tasks. cv.read (cvs-senders), match (rules-match), draft.create (replies), assistant (assistant) and sync's classify/extract (mailbox) each have to remember to record it, and nothing tests that they do, so 'model calls and tokens per day' can silently under-count. Fix: the foundation adds one server-side wrapper over deps.ai (or a recordUsage helper that every AI call goes through) that records each call's usage with at=clock.now(), and a test that each new task's calls show up in usagePerDay.
  5. Pin which origin draft.create checks when it retries. DraftCreatePayload.origin has 'retry', but replyEligibility only knows auto|decision|on_demand. Say whether a retry (after a mailbox or AI failure) re-checks eligibility, for example when a hide/no_draft rule or a high-risk mark was added while IMAP was down, or drafts anyway. Without this, replies and the foundation's sweep can make opposite assumptions.
  6. The foundation is still very large for one agent at high effort: the three reviewed merges (+6.9k lines), 12 schema modules, one migration with about 18 tables and tricky partial indexes and foreign keys, 8 tested query modules, core changes and policy, 4 AI tasks with 16 wire files, the mail contract, a fake mailbox with 6 failure switches plus a fake DomainPort and fake-AI extensions, the dedupe queue, the orchestrator, reevaluate, the sweep, the profile change service, 7 stub routes, web components and 8 slot directories, and ARCHITECTURE. cvs-senders (F2 + F5, 10 criteria, two unrelated features) and replies (12 criteria) are also near the limit. If the cap of 6 slices stays, cut the foundation's own scope instead: write ARCHITECTURE prose only for boundaries, and keep the fake-mailbox switches minimal, adding only what the foundation's own tests use. Otherwise expect the foundation verifiers to find it incomplete.
- **Options:** —
- **Chosen:** —
- **If you decide otherwise:** —
- **Refs:** —
- **Status:** open
