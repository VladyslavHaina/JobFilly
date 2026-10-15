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
- **MVP 3, F3.3:** an Outlook.com test account for the one run with real Microsoft sign-in.
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
