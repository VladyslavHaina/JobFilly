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
