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
- **MVP 3, F3.3:** a Gmail test account with an app password for the one run with a real mailbox,
  done with the owner after the unattended build.
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
- **Status:** accepted

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
- **Status:** changed: use the full name, "Maria Santos's workspace".

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** superseded by TBD-93

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** changed: the server also checks the base URL with the WHATWG URL parser, and refuses it when the two parsers disagree.

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** superseded by TBD-98

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** superseded by TBD-128

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted (already undone by 7dd5d7a).

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** changed: add `releaseIntakeExtras(db, workspaceId, claimedAt)` to packages/db, instead of backdating to the epoch.

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** changed: read amounts, and format pay and dates, in the browser locale (`navigator.language`) instead of a fixed "en"; keep the strict refusal; tests pin the locale.

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** superseded by TBD-186

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
- **Status:** superseded by TBD-187

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
- **Status:** superseded by TBD-189

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
- **Status:** superseded by TBD-190

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
- **Status:** superseded by TBD-207

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
- **Status:** superseded by TBD-202

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
- **Status:** superseded by TBD-204

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
- **Status:** superseded by TBD-205

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
- **Status:** superseded by TBD-206

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
- **Status:** superseded by TBD-208

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
- **Status:** superseded by TBD-209

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
- **Status:** superseded by TBD-186

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
- **Status:** superseded by TBD-187

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
- **Status:** superseded by TBD-188

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
- **Status:** superseded by TBD-189

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
- **Status:** superseded by TBD-190

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
- **Status:** superseded by TBD-198

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
- **Status:** superseded by TBD-199

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
- **Status:** superseded by TBD-200

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
- **Status:** superseded by TBD-201

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
- **Status:** superseded by TBD-202

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
- **Status:** superseded by TBD-203

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
- **Status:** superseded by TBD-204

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
- **Status:** superseded by TBD-205

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
- **Status:** superseded by TBD-206

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
- **Status:** superseded by TBD-207

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
- **Status:** superseded by TBD-208

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
- **Status:** superseded by TBD-209

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted: the phrase lists stay data files.

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted: Gmail INBOX over IMAP includes the category tabs; archived mail and new own replies are not synced. Revisit after MVP 2.

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

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
- **Status:** accepted

## TBD-211 · Fix round 4 and its three branches have no record in TBD.md; they were merged into mvp-2 first
- **Kind:** decision
- **Where:** MVP 2 · Foundation
- **Context:** TBD.md ends at the planning entries and has nothing on fix round 4 or on these branches passing verification. mvp-2 lacked MVP 1's intake form, profile page and profile queries, the inbox search fix and the F5.3 proof-order fix.
- **Options:**
  1. Merge all three branches first, each with --no-ff as its own commit
  2. Leave out any branch whose verification isn't recorded
- **Chosen:** Merged mvp-1-fix-r4-intake-live-merge (58aa202), mvp-1-fix-r4-inbox-search-unanalysed (d83196e) and mvp-1-fix-r4-e2e-f53-proof-order (4e0dec1), in that order, each as its own --no-ff commit and before any foundation commit. None conflicted. pnpm check (889 tests) and pnpm unused were green afterwards, with no fixes needed. MVP 2's rules, matching, reply policy, decisions and assistant all depend on the confirmed profile. Leaving the two small fixes out would lose them, or make them conflict later with this foundation's InboxPage slot edits and the e2e-fixtures slice's stack.test.ts.
- **If you decide otherwise:** Revert the merge commit of whichever branch the owner rejects. Each foundation verifier should review each merge on its own (git diff mvp-2...<branch> for each of the three).
- **Refs:** 58aa202, d83196e, 4e0dec1; TBD-186
- **Status:** accepted

## TBD-212 · packages/db's applyProfileChanges takes core's applyChanges as a parameter instead of importing packages/core
- **Kind:** decision
- **Where:** MVP 2 · Foundation
- **Context:** The plan has applyProfileChanges apply core's applyChanges inside the db transaction. ARCHITECTURE says packages/db may import only packages/schema.
- **Options:**
  1. packages/db imports @jobfilly/core
  2. The caller passes applyChanges in (meta.apply)
- **Chosen:** The caller passes it in. The signature is applyProfileChanges(db, ws, profileId, changes, { source, userId, request, at, apply }), and the server's applyAndReevaluate passes core's applyChanges bound to its context. This keeps the package boundary as documented while still writing entries, rules and the history row in one transaction.
- **If you decide otherwise:** Add @jobfilly/core to packages/db, call applyChanges directly, drop the `apply` field, and update the ARCHITECTURE package table.
- **Refs:** packages/db/src/queries/profile-changes.ts; apps/server/src/profile/changes.ts; docs/ARCHITECTURE.md › The profile change service
- **Status:** accepted

## TBD-213 · An empty reply_to answer counts as not stated, so the default (recruiter outreach) applies
- **Kind:** decision
- **Where:** MVP 2 · Foundation
- **Context:** replyEligibility defaults reply_to to recruiter outreach. The intake stores reply_to as [] when there wasn't enough evidence, so an empty list can't be told apart from 'reply to nothing'.
- **Options:**
  1. Empty means never reply automatically
  2. Empty means not stated, so the default applies
- **Chosen:** Empty means not stated: the default applies. An intake left empty for lack of evidence would otherwise turn off every automatic draft (F6.1). Users who want no automatic drafts can raise reply_threshold or use a no_draft rule.
- **If you decide otherwise:** In packages/core/src/policy/reply.ts, replyTo(): use the entry's value whenever the entry exists, and update the policy test table.
- **Refs:** packages/core/src/policy/reply.ts; F6.1
- **Status:** superseded: an empty reply_to from the scan still means not stated, but one set by hand, a decision or an applied proposal now means reply to nothing (ec03115)

## TBD-214 · Contract fields added beyond the pinned list
- **Kind:** decision
- **Where:** MVP 2 · Foundation
- **Context:** Several slice needs aren't covered by the pinned field lists, and only the foundation can change packages/schema.
- **Options:**
  1. Stick to exactly the pinned fields
  2. Add the fields the slices will need
- **Chosen:** Added these:
  - Cv: countryHints and uploadedAt.
  - Decision choices: {label, value} items, where the value is one profile item.
  - Proposal: before and after ProfileSnapshots, so the card can show before and after (F8.2). ProfileHistoryEntry: the changes.
  - AssistantTurn: threadId. Plus the AssistantThread and AssistantMessage shapes.
  - MailboxPublic.sync: defaults to 'never', so the existing GET /mailboxes stays valid until the mailbox slice sets it.
  - Data-file schemas for the sender phrase lists and free-mail domains.
  - MessageInput.language: always null for now, since nothing detects a message's language.
  Without these, the cvs-senders, replies and assistant slices would each need to change the schema themselves, which the plan rules out.
- **If you decide otherwise:** Remove the field from packages/schema and its use in the db query.
- **Refs:** packages/schema/src/{cv,decisions,assistant,mailbox,sender}.ts; packages/db/src/queries/evaluations.ts
- **Status:** accepted

## TBD-215 · Assistant route guards: viewers send messages and discard proposals; editing and applying a proposal take an editor
- **Kind:** decision
- **Where:** MVP 2 · Foundation
- **Context:** F8.8 says viewers can chat but can't apply. Discard and edit weren't specified.
- **Options:**
  1. Discard and edit both need an editor
  2. Discard needs only a viewer, edit needs an editor
- **Chosen:** GET and POST /assistant: viewer. POST /assistant/proposals/:id/discard: viewer. PATCH /assistant/proposals/:id and POST …/apply: editor. Discarding changes no data and lets a viewer clear their own card. Editing is part of applying.
- **If you decide otherwise:** Change requireRole on the discard route in apps/server/src/routes/assistant.ts and the matching row in app.test.ts.
- **Refs:** apps/server/src/routes/assistant.ts; apps/server/src/app.test.ts
- **Status:** accepted

## TBD-216 · Data choices in the migration and draft history
- **Kind:** decision
- **Where:** MVP 2 · Foundation
- **Context:** Several hard-to-reverse storage choices weren't pinned.
- **Options:**
  1. As chosen below
  2. Alternatives noted per item
- **Chosen:**
  - role_evaluations and match_ai_answers hang off roles with ON DELETE CASCADE, so re-analysing a message drops its evaluations and they are made again.
  - drafts, role_cv_choices, sender_checks and decision_messages hang off messages.
  - 'Dismissed' in draftHistory is per role (message and position), matching DecisionDismiss.
  - One open decision per (workspace, group_key).
  - A deduped job handed back on shutdown while another job with the same key waits ends as 'done', because the waiting job does the same work.
  - profile_history writes no row for a change list that changes nothing.
  - Undo through restoreChanges re-adds a removed rule under a new id.
  Each keeps one source of truth and avoids unique-index conflicts on hand-back.
- **If you decide otherwise:** Each is a small change in packages/db/src/tables.ts (plus a new migration), draft-claims.ts or jobs.ts.
- **Refs:** packages/db/migrations/0001_mvp2.sql; packages/db/src/queries/{draft-claims,jobs,profile-changes}.ts
- **Status:** superseded: Undo now puts a removed rule back with its own id, source and creation date (94becd6, b11d1e7); the other data choices stand

## TBD-217 · Profile PATCH may set policy keys the profile doesn't have yet; other unknown keys are still refused
- **Kind:** decision
- **Where:** MVP 2 · Foundation
- **Context:** reply_threshold and reply_window_days are valid profile keys but are never in a confirmed profile. MVP 1's PATCH refused any key the profile didn't have.
- **Options:**
  1. Refuse every key the profile doesn't have
  2. Also allow the policy keys
- **Chosen:** The policy keys are allowed (Change update creates the entry). Any other unknown key still gets 400. The profile page edits a policy entry with a number field. This lets the owner change the reply policy without inventing intake questions. Assistant proposals can set the policy keys the same way.
- **If you decide otherwise:** Drop the isPolicyKey exception in apps/server/src/routes/profiles.ts.
- **Refs:** apps/server/src/routes/profiles.ts; apps/web/src/pages/intake/answers.tsx
- **Status:** accepted

## TBD-218 · biome's noThenProperty is off for the whole repo
- **Kind:** decision
- **Where:** MVP 2 · Foundation
- **Context:** The spec names a rule's action `then`. The lint fails on every object holding a rule.
- **Options:**
  1. Rename the field (changes the spec's shape)
  2. Add a biome-ignore comment at each use
  3. Turn the rule off in biome.json
- **Chosen:** Turned it off in biome.json and explained why in the RuleDraftSchema comment: `then` is always a string, never a function, so nothing can mistake a rule for a promise. This keeps the spec's field name, and the parallel slices don't each need suppression comments.
- **If you decide otherwise:** Turn the rule back on and add biome-ignore comments where rules are built.
- **Refs:** biome.json; packages/schema/src/rules.ts
- **Status:** accepted

## TBD-219 · A message gone from the mailbox gets an incomplete sender check, redone when the message is seen again
- **Kind:** decision
- **Where:** MVP 2 · Foundation
- **Context:** F1.6: a backlog message deleted from the mailbox never got a check. It kept its workspace in the sweep's work list and logged in to IMAP every interval. fetchBody returns null both for a deleted message and for a folder rebuilt under a new UIDVALIDITY.
- **Options:**
  1. Store an incomplete check (caution, message_gone) and make it stale when saveEnvelopes sees the message again
  2. Add attempts/next_attempt_at columns to sender_checks with a cap and back-off
  3. Both
- **Chosen:** Store an incomplete check with the message_gone signal (MESSAGE_GONE_SIGNAL in packages/schema). It is never better than caution, and a check the stage returned for a gone message is forced to that. saveEnvelopes (the scan and sync path, a UIDVALIDITY re-index included) makes such checks stale so they are redone with the text. The stored language is kept as last detected. F5.3 says a check that couldn't be done is incomplete, never 'looks fine'. Users see an honest 'caution' badge instead of nothing, and the loop ends without a schema change for back-off. Re-staling on saveEnvelopes covers the false positive where the folder was rebuilt between syncs, which matters for upgraded deployments at the startup sweep.
- **If you decide otherwise:** With attempts/back-off, sender_checks needs two columns, listToEvaluate must respect next_attempt_at, and a message gives up after the cap with no check at all, so the reply would wait forever.
- **Refs:** F1.6, F5.3; apps/server/src/pipeline/evaluate.ts, stages.ts (MessageGoneError); packages/db/src/queries/messages.ts saveEnvelopes; sweep.test.ts
- **Status:** accepted

## TBD-220 · The sender stage reports the body's language; it is stored on messages.language
- **Kind:** decision
- **Where:** MVP 2 · Foundation
- **Context:** MessageInput.language was always null, yet TBD-176 (phrase lists per language) and F2.3 (CV by language) depend on it, and re-scoring must not touch the mailbox.
- **Options:**
  1. Store a detected language on messages, filled by the sender stage that reads the body
  2. Add a language to extract.v1's output (MVP 1 contract, fixtures, backlog not covered)
  3. Remove the field and let stages derive it (cv-choice can't read the body)
- **Chosen:** SenderStage now returns {check, language} (SenderStageResult). The pipeline stores the language with saveMessageLanguage on the new nullable messages.language column, and loadMessageInputs reads it. When it changes, the message's roles are marked stale and evaluated again in the same run. Only the sender stage reads the body. Storing what it detects keeps the cv-choice stage and every re-score mailbox-free, and covers the backlog without touching MVP 1's extract.v1 contract.
- **If you decide otherwise:** An extract.v1 language would mean regenerating MVP 1 wire samples and fixtures and backfilling the backlog. Dropping the field would leave cv-choice without a language on re-scoring.
- **Refs:** F2.3, TBD-176; apps/server/src/pipeline/stages.ts, evaluate.ts; packages/db tables.ts messages.language, evaluations.ts
- **Status:** accepted

## TBD-221 · draft.v1 gets a 'Role: <position>' key line (drafts stay per role)
- **Kind:** decision
- **Where:** MVP 2 · Foundation
- **Context:** TBD-210 item 2: drafts are claimed per role, but draft.v1 was keyed only by Message-ID and Attempt, so two roles of one message couldn't be told apart.
- **Options:**
  1. Add 'Role: <position>' to draft.v1's key lines; fake key Message-ID#position#attempt
  2. Pin at most one automatic draft per message in replyEligibility
- **Chosen:** The Role key line, between Message-ID and Attempt, with the wire sample, the e2e wire test, packages/ai tests, the server's fake AI key and ARCHITECTURE updated. Per-role drafts are what the database (one live draft per role), the dedupe key and Draft a reply (F6.5) already assume. Changing the key line is mechanical and keeps every role's answer distinct. Whether two automatic drafts in one thread are wanted is left to replyEligibility, which can still restrict it.
- **If you decide otherwise:** Revert the key line and add a per-message limit in packages/core replyEligibility with a test; the fake AI key goes back to Message-ID#attempt.
- **Refs:** F6.1, F6.5, TBD-210 item 2; packages/ai/src/tasks/draft.ts; e2e/fixtures/wire/draft.v1.request.json; apps/server/src/testing/ai.ts
- **Status:** changed: at most one automatic draft per message, for the best-scoring eligible role (owner, 2026-10-16); Draft a reply stays per role.

## TBD-222 · A failed draft.v1 call marks the draft failed with a new 'ai' kind, retried under the same 5-attempt cap
- **Kind:** decision
- **Where:** MVP 2 · Foundation
- **Context:** TBD-210 item 1: no outcome was defined when draft.v1 itself fails (provider error, timeout, invalid output, no AI set up). The failure kinds were only mailbox and content.
- **Options:**
  1. New 'ai' failure kind retried by the sweep under DRAFT_MAX_ATTEMPTS
  2. Release the claim (releaseDraftClaim) so the role stays never-drafted
- **Chosen:** The 'ai' kind with a plain failureReason, retried like 'mailbox' (one shared cap). After the cap the draft stays failed and visible on the Drafts page, and Draft a reply takes it back. The user sees why there is no draft instead of a silent gap, retries are bounded, and no row is left in saving. Releasing the claim would hide the failure, and nothing would retry it until some later change made the role stale.
- **If you decide otherwise:** Drop 'ai' from DraftFailureKind and the check constraint; draft.create calls releaseDraftClaim on an AI error, and the role gets an automatic draft only after the next change re-evaluates it.
- **Refs:** F6.7, TBD-210 item 1; packages/schema/src/drafts.ts; packages/db/src/queries/draft-claims.ts; apps/server/src/drafts/jobs.ts
- **Status:** accepted

## TBD-223 · Every AI call goes through aiClientFor, which records usage
- **Kind:** decision
- **Where:** MVP 2 · Foundation
- **Context:** TBD-210 item 4 / F1.5: usage was recorded by hand at three call sites, and the four new tasks had no shared recording point.
- **Options:**
  1. A wrapper over the client (aiClientFor) that records each result's usage
  2. A recordUsage(deps, ws, result) helper each call site must call
- **Chosen:** aiClientFor(deps, workspaceId, settings, {scanId}) in apps/server/src/ai-usage.ts wraps every AiClient method explicitly, so adding a task fails compilation until it is wrapped. The scan, POST /ai/test and intake.v1 use it. The scan's spend() only counts now. A recording error propagates (in the scan it surfaces as an internal failure). usagePerDay was added to packages/db. A wrapper can't be forgotten per call the way a helper can, failures and retries count automatically, and ARCHITECTURE now says nothing calls deps.ai.client directly.
- **If you decide otherwise:** Use a helper, with a test per call site; or swallow recording errors (logged) so a database hiccup can't fail an AI step, at the cost of under-counting.
- **Refs:** F1.5, TBD-210 item 4; apps/server/src/ai-usage.ts, ai-usage.test.ts; packages/db/src/queries/usage.ts
- **Status:** accepted

## TBD-224 · Workspace-composite foreign keys, with 0001_mvp2 regenerated in place
- **Kind:** decision
- **Where:** MVP 2 · Foundation
- **Context:** References to CVs, profiles and assistant threads used single-column FKs, so rows could point into another workspace.
- **Options:**
  1. Regenerate 0001_mvp2 (MVP 2 isn't released) with unique (workspace_id, id) and composite FKs
  2. Add a new 0002 migration
  3. Check ownership in the query helpers only
- **Chosen:** Regenerated 0001_mvp2 with drizzle-kit, keeping the journal timestamp. Hand edits: the profiles unique constraint placed before the FKs that reference it, ON DELETE SET NULL ("cv_id") on the two set-null FKs (Postgres 15+, the stack runs 17), and the existing ai_settings UPDATE. The database refuses cross-workspace links whatever a slice writes, and SET NULL (cv_id) keeps workspace_id NOT NULL rows valid. A second migration for unreleased tables would only add noise.
- **If you decide otherwise:** Move these changes to a 0002 migration if any deployment already ran this branch's 0001, since the migrator won't re-apply an edited 0001.
- **Refs:** CLAUDE.md workspace-scoped rule; packages/db/src/tables.ts; packages/db/migrations/0001_mvp2.sql; index.test.ts 'references across workspaces'
- **Status:** accepted

## TBD-225 · F3.3 sign-off run changed to a Gmail app-password account at the owner's request (bde24f3, ff5e1d9)
- **Kind:** decision
- **Where:** MVP 2 · Foundation
- **Context:** Two commits made during the foundation rewrote MVP 3 F3.3 and the matching TBD.md 'Needed from the owner' line. Before, sign-off had one run with a real Outlook.com account. Now it has one run with a real Gmail test account connected with an app password over IMAP and SMTP, and OAuth has no real-account run. The audit asked whether a build agent made these spec edits. The main session's transcript shows the owner asked for them, but TBD.md had no record of that.
- **Options:**
  1. Revert both commits as spec edits by a build agent and file a proposal
  2. Keep them and record the owner as the source
- **Chosen:** Keep them, and have the record step add an entry: Kind decision, Where 'MVP 3 · Spec (owner change during the MVP 2 foundation)', Status 'changed', naming the owner as the source. Evidence: in the interactive main session the owner wrote at 2026-10-15T17:38:56Z "we don't care about outlook, the main provider will be gmail", at 17:40:56Z "how to create the gmail credentials?" and at 17:45:31Z "why console.cloud.google.com, is there not a easy way to have a mail client". bde24f3 (10:40:35 -0700) and ff5e1d9 (10:51:45 -0700) were committed on the main checkout's HEAD right after these messages. The owner asked for the change, so reverting it would undo what the owner wanted. The rule against spec edits covers the build, not the owner. What was missing was only the audit record, and TBD.md says only the record step writes entries.
- **If you decide otherwise:** Revert bde24f3 and ff5e1d9, which brings back the Outlook.com real-account run in docs/mvp/MVP-3.md F3.3 and in TBD.md 'Needed from the owner'.
- **Refs:** docs/mvp/MVP-3.md F3.3; TBD.md 'Needed from the owner'; commits bde24f3, ff5e1d9; ~/.claude/projects/-Users-admin-Desktop-Repos-newrepo-JobFilly/64cc6a3d-9ab6-4d3a-82c6-e8066af76703.jsonl
- **Status:** accepted

## TBD-226 · The e2e-fixtures slice registers its own e2e entry points in knip.jsonc (partly supersedes TBD-206)
- **Kind:** decision
- **Where:** MVP 2 · Foundation
- **Context:** Under TBD-206 the foundation pre-registered rdap/main.ts and dns/main.ts and the slices never edited knip.jsonc. Because the files don't exist yet, knip reports them as configuration hints, and the audit flagged that.
- **Options:**
  1. Keep the entries pre-registered and let the integrator clean them up
  2. Remove them, and let the slice that adds each entry-point file register it in the same change
- **Chosen:** Removed both entries. The knip.jsonc comment now says slices edit the file only to add their own e2e entry points, in the same change that adds the file. The config should only name files that exist, and pnpm unused should stay free of hints. Only the e2e-fixtures slice touches that list, so merges stay low-risk.
- **If you decide otherwise:** Put the entries back in knip.jsonc and have the integrator drop any entry whose file never appears.
- **Refs:** knip.jsonc; TBD-206; docs/mvp/README.md > Clean as you go
- **Status:** superseded by TBD-332

## TBD-227 · AI settings tolerate rows written by MVP 1 replicas (adds to TBD-209)
- **Kind:** decision
- **Where:** MVP 2 · Foundation
- **Context:** TBD-209 fills the new per-task models with a one-time migration backfill. During a rolling update, an MVP 1 replica can still save or insert a row with only four models after the migration has run.
- **Options:**
  1. Merge on save only
  2. Fill on read only
  3. Both
- **Chosen:** Both. saveAiSettings merges with jsonb || (keys being saved win, keys only the stored row has are kept), and getAiSettings fills a missing cv, match, draft or assistant model from extract. Merging keeps the owner's chosen task models when an old replica saves. Filling on read covers a row that an old replica inserted for the first time, which merging can't fix. The schema still requires all eight keys at the API.
- **If you decide otherwise:** Make the new keys optional in AiModelsSchema, with a fallback in packages/ai.
- **Refs:** packages/db/src/queries/ai-settings.ts; packages/db/src/queries/ai-settings.test.ts; docs/ARCHITECTURE.md > Kubernetes readiness; TBD-209
- **Status:** accepted

## TBD-228 · The fit score formula and weights
- **Kind:** decision
- **Where:** MVP 2 · Build (rules-match)
- **Context:** The score formula was pinned nowhere (TBD-210 item 3). The fixtures need Berlin, remote-EU and one APAC role at 70 or more, data engineering below 70, and Amsterdam and Singapore at 40 or less.
- **Options:**
  1. Five weighted parts with fits 1 / unknown about 0.5 / conflicts 0: title 35, skills share 25, place or remote 20, pay 10, other entries 10
  2. Penalty-based scoring from 100
  3. A model-given score
- **Chosen:** Weighted parts. Unknown is worth 0.5, or 0.6 for pay, for a role that lists no skills, and for the other-entries part when none of those entries applies. Hard conflicts cap the score at 40; soft conflicts (a language you don't list, a title that doesn't fit, remote hours outside yours) lower it without capping. Each part maps to a listed verdict, so the score can be explained and is a pure function of its input. Unknowns neither sink nor lift a role, so the CHF roles stay good matches before their decision is answered (S5).
- **If you decide otherwise:** Change WEIGHTS and the credit constants in packages/core/src/match/match.ts and the scores in match.test.ts. After integration, run the scorer over every fixture role and check each lands on the side of the threshold that expected.json records.
- **Refs:** packages/core/src/match/match.ts; TBD-210 item 3; S3, S5, S7, S8
- **Status:** accepted

## TBD-229 · Profile skills come from an 'extra.skills' entry
- **Kind:** decision
- **Where:** MVP 2 · Build (rules-match)
- **Context:** match.v1's input and F4.4 need the profile's own skills, but the profile has no core skills key.
- **Options:**
  1. Read the words of an extra.skills entry when the profile has one, else none
  2. Add a core 'skills' profile key (a schema and intake change)
  3. Always use no profile skills
- **Chosen:** extra.skills when present, else []. It needs no schema or intake change, puts nothing market-specific in code, and makes 'with cvId null, skills come from the profile alone' work.
- **If you decide otherwise:** Change profileSkills() in packages/core/src/match/match.ts to read the new key.
- **Refs:** packages/core/src/match/match.ts profileSkills; F4.4
- **Status:** superseded by TBD-249

## TBD-230 · The model's skill closeness never makes a skill matched
- **Kind:** decision
- **Where:** MVP 2 · Build (rules-match)
- **Context:** match.v1 judges how close the role's skills are, but F4.4 says a missing skill is never a fit, and CLAUDE.md says never invent skills.
- **Options:**
  1. Matched only when the CV or profile lists it (same words after normalising, or its words inside the role's); the model's closeness only appears in the explanation
  2. Count the model's 'fits' as matched
- **Chosen:** Deterministic matching only. A missing skill the model calls close is still listed as missing, and the skills reason adds 'Close to your skills, but not listed in your CV or profile: …'. A wrong model answer can never invent a skill or raise a score.
- **If you decide otherwise:** In skillsPart() in packages/core/src/match/match.ts, move AI-fits skills into matched, and update match.test.ts.
- **Refs:** packages/core/src/match/match.ts skillsPart; F4.4
- **Status:** accepted

## TBD-231 · Which unknowns carry a decision need, and its suggested answers
- **Kind:** decision
- **Where:** MVP 2 · Build (rules-match)
- **Context:** F7.1: only unknowns a reply can't go without become decisions.
- **Options:**
  1. Only pay with a stated currency and period when the profile has a minimum but none in that currency and period
  2. Every unknown
- **Chosen:** Only that pay case gets a need: groupKey min_pay:<CUR>:<period>, profileKey min_pay, question 'Minimum pay in <CUR> per <period>?'. The choices are the role's own stated min and max in that currency and period (none if it states no amount, leaving the free-text answer); no exchange rate is ever used. Pay with no currency, no period or no amount, a missing contract, and similar gaps carry no need. An ask_first rule's need uses groupKey rule:<ruleId> with Yes/No choices. These are the only cases a reply truly depends on, and deriving suggestions from the role avoids assuming rates.
- **If you decide otherwise:** Change payVerdict() and askFirstNeed() in packages/core.
- **Refs:** packages/core/src/match/match.ts payVerdict; packages/core/src/rules/engine.ts askFirstNeed; F4.3; F7.1; F7.3
- **Status:** accepted

## TBD-232 · Rule op semantics
- **Kind:** decision
- **Where:** MVP 2 · Build (rules-match)
- **Context:** The Condition ops were named in the spec but not defined.
- **Options:**
  1. in/contains = any item; not_in = none; equals = the same set for lists; outside = no overlap with the range; within = entirely inside; below = even the highest stated pay is under the threshold, same currency and period only
  2. outside = not entirely within
- **Chosen:** As in the first option. A condition whose value can't test its fact never holds. A role that partly overlaps your hours is never hidden by mistake; this is the cautious reading.
- **If you decide otherwise:** Change evaluateCondition() in packages/core/src/rules/engine.ts and the matrix in engine.test.ts.
- **Refs:** packages/core/src/rules/engine.ts; F3.2; S8
- **Status:** accepted

## TBD-233 · A failed match.v1 call leaves the role unevaluated
- **Kind:** decision
- **Where:** MVP 2 · Build (rules-match)
- **Context:** No answer means the fuzzy parts can't be judged.
- **Options:**
  1. Fail the stage, so the next sweep retries
  2. Score without the model, with the title unknown
- **Chosen:** Fail the stage, as ARCHITECTURE says ('a stage that fails … is never marked evaluated'). A role with neither a title nor skills gets no call at all. It never stores a weaker score as if it were current. Consequence for e2e-fixtures: the fake AI must answer match.v1 for every role with a title or skills, the MVP 1 backlog included, or those roles stay unscored.
- **If you decide otherwise:** In apps/server/src/pipeline/match.ts, catch MatchAiError and call matchRole with ai null.
- **Refs:** apps/server/src/pipeline/match.ts; docs/ARCHITECTURE.md › The analysis pipeline
- **Status:** accepted

## TBD-234 · The match.v1 input hash lives in packages/db
- **Kind:** decision
- **Where:** MVP 2 · Build (rules-match)
- **Context:** The test plan asks for a PGlite test showing the hash includes CvChoiceResult.skills.
- **Options:**
  1. matchInputHash in packages/db/src/queries/match.ts (node:crypto)
  2. Hash in apps/server
- **Chosen:** packages/db, next to the table it keys. It hashes [title, role skills, target roles, profile skills, CV skills] in that order; the message and position are part of the key, not of the hash. The table's key and its hash have one owner and are tested together.
- **If you decide otherwise:** Move the function to the server and its test to pipeline/match.test.ts.
- **Refs:** packages/db/src/queries/match.ts; docs/ARCHITECTURE.md › Data (stored match answers)
- **Status:** accepted

## TBD-235 · An answer without 'Use this answer for similar mail' counts only for the roles waiting now
- **Kind:** decision
- **Where:** MVP 2 · Build (replies)
- **Context:** F7.2 offers 'Use this answer for similar mail', so leaving it off has to mean something. F7.4 says answering writes a profile entry. A profile entry would answer later mail by group key anyway, which would make the checkbox do nothing. Decisions without a profile key (ask_first rules) have nowhere in the profile to write.
- **Options:**
  1. Always write the profile entry and ignore the checkbox
  2. With the checkbox: write the profile entry (add, source decision). Without it, or with no profile key: store the answer on the decision, resolve the waiting roles, re-evaluate them, and give draft.v1 the answer for those roles only
  3. Hide the checkbox
- **Chosen:** The second option. The checkbox is on by default and is shown only when the decision has a profile key. Unchecked, the profile and its history stay untouched. The roles waiting now get their drafts with the answer added to the prompt entries (core draftEntries), and a later message asks again. It gives the spec's choice a real effect. It keeps F7.4 and F7.6 exact for the default path, which S5 uses. It doesn't change the profile when the user said the answer was for this mail only, in line with 'nothing changes without the user's say'.
- **If you decide otherwise:** In apps/server/src/routes/decisions.ts, set `remember = decision.profileKey !== null`, and drop the checkbox in apps/web/src/pages/decisions/index.tsx. The per-role answer path (roleAnswers in drafts/write.ts, answeredHere in the reply stage) then serves only ask_first decisions.
- **Refs:** F7.2, F7.4, F7.6; apps/server/src/routes/decisions.ts; apps/server/src/pipeline/reply.ts; packages/core/src/drafts/entries.ts; routes/decisions.test.ts 'without Use this answer for similar mail answers only the messages waiting now'
- **Status:** accepted

## TBD-236 · A draft.v1 question without a valid profile key becomes an extra.<slug> entry, and its group key is tied to that key
- **Kind:** decision
- **Where:** MVP 2 · Build (replies)
- **Context:** draft.v1 returns free-form profileKey and groupKey strings. If the profile key is null or invalid, or the group key names another key, the answer can't be written to the profile, or answeredFor can never see it. The next draft would then ask the same question again, forever, against F7.6.
- **Options:**
  1. Keep the model's keys and treat unusable ones as per-message questions
  2. Map an invalid or null key to extra.<slug of the group key, or of the question>, and replace a group key that doesn't belong to the key with the key itself
  3. Drop such questions
- **Chosen:** Map them (core needsFromQuestions and questionKey). Choices that can't be an item of the key are dropped; the free-text option is always there. The answer lands in the profile, so the next draft.v1 call sees it and answeredFor closes the question (F7.6, S5's relocation question). Nothing market-specific is added.
- **If you decide otherwise:** Change questionKey and needsFromQuestions in packages/core/src/decisions; unusable questions would then need per-message handling, or be dropped.
- **Refs:** F6.2, F7.6; packages/core/src/decisions/answers.ts, needs.ts; packages/ai/src/tasks/draft.ts
- **Status:** accepted

## TBD-237 · A free-text answer is made into an item of the decision's key from the group key's parts, or refused
- **Kind:** decision
- **Where:** MVP 2 · Build (replies)
- **Context:** F7.2 requires a free-text option, but min_pay, places, remote and work_permits take structured items: a decision answer is one item (TBD-195).
- **Options:**
  1. Accept free text only for word-valued keys
  2. Build the item from the words plus the group key's parts (min_pay:CHF:year with '120,000' becomes amount 120000, CHF, year, as written), and answer 400 with plain words when it can't be built
  3. Store free text unparsed
- **Chosen:** Build it with packages/core itemFromText. A core test checks that every item built answers its own group key. The free-text option works for every key, nothing is guessed beyond the key and the words, and the profile stays valid.
- **If you decide otherwise:** Restrict free text to word keys in the UI and refuse it in answerItem for structured keys.
- **Refs:** F7.2, F7.4; packages/core/src/decisions/answers.ts; routes/decisions.test.ts 'takes free text made into an item of the key'
- **Status:** superseded: typed words that state no item now answer the waiting roles only and write nothing; only keys whose items are words or numbers still refuse them (7da5d80)

## TBD-238 · draft.create stores the reply text before the mailbox write, so a retry saves the same text without another model call
- **Kind:** decision
- **Where:** MVP 2 · Build (replies)
- **Context:** TBD-194 and TBD-222 retry mailbox-failed drafts from the sweep. Calling draft.v1 again on every retry costs model calls and can produce a different reply.
- **Options:**
  1. Keep the text on the saving row (subject, body, language, cvId) and reuse it on retry
  2. Call draft.v1 again on every attempt
- **Chosen:** Keep the text. Only the reply text is stored, never the original, so the rule that a draft row holds only the reply text still holds. After an outage exactly one draft lands, and it is the same one (S11), with no extra AI usage.
- **If you decide otherwise:** Drop the saveDraftText call and the reuse branch in apps/server/src/drafts/write.ts.
- **Refs:** F6.3, F6.7; packages/db/src/queries/drafts.ts saveDraftText; reply.test.ts 'fails the draft with kind mailbox, and the sweep's retry lands exactly one draft'
- **Status:** accepted

## TBD-239 · Editing or discarding while the mailbox is unreachable changes nothing and answers 503
- **Kind:** decision
- **Where:** MVP 2 · Build (replies)
- **Context:** F6.4 needs exactly one mailbox copy. If an edit is saved in the app but not in the mailbox, the two disagree, and nothing would retry an edit.
- **Options:**
  1. 503 with nothing changed; the user tries again
  2. Save the edit and queue a retry of the mailbox write
- **Chosen:** 503 with a plain message ('... Your edit wasn't saved.' or '... The draft is still there.'). The row and the mailbox stay as they were. The mailbox stays the source of truth with exactly one copy, and the user sees at once what happened. There is no hidden half-saved state.
- **If you decide otherwise:** Add a pending-edit state and a job for it; that needs a new draft status in the foundation's schema and migration.
- **Refs:** F6.4; apps/server/src/drafts/edit.ts; routes/drafts.test.ts 'keeps the edit out when the mailbox can't take it, and says so'
- **Status:** accepted

## TBD-240 · The reply stage only claims; draft.create fetches the original itself
- **Kind:** decision
- **Where:** MVP 2 · Build (replies)
- **Context:** The test plan says the reply stage enqueues draft.create and gets the body and References through ctx.original(). A job payload is stored in Postgres, so it can't carry the mail body.
- **Options:**
  1. The stage claims and enqueues; the job fetches the original with fetchOriginal through the same mailboxSession and getMessageRef machinery ctx.original() uses
  2. The stage writes the draft inline through ctx.original() and doesn't enqueue
- **Chosen:** The first option. The stage makes no model or mailbox call, so re-evaluations stay fast. draft.create serves every origin: auto, decision, on_demand and the sweep's retry. No body is ever stored. The F6.4 race is decided by the claim, and the sweep's retries reuse the same job.
- **If you decide otherwise:** Write inline in apps/server/src/pipeline/reply.ts with ctx.original(); Draft a reply and retries would still need the job.
- **Refs:** F6.3, F6.4; apps/server/src/pipeline/reply.ts; apps/server/src/drafts/write.ts, mailbox.ts
- **Status:** accepted

## TBD-241 · Where the first sync starts, and which mail counts as new
- **Kind:** decision
- **Where:** MVP 2 · Build (mailbox)
- **Context:** Before the first sync there is no cursor. Reading INBOX from UID 0 would treat years of mail as new, and so would a new UIDVALIDITY, which returns the whole folder. Either way the model would analyse it all.
- **Options:**
  1. Start from UID 0 and analyse everything
  2. Start where the first scan's stored INBOX mail ends (newestStoredUid), and never treat mail dated before the first scan's 90-day window as new
  3. Start at the folder's current UIDNEXT, dropping mail that arrived between the scan and the first sync
- **Chosen:** Start where the first scan's stored INBOX mail ends, and filter out mail dated before the first scan's window, also after a UIDVALIDITY change. Nothing that arrived after the scan is lost. AI cost stays bounded by what the first scan already decided to read.
- **If you decide otherwise:** Change cursorOf and the windowStart filter in apps/server/src/sync/run.ts.
- **Refs:** F1.1, F1.3; apps/server/src/sync/run.ts; packages/db/src/queries/messages.ts newestStoredUid
- **Status:** accepted

## TBD-242 · Back-off policy for a failing sync
- **Kind:** decision
- **Where:** MVP 2 · Build (mailbox)
- **Context:** F1.4 asks for retries with back-off but gives no numbers. The test stack runs a 15 s interval; production defaults to 120 s.
- **Options:**
  1. Fixed retry every interval
  2. Exponential from one interval, doubling, capped at 15 minutes (or one interval if longer); an attempt up to half an interval away counts as due
  3. Exponential with a cap of a multiple of the interval
- **Chosen:** Exponential from one interval, doubling, capped at 15 minutes. An attempt counts as due when it is at most half an interval away, so tick drift doesn't skip a tick. Recovers quickly after a short outage (S11 pauses IMAP briefly) and stays gentle on a long one. The status says it is retried on its own.
- **If you decide otherwise:** Change backoffMs / MAX_BACKOFF_MS / isDue in apps/server/src/sync/run.ts.
- **Refs:** F1.4; S11; apps/server/src/sync/run.ts
- **Status:** accepted

## TBD-243 · Holding the sync cursor when the model couldn't sort new mail
- **Kind:** decision
- **Where:** MVP 2 · Build (mailbox)
- **Context:** A provider outage or a used-up budget would leave new mail pending ('not analyzed') until someone presses Analyze them. Holding the cursor for ever would make one message the provider always fails on cost model calls every interval, indefinitely.
- **Options:**
  1. Always move the cursor and leave pending mail to Analyze them
  2. Hold the cursor before every pending message
  3. Hold it only for mail dated up to an hour before the last sync that worked; older pending mail is let go
- **Chosen:** Hold only for mail dated up to an hour before the last sync that worked. Each sync's analysis uses the workspace's budgetPerRun. Transient failures and backlogs after an outage are retried automatically, with no endless retry loop. Mail that is let go stays visible as 'not analyzed'.
- **If you decide otherwise:** Change HOLD_MS and the waiting filter in apps/server/src/sync/run.ts.
- **Refs:** F1.1; apps/server/src/sync/run.ts; MVP 1 'Analyze them'
- **Status:** superseded by TBD-286

## TBD-244 · The sync reads INBOX only
- **Kind:** decision
- **Where:** MVP 2 · Build (mailbox)
- **Context:** F1 says 'incremental fetch by UID per folder'. In MVP 1 the Sent folder only feeds the first scan's preferences, and own replies are never analysed outside a scan.
- **Options:**
  1. Sync INBOX and Sent
  2. Sync INBOX only
- **Chosen:** INBOX only (SYNC_FOLDER). The mailbox_sync table and fetchSince still work per folder, so Sent can be added later. Syncing Sent would store own replies as pending rows that nothing in MVP 2 reads.
- **If you decide otherwise:** Loop over folders in syncMailbox and decide what reads synced own replies.
- **Refs:** F1; apps/server/src/sync/run.ts
- **Status:** accepted

## TBD-245 · Draft From, quote attribution and replace order
- **Kind:** decision
- **Where:** MVP 2 · Build (mailbox)
- **Context:** DraftMailInput carries no From address. A quote's attribution line ('On … wrote:') is language-specific, but drafts are in the incoming message's language. A replace that fails between its two steps must still leave exactly one copy (F6.4).
- **Options:**
  1. From = the account user name when it is an email address, else no From (the mail client fills it)
  2. Add a from field to the schema
- **Chosen:** From is the IMAP user name when it is an address. The attribution line has no words, only date and author ('2026-10-12 08:15 UTC, Lena Vogel <…>:'). replaceDraft deletes the old copy first, then appends, so a retry after a failure leaves exactly one copy. With no Drafts folder, one named 'Drafts' is created. buildDraftMime became async (MailComposer builds asynchronously) and private to packages/mail. No schema change for the parallel replies slice, nothing language-specific in code, and F6.4's exactly-one-copy rule holds even across failures.
- **If you decide otherwise:** Add `from` to DraftMailInput, or change replyText / the remove-then-append order in packages/mail/src/client.ts.
- **Refs:** F6.3, F6.4; packages/mail/src/client.ts; packages/mail/src/drafts/index.ts
- **Status:** accepted; the From address part is superseded by TBD-278

## TBD-246 · Log events used for operational sync failures
- **Kind:** decision
- **Where:** MVP 2 · Build (mailbox)
- **Context:** LogEvent in apps/server/src/log.ts is a closed union outside this slice's paths. Analysis that has to wait and a scheduler that can't list mailboxes needed log lines.
- **Options:**
  1. Add new events to log.ts
  2. Reuse existing events
- **Chosen:** pipeline.stage_failed {stage: 'analyze', error} when analysis waits for later, and sync.failed {cause: 'schedule_error'} when the scheduler can't list mailboxes. Avoids editing a shared foundation file that the other slices also extend.
- **If you decide otherwise:** Add e.g. sync.analysis_waiting to LogEvent and switch the calls in apps/server/src/sync/run.ts and scheduler.ts.
- **Refs:** MVP-2.md › Log events; apps/server/src/log.ts
- **Status:** accepted

## TBD-247 · How a remote role's stated scope and places are compared with the profile's remote entry
- **Kind:** decision
- **Where:** MVP 2 · Build (rules-match)
- **Context:** F4.1 finding: a remote role got 'fits' without checking its remoteScope or places. The scopes on both sides are free text ('EU', 'within the EU', 'from anywhere', 'US only'), and the hard rules forbid market or language vocabularies in code.
- **Options:**
  1. Compare words in core: a scope is covered when all the words of one of the profile's remote scopes are in the role's scope; a place is covered when it is one of the profile's places, or a remote scope names its ISO country code or city. Anything else is unknown.
  2. Add a scope-closeness judgement to match.v1 (a schema, prompt and fake-AI fixture change across slices)
  3. Map region names such as 'EU' to lists of countries in code
- **Chosen:** Compare words in core; anything that isn't plainly covered is unknown, never a fit and never a conflict. Time-zone conflicts still win. It is deterministic, needs no model call or vocabulary, and never guesses a fit. Option 2 would change match.v1's contract and the fake-AI answers owned by e2e-fixtures. Option 3 is a market-specific list. The fixture roles keep their outcomes: 'within the EU' still fits, and apac-1 ('from anywhere') drops to about 90, still at least 70.
- **If you decide otherwise:** With match.v1 judging scope closeness, 'from anywhere' could become a fit, but the AI schema, the prompt, the stored-answer hash input and the fake-AI fixtures would all have to change together.
- **Refs:** packages/core/src/match/match.ts (scopeCovered, remotePlaceCovered, remoteVerdict); packages/core/src/match/match.test.ts
- **Status:** superseded by TBD-435

## TBD-248 · Rules are shown by stored words that the change service guarantees
- **Kind:** decision
- **Where:** MVP 2 · Build (rules-match)
- **Context:** F3.1 finding: the Rules list showed the stored description, which could be blank or describe conditions that had since changed. The web depends only on schema, so it can't build words itself.
- **Options:**
  1. The change service stores describeRule's words when a rule is added with a blank description, or updated with new conditions or action under its old description; the list shows the stored description
  2. The rules route rewrites description at read time (ruleName)
  3. Always show describeRule and ignore stored descriptions everywhere
- **Chosen:** Write time, in core applyChanges, the only place rules are written. The route and web are unchanged; the engine's ruleName keeps its blank fallback. One stored truth: the list, the Remove label, history and 'Hidden by your rule …' reasons all show the same words. A deliberate custom description such as 'No Asian hours' is kept, matching the existing engine and route tests. Option 2 would make the API return something other than what is stored. Option 3 would throw away descriptions the assistant and decisions write.
- **If you decide otherwise:** If rules should always show words built from their conditions, make ruleName return describeRule and update the tests that pin custom descriptions in reasons.
- **Refs:** packages/core/src/profile/changes.ts (ruleWords); docs/ARCHITECTURE.md (profile change service)
- **Status:** superseded: the rules a proposal adds or changes are now worded from their conditions when the proposal is stored or edited, so the model's own description is replaced (f1909be, ddc3cc9); other stored words are kept

## TBD-249 · Where a profile's own skills live
- **Kind:** decision
- **Where:** MVP 2 · Build (rules-match)
- **Context:** F4.4 finding: profile skills came from a hidden string literal 'extra.skills' that no other package defined.
- **Options:**
  1. An exported PROFILE_SKILLS_KEY = 'extra.skills' in packages/schema, documented in ARCHITECTURE
  2. A new core or policy profile key 'skills' (an intake-form, intake.v1 and fixture change)
- **Chosen:** PROFILE_SKILLS_KEY = 'extra.skills' in packages/schema/src/profile.ts, imported by the match and described in ARCHITECTURE's Data section. It keeps the current behaviour and stored hashes, and needs no intake-form or fixture change in other slices. Profile skills now rest on a named contract instead of a literal.
- **If you decide otherwise:** If skills should be a real profile question, add a 'skills' key to the schema and intake (and to intake.v1's output and the MVP 1 fixtures), then point PROFILE_SKILLS_KEY at it.
- **Refs:** packages/schema/src/profile.ts; packages/core/src/match/match.ts; docs/ARCHITECTURE.md
- **Status:** accepted

## TBD-250 · Maria's MVP 1 backlog is re-dated so no possible good match sits inside the 14-day reply window
- **Kind:** decision
- **Where:** MVP 2 · Build (e2e-fixtures)
- **Context:** MVP-2 says every good match in Maria's MVP 1 mailbox is older than 14 days, so the backlog gets matches but no drafts. The MVP 1 fixtures had the German Berlin recruiter (maria-0001, a near-perfect match) at 1.1 days and several random backlog recruiter mails inside 14 days that could score well. An automatic draft for one of those would hit the fake AI with no draft.v1 answer, get a 500 and leave a failed draft. MVP 1 also requires the five S5 messages to be among the newest 40 likely job mails, which is all a confident first scan reads.
- **Options:**
  1. Re-date: move maria-0001 to 14.7 days and the prompt-injection mail to 14.8 days, push generated job mail dated under 14.6 days back by 14.6 days, and move the replied-to originals at 7 and 12 days to 15 and 15.5 days, keeping reply order
  2. Keep MVP 1 dates and add draft.v1 answers for the in-window backlog matches, so the backlog does get automatic drafts
  3. Keep MVP 1 dates and give in-window roles title conflicts in match.v1, hoping the scorer stays under 70
- **Chosen:** Re-date, with the random stream unchanged (only dates move). Inside 14 days only these remain: the interview, the onsite-Amsterdam original (a hard conflict), the always-invalid mail, the offer, the rejection, alerts and non-job mail. The S5 messages are still within the newest 22 likely job mails, and intake evidence order is unchanged. The job-alert footer's 'never pay a fee' became 'never asks for money or identity documents', because 'pay a fee' is an asks_for_fee phrase and would have flagged 42 alerts. It meets the spec's fixture property whatever weights the scorer uses (no in-window recruiter role can reach 70 unless it has no hard conflict and a non-conflicting title, and none does). It keeps every MVP 1 consistency property. It also gives S7 a concrete case: the German recruiter is now a good match older than 14 days, with a match and no draft.
- **If you decide otherwise:** Revert cdb4955's changes to maria.ts (REPLY_DAYS, pastReplyWindow, the two key-message dates) and regenerate. Then either add draft.v1 answers for the in-window good matches, or change MVP-2's fixture note to allow backlog drafts.
- **Refs:** e2e/fixtures/build/maria.ts (REPLY_WINDOW_EDGE, pastReplyWindow); e2e/fixtures/build/footers.ts ALERT_FOOTER; consistency.test.ts 'dates every possible good match … past the reply window' and 'places the five S5 messages among the newest 40'; MVP-2 Fixtures added, S7; TBD-210 item 3
- **Status:** accepted

## TBD-251 · Fit bands and hard conflicts in expected.json follow a fixture-side definition, because the scorer isn't pinned
- **Kind:** decision
- **Where:** MVP 2 · Build (e2e-fixtures)
- **Context:** The score formula isn't pinned (TBD-210 item 3), but the fixtures must land on thresholds: Berlin, remote EU and one APAC role at 70 or more; data engineering below 70; Amsterdam and Singapore at 40 or less.
- **Options:**
  1. Make every role that must be low capped by an F4.2 hard conflict, record fit good/below/capped per delivered role, and compute hardConflicts with a stated rule
  2. Rely on title-fit and skill answers alone to push scores down
- **Chosen:** The first. hardConflicts = 'places' for an onsite or hybrid role whose named place isn't in the profile in that mode, or whose mode the profile never accepts. A profile with no places conflicts with nothing. Remote is never a conflict. 'min_pay' is set when the whole range (max, else min) is below a minimum in the same currency and period. Amsterdam, Singapore, two APAC roles, data engineering (€60–65k) and the free-mail recruiter (onsite Hamburg) are capped. The good roles have no conflict and a fitting title. The profile used is Maria's confirmed intake without Amsterdam; Tom's is empty. F4.2 caps any hard conflict at 40 whatever the weights, so the 'below threshold' and 'capped' outcomes don't depend on the scorer. Only the 'good' roles depend on the scorer's weights, and they are as clean as a role can be.
- **If you decide otherwise:** Change the role facts in e2e/fixtures/build/deliveries.ts or the rule in matching.ts and regenerate; the consistency tests pin the bands.
- **Refs:** e2e/fixtures/build/matching.ts; deliveries.ts; format.ts ExpectedRole and ExpectedRoleFit; F4.2; TBD-210 item 3
- **Status:** superseded by TBD-319

## TBD-252 · The CHF and Dublin roles are remote roles with the office city in extra.office
- **Kind:** decision
- **Where:** MVP 2 · Build (e2e-fixtures)
- **Context:** S5 needs the Zurich, Basel and Dublin roles to be good matches waiting only on a decision. Maria accepts hybrid only in Berlin, so a hybrid or onsite role in Zurich, Basel or Dublin would be capped by a place conflict, and no decision would ever be asked (F7.1).
- **Options:**
  1. Remote within the EU (and Switzerland), places [], extra.office naming the city
  2. Hybrid in the city, which conflicts and never creates the decision
- **Chosen:** Remote, with extra {office: Zurich|Basel|Dublin}, CHF yearly pay for Zurich, Basel and Zurich-2, and the mail asking for her rate or about relocating. It is the only reading in which S5's decisions can arise under Maria's profile.
- **If you decide otherwise:** Give Maria a hybrid place there or change the role facts in deliveries.ts.
- **Refs:** e2e/fixtures/build/deliveries.ts; MVP-2 S5; F7.1
- **Status:** accepted

## TBD-253 · assistant.json is keyed by a normalised message with an any-turn answer
- **Kind:** decision
- **Where:** MVP 2 · Build (e2e-fixtures)
- **Context:** The contract keys answers by the user's message text and the turn. People type the scenario requests at whatever turn their thread has reached, and S9 adds E2E-CHAT-<n> markers to the messages.
- **Options:**
  1. Exact text plus exact turn
  2. assistantMessageKey(text) (markers removed, whitespace collapsed, lower case), then the exact turn or the '*' (any-turn) answer
- **Chosen:** The second. All fixtures use '*'. A miss is still a 500, and its reason names only the turn, never the words (F8.10). Otherwise the walkthrough and specs would have to reproduce exact turns and casing, and the leak-check markers would break the lookup.
- **If you decide otherwise:** Remove the '*' fallback in fake-ai/answers.ts and key fixtures by turn.
- **Refs:** e2e/fixtures/format.ts assistantMessageKey and ASSISTANT_ANY_TURN; e2e/fake-ai/answers.ts; e2e/fixtures/build/assistant.ts
- **Status:** accepted

## TBD-254 · inspect smtp and reset-uidvalidity use GreenMail's REST API; the reset recreates the account
- **Kind:** decision
- **Where:** MVP 2 · Build (e2e-fixtures)
- **Context:** GreenMail stores SMTP mail in auto-created recipient accounts that the seed can't enumerate over IMAP. It never deletes an Inbox (DELETE INBOX is refused; RENAME INBOX keeps the folder), and it sets UIDVALIDITY when a folder is created. I checked this in the GreenMail 2.1.4 source.
- **Options:**
  1. Use the API: list users and Inboxes for SMTP mail; delete and recreate the account for the reset, appending every folder back with flags and dates
  2. IMAP only: check only the personas' Inboxes, with no way to change UIDVALIDITY
- **Chosen:** The API. compose sets -Dgreenmail.api.hostname=0.0.0.0 and -Dgreenmail.api.port=8080, and the seed gets GREENMAIL_API_URL=http://imap:8080. The reset gives every folder (Inbox, Sent and Drafts) new UIDVALIDITY and new UIDs; Message-IDs, flags and internal dates are kept, and the seed fails if the Inbox's UIDVALIDITY didn't change. Checked against a real GreenMail container. It is the only way to meet F6.6's 'seed inspect smtp shows nothing' and S11's UIDVALIDITY change. The Drafts folder changing too means the app must find its drafts again by Message-ID, as F1.3 requires.
- **If you decide otherwise:** Limit the reset to the Inbox by moving mail through a temporary account, or swap the mail server.
- **Refs:** e2e/seed/commands.ts; e2e/seed/greenmail.ts; docker/compose.e2e.yaml imap and seed; F1.3; F6.6; S11
- **Status:** accepted

## TBD-255 · CoreDNS on a fixed subnet and IP: 10.253.53.0/24 and 10.253.53.53
- **Kind:** decision
- **Where:** MVP 2 · Build (e2e-fixtures)
- **Context:** A container's `dns` option takes an IP address, not a service name, so the dns service needs a fixed address on the stack's network.
- **Options:**
  1. A fixed default-network subnet with a static IP
  2. A dynamic IP passed in by stack.ts
- **Chosen:** Fixed 10.253.53.0/24, with CoreDNS at .53. Docker's embedded resolver still answers service names and forwards other names to CoreDNS, which forwards the rest to /etc/resolv.conf, so real-AI runs still resolve. stack.ts already allows only one stack at a time (fixed proxy ports), and a fixed subnet keeps compose self-contained.
- **If you decide otherwise:** If that range clashes with a host network, change the subnet and the IP in docker/compose.e2e.yaml; stack.test.ts checks they agree.
- **Refs:** docker/compose.e2e.yaml dns and networks; e2e/dns/Corefile; e2e/stack.test.ts 'the dns service (MVP 2)'
- **Status:** accepted

## TBD-256 · The free-mail recruiter writes from a gmail.com address, and the stack's zone answers for gmail.com
- **Kind:** decision
- **Where:** MVP 2 · Build (e2e-fixtures)
- **Context:** The criterion needs the domain to be in free-mail-domains.json, and every entry there is a real provider. The fixtures must stay synthetic.
- **Options:**
  1. gmail.com with an obviously synthetic local part (hanseatic.freight.recruiting.e2e@gmail.com)
  2. A fake free-mail domain added to the data file, which belongs to cvs-senders
- **Chosen:** gmail.com with that address. CoreDNS serves gmail.com's MX inside the stack, the RDAP data lists it as old, and nothing is ever sent (seed deliver uses IMAP). It meets the criterion without editing another slice's data or touching a real mailbox.
- **If you decide otherwise:** Add a .example free-mail domain to packages/core/src/sender/data/free-mail-domains.json and change the sender in deliveries.ts.
- **Refs:** e2e/fixtures/build/deliveries.ts freemail; e2e/dns/zones/db.gmail.com; consistency.test.ts sender ground truth
- **Status:** accepted

## TBD-257 · Delivered mail's ground truth lives in expected.json `deliveries`, and the delivered batch is a step
- **Kind:** decision
- **Where:** MVP 2 · Build (e2e-fixtures)
- **Context:** MVP 1's tests require expected.messages to be exactly the mailbox's messages. MVP 1's F5.3 proof, which reruns in MVP 2, would report delivered messages as unknown.
- **Options:**
  1. A separate `deliveries` map that compare.ts also consults, never required by `complete`
  2. Delivered mail inside expected.messages
- **Chosen:** The separate map. deliveries.json entries carry `step` (S2 for the batch, S5 for zurich-2), so `seed deliver S2` delivers the batch. It keeps MVP 1's invariants and lets the F5.3 proof pass after deliveries.
- **If you decide otherwise:** Merge them and loosen MVP 1's 'name every message once' test and compare.ts.
- **Refs:** e2e/fixtures/format.ts ExpectedFileMvp2 and DeliveryEntry.step; e2e/fixtures/compare.ts; e2e/seed/commands.ts findDeliveries
- **Status:** accepted

## TBD-258 · The Dublin question has its own profile key, extra.relocation-ireland
- **Kind:** decision
- **Where:** MVP 2 · Build (e2e-fixtures)
- **Context:** Maria's intake already has the extra question 'relocation' (within the EU), which she may have confirmed in MVP 1. If the Dublin question shared that key, it could count as already answered and never be asked.
- **Options:**
  1. profileKey and groupKey extra.relocation-ireland
  2. Reuse extra.relocation
- **Chosen:** extra.relocation-ireland, with question 'Would you relocate to Ireland?' and choices Yes / No / Maybe later. S5 needs this decision to appear.
- **If you decide otherwise:** Reuse extra.relocation, and S5 depends on what Maria answered in MVP 1.
- **Refs:** e2e/fixtures/build/deliveries.ts RELOCATION_GROUP; MVP-2 S5
- **Status:** accepted

## TBD-259 · Idempotent draft append via a Message-ID chosen by the server
- **Kind:** decision
- **Where:** MVP 2 · Build (replies)
- **Context:** F6.3/F6.4: a retry after an append whose outcome was never recorded appended a second copy. MailClient is owned by the mailbox slice, and its saveDraft generates its own Message-ID.
- **Options:**
  1. Add optional DraftMailInput.draftMessageId (schema), store it before the append, and delete-by-Message-ID before a retry with the existing deleteDraft (UIDVALIDITY 0)
  2. Add a new mail-port operation (findDraftsByMessageId / replaceByMessageId) in packages/mail
  3. Leave the crash window and record it as open
- **Chosen:** Optional DraftMailInput.draftMessageId, generated on the mailbox address's domain (or jobfilly.invalid) and kept with saveDraftText. A retry deletes any copy found by that Message-ID through deleteDraft with UIDVALIDITY 0. It stays inside this slice and packages/schema, and reuses deleteDraft's lookup by Message-ID, which the mailbox slice already implements. No new port operation is needed.
- **If you decide otherwise:** If the mailbox slice wants a dedicated port operation, replace copyByMessageId and deleteDraft in apps/server/src/drafts/write.ts with that operation. Either way, the mailbox's append() must use input.draftMessageId when it is set (one line at integration).
- **Refs:** F6.3, F6.4; packages/schema/src/mailbox.ts; apps/server/src/drafts/write.ts; apps/server/src/drafts/mailbox.ts; docs/ARCHITECTURE.md › The draft lifecycle
- **Status:** accepted

## TBD-260 · Racing discard always wins over an edit
- **Kind:** decision
- **Where:** MVP 2 · Build (replies)
- **Context:** F6.4: an edit and a discard on the same draft at the same time. With compare-and-set one of them loses, and the result has to be either one copy or none.
- **Options:**
  1. The discard retries: it deletes the newer copy and compares and sets again (up to 3 rounds), so the draft ends discarded with no copy
  2. Whichever loses gets 409 (the result depends on timing)
  3. A per-draft advisory lock held across the IMAP calls
- **Chosen:** The discard retries until it wins (3 rounds). An edit that loses deletes the copy it appended and answers 409. The user's latest intent in a discard is 'gone from the mailbox', and the outcome does not depend on timing. It also avoids holding a database lock during IMAP calls.
- **If you decide otherwise:** If the owner prefers 'first one wins', change the continue in discardDraft (apps/server/src/drafts/edit.ts) to return CHANGED.
- **Refs:** F6.4; apps/server/src/drafts/edit.ts; packages/db/src/queries/drafts.ts
- **Status:** accepted

## TBD-261 · Draft a reply re-asks a question the user dismissed with "Don't ask for this message"
- **Kind:** decision
- **Where:** MVP 2 · Build (replies)
- **Context:** F6.5 against F7.5: after a dismissal, pressing Draft a reply again raised the same question, the dismissed state swallowed it, and the button silently did nothing.
- **Options:**
  1. Reopen the dismissed place (waiting again) when the claim is Draft a reply's (origin on_demand)
  2. Mark the draft failed with a reason that names the dismissed question
  3. Keep the silent no-op
- **Chosen:** For on-demand claims, recordNeeds is called with reopen, so the dismissed place on that decision goes back to waiting. The panel then shows 'Waiting for your answer'. An explicit Draft a reply is newer, deliberate intent, and the reply cannot be written without the answer (Unknown means ask). Automatic drafts still respect the dismissal.
- **If you decide otherwise:** Drop the reopen option in apps/server/src/drafts/write.ts and fail the draft with a reason instead.
- **Refs:** F6.5, F7.5; packages/db/src/queries/decisions.ts recordNeeds; apps/server/src/drafts/write.ts
- **Status:** accepted

## TBD-262 · Answered Draft a reply questions draft a policy-held role with origin on_demand
- **Kind:** decision
- **Where:** MVP 2 · Build (replies)
- **Context:** F7.4 says answering creates the drafts; F7.1 says decisions only for good matches. Draft a reply on a below-threshold role raises decisions, but the reply stage held the role by policy and never drafted it. decision_messages does not record whether a draft question came from Draft a reply or from an automatic draft.
- **Options:**
  1. In the reply stage, when the plan is hold and a resolved draft-sourced decision exists, no draft-sourced need is still open, there is no draft history and none of the draft's questions was dismissed, claim with origin on_demand
  2. Store the request origin on decision_messages (a migration)
  3. Draft directly from the answer route
- **Chosen:** The reply-stage rule without a migration. I read F7.1 as allowing questions on a role the user explicitly asked to reply to. It needs no schema migration, runs after re-matching, and claims the draft once. Automatic drafts only run on eligible roles, so in practice only Draft a reply raises questions on a held role.
- **If you decide otherwise:** One edge case: an automatic draft's question on a role that later became ineligible (for example it fell outside the reply window while waiting) would also be drafted once answered. To exclude that, add an origin column to decision_messages and check it in answeredForDraft.
- **Refs:** F6.5, F7.1, F7.4; apps/server/src/pipeline/reply.ts answeredForDraft
- **Status:** superseded by TBD-280

## TBD-263 · 'Use this answer for similar mail' on ask_first rule decisions is shown but disabled, with the reason
- **Kind:** decision
- **Where:** MVP 2 · Build (replies)
- **Context:** F7.2 says each decision shows the option. Rule decisions have no profile key and are answered per message by schema design, and the server ignored the flag without saying so.
- **Options:**
  1. Show it disabled and unchecked with the reason (the rule asks for each message; switch the rule off to stop)
  2. Store the answer under the rule's group key for later messages (needs new storage and in effect disables the rule)
  3. Hide it (the previous behaviour)
- **Chosen:** Shown disabled with the reason, and useForSimilar sent as false. Remembering an answer to 'ask first' would quietly defeat the rule the user set up. Nothing should change without the user's say, and turning the rule off is their action.
- **If you decide otherwise:** Add per-group-key storage for rule answers and let isOpen consult it. Then enable the checkbox in apps/web/src/pages/decisions/index.tsx and drop the guard in routes/decisions.ts.
- **Refs:** F7.2; apps/web/src/pages/decisions/index.tsx; apps/server/src/routes/decisions.ts
- **Status:** accepted

## TBD-264 · A decision answer writes the profile inside the decision's transaction
- **Kind:** decision
- **Where:** MVP 2 · Build (replies)
- **Context:** F7.4 race: the profile was written before the decision was claimed, so two racing answers could both reach the profile.
- **Options:**
  1. answerDecision takes an alsoWrite callback that runs in its transaction (writeProfileChanges on the transaction), and a refusal rolls everything back
  2. Claim first and revert the claim on refusal (can clash with a new open decision for the same group key)
- **Chosen:** One transaction, with the nested applyProfileChanges running as a savepoint. Re-evaluation (afterProfileChanges) runs after the commit. It is atomic, and a lost race never touches the profile. The profile change service stays the one path, split into a write step and an after-commit step.
- **If you decide otherwise:** Revert-on-refusal would need a reopenDecision query and handling for the one-open-decision-per-group-key index.
- **Refs:** F7.4; packages/db/src/queries/decisions.ts answerDecision; apps/server/src/profile/changes.ts; docs/ARCHITECTURE.md › The profile change service
- **Status:** accepted

## TBD-265 · Which CVs a role's choice picks from
- **Kind:** decision
- **Where:** MVP 2 · Build (cvs-senders)
- **Context:** The profile_cvs links exist, but a CV uploaded before the intake was confirmed would be linked to no profile. The foundation's intake confirm doesn't link CVs.
- **Options:**
  1. Only the CVs linked to the profile
  2. Every CV of the workspace, and links are written but never read
  3. CVs linked to the profile plus CVs linked to no profile yet; uploads link to every existing profile
- **Chosen:** The third: listCvsForProfile returns the profile's CVs and any CV no profile has yet; an upload links the new CV to every profile of the workspace. A CV is never silently ignored, and the links still mean something when MVP 3 adds several profiles.
- **If you decide otherwise:** Change listCvsForProfile in packages/db/src/queries/cvs.ts and the cv-choice stage; nothing else depends on it.
- **Refs:** F2.3; packages/db/src/queries/cvs.ts listCvsForProfile, linkCvToProfiles; apps/server/src/pipeline/cv-choice.ts
- **Status:** accepted

## TBD-266 · The body's language is detected from common words in a data file
- **Kind:** decision
- **Where:** MVP 2 · Build (cvs-senders)
- **Context:** The sender stage must report the language (TBD-220), and the CV choice and phrase lists depend on it. No AI task or library covers it, and word lists can't live in code.
- **Options:**
  1. A new data file of function words and negations per language (en, de, pt, nl, fr, es, it)
  2. Add a language detection dependency
  3. Use only languages that have phrase lists
- **Chosen:** packages/core/src/sender/data/language-words.json, checked by hand in core. It includes languages without phrase lists, so their mail is named (e.g. 'nl') and its check is incomplete (F5.3). Deterministic, hermetic and no new dependency. On all fixture job mail it detected the language correctly: en, de and pt, and nl for the Dutch mail.
- **If you decide otherwise:** Dutch recruiter mail shows 'Caution (incomplete)' today. Adding nl phrase lists to message-signals.json (and updating its data test) would make it complete.
- **Refs:** TBD-176, TBD-220; packages/core/src/sender/language.ts
- **Status:** accepted

## TBD-267 · Phrases said with a negation don't count
- **Kind:** decision
- **Where:** MVP 2 · Build (cvs-senders)
- **Context:** Every fixture job-board footer says 'never pay a fee or share identity documents', which matched the 'pay a fee' phrase and would have made 70+ job alerts high risk.
- **Options:**
  1. Ignore a phrase when a negation from the data file appears in the five words before it
  2. Remove generic phrases from the lists
  3. Only check recruiter_outreach mail
- **Chosen:** Negation window of five words, with negations per language in language-words.json. It keeps the phrase lists useful and removed every false positive in the fixtures. The two scams still match.
- **If you decide otherwise:** Tune NEGATION_WINDOW or the negation lists in data; core/sender/check.ts firstPhrase.
- **Refs:** F5.1, F5.5; packages/core/src/sender/check.ts
- **Status:** accepted

## TBD-268 · How signals add up to a verdict
- **Kind:** decision
- **Where:** MVP 2 · Build (cvs-senders)
- **Context:** The spec names the signals but not their weight.
- **Options:**
  1. Fee or ID request = high risk; three medium signs (chat only, free mail, sender mismatch, young domain under 180 days, no MX) = high risk; one medium sign or an incomplete check = caution; else looks fine
  2. Any signal = high risk
- **Chosen:** The first. Both F5.5 scams are high risk, the free-mail recruiter is caution, and one weak sign alone doesn't block drafts.
- **If you decide otherwise:** Change STRONG, MEDIUM, MEDIUM_FOR_HIGH_RISK or YOUNG_DOMAIN_DAYS in packages/core/src/sender/check.ts.
- **Refs:** F5.1, F5.2, F5.5
- **Status:** accepted

## TBD-269 · Company signals only for recruiter outreach
- **Kind:** decision
- **Where:** MVP 2 · Build (cvs-senders)
- **Context:** Job alerts and ATS application updates legitimately come from domains that don't match the role's company.
- **Options:**
  1. Free-mail and sender-mismatch signals only for the recruiter_outreach category
  2. For every job category
- **Chosen:** Only for recruiter_outreach, with lenient name-to-domain matching (word prefixes, diacritics stripped; the agency's name counts too). No false mismatches across the fixture recruiters and agencies (Talentbrücke ↔ talentbruecke, Harbour Recruitment ↔ harbour-rec).
- **If you decide otherwise:** Extend RECRUITER_CATEGORIES in packages/core/src/sender/check.ts.
- **Refs:** F5.1
- **Status:** accepted

## TBD-270 · What a mark does to the check
- **Kind:** decision
- **Where:** MVP 2 · Build (cvs-senders)
- **Context:** F5.4 says a mark is kept and named. The spec doesn't say how it combines with the signals or failed lookups.
- **Options:**
  1. Trusted means looks fine and blocked means high risk; complete=true; domain lookups skipped; the signals found are still listed under the mark
  2. The mark only adds a reason
- **Chosen:** The first. An address mark beats a domain mark. The UI marks the address only (no domain marking from the panel, so nobody blocks gmail.com by accident); the API accepts both scopes. Trusting a sender is the user's decision and must lift a caution verdict. Blocking holds back automatic drafts through the existing high-risk policy.
- **If you decide otherwise:** Change checkSender's mark branch in packages/core/src/sender/check.ts, and MarkButtons in apps/web/src/pages/senders/index.tsx for domain marks.
- **Refs:** F5.4, S6
- **Status:** accepted

## TBD-271 · Domain lookup cache lifetimes
- **Kind:** decision
- **Where:** MVP 2 · Build (cvs-senders)
- **Context:** F5 asks for cached lookups; how long they are kept wasn't set.
- **Options:**
  1. RDAP answers 30 days, MX answers 1 day, failures 15 minutes
  2. Never expire
- **Chosen:** 30 days / 1 day / 15 minutes, per workspace in domain_lookups. Free-mail domains and marked senders aren't looked up. A registration date barely changes, MX can. A short failure cache stops a burst of mail from re-asking without pinning a temporary outage.
- **If you decide otherwise:** KEEP_MS and KEEP_FAILURE_MS in apps/server/src/senders/lookup.ts.
- **Refs:** TBD-165, F5.3
- **Status:** accepted

## TBD-272 · Upload validation and read failures
- **Kind:** decision
- **Where:** MVP 2 · Build (cvs-senders)
- **Context:** The spec doesn't say what to do with a scanned PDF without text, a wrong file type, or a failed AI read.
- **Options:**
  1. Refuse without readable text (422) or with another type (415); a failed read leaves the CV marked 'Couldn't read', and uploading it again retries
  2. Accept everything and show empty data
- **Chosen:** The first. The type comes from the file's bytes, not its name. The user sees why at once; a CV with no text could never pass the skill check.
- **If you decide otherwise:** apps/server/src/routes/cvs.ts and cvs/jobs.ts.
- **Refs:** F2.1, F2.2
- **Status:** accepted

## TBD-273 · Tags drive the CV choice; skills stay read-only
- **Kind:** decision
- **Where:** MVP 2 · Build (cvs-senders)
- **Context:** F2.1 shows the AI's suggestions as editable tags; F2.2 keeps skills to what the text contains.
- **Options:**
  1. Tags = language, role families, seniority, format hints (ai) plus the user's; skills listed read-only; tag edits re-evaluate the roles
  2. Make skills editable tags too
- **Chosen:** The first. Removing a role-family tag removes it from the choice, and 'preferred' wins ties. Editing what the choice uses must matter. Editable skills would let a user list a skill the CV doesn't contain.
- **If you decide otherwise:** packages/core/src/cv/skills.ts tagsAfterRead and choice.ts familyVocabulary; the web CvsPage.
- **Refs:** F2.1, F2.2, F2.3
- **Status:** superseded: skills can now be edited, and an added skill must appear in the CV text (TBD-289, 655e706); the preferred CV is a switch, not a tag (TBD-439, 3d8f22a)

## TBD-274 · Guard the fixtures against the scorer by copying the scorer's place rules into the generator now, and leave the real-scorer test for after the merge
- **Kind:** decision
- **Where:** MVP 2 · Build (e2e-fixtures)
- **Context:** The finding asks for a packages/core test that runs matchRole over every fixture role, plus either aligning matching.ts:hardConflicts with the scorer or making that test the only check. matchRole exists only on mvp-2-rules-match, so the test can't be built on this branch.
- **Options:**
  1. Copy the scorer's samePlace, modeAccepted and placeVerdict hard-conflict logic into the generator and pin it with unit tests; add the real-scorer test after the merge
  2. Do nothing here and let the post-merge test be the only check
  3. Bring matchRole's code onto this branch
- **Chosen:** Copy the scorer's place rules into the generator now, with matching.test.ts; the post-merge packages/core test is still needed and listed as not done. With the rules copied, a regenerated fixture can't drift on place rules today, and nothing in packages/ changes on this branch, which keeps the slice's boundary. Bringing rules-match code here would overlap that slice's files.
- **If you decide otherwise:** If the post-merge test becomes the only check, revert the matching.ts part of 7bd6974. Regenerating the fixtures gives the same output either way.
- **Refs:** TBD-210 item 3; e2e/fixtures/build/matching.ts; e2e/fixtures/build/matching.test.ts; mvp-2-rules-match:packages/core/src/match/match.ts
- **Status:** superseded by TBD-319

## TBD-275 · Check the DNS and RDAP wiring in `stack up` from inside app-a, before any mail loads
- **Kind:** decision
- **Where:** MVP 2 · Build (e2e-fixtures)
- **Context:** The fix offers two places for the check: during Validate, or as a smoke step in e2e/stack.ts `up`. The server's DomainPort is still a stub on this base, so the check can't go through the app's code.
- **Options:**
  1. Run `docker compose exec -T app-a node -e <script>` with node:dns Resolver and the app's JOBFILLY_RDAP_URL, before seeding
  2. Check from a separate container
  3. Leave it to Validate only
- **Chosen:** Run the check in app-a, with gmail.com as one of the probe domains, because the fixture zone gives it a different MX from the real one. It uses app-a's own resolver path and RDAP URL, so it proves the replicas' dns setting and http://rdap:8080 work, and it doesn't need cvs-senders. Because the gmail.com check expects the fixture zone's MX, an answer from the internet's DNS fails it. Every later stack run gets this check, not just one Validate.
- **If you decide otherwise:** Remove the wiring step from up() in e2e/stack.ts (WIRING_SCRIPT, WIRING_PROBES, wiringProblems) and its stack.test.ts and seed/main.test.ts cases.
- **Refs:** e2e/stack.ts; e2e/stack.test.ts; e2e/seed/main.test.ts; docker/compose.e2e.yaml
- **Status:** accepted

## TBD-276 · A min-only pay is not the highest amount offered
- **Kind:** decision
- **Where:** MVP 2 · Build (rules-match)
- **Context:** The verifier asked to decide whether 'from €50k' (min set, max null) is the top of what a role pays. Before this change, comparePay used max ?? min, so a min under the user's minimum was a hard 'below your minimum' cap at 40. The inbox already shows a min-only pay as 'from €X' (apps/web/src/pages/inbox/format.ts), and 'Unknown means ask. Never guess' applies.
- **Options:**
  1. Keep min as the top (hard cap when min < minimum)
  2. Treat a min-only pay as open-ended: below only when known; min under the minimum is unknown, min at or over it meets it
- **Chosen:** Treat a min-only pay as open-ended. Under the threshold it is unknown ('highest pay not stated', no need or decision created); at or over it, it meets the minimum. This applies to the match verdict and the rules engine's 'below' condition. A max-only pay ('up to') still counts as the top. One existing engine test asserted the old behaviour ('Only a minimum stated: it is the top of what is offered' → holds). I changed its expectation to the new behaviour and added more cases; I deleted or skipped no tests. Treating 'from €50k' as at most €50k invents a conflict the mail doesn't state, which is the kind of guess the hard rules forbid. This direction can only make a role less capped, never wrongly fit, because an unknown pays only partial credit.
- **If you decide otherwise:** If extraction writes a single stated amount (e.g. '€60k a year') as min-only rather than min == max, such roles under the minimum become unknown instead of hard-capped. The fix would then be in the extract.v1 prompt (single amount → min = max), or a return to max ?? min.
- **Refs:** packages/core/src/rules/engine.ts comparePay; packages/core/src/match/match.ts payVerdict; packages/core/src/rules/engine.test.ts; packages/core/src/match/match.test.ts 'never takes a minimum alone for the most a role pays'
- **Status:** accepted

## TBD-277 · Parenthesised text in a skill is treated as an alias on either side
- **Kind:** decision
- **Where:** MVP 2 · Build (rules-match)
- **Context:** The fix allows 'equal to the CV skill plus a parenthesised alias such as Go (Golang)'. I had to decide whether the text inside the parentheses can match on its own (CV 'Golang' against role 'Go (Golang)'), and whether a parenthesised CV skill matches the plain role skill.
- **Options:**
  1. Compare the whole skill and the skill with its parentheses removed, on both sides
  2. Also let the text inside the parentheses match on its own
- **Chosen:** Compare the whole bare skill and the bare skill without its parenthesised part, on both sides. 'Go' and 'Go (Golang)' match each other, and 'Kubernetes (K8s)' matches 'Kubernetes'. CV 'Golang' or 'K8s' does not match on the alias alone. This is the conservative reading. Text inside parentheses can be a qualifier rather than an alias ('Cloud (AWS)'). A missed match is only reported as missing, and match.v1 closeness still explains it; a false match would break F4.4.
- **If you decide otherwise:** Allowing alias-only matches would mark more skills as matched, at the risk of qualifier false positives.
- **Refs:** packages/core/src/match/match.ts sameSkill/withoutAlias; packages/core/src/match/match.test.ts 'matches the same skill with other spacing, punctuation or a parenthesised alias'
- **Status:** accepted

## TBD-278 · Where the drafts' From address enters packages/mail
- **Kind:** decision
- **Where:** MVP 2 · Build (mailbox)
- **Context:** The foundation pinned DraftMimeInput.from as a required Address, but the slice guessed it from the IMAP user name. The verifier allowed a field on MailConnection, on MailClientOptions or on DraftMailInput. The replies slice already edits DraftMailInput (it adds draftMessageId) and builds draft inputs, but adds no new connect() calls.
- **Options:**
  1. Required `address` on MailClientOptions (packages/mail), supplied by every MailPort.connect caller
  2. Optional `address` on MailConnectionSchema in packages/schema
  3. Required `from` on DraftMailInput, supplied by draft.create
- **Chosen:** Required `address` on MailClientOptions. Every caller that connects already has the stored mailbox, so From stays required with no guessing. Putting it on DraftMailInput would collide with the replies slice's edits there and push mailbox knowledge into draft.create. Putting it on MailConnection would change every connection fixture across the slices. Making it required means the compiler flags any new caller that leaves it out.
- **If you decide otherwise:** If it lived on DraftMailInput, the replies slice's draft.create would have to look up and pass the mailbox address on every save and replace. If it were optional anywhere, drafts without a From could come back.
- **Refs:** packages/mail/src/client.ts (MailClientOptions, mailClientWith), packages/mail/src/drafts/index.ts, apps/server/src/deps.ts, docs/ARCHITECTURE.md › The analysis pipeline
- **Status:** accepted

## TBD-279 · Storing the sync failure reason by editing the unreleased 0001_mvp2 migration
- **Kind:** decision
- **Where:** MVP 2 · Build (mailbox)
- **Context:** The reason code has to be stored next to last_error. ARCHITECTURE says 'One migration per release step', and MVP 2 is not released. No other MVP 2 slice touches the migrations.
- **Options:**
  1. Add the column to 0001_mvp2.sql and its snapshot
  2. Add a new 0002 migration
  3. Store the code in last_error and derive the words in the server
- **Chosen:** Add `last_error_reason` with a CHECK constraint to 0001_mvp2.sql and 0001_snapshot.json (the SQL comes from drizzle-kit generate and was folded in; a second generate reports no changes). This keeps one migration for the MVP 2 release step, as ARCHITECTURE asks. It needs no journal entry that could conflict with other slices. It keeps last_error as plain words.
- **If you decide otherwise:** A local dev database that already applied the old 0001 will not get the column (drizzle does not re-run an applied migration), and sync failures would then error there until the database is recreated. Test and e2e databases are always fresh. If that matters, the column moves to a 0002 migration instead.
- **Refs:** packages/db/migrations/0001_mvp2.sql, packages/db/migrations/meta/0001_snapshot.json, packages/db/src/tables.ts (mailboxSync)
- **Status:** accepted

## TBD-280 · How a Draft a reply question is told apart from an automatic draft's
- **Kind:** decision
- **Where:** MVP 2 · Build (replies)
- **Context:** F7.1/F6.1: the reply stage could not tell an on_demand claim's questions from an automatic claim's, because both were stored with source 'draft'.
- **Options:**
  1. A new source value 'draft_on_demand' in DecisionNeedSchema and in the decision_messages check constraint
  2. A separate origin column on decision_messages
  3. Infer it from the draft row (not possible: the claim's row is deleted when its questions are recorded)
- **Chosen:** A new source value 'draft_on_demand'. The 0001_mvp2 migration's check constraint is edited in place, and recordNeeds with reopen also changes an already-waiting row to the new source. It is the smallest change. Source already describes what raised a need, and reopen's ON CONFLICT already carries the source over, so no extra column has to be kept in step. MVP 2 is unreleased, so editing 0001 in place follows TBD-224 and avoids a 0002 that other slices could collide with.
- **If you decide otherwise:** An origin column would need a migration column, NeedGroupInput and RoleDecision fields, and an update in recordNeeds. The reply stage's filters (fromDraft, fromDraftAReply) would read that column instead of source.
- **Refs:** packages/schema/src/decisions.ts, packages/db/src/tables.ts, packages/db/migrations/0001_mvp2.sql, packages/db/src/queries/decisions.ts, apps/server/src/pipeline/reply.ts, apps/server/src/drafts/write.ts; commits 98e726a, 3e32891, 3cba5cb
- **Status:** accepted

## TBD-281 · Where the one draft Message-ID generator lives
- **Kind:** decision
- **Where:** MVP 2 · Build (replies)
- **Context:** The verifier found two generators: the server's newDraftMessageId and the private draftMessageId(from) in the mailbox slice's client. The real client also ignores input.draftMessageId, so retries can leave two copies.
- **Options:**
  1. Export it from packages/mail; the server calls it and append uses input.draftMessageId ?? the export
  2. Keep it in the server only and make draftMessageId required in DraftMailInput, so packages/mail never generates one
  3. Keep both
- **Chosen:** packages/mail exports newDraftMessageId(address). The server's draftMessageIdFor(deps, ws) calls it with the mailbox address. The MailClient.saveDraft and replaceDraft contract says the copy gets input.draftMessageId when it is set. A Message-ID header is mail-format knowledge, and the mailbox slice already generates one for replaceDraft, which the server calls without an ID. Exporting keeps one implementation for both paths, and integration only has to swap the mailbox slice's private function for the export and honour input.draftMessageId.
- **If you decide otherwise:** If the generator lives in the server only: make DraftMailInput.draftMessageId required, have edit.ts pass a new ID to replaceDraft, delete packages/mail/src/message-id.ts, and have the mailbox slice's append use input.draftMessageId directly.
- **Refs:** packages/mail/src/message-id.ts, packages/mail/src/client.ts (MailClient doc), apps/server/src/drafts/mailbox.ts; commit bc39d12. Needs a TBD entry, open item: the mvp-2-mailbox append must adopt it at integration.
- **Status:** superseded: the server makes the draft Message-ID itself (apps/server/src/drafts/mailbox.ts, 8d1ec8c) and packages/mail keeps the caller's (fbffbbb); packages/mail exports no generator

## TBD-282 · A losing run's copy with an unknown UID is left in place and logged
- **Kind:** decision
- **Where:** MVP 2 · Build (replies)
- **Context:** Two runs of one claim share the kept Message-ID. On a server without UIDPLUS the losing run's ref has UIDVALIDITY 0, so deleting it by Message-ID would also remove the winner's copy.
- **Options:**
  1. Skip the delete when the ref has UIDVALIDITY 0 and log draft.copy_left
  2. Give each attempt its own Message-ID and delete the previous one explicitly
- **Chosen:** Skip the delete and log draft.copy_left (warn, draftId and reason uid_unknown). A failed delete logs reason delete_failed, in write.ts and edit.ts. Losing the winner's copy is worse than a possible extra copy that is logged. Usually there is no extra copy anyway, because the winner's retry already deleted copies with that Message-ID before its own append. Per-attempt IDs would change how prepare() keeps text and IDs together, which is more than this fix needs.
- **If you decide otherwise:** Per-attempt Message-IDs would need saveDraftText or the retry path to rotate the ID and delete the old ID's copies before appending, and draft rows would have to record the previous ID.
- **Refs:** apps/server/src/drafts/write.ts, apps/server/src/drafts/edit.ts, apps/server/src/drafts/mailbox.ts (knowsUid), apps/server/src/log.ts; commit 3cba5cb
- **Status:** accepted

## TBD-283 · How the fixed-term hide rule names fixed-term contracts
- **Kind:** decision
- **Where:** MVP 2 · Build (e2e-fixtures)
- **Context:** The expected change for 'Zeig mir keine befristeten Stellen mehr' used `contains ["befristet", "fixed-term"]`. "unbefristet" also contains "befristet", so the rule hid permanent roles.
- **Options:**
  1. contains ["befristet auf", "fixed-term", "tijdelijk", "a termo"]
  2. in with the fixture's exact fixed-term values
- **Chosen:** contains ["befristet auf", "fixed-term", "tijdelijk", "a termo"]. It covers all four fixed-term phrasings in Maria's mail in DE, EN, NL and PT, and it matches none of the permanent values. It still reads like a rule a model would propose, not a list copied from the fixtures.
- **If you decide otherwise:** An `in` list of the exact values would break as soon as a fixture writes a fixed-term contract slightly differently.
- **Refs:** e2e/fixtures/build/assistant.ts; e2e/fixtures/consistency.test.ts 'hide by contract no role on a permanent contract'
- **Status:** accepted

## TBD-284 · Basel's CHF range raised to 115,000–135,000
- **Kind:** decision
- **Where:** MVP 2 · Build (e2e-fixtures)
- **Context:** The CHF decision suggests the pay min and max of the role that opens it. If Zurich opened it, its 135k suggestion was above Basel's 130k top, which put Basel in a hard conflict and failed S5.
- **Options:**
  1. Raise Basel's top to 135,000
  2. Lower Zurich's top to 130,000
- **Chosen:** Raise Basel's top to 135,000. This was the fix the verifier suggested. It changes only one role, and zurich-2's 140k top already covers both. The Basel mail body was updated to match.
- **If you decide otherwise:** Lowering Zurich instead would also work, but it changes the Zurich mail, which S5's text quotes.
- **Refs:** e2e/fixtures/build/deliveries.ts basel; consistency.test.ts 'keeps every CHF amount the decision can suggest'
- **Status:** accepted

## TBD-285 · How the sync counts failures before letting go of a waiting message
- **Kind:** decision
- **Where:** MVP 2 · Build (mailbox)
- **Context:** F1.1 fix: let go of a waiting message only after N failed sync attempts, counted per message, not after one failure.
- **Options:**
  1. An attempts column on messages (messages.sync_analysis_failures), incremented for each sync that tried the message and failed
  2. A time-since-first-stored check on messages.created_at
  3. A per-message failure map kept in jsonb on mailbox_sync
- **Chosen:** An attempts column on messages, added to the unreleased 0001_mvp2 migration, with countSyncAnalysisFailures in packages/db. It counts real attempts rather than wall-clock time, so a sync that resumes after a long mailbox outage doesn't let mail go after a single extra failure. created_at uses the database clock, not the injected clock, so a time check would also be hard to test hermetically. It also follows how the slice already extends the unreleased migration (7bdf7f0).
- **If you decide otherwise:** A time-based check would let mail go after a fixed period no matter how many tries were made. A jsonb map would keep messages untouched but holds per-message state in a less usual place.
- **Refs:** apps/server/src/sync/run.ts (MAX_SYNC_ANALYSIS_FAILURES, countSyncAnalysisFailures call); packages/db/src/queries/sync.ts; packages/db/migrations/0001_mvp2.sql
- **Status:** accepted

## TBD-286 · How many failed tries before the sync lets go, and what counts as a try
- **Kind:** decision
- **Where:** MVP 2 · Build (mailbox)
- **Context:** The finding left N open. A sync where the provider fails on a message, or where no AI is set up, leaves it 'pending'. A message the run's budget never reached was not tried at all.
- **Options:**
  1. N = 5 (about 10 minutes at the default 120 s interval)
  2. N = 30 (about 1 hour at the default interval)
  3. Do not count the no-AI case
- **Chosen:** N = 30. A try is a sync that asked the model about the message (its batch reached analyzeBatch), or a sync that found no AI set up. Messages the budget or a stop left untouched are not counted. Users notice when mail is let go: it then needs 'Analyze them'. A provider outage of up to about an hour should not cause that, and a message the provider always fails on costs only about 30 extra calls. The no-AI case is counted so the cursor can't stay stuck forever and re-read a growing tail of mail.
- **If you decide otherwise:** A smaller N lets mail go after shorter provider outages. If no-AI were not counted, the cursor would hold until AI is configured again, re-reading every envelope after it on every sync.
- **Refs:** apps/server/src/sync/run.ts (analyze() 'tried', MAX_SYNC_ANALYSIS_FAILURES)
- **Status:** accepted

## TBD-287 · Carry the arrival time on fetchSince's messages rather than on every Envelope
- **Kind:** decision
- **Where:** MVP 2 · Build (mailbox)
- **Context:** The window filter needs arrival time (INTERNALDATE) for messages that are not stored yet. Envelope.date is the header date with an INTERNALDATE fallback.
- **Options:**
  1. Add SyncedEnvelopeSchema = Envelope + receivedAt, used only in FetchSinceResult
  2. Add receivedAt to EnvelopeSchema everywhere and store it
- **Chosen:** SyncedEnvelopeSchema, used only by FetchSinceResult (its own schema commit). Only the sync needs it, and the first scan already filters by INTERNALDATE inside packages/mail. Changing Envelope would touch every fixture and every stored-message path in other workstreams.
- **If you decide otherwise:** If other features later need arrival time on stored messages, receivedAt would have to move onto Envelope and get a column.
- **Refs:** packages/schema/src/mailbox.ts; packages/mail/src/client.ts envelopesOf
- **Status:** accepted

## TBD-288 · The language suggested as a CV tag is its ISO code, and format hints are no longer tags
- **Kind:** decision
- **Where:** MVP 2 · Build (cvs-senders)
- **Context:** F2.1 says the AI-suggested language, skills, role families, seniority and format hints are shown as editable tags. The fixtures' expected.json cvs[].tags is ["en","Backend engineering","Senior"], and S1 says the suggested tags are language, role family and seniority.
- **Options:**
  1. Tags = language code, role families, seniority; skills and format hints are their own editable tag lists
  2. Keep language names and format hints as tags and ask the fixtures slice to change expected.json
  3. Put everything, skills included, into the one tags list
- **Chosen:** Tags = [language ISO code, role families, seniority]. Skills and format hints are separate editable tag fields (CvUpdateSchema.skills / .formatHints). It matches expected.json and S1 without touching the fixtures, and it still meets F2.1: everything the AI suggests appears as an editable tag. Keeping skills separate is what lets the server check an added skill against the CV text (F2.2).
- **If you decide otherwise:** Change tagsAfterRead in packages/core/src/cv/skills.ts and regenerate the fixtures' cvTags. Users would see 'English' rather than 'en'.
- **Refs:** F2.1, F2.2, S1; packages/core/src/cv/skills.ts tagsAfterRead; packages/schema/src/cv.ts CvUpdateSchema; e2e/fixtures/build/cvs.ts cvTags (mvp-2-e2e-fixtures)
- **Status:** accepted

## TBD-289 · An added skill must appear in the CV text; it is never stored with source 'you'
- **Kind:** decision
- **Where:** MVP 2 · Build (cvs-senders)
- **Context:** The fix allowed either checking an added skill against the CV text (F2.2) or recording it with source 'you'.
- **Options:**
  1. Refuse a skill the CV text doesn't contain (422 skill_not_in_cv)
  2. Store user-added skills with a source and skip the check
- **Chosen:** Refuse it with 422 and a plain message. Removing a skill is always allowed. F2.2 says a skill is listed only if it appears in the CV text, and the match must never invent skills. Skills stay a plain string[], so no schema shape breaks for the match and replies slices.
- **If you decide otherwise:** Turn skills into {label, source} in CvSchema and in every consumer (the match stage, draft.v1 input).
- **Refs:** F2.2; apps/server/src/routes/cvs.ts PATCH /:cvId
- **Status:** accepted

## TBD-290 · CV choice weights: a fully named role family outweighs language; preferred outweighs one extra matching skill
- **Kind:** decision
- **Where:** MVP 2 · Build (cvs-senders)
- **Context:** German alerts and generic English roles went to the wrong CV. The fixtures' rule is: the title says data engineer → Data CV; otherwise the language decides between DE and EN backend.
- **Options:**
  1. A full family match counts 5, one shared word counts 1, language 4, preferred 2, skills up to 3, seniority 1
  2. Keep any shared word as a full family match
  3. Ignore skills entirely
- **Chosen:** The first option, with lenient word forms: at least 5 letters in common and at most 4 letters after them (engineer/engineering, entwickler/entwicklerin, not data/database). Fixture agreement went from 85.5% to 98.4% without a preferred tag, and to 100% with Backend (EN) tagged preferred as in S1. One generic word such as 'data' no longer makes a data engineering role. Skills still decide when nothing else does.
- **If you decide otherwise:** Adjust WEIGHT in packages/core/src/cv/choice.ts. Without the preferred tag, the four generic engineer roles that list Python stay on the Data CV.
- **Refs:** F2.3; packages/core/src/cv/choice.ts; packages/core/src/cv/cv.test.ts
- **Status:** accepted

## TBD-291 · A failed domain lookup is retried through the sweep, waiting twice as long after each repeat
- **Kind:** decision
- **Where:** MVP 2 · Build (cvs-senders)
- **Context:** An incomplete check (lookup_failed) was never redone. A registry without RDAP (rdap.org answers 404) fails every time, and a flat 15-minute retry would fetch the message body from IMAP every 15 minutes for that sender's mail.
- **Options:**
  1. The sweep marks stale every lookup_failed check whose sender domain has no unexpired failure in domain_lookups; repeated failures are cached 15 min, doubling up to 24 h
  2. Retry every lookup_failed check every 15 minutes
  3. Retry only while the message is recent
- **Chosen:** The first option: listWorkspacesWithFailedLookups (a cross-workspace read, like listWorkspacesWithWork) and markFailedLookupChecksStale (workspace-scoped), with lastLookupFailure driving the backoff. A transient RDAP or DNS failure is fixed within one sync interval after 15 minutes, and a domain that always fails costs at most one body fetch a day per message. F5.3 still holds: an incomplete check never shows as looks fine.
- **If you decide otherwise:** Change KEEP_FAILURE_MS and MAX_KEEP_FAILURE_MS in apps/server/src/senders/lookup.ts, or the retryableCheck condition in packages/db/src/queries/senders.ts.
- **Refs:** F5.3; apps/server/src/senders/retry.ts, lookup.ts; apps/server/src/pipeline/sweep.ts; packages/db/src/queries/senders.ts; docs/ARCHITECTURE.md
- **Status:** accepted

## TBD-292 · Dutch phrase lists added to message-signals.json
- **Kind:** decision
- **Where:** MVP 2 · Build (cvs-senders)
- **Context:** With the new language detection, 10 Dutch alerts (nationalevacaturebank.nl, recruitee) that used to be detected as English because of their footers are now 'nl'. Dutch had no phrase lists (TBD-176), so their checks would turn incomplete/caution, while expected.json says looks_fine for all 34 Dutch messages. 24 of those already disagreed before this change.
- **Options:**
  1. Add Dutch phrases for asks_for_fee, asks_for_id and chat_only (data only)
  2. Leave Dutch checks incomplete and accept lower sender-verdict agreement
  3. Use the whole-body language for the sender check and the opening language for the CV choice
- **Chosen:** I added Dutch lists. French, Spanish and Italian still have none, so their checks stay incomplete as TBD-176 says. I moved the core 'language without phrase lists' test from Dutch to French. The language detected for the CV choice is now correct, the sender-verdict agreement doesn't fall (34 Dutch checks can now be complete), and phrase lists are data, which is allowed for market-specific vocabulary. None of the new phrases appears anywhere in the fixtures' mail.
- **If you decide otherwise:** Remove 'nl' from packages/core/src/sender/data/message-signals.json. All 34 Dutch messages would then be caution/incomplete in the quality run.
- **Refs:** F5.1, F5.3, TBD-176/TBD-200; packages/core/src/sender/data/message-signals.json; packages/core/src/sender/check.test.ts
- **Status:** accepted

## TBD-293 · When an ID request in an "offer" is still a warning sign
- **Kind:** decision
- **Where:** MVP 2 · Build (cvs-senders)
- **Context:** F5.5 needs the scam posing as a job offer to list both the fee and the passport reasons, and asking for ID documents within a genuine offer is normal. The category comes from the model, so it can't be the only thing that switches off the ID signal.
- **Options:**
  1. Keep asks_for_id in an offer when any other strong or medium sign is present
  2. Exempt it only for a reply in a thread the user started, or when the sender's domain matches the company
  3. Never exempt an ID request in an offer
- **Chosen:** Keep asks_for_id in an offer when any other strong or medium sign is present (fee, chat-only, free-mail, sender mismatch, young domain, no MX); drop it otherwise. It fixes the F5.5 case without new inputs to checkSender, and a genuine offer with no other warning sign still looks fine, so today's fixtures gain no false positives. The thread-origin option would need new data passed into core. Never exempting would flag genuine offers as high risk.
- **If you decide otherwise:** A scam offer whose only warning sign is a passport request (old domain, company domain, no fee) still looks fine when the model calls it an offer. Company signals (free-mail, mismatch) still fire only for recruiter_outreach, so they don't help an "offer". Closing that gap means also running company signals for offers, or using the thread-origin rule.
- **Refs:** packages/core/src/sender/check.ts (withoutOfferIdRequest), packages/core/src/sender/check.test.ts
- **Status:** accepted

## TBD-294 · Build the assistant slice on top of the unmerged rules-match branch
- **Kind:** decision
- **Where:** MVP 2 · Build (assistant)
- **Context:** The slice depends on rules-match: the test plan requires the impact preview to run the real rules engine and scoring. But mvp-2 still has only the foundation's empty packages/core rules and match stubs. mvp-2-rules-match (19 commits, verified in build level 1 per the TBD records) was never merged into mvp-2, and the workflow told this slice to branch from mvp-2.
- **Options:**
  1. Merge mvp-2-rules-match into mvp-2-assistant with --no-ff and build on its exports
  2. Inject the engine and scorer into the preview as parameters and test with a stand-in engine
  3. Wait for integration
- **Chosen:** Merged mvp-2-rules-match into mvp-2-assistant (commit 2575ca8) and used its matchRole and describeRule exports. A preview built against a stand-in engine would prove nothing (TBD-159/187). The merge is clean, and the integrator's later merge of both branches shares the same commits, so it can't conflict. The unattended build can't wait.
- **If you decide otherwise:** If rules-match fails final verification or is rebased, this branch carries its commits. The integrator would have to merge rules-match first, or revert 2575ca8 and replace the preview's matchRole calls.
- **Refs:** mvp-2-rules-match; packages/core/src/assistant/preview.ts; TBD-159, TBD-187
- **Status:** accepted

## TBD-295 · Proposal cards and history items carry their plain words over the API
- **Kind:** decision
- **Where:** MVP 2 · Build (assistant)
- **Context:** F8.2 and F8.4 need before and after in plain words. apps/web may import only packages/schema, not packages/core, and ProposalSchema and ProfileHistoryEntrySchema had only raw snapshots.
- **Options:**
  1. Add lines (ChangeLine[]) to Proposal and a ProfileHistoryItem with byName and lines, computed by the server from the snapshots
  2. Word the snapshots again in the web
  3. Store the words in new columns
- **Chosen:** The schema gains ChangeLineSchema, Proposal.lines and ProfileHistoryItemSchema; the server words them with packages/core's changeLines when it reads them. No database change. One wording, shared with the rules engine's describeRule. The web stays thin, and the words are never stale because they are computed from the stored snapshots.
- **If you decide otherwise:** The web would need its own copy of the value and rule wording, which could drift from the engine's.
- **Refs:** packages/schema/src/assistant.ts; packages/core/src/assistant/words.ts; apps/server/src/assistant/service.ts toProposal; apps/server/src/assistant/history.ts
- **Status:** accepted

## TBD-296 · Assistant threads and proposals are private to their member
- **Kind:** decision
- **Where:** MVP 2 · Build (assistant)
- **Context:** assistant_threads has a user_id. The spec doesn't say whether one member can see, apply or discard another member's proposal.
- **Options:**
  1. Each member reads and acts only on their own thread and proposals (another's is 404)
  2. Any editor can apply any proposal in the workspace
- **Chosen:** Every thread and proposal read is scoped to the member. Another member's proposal answers 404 to apply, edit and discard, so an editor can't apply a proposal a viewer made. A conversation is personal, and nothing in the UI shows another member's thread, so acting on one would be acting blind. Viewers still chat (F8.8) and editors make their own requests.
- **If you decide otherwise:** Add a workspace-wide proposals list and drop the userId check in ownProposal.
- **Refs:** apps/server/src/assistant/service.ts ownProposal; packages/db/src/queries/assistant.ts getThread
- **Status:** accepted

## TBD-297 · Undo is itself a change by hand, recorded in the history
- **Kind:** decision
- **Where:** MVP 2 · Build (assistant)
- **Context:** applyProfileChanges writes a history row for every change. Undo restores an entry's before through the profile change service.
- **Options:**
  1. Undo applies restoreChanges with source 'you', request null, so the restore is a new history row and the undone entry gets undoneAt
  2. Restore without a history row (would need changes to packages/db)
- **Chosen:** The first option. A rule restored by undoing its removal comes back with a new id and source 'you'. It keeps one write path for every change (ARCHITECTURE) and a complete history of who changed what; the original entry shows 'Undone'.
- **If you decide otherwise:** applyProfileChanges would need a flag to skip the history row, and restoreChanges would need to keep a re-added rule's id and source.
- **Refs:** apps/server/src/assistant/history.ts; packages/core/src/profile/changes.ts restoreChanges
- **Status:** superseded: Undo is still a recorded change by you, but a removed rule comes back with its own id, source and creation date, not as a new rule (94becd6, b11d1e7)

## TBD-298 · The preview never calls the model, even when the change alters what match.v1 would see
- **Kind:** decision
- **Where:** MVP 2 · Build (assistant)
- **Context:** A change to target_roles or extra.skills changes the match.v1 input hash, so no stored answer exists for the 'after' side.
- **Options:**
  1. Use the role's stored answer (the one for its current input, else its latest) for both before and after
  2. Call match.v1 during the preview
  3. Leave such roles out of the preview
- **Chosen:** The stored answer is used on both sides. The title-fit and skill-closeness parts stay as they were, and the re-evaluation after Apply asks the model. ARCHITECTURE and the test plan require that the preview never calls the model. Using the same answer on both sides keeps differences down to the change itself.
- **If you decide otherwise:** Previews of target-role or skill changes would cost a model call per role and wait on the provider.
- **Refs:** packages/core/src/assistant/preview.ts; apps/server/src/assistant/preview.ts storedAnswer
- **Status:** accepted

## TBD-299 · Which drafts count as 'already in your mailbox'
- **Kind:** decision
- **Where:** MVP 2 · Build (assistant)
- **Context:** F8.5's count of drafts that stay in the mailbox. Draft rows can be saving, in_mailbox, edited, failed or discarded.
- **Options:**
  1. Live drafts in status in_mailbox or edited, among the roles the change affects
  2. Also count saving
  3. Count every live draft of the workspace
- **Chosen:** in_mailbox or edited, and only for roles whose outcome the change affects (hidden or shown, score, rule effects or eligibility). S8 expects '1 draft' for the one Asia-Pacific role with a draft. A saving draft isn't in the mailbox yet and may fail.
- **If you decide otherwise:** Change IN_MAILBOX or the affected test in previewImpact.
- **Refs:** packages/core/src/assistant/preview.ts IN_MAILBOX
- **Status:** accepted

## TBD-300 · Wording of refused proposals and edited summaries
- **Kind:** decision
- **Where:** MVP 2 · Build (assistant)
- **Context:** When the model's proposal is outside rules and entries or doesn't apply, or the user edits a card, the server adds its own words.
- **Options:**
  1. Keep the model's reply (in the user's language) and add one English sentence saying why nothing was proposed; after an edit the summary becomes the app's plain-word summary of the changes
  2. Replace the reply entirely
  3. Ask the model again
- **Chosen:** The first option. When the model gives a clarifying question and a proposal together, the question is kept and the proposal dropped (F8.6: no guess). The user keeps the model's reply, which is in their own language. The app's added sentence is consistent and truthful, and needs no second model call.
- **If you decide otherwise:** Localising the added sentences would need a second model call or translation strings.
- **Refs:** apps/server/src/assistant/service.ts sendMessage, editProposal; packages/core/src/assistant/words.ts changeSummary
- **Status:** accepted

## TBD-301 · Where an out-of-scope assistant proposal is refused
- **Kind:** decision
- **Where:** MVP 2 · Build (assistant)
- **Context:** packages/ai checked assistant.v1 answers with the strict AssistantOutputSchema. A proposal that changed a mailbox therefore became invalid_output and a 502, so the user never heard that the assistant can't do it, which F8.7 requires. The server's outsideOnly fallback could never run.
- **Options:**
  1. (a) packages/ai checks against a looser schema from packages/schema; the server refuses the proposal and keeps the reply
  2. (b) Delete the server fallback and accept the 502
- **Chosen:** (a), with a precise loose schema. Only a change whose target is neither rule nor entry is let through. A malformed rule or entry change still fails the check, gets one retry, then returns 502. The provider is still asked for the strict schema. F8.7 says that when asked, the assistant says it can't. A 502 'couldn't answer' does not do that. Keeping the strict schema as what the provider is asked for keeps the model guidance and the wire golden files unchanged. Keeping malformed in-scope changes as invalid answers keeps the retry, which might produce a valid proposal, instead of refusing them with misleading words.
- **If you decide otherwise:** With (b), a model that tries to change a mailbox would give the user a generic 502 and nothing would be stored. With a fully loose proposal (z.unknown()), malformed rule changes would no longer be retried and would be refused as 'outside rules and entries'.
- **Refs:** packages/schema/src/ai-output.ts (AssistantAnswerSchema), packages/ai/src/client.ts (assistant task, single's `sent` param), apps/server/src/assistant/service.ts (sendMessage)
- **Status:** superseded: the provider is now asked for AssistantRequestSchema, the entry changes as one shape to stay within 16 union types (15392e9, fda975e); the loose answer check that lets out-of-scope changes through stands

## TBD-302 · Fixing the assistant data-access boundary in the docs rather than in the queries
- **Kind:** decision
- **Where:** MVP 2 · Build (assistant)
- **Context:** ARCHITECTURE and the db module comment said every assistant read takes the user id, but getProposal, listThreadProposals, listThreadMessages and nextTurn take only (workspaceId, id).
- **Options:**
  1. Add a userId parameter to the four queries and filter by assistant_threads.user_id
  2. Correct the docs: only the thread lookups take the user id, and the server checks ownership (thread lookup / ownProposal)
- **Chosen:** Correct the docs and the module comment. The server already enforces ownership on every path (getThread with the user id, ownProposal). The verifier offered either fix, and correcting the docs makes them match the boundary without changing four query signatures and their tests in a fix round.
- **If you decide otherwise:** Adding userId to the queries would give defence in depth at the db layer, at the cost of changing the query signatures, the db tests and service.ts call sites.
- **Refs:** docs/ARCHITECTURE.md (The assistant), packages/db/src/queries/assistant.ts header
- **Status:** accepted

## TBD-303 · How the server test marks a draft as in the mailbox without a db helper
- **Kind:** decision
- **Where:** MVP 2 · Build (assistant)
- **Context:** This branch has no packages/db function that moves a draft to in_mailbox; the replies slice adds markDraftSaved in packages/db/src/queries/drafts.ts, which is empty here. The drafts table and drizzle's sql tag are not exported to apps/server.
- **Options:**
  1. Add a markDraftSaved-like helper to packages/db on this branch
  2. Run one raw UPDATE through deps.db.execute(string) in the test
  3. Change PreviewRole input in the test only
- **Chosen:** One raw UPDATE in a markInMailbox test helper, limited to the workspace id and to rows in status saving. The finding allows a direct update through deps.db. Adding a db function here would clash with the replies slice's markDraftSaved when the slices are merged. The test still goes through the real listRoleStates and the server preview.
- **If you decide otherwise:** After merging with the replies slice, the integrator can swap markInMailbox for markDraftSaved.
- **Refs:** apps/server/src/routes/assistant.test.ts (markInMailbox, seedInbox)
- **Status:** superseded by TBD-437

## TBD-304 · Keep the assistant.v1 instruction text byte-identical instead of regenerating the wire fixtures
- **Kind:** decision
- **Where:** MVP 2 · Build (assistant)
- **Context:** The finding asked to build the vocabulary from the schema and regenerate e2e/fixtures/wire/assistant.v1.*.json.
- **Options:**
  1. Reword the instruction and regenerate the fixtures
  2. Build the vocabulary so it produces exactly the current words
- **Chosen:** Generate the same words: neighbouring ops with the same value text are grouped, which matches the current RULE_OPS order. The model sees the same prompt, so the stored fixtures and fake AI answers stay valid. A new fact, op or action now changes the prompt automatically, and wire-client.test.ts will flag that the fixtures need regenerating.
- **If you decide otherwise:** Rewording would mean regenerating the request fixtures, and the e2e answers might need checking too.
- **Refs:** packages/ai/src/tasks/assistant.ts
- **Status:** accepted

## TBD-305 · Create the MVP 1 state through the UI before walking S1
- **Kind:** decision
- **Where:** MVP 2 · Validate (S1)
- **Context:** MVP 2 relies on the profile Maria confirmed in MVP 1, but this stack had no accounts (no auth.registered in app.log). Only the MVP 1 stack smoke specs had run, and they create no persona state.
- **Options:**
  1. Report S1 as blocked without touching the stack
  2. Replay the MVP 1 setup steps (register, mailbox, AI, scan, intake confirm; Tom registers) through the UI, then walk S1
- **Chosen:** Replay the MVP 1 setup through the UI, without probes or screenshots for those steps. S1 needs Maria's workspace and profile ('the profile page lists all three'), and Tom's own workspace for the probe. Walking the setup like a person keeps the protocol (no API or database seeding) and leaves the state later scenarios expect.
- **If you decide otherwise:** The next walker or spec run must create Maria's and Tom's accounts itself, or the orchestrator must run MVP 1's walkthrough first on a fresh stack.
- **Refs:** docs/mvp/README.md (One run plays the scenarios of every MVP up to the current one); docs/mvp/MVP-1.md S1–S4, S6
- **Status:** superseded by TBD-394

## TBD-306 · Run the cross-workspace probe with a made-up CV id
- **Kind:** decision
- **Where:** MVP 2 · Validate (S1)
- **Context:** The probe 'Maria's session downloading Tom's CV -> 404' needs one of Tom's CVs, and none can exist because uploads aren't implemented.
- **Options:**
  1. Skip the probe
  2. Probe Tom's workspace CV file route and list route with Maria's own curl session and a made-up CV id
- **Chosen:** Probe with a made-up id, and record it only as partial evidence. It still shows the membership guard answers 404 before any CV lookup. That is the workspace-scoping half of the check, and it's cheap.
- **If you decide otherwise:** Rerun the probe with a real Tom CV id once uploads work. It must still be 404.
- **Refs:** S1 probe; curl results: GET /api/workspaces/aa110be0-…/cvs/00000000-0000-4000-8000-000000000000/file -> 404 {"error":"not_found"}, GET /api/workspaces/aa110be0-…/cvs -> 404
- **Status:** superseded by TBD-353

## TBD-307 · Report S2 as failed instead of delivering mail another way
- **Kind:** decision
- **Where:** MVP 2 · Validate (S2)
- **Context:** The scenario's only allowed infrastructure step, `seed deliver`, does not exist on this stack, and the protocol forbids API calls or database writes during the walkthrough.
- **Options:**
  1. Fail S2 and report the missing integration as a blocker
  2. Append the fixture messages over IMAP myself with a one-off script
  3. Rebuild the stack from the slice branches
- **Chosen:** Fail S2 and report the missing integration as a blocker. The protocol allows only the infrastructure steps a scenario lists. A home-made delivery script would not prove anything, because the app has no sync job to pick the mail up anyway. Rebuilding or integrating is the orchestrator's Integrate/Fix phase, not a walkthrough agent's job.
- **If you decide otherwise:** If the owner wants scenarios walked even on partial builds, the workflow needs an explicit check that Integrate merged every slice before Validate starts.
- **Refs:** docs/mvp/README.md (Validation protocol > Walk it like a person; Order table: Integrate before Validate); git merge-base checks of the mvp-2-* branches against mvp-2
- **Status:** accepted

## TBD-308 · Which 'Berlin role' to open when the delivered one is missing
- **Kind:** decision
- **Where:** MVP 2 · Validate (S3)
- **Context:** S3 needs the German Berlin role that asks for a CV, delivered in S2 with `seed deliver`. That command does not exist and S2 found no new mail, so the role is not in the mailbox.
- **Options:**
  1. Mark S3 not walkable and stop
  2. Open the closest visible Berlin role (the MVP 1 backlog message 'Senior Backend-Entwickler (m/w/d) – Berlin, hybrid' from Jonas Weber) and check every S3 expectation that applies to any role
  3. Deliver the message by other means (raw IMAP append)
- **Chosen:** Open the backlog Berlin role through the UI and check every expectation that applies to any role: fit score, reasons, skills, CV choice and draft panel. Separately check the Drafts and CVs pages. Run the listed seed verification steps exactly as written. This walks the scenario as a person would without inventing infrastructure steps the protocol doesn't list. It still gives evidence that the match, CV-choice and draft UI are absent for every role, not only the missing one.
- **If you decide otherwise:** If the owner wants S3 to count only on the exact delivered message, the result is the same (fail), with the cause being the missing `seed deliver`.
- **Refs:** docs/mvp/MVP-2.md S3, S2; e2e/seed/main.ts; screenshot e2e/reports/mvp-2/20261015T234619Z-r0-walkthrough/S3-01-berlin-role-no-fit-score-no-match-panel.png
- **Status:** superseded by TBD-355

## TBD-309 · Did not press 'Analyze them' to bring the backlog scam into the inbox
- **Kind:** decision
- **Where:** MVP 2 · Validate (S6)
- **Context:** The backlog scam is among the 305 likely-job emails the first scan left unanalyzed. Pressing 'Analyze them' is a person's action, but S6 does not list it. It would change the backlog state that S7 relies on ('a good match from the first scan's backlog').
- **Options:**
  1. Press Analyze them during S6
  2. Leave the backlog as the earlier scenarios left it and report the scam as not reachable
- **Chosen:** Leave the backlog as it is and report it. The sender stage is a stub that throws for every message (280 `stage_failed stage=sender`), so analyzing the backlog could not produce a verdict anyway. It would only spend ~300 fake-AI calls and change state for S7.
- **If you decide otherwise:** The scam would appear in the inbox with no badge and no sender panel. Same result, and S7's backlog preconditions would shift.
- **Refs:** docs/mvp/MVP-2.md S6, S7, F5.5; apps/server/src/pipeline/sender.ts
- **Status:** superseded by TBD-358

## TBD-310 · Walk S7 against substitute messages because the scenario's delivered roles don't exist
- **Kind:** decision
- **Where:** MVP 2 · Validate (S7)
- **Context:** S7 names the delivered hybrid Amsterdam role and the Singapore onsite role, and a backlog good match older than 14 days. The stack has no deliveries (there is no seed deliver), and maria-0001 is dated inside the window.
- **Options:**
  1. Report S7 as not walkable without looking at the UI
  2. Walk the closest existing messages (backlog Amsterdam hybrid maria-0148, a job alert, backlog Berlin maria-0001) and report what a person sees
- **Chosen:** Walk the closest existing messages and mark every criterion failed, with evidence. It gives the fix round concrete observations: no fit score, no sender check, blank Drafts and Decisions. It does not claim a pass for a scenario whose preconditions are missing.
- **If you decide otherwise:** Nothing changes in the code. Only the report would say 'blocked' instead of 'failed'.
- **Refs:** docs/mvp/MVP-2.md S7; screenshots S7-01…S7-04 in /Users/admin/Desktop/Repos/newrepo/JobFilly/e2e/reports/mvp-2/20261015T234619Z-r0-walkthrough
- **Status:** superseded by TBD-360

## TBD-311 · Recreate the missing Tom membership through the UI before walking S10
- **Kind:** decision
- **Where:** MVP 2 · Validate (S10)
- **Context:** S10 starts with 'Maria sets Tom back to Viewer', which needs the state MVP 1 S6 leaves behind (Tom accepted an invite and is an Editor in Maria's workspace). In this run Tom was not a member at all.
- **Options:**
  1. Stop and mark S10 not walkable
  2. Recreate the precondition as a person would: Maria invites Tom as Editor and Tom accepts, then walk S10
  3. Seed the membership through the API or database
- **Chosen:** Recreate it through the UI: Maria invited tom.okafor@inbox.example as Editor, signed out, Tom signed in and pressed Accept, signed out, Maria signed in and changed Tom's role to Viewer on Members. This yields real evidence for every S10 criterion while keeping to the visible-UI-only rule. Seeding through the API or database would break the protocol, and stopping would leave F6.7, F7.7 and F8.8 with no evidence.
- **If you decide otherwise:** If the owner wants S10 to run only on state the earlier scenarios built, this walk is invalid until the run replays MVP 1 S6. Tom is now a Viewer member of Maria's workspace and a second invite to him would fail or duplicate, so a later MVP 1 S6 replay on this same stack must allow for that.
- **Refs:** docs/mvp/MVP-1.md S6; docs/mvp/MVP-2.md S10; app.log events workspace.invite_created (inviteId 65a274a5-2aab-4bb8-a58b-b99534b16e7b), workspace.invite_accepted, workspace.role_changed role=viewer
- **Status:** superseded by TBD-402

## TBD-312 · Extra curl requests beyond the three listed probes
- **Kind:** decision
- **Where:** MVP 2 · Validate (S10)
- **Context:** The scenario lists three probes (apply a proposal, answer a decision, edit a draft). In the same curl session I also sent GET /drafts, /decisions, /decisions/count and /assistant, plus POST /drafts/:id/discard, POST /decisions/:id/not-now and PATCH /assistant/proposals/:id.
- **Options:**
  1. Only the three listed probes
  2. Add read and write checks to find out why the pages were blank
- **Chosen:** Added them as diagnostics, after the browser walkthrough and in their own session. The blank pages made no network requests, so the extra calls were the only way to tell a client bug from a missing server handler (they return 501 not_implemented). They are not counted as walkthrough evidence.
- **If you decide otherwise:** If the protocol is read strictly, drop these extra results. The browser observations alone still fail all three criteria.
- **Refs:** app.log http.request lines at 2026-10-16T00:25:27Z (routes /drafts, /decisions, /decisions/count and /assistant with status 501; proposal, decision and draft writes with status 403)
- **Status:** superseded by TBD-364

## TBD-313 · Substitute replica to kill when no sync.started exists
- **Kind:** decision
- **Where:** MVP 2 · Validate (S11)
- **Context:** S11 says to kill the replica named in the next sync.started, but no sync ever runs on this stack, so no instance could be read.
- **Options:**
  1. Skip the kill step entirely
  2. Kill one replica (app-b, which ran the latest pipeline sweep) to observe failover, then start it again
- **Chosen:** Killed app-b at 00:31:11Z and started it again at 00:31:27Z. It still tells us whether the UI survives a lost replica and whether any lease expiry shows up, and it leaves the stack as it was for later scenarios. The criterion is marked failed either way.
- **If you decide otherwise:** Skipping it would give no failover observation; the F1.2 verdict would be the same (fail).
- **Refs:** docs/mvp/MVP-2.md S11; app.log server.ready app-b 00:31:27.946Z
- **Status:** superseded by TBD-405

## TBD-314 · How to walk a scenario that is a spec run
- **Kind:** decision
- **Where:** MVP 2 · Validate (S12)
- **Context:** S12 has no UI steps and no camera-marked steps. Its only content is 'All MVP 1 specs pass'. The protocol says to walk scenarios like a person with Playwright MCP.
- **Options:**
  1. Run only `pnpm e2e:specs --mvp 1` against the running stack
  2. Also do a short Playwright MCP check of MVP 1's inbox and profile
  3. Re-walk every MVP 1 scenario by hand
- **Chosen:** Ran the MVP 1 specs on the running stack after S11, and added a short visible-UI check of Job inbox and Profile as Maria. No screenshots, because S12 marks no step with a camera. The criterion is literally about the specs, so running them is the scenario. The short UI check adds real evidence that MVP 1's main screens still work, because the spec suite has no scenario specs. A full manual re-walk of MVP 1 would mutate state on a stack that has already gone through all of MVP 2 (registrations, scans), and the spec does not ask for it.
- **If you decide otherwise:** If the owner reads S12 as needing MVP 1's scenarios re-proved, the MVP 1 scenario specs have to be codified first (names fixed in e2e/fixtures/f53-proof.ts), and then S12 runs them on a fresh stack before the MVP 2 scenarios.
- **Refs:** docs/mvp/MVP-2.md S12; docs/mvp/README.md Validation protocol and Sign-off; e2e/fixtures/f53-proof.ts; TBD-142; TBD-148; /Users/admin/Desktop/Repos/newrepo/JobFilly/e2e/reports/mvp-2/20261015T234619Z-r0-walkthrough/s12-specs.log
- **Status:** superseded by TBD-406

## TBD-315 · Fix round 1 finishes the six unmerged slice branches instead of patching mvp-2
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1
- **Context:** 11 of 12 scenarios failed because Validate ran on a foundation-only build: none of the six MVP 2 slice branches passed verification, so none was merged (mvp-2-assistant 38 commits ahead, cvs-senders 30, mailbox 20, replies 20, rules-match 19, e2e-fixtures 10). Almost every scenario failure is a stub that a slice already replaces.
- **Options:**
  1. Continue each slice branch, fix its review findings, and attach the scenario failures it resolves
  2. Rebuild the missing features on mvp-2 from scratch
  3. Merge the slices unverified
- **Chosen:** Continue each slice branch (continueBranch) with its review findings plus the scenario and criterion failures its code resolves, so the verifier checks them and the fix-round integration merges them; foundation and web-shell problems get their own tasks on mvp-2. The slices hold the real implementation; only their review findings kept them out. Re-building wastes work, and merging unverified code breaks the build protocol.
- **If you decide otherwise:** Validation would run on stubs again and fail the same way.
- **Refs:** RUN-RESULT failed; slice mailbox/cvs-senders/rules-match/replies/assistant/e2e-fixtures 'not merged' findings; .claude/workflows/build-mvp.js fixRound
- **Status:** accepted

## TBD-316 · Shared files split by section and line, not by whole path
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1
- **Context:** The rule is that no two fix tasks share a path. But docs/ARCHITECTURE.md needs edits from the foundation, mailbox, cvs-senders, replies and assistant findings, and packages/db/src/queries/evaluations.ts needs one from the foundation (back-off in listToEvaluate) and one from cvs-senders (the fromDomain fragment at line ~99). The text being changed exists on different branches.
- **Options:**
  1. Give each task a distinct section or line range of the shared file
  2. Put all ARCHITECTURE edits in one docs task on mvp-2 (it can't edit text that exists only on slice branches)
  3. Leave some findings unfixed
- **Chosen:** Each task owns only the named section or lines (listed in ownedPaths), so the integration merge combines them without overlapping hunks. This keeps the purpose of the rule (no conflicting edits) and still fixes every finding on the branch where its text lives.
- **If you decide otherwise:** Some findings could not be fixed this round, or one docs task would edit text that isn't on its branch.
- **Refs:** foundation, mailbox, cvs-senders, replies, assistant ownedPaths; docs/ARCHITECTURE.md ~91, ~117-119, ~178, ~201, ~240, ~241, ~264, ~268
- **Status:** accepted

## TBD-317 · Who owns packages/mail: mailbox owns client.ts, replies removes its own mail-package files
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1
- **Context:** The replies slice added packages/mail/src/message-id.ts, an index.ts export and a client.ts doc edit, against TBD-187. The mailbox slice's real IMAP client ignores input.draftMessageId, so draft retries can leave duplicate copies, and only the test double honours it.
- **Options:**
  1. Mailbox makes append() honour input.draftMessageId and rewrites the client.ts doc; replies deletes its generator files, restores index.ts and generates the ID in apps/server/src/drafts/mailbox.ts
  2. Keep the replies generator in packages/mail and have mailbox use it
- **Chosen:** The first option. Replies does not touch client.ts. On integration, mailbox's client.ts wins over the replies branch's old doc edit. TBD-187 gives IMAP work one owner. This leaves one generator, and production gets the exactly-one-copy behaviour that F6.3/F6.4 need.
- **If you decide otherwise:** There would be two generators, and a retried draft could leave a second copy in the user's Drafts folder.
- **Refs:** slice replies [scope] and [rule] findings; TBD-187; packages/mail/src/client.ts append()
- **Status:** accepted

## TBD-318 · knip: register e2e/rdap/main.ts in the change that adds it; this supersedes TBD-206
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1
- **Context:** TBD-206 chose: the foundation adds the e2e entries rdap/main.ts and dns/main.ts, and slices never edit knip.jsonc. Commit 7a9f173 removed them and said the change that adds an entry registers it (TBD-226). There is no dns/main.ts: CoreDNS runs from e2e/dns/Corefile.
- **Options:**
  1. Restore both entries on mvp-2, as TBD-206 says
  2. The e2e-fixtures slice registers rdap/main.ts itself, as TBD-226 and the knip comment say
- **Chosen:** The e2e-fixtures task adds "rdap/main.ts" and no dns entry. The TBD-206 entry should be marked superseded by TBD-226. Listing an entry for a file that doesn't exist hides nothing useful. The slice that adds the file is the one that knows it exists.
- **If you decide otherwise:** knip would carry an entry for a missing dns/main.ts, and the rdap entry would depend on a test import.
- **Refs:** foundation [criterion] knip.jsonc; slice e2e-fixtures [rule] knip.jsonc; TBD-206; TBD-226
- **Status:** superseded by TBD-332

## TBD-319 · Hard-conflict ground truth for F4.2 is written by hand, not computed from a copy of the scorer
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1
- **Context:** e2e/fixtures/build/matching.ts copies the app scorer's place and pay rules and writes their result into expected.json. A cross-check against the real scorer cannot live on either branch alone: the scorer is on rules-match, the fixtures on e2e-fixtures.
- **Options:**
  1. Hand-write the hard conflicts in the persona sources
  2. Add a packages/core test after integration that compares the real scorer with expected.json
- **Chosen:** Hand-written conflicts in the persona sources. The scorer copy is deleted. Ground truth written independently of the app is what lets E2E catch a scorer bug, and it fits on one branch now.
- **If you decide otherwise:** 'Every hard conflict is detected' would measure the copy, not the app.
- **Refs:** slice e2e-fixtures [criterion] matching.ts/build.ts
- **Status:** accepted

## TBD-320 · Failed pipeline stages back off instead of retrying every interval forever (changes TBD-191)
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1
- **Context:** TBD-191 pinned that failed evaluations are retried within one interval. On the stack, stages that always fail were retried every 2 minutes, forever: 1820 warn lines, plus repeated model calls whenever the failure is an AI answer that never validates.
- **Options:**
  1. Keep retrying every interval
  2. First retry within one interval, then a doubling back-off with a cap, stored in the database
  3. Stop after N attempts
- **Chosen:** The first retry stays within one interval, so F5.3 and F6 retries behave as specified. Repeated failures of the same stage then double up to a cap (around 1 hour). The state is stored in the database so all replicas agree. Transient failures still recover quickly, while a failure that never goes away no longer floods the logs or the AI budget. Stopping for good would leave mail unanalysed with no way back.
- **If you decide otherwise:** A single broken message or provider keeps making model calls and warn lines on every tick.
- **Refs:** S5/S7/S11/S12 important 'no back-off'; TBD-191; apps/server/src/pipeline/sweep.ts
- **Status:** accepted

## TBD-321 · Reply-policy retries are re-checked against every hold except their own earlier draft
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1
- **Context:** Planning left TBD-210 item 5 open. reevaluate.ts re-claims failed drafts and enqueues draft.create {origin:'retry'} without checking eligibility, and replyEligibility cannot take origin retry.
- **Options:**
  1. Extend the policy to origin retry and have draft.create (or reevaluate) check it
  2. Never retry automatically
- **Chosen:** ReplyEligibilityInput.origin accepts retry. A retry skips only the already_drafted hold for its own row and keeps every other hold (outside the reply window, high risk, rules, open needs, dismissed, below threshold). A held retry is marked failed or discarded with the reason. This is done in the replies task. F1.6 says automatic drafts happen only inside the reply window. A retry must not get around that, or any other hold.
- **If you decide otherwise:** A draft that failed while IMAP was down could be written days later, after the message left the window.
- **Refs:** foundation [criterion] F1.6 and packages/core/src/policy findings; TBD-210 item 5
- **Status:** accepted

## TBD-322 · connectMailbox lands on mvp-2; the sync and draft code switch to it at integration
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1
- **Context:** The foundation finding asks for one helper that opens the mailbox. The mailbox and replies branches were written before it existed and may hold their own copies.
- **Options:**
  1. Add the helper on mvp-2 now and switch the slices' copies when merging
  2. Make each slice task add its own helper
- **Chosen:** The foundation task adds apps/server/src/mailbox.ts connectMailbox and records it in ARCHITECTURE. Copies that come in with the mailbox and replies merges should be switched to it during integration. Any left over are carried to the next round. One owner and one helper. The slice tasks can't import a file that isn't on their branch yet.
- **If you decide otherwise:** Code that decrypts secrets would keep spreading across modules.
- **Refs:** foundation [hygiene] pipeline/evaluate.ts:107-119 openMailbox
- **Status:** accepted (done: the pipeline and the drafts open the mailbox through connectMailbox, the scan and the sync through connectStoredMailbox, both in apps/server/src/mailbox.ts)

## TBD-323 · Merge the rules-match fix before the assistant fix
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1
- **Context:** mvp-2-assistant contains every mvp-2-rules-match commit. If the assistant fix passes verification and the rules-match fix does not, merging assistant would still bring in the unfixed substring scorer.
- **Options:**
  1. Merge rules-match first and let git combine the shared history
  2. Rebase assistant away from rules-match
- **Chosen:** Merge order: rules-match fix, then assistant fix. If rules-match fails verification, its findings (deal-breaker and contract substring matches) are carried into round 2 even though assistant merged. Shared history merges cleanly, and rebasing 38 commits risks breaking the assistant slice.
- **If you decide otherwise:** The scorer bug could reach mvp-2 without anyone noticing.
- **Refs:** git merge-base: mvp-2-rules-match is in mvp-2-assistant
- **Status:** accepted

## TBD-324 · No fix task for codifying MVP 1's scenario specs or replaying MVP 1's scenarios
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1
- **Context:** S12 found that e2e/specs/mvp-1 holds only 00-stack and the skipped F5.3 proof, so 'all MVP 1 specs pass' proves almost nothing. S10 also found that MVP 1's S6 and S7 setup was never replayed (Tom wasn't a member, and his workspace had no mailbox).
- **Options:**
  1. Write MVP 1 specs now without being able to run them (fix tasks never start the Docker stack)
  2. Leave it to the Codify phase and the walkers' replay of earlier scenarios, and record it in TBD.md
- **Chosen:** Record it in TBD.md for the owner. The next validation run must replay MVP 1's scenarios in order before MVP 2's. The Codify phase should also write MVP 1's missing scenario specs while it codifies MVP 2, so 'every spec of MVP 1 to 2 passes' means something. Specs that were never run would just fail later at Confirm. The fix protocol bars starting the stack.
- **If you decide otherwise:** The MVP 1 regression gate stays nearly empty.
- **Refs:** S12 (important) MVP 1 specs; S10 (important) starting state
- **Status:** superseded by TBD-370

## TBD-325 · Housekeeping and the missing report are left to the orchestrator and Clean-up
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1
- **Context:** There are about 190 leftover .claude/worktrees/wf_89cf9a43-* worktrees and stale branches (mvp-1-scan, mvp-1-fix-r1-intake-profile, mvp-1-fix-r4-intake-live-merge). The run's report.md was refused for the walker and not written.
- **Options:**
  1. Make a fix task for them
  2. Leave them to the Clean-up phase and to the orchestrator, which writes report.md from the run result
- **Chosen:** No fix task. Clean-up removes the worktrees and merged or stale branches, and the orchestrator writes report.md. These aren't product code, and removing worktrees while fix tasks run in parallel worktrees is risky.
- **If you decide otherwise:** Fix tasks could delete worktrees other agents are using.
- **Refs:** Housekeeping note; report.md failed
- **Status:** accepted

## TBD-326 · What counts as a whole-word mention for deal-breakers, contracts, seniority and permits
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (rules-match)
- **Context:** The fix had to stop substring matches (crypto vs Cryptography, permanent vs Non-permanent) while 'on-call' still matches 'Weekly On-Call rotation'. Splitting text into words is not enough on its own: 'Non-permanent' splits into non + permanent, so 'permanent' would still fit.
- **Options:**
  1. Reuse the existing `tokens` helper, which splits on hyphens and so lets 'permanent' fit 'Non-permanent'
  2. Keep hyphenated words whole, which stops 'on call' from matching 'On-Call'
  3. Match the needle's words one after another, but reject a match that is joined to a neighbouring word by a hyphen, dot or apostrophe
- **Chosen:** Words one after another, rejecting a match joined to a neighbouring word by a hyphen, dot or apostrophe. It is the only option that satisfies every case in the task: 'Non-permanent' is not 'permanent', 'on-call' and 'on call' both match 'On-Call', and 'Java/Kotlin' still matches 'Java'. When the wording is unclear the verdict stays 'unknown' and never fits, which follows the 'unknown means ask' rule. It uses no language-specific word lists. A negation written as a separate word ('not permanent') can't be detected without words for a particular language, so it would still fit.
- **If you decide otherwise:** If the owner wants negations written as separate words treated as unknown, they would have to come from the profile or the model (match.v1), not from a hard-coded word list.
- **Refs:** packages/core/src/match/match.ts (wordsOf, mentions); packages/core/src/match/match.test.ts
- **Status:** superseded by TBD-373

## TBD-327 · Impact preview for a role with no stored answer for its current input hash
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (assistant)
- **Context:** ARCHITECTURE said the preview picks each role's stored match.v1 answer by its input hash. The code fell back to the newest stored answer for the role and CV. The task offered two options: drop the fallback, or document it as an approximation that the re-evaluation after Apply corrects.
- **Options:**
  1. Drop the fallback: preview such a role with ai=null (title 'not compared yet')
  2. Keep the fallback and document it as an approximation that the re-evaluation after Apply corrects
- **Chosen:** Drop the fallback: preview such a role with ai=null. The pipeline never reuses an answer stored for another input hash; it asks the model again. A stale answer can make the card count a draft (or a score) the pipeline would not produce, which the task said to avoid. With ai=null the preview uses only what the profile and the stored data support now, matching the 'Never guess' rule.
- **If you decide otherwise:** Keeping the fallback would make a card shown right after a target-roles or skills change count drafts and eligibility from the old targets (in the new test: draftsNotCreated 1 instead of 0). ARCHITECTURE would then need to call this an approximation.
- **Refs:** apps/server/src/assistant/preview.ts; apps/server/src/routes/assistant.test.ts ('previews a role whose stored answer no longer fits the profile as not compared yet'); docs/ARCHITECTURE.md ### The assistant; packages/db/src/queries/assistant.ts listStoredMatchAnswers
- **Status:** accepted

## TBD-328 · How a retry the reply policy holds is recorded
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (replies)
- **Context:** F1.6/F6.1: a failed or dead draft retried by the sweep must not be saved once the policy holds it (message left the window, high-risk sender, a rule). The drafts table's failure_kind check allows only mailbox, ai and content, and packages/db/src/tables.ts is outside this task's paths.
- **Options:**
  1. Mark it failed with kind content and the reason 'Not tried again: <hold reasons>' (never retried, Draft a reply can take it back)
  2. Mark it discarded (it leaves the list and Draft a reply makes a new row; a stray copy would need deleting from reevaluate)
  3. Leave it failed with its retried kind and skip it each sweep until the hold lifts
  4. Add a new failure kind 'held' (needs a migration and a tables.ts change)
- **Chosen:** Failed with kind content and a 'Not tried again: …' reason, checked before reclaimDraft in pipeline.reevaluate (retryPlan). A role with no current evaluation or sender check waits instead of being held. The user still sees the draft and why it stopped, and can press Draft a reply, which matches F6.7. It needs no schema or migration change outside this slice, and the sweep never lists the row again. Waiting on a missing or stale sender check avoids holding a draft for good just because the mailbox is down, which is often why it failed in the first place.
- **If you decide otherwise:** If kind content shouldn't carry policy holds, add a 'held' failure kind to DraftFailureKindSchema and the drafts_failure_kind_check (db migration), and use it in apps/server/src/pipeline/reevaluate.ts instead of 'content'.
- **Refs:** packages/core/src/policy/reply.ts, apps/server/src/pipeline/reply.ts (retryPlan), apps/server/src/pipeline/reevaluate.ts, packages/schema/src/drafts.ts, apps/server/src/pipeline/reply.test.ts
- **Status:** accepted

## TBD-329 · A failed Draft a reply is retried as on_demand
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (replies)
- **Context:** The fix task says a retry keeps every hold, but a Draft a reply on a role below the threshold or outside the window (F6.5) would then never be saved after a mailbox failure.
- **Options:**
  1. Check every retry with origin retry
  2. Check retries of on_demand rows as on_demand (always eligible), and others as retry
- **Chosen:** Retries of on_demand rows are checked as on_demand. Rows with origin auto or decision are checked as retry. F6.5 says Draft a reply works whatever the score; the user asked for that reply, so a transient mailbox failure shouldn't turn into a policy hold.
- **If you decide otherwise:** Remove the on_demand early return in retryPlan (apps/server/src/pipeline/reply.ts) and the matching test in reply.test.ts.
- **Refs:** apps/server/src/pipeline/reply.ts, apps/server/src/pipeline/reply.test.ts
- **Status:** accepted

## TBD-330 · Draft question group-key parts on keys without item fields
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (replies)
- **Context:** F7.6: 'extra.relocate:IE' answered 'Yes' never matched. The parts can be dropped (extra.relocate) or folded into the extra key's name (extra.relocate_ie).
- **Options:**
  1. Normalise to groupKeyFor(profileKey) for every key without GROUP_PARTS
  2. Fold an extra question's parts into its slug; normalise core word-list keys to their own group key
- **Chosen:** Fold an extra question's parts into its slug (extra.relocate_ie). A core key without item fields uses its own group key (deal_breakers). Relocating to Ireland and relocating to Germany are different questions. Merging them would reuse one answer for the other, which breaks the 'Unknown means ask, never guess' rule. Core keys can't be renamed, so they use the key's own group key, which answeredFor can match.
- **If you decide otherwise:** Change questionKeys in packages/core/src/decisions/answers.ts to return groupKeyFor(key) for extra keys too; the decisions tests list the expected keys.
- **Refs:** packages/core/src/decisions/answers.ts, packages/core/src/decisions/needs.ts, packages/core/src/decisions/decisions.test.ts, apps/server/src/routes/decisions.test.ts
- **Status:** accepted

## TBD-331 · Cross-slice dependency: the IMAP client must keep the caller's draftMessageId
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (replies)
- **Context:** The idempotent append, the retry's delete-first and the new discard of a failed draft's stray copy all find the copy by the Message-ID the server chose. Only the server's test double honoured input.draftMessageId on this branch, and the client is owned by the mailbox slice.
- **Options:**
  1. Generate the ID in packages/mail (rejected: TBD-187, replies has no mail-package work)
  2. Generate it in apps/server and rely on the mailbox task making append() honour input.draftMessageId
- **Chosen:** The server generates it (draftMessageIdFor) and passes it as DraftMailInput.draftMessageId. ARCHITECTURE states the contract, and packages/mail's tests from the mailbox task in this round are expected to prove it. This follows the fix instructions and keeps one owner per package. Without the client honouring the ID, a retry or discard could leave a duplicate or stray copy on a real IMAP server.
- **If you decide otherwise:** If the mailbox task's client.ts doesn't honour input.draftMessageId after integration, F6.3/F6.4 idempotency only holds against the test double; fix packages/mail/src/client.ts append() and add its test.
- **Refs:** apps/server/src/drafts/mailbox.ts, apps/server/src/drafts/write.ts, apps/server/src/drafts/edit.ts, docs/ARCHITECTURE.md (### The draft lifecycle), packages/mail/src/client.ts
- **Status:** accepted (done: packages/mail keeps the caller's draftMessageId, fbffbbb)

## TBD-332 · The change that adds an e2e entry point registers it in knip.jsonc, superseding TBD-206
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (e2e-fixtures)
- **Context:** TBD-206 said slices never edit knip.jsonc and the foundation pre-registers rdap/main.ts and dns/main.ts. TBD-226 had already removed those pre-registered entries because the files didn't exist yet. The slice then added e2e/rdap/main.ts without registering it, and knip passed only because rdap/main.test.ts imports it.
- **Options:**
  1. Register rdap/main.ts in the slice's own change (and no dns entry, since CoreDNS uses e2e/dns/Corefile)
  2. Leave registration to the integrator as TBD-206 said
- **Chosen:** Register rdap/main.ts now, add no dns entry, and keep the knip.jsonc comment that a change adding an entry point registers it in the same change. knip.jsonc should name only files that exist and every real entry point. Deferring registration leaves knip passing only because a test happens to import the file.
- **If you decide otherwise:** Remove "rdap/main.ts" from knip.jsonc and have the integrator add it back. Until then knip stays green only because the test imports the file.
- **Refs:** knip.jsonc; TBD-206; TBD-226; docker/compose.e2e.yaml (rdap service)
- **Status:** accepted

## TBD-333 · Maria's generated roles get their hard conflicts from a hand-labelled table checked against each role's facts
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (e2e-fixtures)
- **Context:** The fix requires hand-written conflicts placed next to each role. About 280 of Maria's roles come from seeded random generators (recruiter, alert, applicant-tracking and replied-to mail), so there is no hand-written role to annotate. Changing the generators' random draws would rewrite MVP 1's signed-off mailbox.
- **Options:**
  1. A per-message table in a persona source (maria-conflicts.ts): one '<places> <mode> ≤<top>: <conflicts>' line per role, checked against the facts so it can't go stale
  2. Annotate the generators' pick tables (locations, pay ranges) with Maria's verdicts
  3. Keep computing conflicts with a rule written from the persona
- **Chosen:** Hand-written roles carry their conflicts inline. Generated roles are labelled in e2e/fixtures/build/maria-conflicts.ts, under a header that states her story (hybrid in Berlin or remote; at least €70,000 a year or €450 a day). applyConflictTable throws on any mismatch, missing message or unused line. The labels are data, not code shared with the app's scorer, so E2E measures the scorer against her story. Option 2 still needs arithmetic or new draws for pay. Option 3 is the same kind of copy the review rejected. Checking each line against the facts means a generator change can't leave stale ground truth unnoticed.
- **If you decide otherwise:** Restructure the generators so each role is drawn from pre-labelled options. Every fixture file would be regenerated and MVP 1's mailbox would change.
- **Refs:** e2e/fixtures/build/maria-conflicts.ts; e2e/fixtures/build/spec.ts (roleWhere, applyConflictTable); e2e/fixtures/build/spec.test.ts
- **Status:** accepted

## TBD-334 · The backlog scam is re-dated to 14.85–14.95 days ago so the first scan analyses it
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (e2e-fixtures)
- **Context:** F5.5 and S6 need the backlog scam to be high risk, but the scam is only part of MVP 2's backlog if the first scan analysed it. The first scan reads the newest likely job mail and stopped after 40; the scam was at rank 58.
- **Options:**
  1. Move the scam into the newest 40, keeping its single random draw so no other message changes
  2. Move it to a fixed date, which changes the draw sequence and every later message
  3. Change which message is the scam
- **Chosen:** rnd.int(days(14.85), days(14.95)): now rank 33 of 40, high risk and outside the reply window. This is the smallest change that makes S6 reachable. Only the scam's own date changes (plus the inbox file numbering after it); every other message keeps its date and its ground truth. The MVP 1 key messages stay among the newest 40.
- **If you decide otherwise:** If the first scan should analyse more than 40 messages, the scam's old date could stay. The new consistency test, and the S6/S7 newest-40 assumption it encodes, would then need to change.
- **Refs:** e2e/fixtures/build/maria.ts (scam); e2e/fixtures/consistency.test.ts (the newest-40 backlog test); docs/mvp/MVP-2.md F1.6, F5.5, S6, S7
- **Status:** accepted

## TBD-335 · The reply window is recorded per message as outsideReplyWindow in expected.json
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (e2e-fixtures)
- **Context:** The review asked that expected.json record which backlog roles are outside the reply window, for F1.6 in S7. The window applies per message, by its received date.
- **Options:**
  1. A message-level boolean outsideReplyWindow on every analysed message, backlog and delivered
  2. A role-level field repeated on each role
- **Chosen:** A message-level outsideReplyWindow, set when minutesAgo >= REPLY_WINDOW_MINUTES (14 days, now exported from format.ts). The window depends only on the message's date, so a role-level copy would just repeat the same value. Delivered mail always gets false, which makes the contrast explicit for S7.
- **If you decide otherwise:** Copy the flag onto each ExpectedRole and update the key-shape test.
- **Refs:** e2e/fixtures/format.ts (ExpectedMessageMvp2, REPLY_WINDOW_MINUTES); e2e/fixtures/build/build.ts
- **Status:** accepted

## TBD-336 · The core-side fixture test reads files with import.meta.glob instead of node:fs
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (e2e-fixtures)
- **Context:** packages/core has no Node types (types: []) and does no I/O. Its tsconfig and package.json were not in my allowed paths.
- **Options:**
  1. Use Vite's import.meta.glob (raw .eml, default-export JSON) with a local ImportMeta declaration
  2. Add @types/node to packages/core or a tsconfig.test.json as packages/schema has
  3. Use a triple-slash Node types reference, which leaks Node globals into core's typecheck
- **Chosen:** import.meta.glob, with lazy loading of the .eml files. It needs no dependency or tsconfig change and keeps Node types out of core. Lazy loading keeps the test at about 3 s.
- **If you decide otherwise:** Give packages/core a tsconfig.test.json with Node types, as packages/schema has, and switch the test to readFileSync.
- **Refs:** packages/core/src/sender/fixtures.test.ts; packages/schema/tsconfig.test.json
- **Status:** superseded by TBD-417

## TBD-337 · Load-tolerant timeouts in the root vitest config
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (e2e-fixtures)
- **Context:** pnpm check failed twice at a load average of 58–75 on 10 cores, with timeouts only outside the slice: PGlite hooks over 30 s and web jsdom tests over 5 s. maxWorkers was already 4.
- **Options:**
  1. Raise the PGlite hook and test timeouts to 120 s and give apps/web a 30 s testTimeout (inline project extending its own config)
  2. Lower maxWorkers further
  3. Add retries
- **Chosen:** Raise the timeouts. Keep maxWorkers at 4 and add no retries. Under CPU starvation from other builds, each worker's share of the CPU barely depends on our own worker count, so the wall-clock limits are what fail. Retries would hide real flakes. A test that really hangs still fails, just later.
- **If you decide otherwise:** Revert vitest.config.ts to the 30 s PGlite timeouts and the apps/* glob for web. The check can then go red on loaded machines.
- **Refs:** vitest.config.ts; apps/web/vitest.config.ts
- **Status:** accepted

## TBD-338 · How to stop workspace requests after sign out
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (web-shell)
- **Context:** useSignOut (hooks/useSession.ts, outside my paths) clears the cache before navigating, and mounted observers refetch on their next render. The fix had to be timing-proof and inside App.tsx, layout/ or pages/auth.
- **Options:**
  1. Default `enabled` in createQueryClient: every query except the session's is off once the session is known to be null
  2. Reorder sign out in the Header (navigate first, clear after)
  3. Gate each useWorkspaces caller on the session
- **Chosen:** Default `enabled` guard in createQueryClient, plus AppShell checking isPending instead of isLoading. It doesn't depend on whether React renders the route change or the mutation update first. It also stops any other query from hammering the API after a 401 elsewhere. Reordering would race with SignInPage's redirect for signed-in users.
- **If you decide otherwise:** Without it, any re-render between the cache clear and the navigation sends an unauthenticated request. Queries that set their own `enabled` (WorkspaceIndex mailboxes, MailboxForm, intake) override the default and stay unguarded, but none of them is mounted in the shell header.
- **Refs:** apps/web/src/App.tsx, apps/web/src/layout/AppShell.tsx, apps/web/src/App.test.tsx
- **Status:** accepted

## TBD-339 · Coalescing window for live updates
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (web-shell)
- **Context:** The brief asked for coalescing within a short window or per animation frame. A burst lasts about 250 ms, so a single frame or a fixed short window would still refetch several times.
- **Options:**
  1. Per animation frame
  2. Fixed window
  3. Trailing debounce with a max wait
- **Chosen:** Trailing debounce of 150 ms after the last event, capped at 1 s after the first. A whole burst becomes one refetch per active query, while a steady stream such as a long scan still refreshes at least once a second.
- **If you decide otherwise:** A per-frame flush would still cause about 15 refetches per 250 ms burst.
- **Refs:** apps/web/src/hooks/useLiveEvents.ts (LIVE_SETTLE_MS, LIVE_MAX_WAIT_MS)
- **Status:** accepted

## TBD-340 · What a failed message offers instead of 'retry'
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (web-shell)
- **Context:** The brief suggested 'open to retry' and 'the existing way to analyze it again'. No such way exists: Analyze them takes only pending mail, the server has no per-message re-analyze route, and server code is outside this task's paths.
- **Options:**
  1. Say 'open to retry', which nothing can deliver
  2. Point to the existing category correction as the way on
  3. Add a re-analyze endpoint (outside paths)
- **Chosen:** Row: "The AI's answer didn't fit, so nothing was guessed. Open it to set the category." (viewers: "Open it to read it."). Detail alert: a 'Set the category' button that focuses the category select; viewers are told an editor or admin can set it. Promising a retry that cannot happen would mislead users. Correcting the category is the action that already exists, and later analysis keeps the correction.
- **If you decide otherwise:** If the owner wants a real re-analyze action, a server route that resets a failed message to pending, plus a button, needs its own task.
- **Refs:** apps/web/src/pages/inbox/badges.tsx, InboxPage.tsx, MessageDetail.tsx, InboxPage.test.tsx
- **Status:** accepted

## TBD-341 · Where a page's heading comes from when its slot is empty
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (web-shell)
- **Context:** routes.tsx is outside my paths, and the slices' Drafts, Decisions and CVs pages render their own PageHeader once they render.
- **Options:**
  1. Always render the heading in the layout, doubling the slices' headings
  2. Show the heading only while the page shows nothing, taking the title from the nav label of the current path
- **Chosen:** PageFrame watches the page's DOM with a MutationObserver. Only while it shows nothing does it render the nav label as the heading, with Loading and then 'Nothing to show here yet.'; an error boundary shows the heading and an error with a Reload button. No blank <main> and no duplicate h1 after integration, and no edits to routes or the slices.
- **If you decide otherwise:** Pages outside the nav (setup steps, the index redirect, not found) get only the error boundary, because they have no nav title.
- **Refs:** apps/web/src/layout/PageFrame.tsx, apps/web/src/layout/AppShell.tsx, apps/web/src/layout/AppShell.test.tsx
- **Status:** accepted

## TBD-342 · How the UI learns a sender mark's scope (F5.4)
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (cvs-senders)
- **Context:** The fix suggested adding a scope to SenderCheck, set in core's checkSender. Checks are stored in sender_checks, which has only a mark column. tables.ts, the migrations and the save/read code in evaluations.ts are outside this task's paths, so a new SenderCheck field would be lost on save and never reach the UI.
- **Options:**
  1. Add scope to SenderCheck plus a sender_checks column and a migration (outside this task's paths)
  2. Encode the scope in the mark reason's signal or text
  3. Add GET /senders/marks?address=… returning the mark that applies now, with its scope and value
- **Chosen:** GET /senders/marks?address=… (viewer and up) returning {applied: {scope, value, mark} | null} via findSenderMark. The web buttons read it and clear with that scope and value. PUT with mark null answers 404 when nothing was removed. It stays within this task's paths and needs no schema migration. It reads the mark as it stands, which is also right while a check is still stale after a mark change. A domain mark can be cleared for the whole domain, and the text says it is the domain's.
- **If you decide otherwise:** If the scope should live on the check, a later change adds a mark_scope column to sender_checks, saves and reads it in evaluations.ts, sets it in checkSender, and the panel can read check.markScope instead of making the extra GET.
- **Refs:** packages/schema/src/sender.ts (SenderMarkQuerySchema, AppliedSenderMarkSchema), apps/server/src/routes/senders.ts, apps/web/src/pages/senders/index.tsx, apps/server/src/routes/senders.test.ts, apps/web/src/pages/senders/senders.test.tsx
- **Status:** superseded by TBD-392

## TBD-343 · The SQL sender domain also trims, to match core exactly
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (cvs-senders)
- **Context:** Core's senderDomain trims and lower-cases the part after the last '@'. The fix example was lower(substring(from_address from '@([^@]*)$')).
- **Options:**
  1. lower(substring(...))
  2. lower(btrim(substring(...)))
- **Chosen:** lower(btrim(substring(from_address from '@([^@]*)$'))) Gives the same domain as packages/core for every address, which is the point of the fix; the trim costs nothing.
- **If you decide otherwise:** Drop btrim. The only difference is for stored addresses with whitespace after the domain.
- **Refs:** packages/db/src/queries/sender-domain.ts, packages/core/src/sender/check.ts senderDomain
- **Status:** accepted

## TBD-344 · Where the back-off lives
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (foundation)
- **Context:** Repeated failures of the same message's stage need a back-off stored in the database, so every replica agrees.
- **Options:**
  1. A new stage_failures table keyed by message, stage and position
  2. New columns on messages (sender) and roles (match)
- **Chosen:** A new stage_failures table, with a foreign key to messages and cascade delete. A role that was never evaluated has no role_evaluations row to hold a counter, and a separate table leaves the slices' tables and their merges alone. The cost is one expected table name added to packages/db/src/index.test.ts.
- **If you decide otherwise:** Columns on messages and roles would avoid the extra table and the test-list edit, but they mix pipeline retry state into the scan's rows, and re-analysis would reset it.
- **Refs:** packages/db/src/tables.ts stageFailures; packages/db/migrations/0001_mvp2.sql; packages/db/src/queries/stage-failures.ts
- **Status:** accepted

## TBD-345 · Back-off schedule
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (foundation)
- **Context:** The first retry must stay within one interval (TBD-191, F5.3/F6 retries), and later ones should back off.
- **Options:**
  1. First retry at the next sweep, then interval x 2^(n-2), capped at 1 hour (never less than one interval)
  2. A fixed delay
  3. Doubling from the first failure
- **Chosen:** First retry at the next sweep, then one interval, doubling up to 1 hour. This keeps the pinned first retry, ends the every-tick model calls and log flood, and caps how long a fixed AI setup waits.
- **If you decide otherwise:** A longer cap means even fewer calls for deterministic failures but a longer wait after a fix that triggers no re-evaluation, such as editing AI settings.
- **Refs:** apps/server/src/pipeline/evaluate.ts MAX_BACK_OFF_MS; recordStageFailure
- **Status:** accepted

## TBD-346 · What ends a back-off
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (foundation)
- **Context:** A change such as a profile, rule, CV, decision or category change, or a sender mark, is a new question and shouldn't wait out an old failure's back-off.
- **Options:**
  1. Compare stale flags and stale_since stored at failure time, plus have requestReevaluation clear role failures in its scope
  2. Compare only timestamps between the failure and the stale mark
- **Chosen:** Both: a stale sender check releases the hold; a role re-staled with a different stale_since releases it; requestReevaluation also clears role failures in its scope (this also covers roles never evaluated) This doesn't depend on clock skew between replicas, and it covers missing roles, which markStale can't touch.
- **If you decide otherwise:** Without the clear in requestReevaluation, a backlog role that never matched would wait up to an hour after the user changes the profile.
- **Refs:** packages/db/src/queries/stage-failures.ts senderHeldSql, roleHeldSql, clearStageFailures; apps/server/src/profile/changes.ts
- **Status:** accepted

## TBD-347 · Visible state of a failed sender check
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (foundation)
- **Context:** A thrown sender stage stored nothing, so the person saw no badge at all. F5.3 says incomplete, never silent and never 'looks fine'.
- **Options:**
  1. Store an incomplete caution check with a check_failed reason, still counted as missing and hidden from the reply stage
  2. Keep storing nothing
- **Chosen:** Store {verdict: caution, complete: false, reasons: [check_failed: "Couldn't check this sender yet. JobFilly tries again shortly."], mark: null}. The pipeline still lists it as missing, retries it with back-off, and passes sender null to the reply stage. It fits the existing SenderCheck schema and slots in the UI. Caution is the best verdict an incomplete check may have, and the reply still waits for a real check.
- **If you decide otherwise:** Other readers of stored checks (the impact preview's listRoleStates, the replies slice) would need to stop treating check_failed as a real caution; this is listed under notDone.
- **Refs:** apps/server/src/pipeline/evaluate.ts FAILED_CHECK, isFailedCheck
- **Status:** accepted

## TBD-348 · listToEvaluate without now
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (foundation)
- **Context:** The sweep passes now, but pipeline/reevaluate.ts (outside my paths) calls listToEvaluate without it.
- **Options:**
  1. now is optional: without it everything to do is listed and evaluateMessage holds back waiting stages via getStageHolds
  2. Default now to the wall clock
- **Chosen:** An optional now; evaluateMessage enforces the holds with deps.clock. Defaulting to the wall clock would mix the fake clock and the real clock in tests and make them flaky. Holding in evaluateMessage keeps runs started for other work from retrying early.
- **If you decide otherwise:** Once reevaluate.ts passes now, waiting messages wouldn't be listed at all.
- **Refs:** packages/db/src/queries/evaluations.ts listToEvaluate; apps/server/src/pipeline/evaluate.ts
- **Status:** accepted

## TBD-349 · How to tell a sync's held mail from the first scan's backlog after a new UIDVALIDITY
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (mailbox)
- **Context:** The task suggested 'sync_analysis_failures > 0 or stored by a sync, scan_id null'. But messages has no scan_id column, and analyzed_by_scan_id is null for both the scan's untouched backlog and the sync's held mail. Counting failures alone would miss held mail that the budget left untried.
- **Options:**
  1. Messages with sync_analysis_failures > 0
  2. Messages created after the first scan stopped (createdAt vs stoppedAt)
  3. Pending likely job mail under the cursor's old UIDVALIDITY with UID > cursor.lastUid, read before re-indexing
- **Chosen:** Pending likely job mail under the cursor's old UIDVALIDITY with UID > cursor.lastUid, read before re-indexing (packages/db listHeldBySync) The cursor starts where the first scan's stored mail ends and never moves back, so anything above it was stored by a sync. Mail is above it only while it holds the cursor. This catches failed and budget-skipped mail alike, needs no new column, and needs no clock comparison across replicas. The MAX_SYNC_ANALYSIS_FAILURES cut-off still applies afterwards.
- **If you decide otherwise:** Counting failures alone would leave budget-skipped held mail pending for good after a UIDVALIDITY change. A timestamp rule would depend on clock agreement between the scan and the database.
- **Refs:** apps/server/src/sync/run.ts (held/carried), packages/db/src/queries/sync.ts listHeldBySync, apps/server/src/sync/sync.test.ts 'still sorts mail a sync held the cursor for'
- **Status:** accepted

## TBD-350 · How to make each rewritten schema commit typecheck
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (mailbox)
- **Context:** The task asked both to fold follower updates into or before the schema commits and to keep each schema change as its own commit at the front. A follower placed before a schema commit cannot compile against a type that does not exist yet.
- **Options:**
  1. Squash each schema commit with all its followers
  2. Keep the schema commit first, carrying the minimal follower edits to compile (placeholders), with the real followers after it
  3. Make the new fields optional
- **Chosen:** Schema commit first with minimal placeholder follower edits; real follower commits follow; cross-package API changes (MailClientOptions.address, recordSyncFailure reason) carry their server callers in the same commit. Every commit typechecks, the schema change stays at the front of its group, the package-scoped commits stay readable, and the final tree is unchanged.
- **If you decide otherwise:** Squashing would merge four packages into one commit. Making the fields optional would change the final tree and the contract.
- **Refs:** d2c4918, fe0515f, 3131db8, 997a6d6
- **Status:** accepted

## TBD-351 · The draft Message-ID generator stays in client.ts instead of replies' message-id.ts
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (mailbox)
- **Context:** The replies slice adds packages/mail/src/message-id.ts (newDraftMessageId) with a jobfilly.invalid fallback, plus a matching saveDraft doc. That file and packages/mail/src/index.ts are outside this task's allowed paths.
- **Options:**
  1. Copy replies' message-id.ts into this slice
  2. Keep draftMessageId in client.ts with the drafts.jobfilly.invalid fallback and honour input.draftMessageId
- **Chosen:** Keep the generator in client.ts with the drafts.jobfilly.invalid fallback; the schema field matches replies' text exactly. It stays within the allowed paths, and the fallback cannot be mistaken for a synthetic id. The identical schema hunk merges cleanly with the replies slice.
- **If you decide otherwise:** At integration, client.ts's saveDraft doc and generator will conflict with replies' message-id.ts. The integrator should keep a single generator and use the drafts.jobfilly.invalid fallback, since replies' fallback uses the synthetic domain.
- **Refs:** packages/mail/src/client.ts draftMessageId/append, packages/schema/src/mailbox.ts DraftMailInputSchema, mvp-2-replies packages/mail/src/message-id.ts
- **Status:** accepted

## TBD-352 · Register Maria and Tom through the UI before S1 because the stack had no users
- **Kind:** decision
- **Where:** MVP 2 · Validate (S1)
- **Context:** S1 starts with Maria opening CVs and relies on MVP 1 state, but this fresh stack had no accounts (app.log had no auth.registered) and only the MVP 1 stack specs had run. Without accounts the CVs page can't be reached.
- **Options:**
  1. Register Maria and Tom through the UI with the MVP 1 S1/S6 data (names, inbox.example addresses, E2E-SECRET-<p>-login passwords), skipping mailbox, AI, scan and intake
  2. Walk the whole MVP 1 setup (mailbox, AI, scan, intake, invite) before S1
  3. Report S1 as blocked without walking it
- **Chosen:** Register both personas through the UI with the MVP 1 data, without mailbox or AI setup. It is the least setup that lets S1 be walked like a person, and it uses the same credentials later scenarios expect. Full MVP 1 setup is out of scope for an S1 agent and would not change the result: the CV page and API are stubs.
- **If you decide otherwise:** Later scenario agents will find Maria (maria.santos@inbox.example, workspace 9a81c2b5-3469-482c-af5c-ac931f405f24) and Tom (tom.okafor@inbox.example, workspace dc910875-2152-4c8e-ae0a-37398dfff538) already registered, with no mailbox, AI or profile. If an earlier phase was meant to set this up, those agents must sign in instead of registering.
- **Refs:** docs/mvp/MVP-1.md S1/S6; app.log auth.registered x2 at 03:10:06 and 03:10:45
- **Status:** superseded by TBD-394

## TBD-353 · Run the cross-workspace probe with a made-up CV id, plus diagnostic probes
- **Kind:** decision
- **Where:** MVP 2 · Validate (S1)
- **Context:** The listed probe (Maria's session downloading Tom's CV → 404) needs a CV of Tom's, which can't exist because upload returns 501.
- **Options:**
  1. Skip the probe
  2. Probe with a random CV id in Tom's workspace from Maria's own curl session, and add diagnostic list and upload probes to explain the failure
- **Chosen:** Probe with a random id (404) and add diagnostic GET /cvs and POST /cvs probes with the personas' own curl sessions (501). It still shows the membership guard returns 404 to a non-member, and the diagnostic probes show where the failure comes from (server stubs, not only the UI). They are outside the scenario's listed probes, so they are reported here.
- **If you decide otherwise:** The isolation evidence is only partial. The real probe must be repeated once CVs can be uploaded.
- **Refs:** app.log 03:11:05 404 lines for userId cd9760c0-... on workspace dc910875-...; 501 lines for /cvs
- **Status:** accepted

## TBD-354 · Set up Maria's MVP 1 state through the UI so S2 had its preconditions
- **Kind:** decision
- **Where:** MVP 2 · Validate (S2)
- **Context:** When S2 started, Maria had no mailbox, AI settings, scan or profile in this run's stack. S2 (and F1.6) rely on the profile confirmed in MVP 1, but the MVP 1 scenarios hadn't been walked in this run.
- **Options:**
  1. Report S2 as blocked without touching the stack
  2. Do MVP 1 S1–S4's steps through the UI as Maria (Other IMAP imap:3143 plain, fake AI http://fake-ai:8080/v1, Start scan, remove Amsterdam, Confirm), then walk S2
- **Chosen:** Did MVP 1 S1–S4's steps through the UI, as a person would, without their probes or screenshots, then walked what S2 could reach. S2's own criteria (F1.5 usage, F1.6 backlog checks, mailbox status) can only be judged after a mailbox, an AI and a scan exist. Doing it with visible controls kept to the protocol and left the stack where later MVP 2 scenarios expect it (Maria's profile confirmed, Amsterdam removed).
- **If you decide otherwise:** If later walkers in this run expect to do the MVP 1 setup themselves, they'll find Maria's mailbox already connected and her profile confirmed at 03:15:56Z; they'd need a fresh stack.
- **Refs:** docs/mvp/README.md 'One run plays the scenarios of every MVP up to the current one'; docs/mvp/MVP-1.md S1–S4; app.log mailbox.connected 03:14:24Z, ai.settings_saved 03:14:55Z, scan.started 03:15:02Z, intake.confirmed
- **Status:** superseded by TBD-396

## TBD-355 · Which message to treat as 'the Berlin role' when the S3 delivered fixture is absent
- **Kind:** decision
- **Where:** MVP 2 · Validate (S3)
- **Context:** S3 expects the German Berlin role that asks for a CV, delivered in S2 with seed deliver. That command doesn't exist, so that message isn't in the mailbox. The only Berlin role in the inbox is MVP 1's <maria-0001@talentbruecke.example>: German, Berlin hybrid, no CV request, dated Oct 14, inside the 14-day window.
- **Options:**
  1. Open maria-0001 as the closest Berlin role and judge the criteria on it
  2. Mark S3 not walkable and open nothing
- **Chosen:** Opened maria-0001 and judged every S3 criterion on what it shows. It is a good-match recruiter message inside the reply window, so it should still show a fit score, a CV choice and an automatic draft. It walks the scenario as a person would: open the Berlin role in the list. It shows that the failure lies in the build, not only in the missing fixture.
- **If you decide otherwise:** The result doesn't change: the stubbed match, sender and sync stages fail S3 for any message.
- **Refs:** docs/mvp/MVP-2.md S3; e2e/seed/main.ts; apps/server/src/pipeline/match.ts
- **Status:** accepted

## TBD-356 · Walk S4 as far as the UI allows instead of declaring it blocked up front
- **Kind:** decision
- **Where:** MVP 2 · Validate (S4)
- **Context:** The scenario's preconditions (remote-EU draft, data-engineering role, Data engineering (EN) CV) and its verification tool (seed inspect drafts) do not exist on this stack.
- **Options:**
  1. Mark S4 not walkable without walking it
  2. Walk every step a person can reach, record what is missing at each one, and mark S4 failed
- **Chosen:** Walked every reachable step (Drafts page, CVs page, remote roles, search for the data-engineering role, Berlin role) and marked each criterion failed with evidence. The protocol says a scenario is never marked passed unless it was walked. Walking what exists gives the fix round concrete evidence of what is missing.
- **If you decide otherwise:** If the owner prefers blocked scenarios marked as not run, S4 becomes 'not run, preconditions missing' rather than 'failed'; the gaps listed stay the same.
- **Refs:** docs/mvp/MVP-2.md S4; docs/mvp/README.md Validation protocol 1; e2e/seed/main.ts; apps/server/src/routes/drafts.ts; apps/web/src/pages/drafts/index.tsx
- **Status:** superseded by TBD-398

## TBD-357 · Walked S5 to the point where it can't go on, and reported it failed without faking state
- **Kind:** decision
- **Where:** MVP 2 · Validate (S5)
- **Context:** S5 depends on the Zurich, Basel and Dublin roles delivered in S2 and on seed deliver. Neither exists in the running build, and the decision inbox is a stub.
- **Options:**
  1. Stop at the first missing precondition and report
  2. Walk every reachable step (inbox search, Decisions page, the seed deliver infra step, log check) and report every criterion failed with evidence
  3. Load the mail some other way (IMAP append, the API) to get further
- **Chosen:** Walk every reachable step and report every criterion failed with evidence. The protocol allows only visible UI actions plus the listed infra steps. Faking deliveries outside seed would break that rule and still couldn't exercise a decision inbox that returns 501.
- **If you decide otherwise:** Getting further needs the MVP 2 slice branches merged into mvp-2 and a fresh stack; then S5 can be walked as written.
- **Refs:** docs/mvp/MVP-2.md S5; docs/mvp/README.md Validation protocol §1; e2e/seed/main.ts; apps/web/src/pages/decisions/index.tsx; apps/server/src/routes/decisions.ts
- **Status:** superseded by TBD-399

## TBD-358 · Pressed 'Analyze them' so the backlog scam would appear
- **Kind:** decision
- **Where:** MVP 2 · Validate (S6)
- **Context:** The backlog scam (maria-0006) was among the 305 likely job emails the first scan's confident stop left unanalyzed, so it wasn't in the inbox or in search results. S6 needs it visible.
- **Options:**
  1. Press the visible 'Analyze them' button, as a person would
  2. Report the scam as missing without analyzing the rest
- **Chosen:** Pressed 'Analyze them' and waited for 'Stopped: done, all 305 likely job emails analyzed'. It is a visible, ordinary user action and the only way a person could reach the message. S7, which needs the older backlog matched, benefits from it too.
- **If you decide otherwise:** The later scenarios in this run (S7 to S11) start with the whole backlog analyzed rather than only the first 40. A fresh-stack rerun of S6 without this step would see the scam as not analyzed.
- **Refs:** docs/mvp/MVP-2.md S6, F5.5; e2e/reports/mvp-2/20261016T030053Z-r1-walkthrough/app.log scan.started kind=analyze_rest at 03:31:05Z
- **Status:** accepted

## TBD-359 · Recorded the root cause from source and git, outside the walkthrough
- **Kind:** decision
- **Where:** MVP 2 · Validate (S6)
- **Context:** Every step of S6 failed in the UI. I read apps/server/src/pipeline/sender.ts and checked branch ancestry with git after the walkthrough, without touching the API or the database.
- **Options:**
  1. Report only the UI symptoms
  2. Also name the root cause (unmerged slice branches) for the fix round
- **Chosen:** Reported both, and kept the root cause out of the walkthrough evidence. A fix round that only patches symptoms would miss that the integration merge never happened. Reading source and git is not a database read or API call, so the walkthrough rules still hold.
- **If you decide otherwise:** The fix round might change the web UI or the stubs on mvp-2 instead of merging the finished slice branches.
- **Refs:** apps/server/src/pipeline/sender.ts; git rev-list mvp-2..mvp-2-fix-r1-cvs-senders (40 commits)
- **Status:** accepted

## TBD-360 · Walk S7 on the closest existing roles because the delivered fixtures are missing
- **Kind:** decision
- **Where:** MVP 2 · Validate (S7)
- **Context:** S7 names 'the Amsterdam role' and 'the Singapore onsite role', which are MVP 2 deliveries ('seed deliver'). Neither exists in the stack or the repo, and S7 itself lists no infrastructure step, so no delivery was allowed or possible.
- **Options:**
  1. Mark F4.2 untestable without walking
  2. Walk the closest existing roles (backlog Amsterdam hybrid role, LinkedIn job alert, a backlog recruiter role older than 14 days) and report what a person sees
- **Chosen:** Walked the closest existing roles through the UI and reported F4.2, F6.1 and F1.6 as failed with evidence. The protocol says a scenario is never marked passed unless it was walked. Walking the real UI showed the root cause (no match, sender or draft anywhere), and the fix rounds need that, whichever fixture is used.
- **If you decide otherwise:** Once the deliver fixtures and the seed, dns and rdap services exist, S7 must be walked again on the delivered Amsterdam and Singapore roles to confirm the cap at 40 or less and the conflict listed first.
- **Refs:** docs/mvp/MVP-2.md S7 and 'Fixtures added'; e2e/fixtures/format.ts lines 28-30 and 404-411; screenshots S7-01 to S7-04 in e2e/reports/mvp-2/20261016T030053Z-r1-walkthrough/
- **Status:** accepted

## TBD-361 · Walk S8 as far as the UI allows when its first step is impossible
- **Kind:** decision
- **Where:** MVP 2 · Validate (S8)
- **Context:** S8 starts with 'Open Assistant', but no visible control opens it, and the scenario's earlier preconditions (Asia-Pacific roles, an existing draft) are missing too.
- **Options:**
  1. Stop at step 1 and report everything as not walked
  2. Check every page a person can reach for an Assistant entry, the Rules list, history/Undo and the Hidden filter, run the listed verification step, and report each criterion failed with evidence
- **Chosen:** Check every reachable page and run the listed verification step, without pressing extra buttons that would change the state later scenarios start from. The protocol requires evidence per criterion and never marks a scenario passed unless it was walked. Checking each page shows exactly which parts are missing, without changing state for S9 to S12.
- **If you decide otherwise:** A shorter report saying only 'Assistant missing' would hide the missing Rules list, history, Hidden filter and seed command.
- **Refs:** docs/mvp/MVP-2.md S8; docs/mvp/README.md Validation protocol §1; apps/web/src/pages/assistant/index.tsx; apps/web/src/pages/rules/index.tsx
- **Status:** accepted

## TBD-362 · Extra evidence screenshots named S8-*
- **Kind:** decision
- **Where:** MVP 2 · Validate (S8)
- **Context:** S8's camera-marked steps (the proposal card, Hidden, history) can't be reached, but the failures need visual evidence.
- **Options:**
  1. No screenshots
  2. Screenshot the states actually found
- **Chosen:** Saved S8-01-inbox-no-assistant-no-hidden-filter.png and S8-02-profile-no-rules-no-history-no-assistant.png (full page) in /Users/admin/Desktop/Repos/newrepo/JobFilly/e2e/reports/mvp-2/20261016T030053Z-r1-walkthrough. The protocol asks for evidence, and the run folder is git-ignored, so nothing is added to the tree.
- **If you decide otherwise:** Delete the two S8-*.png files; the snapshot text and log counts still prove the failure.
- **Refs:** docs/mvp/README.md §1, §6
- **Status:** accepted

## TBD-363 · Recreated the missing 'Tom is an Editor' state through the UI before walking S10
- **Kind:** decision
- **Where:** MVP 2 · Validate (S10)
- **Context:** S10 starts with 'Maria sets Tom back to Viewer', which assumes MVP 1 S6 left Tom as an Editor of Maria's workspace. In this run Tom had never been invited: Members listed only Maria, and no invite or role events were in app.log.
- **Options:**
  1. Report S10 as not walkable and stop
  2. Recreate the state as a person: Maria invites Tom as Editor, Tom accepts from 'Maria invited you', then Maria sets him to Viewer
  3. Seed the membership directly in the database
- **Chosen:** Recreate the state as a person through visible UI (invite as Editor, accept, set back to Viewer). This walks the scenario's own step (setting Tom back to Viewer) and reaches the viewer checks the criteria are about. It uses only visible buttons and no API or database access. Stopping would have left F6.7, F7.7 and F8.8 without evidence. A database write would break the protocol.
- **If you decide otherwise:** S10 would have been reported as blocked with no evidence on the viewer gates or the probes.
- **Refs:** docs/mvp/MVP-2.md S10; docs/mvp/MVP-1.md S6; app.log 03:49:53 workspace.invite_created role=editor, 03:50:28 workspace.invite_accepted, 03:50:56 workspace.role_changed role=viewer
- **Status:** superseded by TBD-402

## TBD-364 · Added three read-only GET calls to the probe session
- **Kind:** decision
- **Where:** MVP 2 · Validate (S10)
- **Context:** The scenario lists three write probes. To tell 'no data yet' apart from 'not built', I also sent GET /drafts, /decisions and /assistant in Tom's same curl session.
- **Options:**
  1. Only the three listed probes
  2. Also the three read-only GETs
- **Chosen:** Also the three read-only GETs, all after the browser walkthrough. They show that the read side a viewer needs answers 501 not_implemented, which explains why the pages are empty. They change no state and ran after the browser walkthrough was done.
- **If you decide otherwise:** The empty pages could have been mistaken for an empty but working feature.
- **Refs:** app.log 03:52:36.513Z, .544Z, .572Z, all status 501
- **Status:** accepted

## TBD-365 · Stand-in replica kill when no sync.started exists (same as TBD-313)
- **Kind:** decision
- **Where:** MVP 2 · Validate (S11)
- **Context:** S11 says to kill the replica named in the next sync.started. No sync runs on this stack, so there was no instance to read.
- **Options:**
  1. Skip the kill step
  2. Kill the replica serving most of the traffic (app-b), watch for failover and lease expiry, then start it again
- **Chosen:** Killed app-b at 03:58:30Z, waited past the 30 s lease until 04:00:41Z, and started it again at 04:00:47Z (ready at 04:00:48Z). It still shows whether the UI survives losing a replica and whether a lease expiry appears. It leaves the stack as later scenarios expect it, and it matches the r0 precedent. F1.2 fails either way.
- **If you decide otherwise:** Skipping the kill gives the same F1.2 verdict but no failover observation.
- **Refs:** docs/mvp/MVP-2.md S11; TBD-313; app.log server.ready app-b 2026-10-16T04:00:48.941Z
- **Status:** superseded by TBD-405

## TBD-366 · Ran the missing seed commands as written instead of working around them
- **Kind:** decision
- **Where:** MVP 2 · Validate (S11)
- **Context:** The scenario's `seed deliver` and `seed reset-uidvalidity` do not exist on this stack, and the protocol allows only the infrastructure steps the scenario lists.
- **Options:**
  1. Run them as written and report the failure
  2. Append mail or change UIDVALIDITY with a one-off IMAP script
- **Chosen:** Ran both exactly as written. Each exited 2 with 'Usage: seed load <persona>', and I recorded S11 as failed. A home-made script is not an allowed step, and it would prove nothing because the app has no sync job to pick the change up. Same reasoning as TBD-307.
- **If you decide otherwise:** The owner would need the workflow to check that Integrate merged every slice before Validate starts.
- **Refs:** TBD-307; e2e/seed/main.ts; branch mvp-2-fix-r1-e2e-fixtures
- **Status:** accepted

## TBD-367 · A skipped MVP 1 spec does not count as passing for S12
- **Kind:** decision
- **Where:** MVP 2 · Validate (S12)
- **Context:** S12 says 'All MVP 1 specs pass'. The suite ran 3 passed and 2 skipped. The skip is a designed guard ('needs the codified S1–S9 specs; the walkthrough covers F5.3 until then'), but MVP 1's scenarios were never codified, and this run did not walk MVP 1's scenarios again.
- **Options:**
  1. Count skipped specs as acceptable and mark S12 passed
  2. Mark S12 not passed because 2 of 5 specs did not pass and the suite has no MVP 1 scenario specs
- **Chosen:** Mark S12 not passed. The protocol says nothing counts as passing without evidence, and that earlier MVPs' specs must pass in every validation. A skip proves nothing about F5.3 or any MVP 1 behaviour, and calling the suite green would hide that the regression net is three smoke tests.
- **If you decide otherwise:** If the owner accepts the guard skip as by design, S12 passes on 3/3 executed specs plus the manual UI check. MVP 1 regressions would still go undetected until its scenarios are codified.
- **Refs:** docs/mvp/MVP-2.md S12; docs/mvp/README.md Quality gates and Sign-off; e2e/specs/mvp-1/; e2e/fixtures/f53-proof.ts; /private/tmp/claude-501/-Users-admin-Desktop-Repos-newrepo-JobFilly/64cc6a3d-9ab6-4d3a-82c6-e8066af76703/scratchpad/s12-specs.log
- **Status:** superseded by TBD-407

## TBD-368 · Fix round 2 continues the round-1 fix branches instead of rebuilding the slices
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2
- **Context:** Every scenario failure has one root cause: only mvp-2-fix-r1-web-shell was merged. The other fix-r1 branches failed verification on narrow findings (comment wraps, a commit's scope, word matching, a schema constant, an address in a URL, pnpm check timeouts under load), so integration never merged them and the stack ran the foundation's stubs.
- **Options:**
  1. Continue each mvp-2-fix-r1-<slice> branch, fix its verifier findings, and let integration merge it
  2. Rebuild the slices from mvp-2
  3. Merge the unverified branches as they are
- **Chosen:** Continue each fix-r1 branch (continueBranch). The scenario failures go to the slice that owns the criterion, so the verifier checks that criterion on the branch. Tasks are listed in merge order: foundation (connectMailbox, back-off), mailbox, cvs-senders, rules-match before assistant (TBD-323), replies, assistant, e2e-fixtures, scan-feedback, mvp1-specs. The features already exist and were verified apart from these findings. Fixing the findings is the shortest way to get them merged without skipping verification.
- **If you decide otherwise:** Rebuilding would throw away about 200 verified commits. Merging unverified branches would bring in the substring scorer, an address-in-URL leak and the wrong failed-check verdict.
- **Refs:** git rev-list mvp-2..mvp-2-fix-r1-*; build-mvp.js fixRound/integrate; TBD-322, TBD-323
- **Status:** accepted

## TBD-369 · Two shared files get hunk-scoped ownership in this round
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2
- **Context:** The rule is that no two tasks share a path. Two required edits land in the same files on different branches, and each edit exists only on its own branch. In docs/ARCHITECTURE.md, the foundation must add stage_failures to the Data list and the replies task must correct its line-249 claim about packages/mail tests. In packages/schema/src/sender.ts, the foundation must export CHECK_FAILED_SIGNAL (line 28) and cvs-senders must drop SenderMarkQuerySchema (line 83).
- **Options:**
  1. Give each file to one task and leave the other finding unfixed
  2. Scope each file to the named section or hunk for each task
  3. Put one constant in a new schema file just to avoid the overlap
- **Chosen:** Scope each file by section or hunk, as written in each task's ownedPaths. The hunks are far apart, so git merges them cleanly. cvs-senders keeps its CV test files in the shared helpers, so it needs no ARCHITECTURE edit. Both findings must be fixed for their branches to pass verification. Moving a constant away from its sibling MESSAGE_GONE_SIGNAL would break the Schemas-first precedent the finding cites.
- **If you decide otherwise:** One of foundation, replies or cvs-senders fails verification again and stays unmerged for a third round.
- **Refs:** docs/ARCHITECTURE.md:85-93 and :249; packages/schema/src/sender.ts:28, :83
- **Status:** accepted

## TBD-370 · MVP 1's scenario specs are written now, without running them (reverses TBD-324)
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2
- **Context:** TBD-324 left MVP 1's specs to the Codify phase. Codify runs only after a walkthrough with no failures, but S12 ('All MVP 1 specs pass') can never pass while the F5.3 proof skips for want of those specs. That is a deadlock. The missing specs also leave every MVP 2 run without MVP 1's end state (no users or profile, and Tom not an Editor), which broke S1, S2 and S10. Fix tasks may not start the Docker stack.
- **Options:**
  1. Write the S1-S11 specs now; their first run is the next validation's stack step
  2. Keep waiting for Codify (deadlocked)
  3. Let walkers replay MVP 1 by hand each run
- **Chosen:** Write them now in the mvp1-specs task, type-checked and linted, read values from the fixtures, and name them as F53_PROOF_NEEDS expects. It is the only way out of the deadlock. It also turns 'earlier specs passed' into real setup for MVP 2's scenarios.
- **If you decide otherwise:** S12 fails in every round, and walkers keep improvising MVP 1's state, which makes MVP 2's results unreliable.
- **Refs:** TBD-324; e2e/fixtures/f53-proof.ts F53_PROOF_NEEDS; S12 findings
- **Status:** accepted

## TBD-371 · Load-tolerant test timeouts live on the e2e-fixtures branch; other branches confirm green without them
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2
- **Context:** Verifiers run pnpm check while many worktrees run vitest in parallel (load average 50-123). Timeouts failed the replies, assistant and e2e-fixtures branches. 37b60a8, already on mvp-2-fix-r1-e2e-fixtures, edits vitest.config.ts, so the shared fix can't sit in a separate task without a shared path.
- **Options:**
  1. Put the config.test.ts spawnSync timeout and a global asyncUtilTimeout in the e2e-fixtures task
  2. Have every branch raise timeouts in its own tests
  3. A separate task from mvp-2 that conflicts with 37b60a8
- **Chosen:** The e2e-fixtures task completes the hardening: config.test.ts spawnSync timeout, plus a web setupFiles entry with asyncUtilTimeout 10 s. Replies and assistant must reach a green pnpm check. They rerun timeout-only failures alone with --maxWorkers=1 and report both runs. assistant also makes history.test.ts's setup robust against cascades. One owner and no shared path. Once merged, every later round gets the hardening. No test is skipped.
- **If you decide otherwise:** Replies or assistant may again fail verification on timeouts alone and wait another round.
- **Refs:** vitest.config.ts; apps/server/src/config.test.ts:106; TBD-337
- **Status:** accepted

## TBD-372 · Sender marks are looked up by message, not by email address in the URL
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2
- **Context:** GET /senders/marks?address=... puts the sender's address in request lines, and proxies and ingresses log those lines. That breaks 'email addresses are never logged'.
- **Options:**
  1. Key the lookup by the workspace-scoped message (path in the senders route)
  2. Return the applied mark with the message detail (needs a further schema change)
  3. POST the address in a body
- **Chosen:** A senders-route endpoint keyed by message id. The server reads the From address itself and answers 404 outside the workspace. SenderMarkQuerySchema is dropped. It keeps the address out of every URL, reuses the existing workspace-scoped message lookup and needs no new shared schema.
- **If you decide otherwise:** Choose option 2 for one request fewer, at the cost of a schema change in its own commit first.
- **Refs:** apps/server/src/routes/senders.ts:32; apps/web/src/pages/senders/index.tsx:68; docker/proxy/haproxy.cfg
- **Status:** accepted

## TBD-373 · How words match in the scorer and rules (users notice what gets hidden or capped)
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2
- **Context:** The round-1 whole-word fix missed hyphenated deal-breakers ('Crypto-Exchange'), still let negations fit ('Not permanent', 'No UK work permit'), and left two matchers disagreeing. The rules engine's 'mentions' still matches substrings ('crypto' hides 'Cryptography').
- **Options:**
  1. One whole-token matcher in packages/core/src/rules/words.ts. Hyphen, dot and apostrophe are word breaks for deal-breakers and rule 'mentions'. Any negation (no, not, non, without) makes a permit, contract or seniority verdict unknown
  2. Keep substring matching for deal-breakers
- **Chosen:** Option 1, with tests for each case named in the findings. F4 requires explainable verdicts. Never-guess means unclear wording is 'unknown', never 'fits', and a rule hides only what it really mentions.
- **If you decide otherwise:** Deal-breakers inside compound words would be missed again, or negated wording would count as a fit.
- **Refs:** packages/core/src/match/match.ts:151, :483-600; packages/core/src/rules/engine.ts:189, :277; TBD-326
- **Status:** accepted; its negation words are superseded by TBD-410

## TBD-374 · A failed sender re-check keeps the stored verdict and mark; a missing score or check is shown as pending
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2
- **Context:** FAILED_CHECK overwrote a known high_risk verdict and an editor's mark. The walkthroughs also found that a message whose sender or match stage hadn't produced a result showed nothing at all.
- **Options:**
  1. Derive the failed check from the stored one (never better than caution, high_risk stays, mark kept), and show 'pending / couldn't check yet' in the list and the detail
  2. Keep the constant and the silent UI
- **Chosen:** Option 1. foundation owns the failed check, cvs-senders the sender's pending state and rules-match the pending fit score. F5.3 says a check must never look better than it is, and a person must be able to tell analysis is pending or failed.
- **If you decide otherwise:** A scam could show as merely 'caution' while the mailbox is down, and users would read blank badges as 'done'.
- **Refs:** apps/server/src/pipeline/evaluate.ts:130-160, :296-301; S2/S3 findings
- **Status:** accepted

## TBD-375 · Draft questions on remote and places keep only the parts the answer fills (F7.6)
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2
- **Context:** KEYS_WITH_PARTS copied GROUP_PARTS by hand. For remote and places, the answer's words fill scope or city, which never equal the group key's parts, so the question came back on every draft.
- **Options:**
  1. Derive from the exported GROUP_PARTS; keep parts only where the answer fills every compared field, and otherwise fill those fields from the parts or fall back to the key's own group key
  2. Keep the hand list and special-case remote and places
- **Chosen:** Option 1. One source of truth, and an answered question stays answered (F7.6).
- **If you decide otherwise:** Remote and places questions are asked again after they are answered.
- **Refs:** packages/core/src/decisions/answers.ts:115-130; packages/core/src/profile/changes.ts:238-268; TBD-330
- **Status:** superseded by TBD-381

## TBD-376 · No fix task for the report.md refusal, or for walker 'error logged' entries that report no error or an expected one
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2
- **Context:** The harness refuses report files written by subagents, so the close agent can't write report.md. Several 'error logged' items say there was no error ('No line at level error', 'Leak check 0 matches', '0 console errors', 'both replicas served'). Others are expected: MVP 1's invalid-answer fixture (2 x ai.output_invalid), and errors S11 provokes (app-b exit 137, ERR_INCOMPLETE_CHUNKED_ENCODING, the 502 while IMAP is paused).
- **Options:**
  1. Leave them with no task; the orchestrator writes report.md from the run result (TBD-325)
  2. Edit the workflow script or the fixtures to silence them
- **Chosen:** No task. The real errors in those lists, the opaque stage_failed warnings and the retry flood, are in the foundation task. None of these is a product defect. Changing the running workflow, or working around the harness rule, is not the build's call.
- **If you decide otherwise:** The owner could change build-mvp.js so the close step returns report text and the orchestrator writes it. The assess step could also stop counting 'no error found' lines as failures.
- **Refs:** TBD-325; report.md-written finding; S2/S4/S6/S8/S11 'error logged' items
- **Status:** accepted

## TBD-377 · Fold the re-wrap into the commit instead of adding a style commit
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2 (mailbox)
- **Context:** The finding allowed either a fixup folded into 20e5266 or a separate style(web) commit. 20e5266 was the tip of the branch.
- **Options:**
  1. Amend 20e5266 (it is HEAD)
  2. Add a separate style(web) commit
- **Chosen:** Amend 20e5266, now bfd3c1b. It keeps history clean with no commit that only fixes a slip, needs no rebase, and leaves the other commits untouched. Only a comment changed, so every commit still typechecks.
- **If you decide otherwise:** A style(web) commit on top would work too and would keep the original 20e5266 hash.
- **Refs:** apps/web/src/pages/sync/index.tsx:9-13
- **Status:** accepted

## TBD-378 · No test for comment line width
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2 (mailbox)
- **Context:** The task asks for a test that would have caught the root cause. Here the root cause is that Biome does not reflow comments past lineWidth 100.
- **Options:**
  1. Add a repo-wide check on comment width (root tooling/config)
  2. Add a file-specific check of line widths inside sync.test.tsx
  3. No test
- **Chosen:** No test. A width check belongs in repo-wide tooling, which is outside the paths this task may change. A one-file check in a UI test would be odd and would not cover other files.
- **If you decide otherwise:** The owner could add a small lint step for comment widths at the root (for example inside pnpm check) in a later task.
- **Refs:** biome.json lineWidth 100
- **Status:** accepted

## TBD-379 · Root cause: the reported symptom was an observation error; fixed the real stale-progress gap found while tracing it
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2 (scan-feedback)
- **Context:** The task asked for the root cause of the scan screen reading 0/Scanning at 03:15:25. The r1 transcript and app.log show that snapshot was taken at 03:15:05.9, when 0 was correct, and that /scans/current was refetched every ~2 s with the stop shown by 03:15:35. That leaves nothing on the web side to fix for this report.
- **Options:**
  1. Change the web coalescing (LIVE_SETTLE_MS / LIVE_MAX_WAIT_MS) anyway
  2. Fix the server-side join of an in-flight progress write, which can genuinely leave a finished batch's counts unstored for up to one tick, and add a guard test for the web 2 s budget
  3. Make no code change and report only
- **Chosen:** Fix the server-side join in run.ts with a test that fails today, and add a web guard test for the 2 s budget; leave the coalescing unchanged. The coalescing flushes at most 150 ms after the last event and 1 s after the first, which is within the 2 s budget, and the logs show it working. The joined write is a real path by which a completed batch can stay unseen for more than 2 s (F4.6 / MVP 1 F4), and a deterministic test shows it.
- **If you decide otherwise:** Changing the coalescing would bring back the refetch storm that 7b507e3 fixed, without solving any observed problem. Making no change would leave the stale-row race in place.
- **Refs:** apps/server/src/jobs/scan/run.ts report()/reported(); apps/server/src/jobs/scan/scan.test.ts; apps/web/src/hooks/useLiveEvents.test.tsx; e2e/reports/mvp-2/20261016T030053Z-r1-walkthrough/app.log lines 1143-1196
- **Status:** accepted

## TBD-380 · A failed re-check keeps the stored mark even when the mark itself was what changed
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2 (foundation)
- **Context:** The task says to keep the stored check's mark when the sender stage throws on a re-check. A sender mark change is one of the things that makes a check stale. If an editor clears or changes a mark and the re-check then fails, the stored check still carries the old mark until a later retry succeeds.
- **Options:**
  1. Keep the stored mark, as the task says
  2. Read the current mark from sender_marks inside evaluate.ts
  3. Drop the mark on failure (the old behaviour)
- **Chosen:** Keep the stored mark, as the task says. This is what the fix task asks for. It never loses a known verdict or mark (F5.3). The check is shown incomplete with check_failed, and it is tried again at the next sweep and then with back-off, so the old mark can last only one sync interval up to the back-off cap of an hour. Working out the mark is the sender stage's job (cvs-senders slice), and doing it in evaluate.ts would copy that logic.
- **If you decide otherwise:** If the current mark must show even while the re-check fails, the sender stage port would need a mark-only path that evaluate.ts calls on failure, or evaluate.ts would read sender_marks itself.
- **Refs:** apps/server/src/pipeline/evaluate.ts failedCheck; apps/server/src/pipeline/evaluate.test.ts 'keeps a stored check's verdict and mark when the sender stage fails on a re-check (F5.3)'
- **Status:** accepted

## TBD-381 · How a remote or places question's answer fills the item (F7.6)
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2 (replies)
- **Context:** A draft question asked under remote:EU or places:IE:Dublin:hybrid stored the answer's words ('Yes') as the scope or city, so the answer never matched the group key and the question was asked again. The finding allowed two fixes: fill the fields from the parts, or fall back to the key's own group key.
- **Options:**
  1. Fill scope, city and mode from the group key's parts, and keep the parts
  2. Fall back to the key's own group key (remote, places) and store the words as the scope or city
  3. Turn the question into an extra.<slug> question that stores the words as they are
- **Chosen:** Fill the fields from the parts. The parts are kept only when GROUP_PARTS has a field for each one; otherwise the key's own group key is used. With the fallback, any existing remote entry would count as answering remote:EU, so a question the profile can't really answer would be dropped. That goes against 'Unknown means ask'. It would also store 'Yes' as a remote scope. Filling from the parts keeps EU and US, and Dublin hybrid and Dublin onsite, as separate questions, and an answer adds the item the question named.
- **If you decide otherwise:** With the fallback, one remote entry would hide every later remote question, and the profile would collect scopes like 'Yes'.
- **Refs:** packages/core/src/decisions/answers.ts itemFromText/questionKeys; packages/core/src/profile/changes.ts GROUP_PARTS; packages/core/src/decisions/decisions.test.ts
- **Status:** accepted

## TBD-382 · Drop choices that would write the same item
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2 (replies)
- **Context:** Once the parts fill every field of places:IE:Dublin:hybrid (or remote:EU), the model's 'Yes' and 'No' choices both become the same item, so a 'No' click would add Dublin to the profile.
- **Options:**
  1. Leave out every choice whose item equals another choice's item with a different label (the free-text answer is still offered)
  2. Keep all choices
  3. Keep the first choice only
- **Chosen:** Leave out choices whose labels differ but whose items are the same. A click must never write something its label doesn't say ('Nothing changes without the user's say'). Keeping only the first choice would mean guessing which label means yes, which depends on language. A free-text answer under such a key still adds the item the parts name, whatever the words are; 'Not now' and 'Don't ask for this message' stay available for a no.
- **If you decide otherwise:** One-click 'No' answers would add places or remote scopes the user turned down.
- **Refs:** packages/core/src/decisions/needs.ts needsFromQuestions; test 'leave out choices whose labels differ but whose items don't'
- **Status:** superseded: every choice offered stays clickable; one that declines, or whose words make no item, answers the waiting roles only and writes nothing (7da5d80)

## TBD-383 · Negation words and clause scope for 'plainly says'
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2 (rules-match)
- **Context:** The fix asks for 'unknown' whenever the matched words follow no/not/non/without 'in either text'. 'Nothing market- or user-specific in code' rules out vocabulary lists, and a negation can sit far from the matched words ('No relocation; permanent').
- **Options:**
  1. Negation anywhere earlier in the whole text
  2. Negation earlier in the same clause (clause ends at , ; : ! ? brackets, dashes, line breaks, '. ')
  3. Exact wording only
- **Chosen:** Same-clause negation using the four English function words no/not/non/without. A negation inside the profile's own value ('No sponsorship needed') is matched word for word, so both texts must say the same thing. That covers 'either text' without making such profile values impossible to fit. It catches 'Not permanent, 6 months', 'Non permanent', 'Not senior' and 'Not the EU' without turning 'No relocation; permanent' into an unknown. Negation is grammar, not market vocabulary. Other-language negations (kein, geen, não) are not caught; those cases stay as before (fit only on the same words).
- **If you decide otherwise:** Whole-text scope would give more false unknowns. Adding more languages' negations would mean a word list per language in packages/core/src/rules/words.ts (NEGATIONS).
- **Refs:** packages/core/src/rules/words.ts (NEGATIONS, CLAUSE_BREAK, saysPlainly); packages/core/src/rules/words.test.ts
- **Status:** superseded by TBD-410

## TBD-384 · Remote scopes now need consecutive whole words, not inside joined words
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2 (rules-match)
- **Context:** Using one matcher means scopeCovered now uses saysPlainly instead of 'every profile token appears somewhere in the role scope', with hyphens splitting tokens.
- **Options:**
  1. saysPlainly (joined words stay whole, negations block a fit)
  2. mentions (hyphens break words)
- **Chosen:** saysPlainly. The finding requires 'Non-EU' vs 'EU' to be unknown. With hyphens as breaks, 'Non-EU' would contain 'EU'. The trade-off is that 'EU-only' or 'EU-based' scopes become unknown (score about 10 lower) rather than fits. That is a cautious unknown, never a guessed fit.
- **If you decide otherwise:** To treat 'EU-only' as a fit, scopeCovered in packages/core/src/match/match.ts would need a joined-suffix exception, which would bring back the kind of special-case vocabulary the fix removed.
- **Refs:** packages/core/src/match/match.ts scopeCovered/remotePlaceCovered
- **Status:** superseded by TBD-435

## TBD-385 · Inbox list pending fit score left for a schema/db change
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2 (rules-match)
- **Context:** The fix asks for a pending fit score 'in the list and the detail', but the list slot FitScore only receives `fit`, which is null for non-job mail, for job mail with no roles, and for unscored roles alike. Schema, db inbox and InboxPage are outside this task's paths.
- **Options:**
  1. Show 'pending' for every null fit
  2. Widen FitScore props without a caller
  3. Do the detail only and report the list as not done
- **Chosen:** Detail only; list reported in notDone with the exact change needed. Showing 'pending' on every null fit would show it forever on rejections, newsletters and other mail with no roles, which would be false. Props nobody passes would be dead code.
- **If you decide otherwise:** Whoever owns packages/schema and packages/db adds a pending state to MessageListItem.fit computed from roles without a current evaluation, and FitScore renders it.
- **Refs:** apps/web/src/pages/match/index.tsx FitScore/MatchPanel; packages/db/src/queries/inbox.ts listColumns.fit; packages/schema/src/messages.ts MessageListItemSchema
- **Status:** superseded by TBD-436

## TBD-386 · Helpers are copied into each spec instead of a shared module
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2 (mvp1-specs)
- **Context:** Specs need small helpers: compose and log reading, sign-in and probe sessions. This task may only change e2e/specs/mvp-1/**, playwright.config.ts and fixtures/f53-proof.ts. stack.test.ts fails if specs/mvp-1 holds any entry other than 00-stack, 99-proof or an NN-sN-*.spec.ts, so a helper file or subfolder there is not possible.
- **Options:**
  1. Copy small helpers into each spec
  2. Put the helpers in fixtures/f53-proof.ts or export them from playwright.config.ts
  3. Add e2e/specs/support.ts or e2e/fixtures/specs.ts (outside the allowed paths) and change stack.test.ts
- **Chosen:** Copy small helpers into each spec (about 20-30 lines each: replicaLog, eventsSince or logged, compose). It stays within the allowed paths and the existing naming check. Putting helpers in the proof's guard module or the config file would give them the wrong home.
- **If you decide otherwise:** A later change can move the helpers into one module, for example e2e/fixtures/specs.ts with a knip entry, and import it from the specs. Nothing else changes.
- **Refs:** e2e/specs/mvp-1/*.spec.ts; e2e/stack.test.ts 'names every scenario spec NN-sN-<slug>'
- **Status:** superseded: the specs share their helpers from e2e/specs/shared.ts, and e2e/stack.test.ts checks no spec copies them (b8170dc)

## TBD-387 · S11 sends the slow request and the live stream to app-b's direct port
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2 (mvp1-specs)
- **Context:** S11 needs a slow request and a live-update stream open on app-b when it gets SIGTERM. The proxy load-balances each request round-robin, and the walkthrough retried Test until one landed on app-b.
- **Options:**
  1. Retry Test through the proxy until it lands on app-b
  2. Make the request with curl on :8082 only
  3. Route the browser's ai/test request and EventSource to app-b's direct port, then unroute the stream before the stop so it reconnects through the proxy
- **Chosen:** Route the browser's ai/test request and EventSource to :8082 with page.route; unroute the stream before `docker compose stop app-b`. It's deterministic and keeps the human step of pressing Test in Settings > AI. The POST passes the Origin check because the page's own Origin is http://127.0.0.1:8080. The slow request uses TBD-33's FAKE_AI_SLOW_TEST_MS=15000 on a restarted fake-ai, which is reset to 0 at the end.
- **If you decide otherwise:** Use a retry loop, which can be flaky, or a curl-only stream, which wouldn't show the browser reconnecting.
- **Refs:** e2e/specs/mvp-1/11-s11-startup-health-shutdown.spec.ts; TBD-33; F7.4
- **Status:** superseded: S11 pauses app-a so the proxy sends the slow request and the stream to app-b on the page's own origin (a5dc1d7)

## TBD-388 · Which categories the S5 and S6 corrections change in MVP 2's starting data
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2 (mvp1-specs)
- **Context:** S5 has Maria correct one category and S6 has Tom, once he is an editor, correct one. Both corrections stay in the state MVP 2 starts from.
- **Options:**
  1. Correct analysed messages to another category (this changes job mail MVP 2 matches against)
  2. Correct the always-invalid 'Couldn't analyze' message (it has no roles and the F5.3 proof leaves it out)
- **Chosen:** Maria sets the always-invalid message (maria-0005) to its ground-truth category, Recruiter outreach. Tom then sets the same message to 'Other job mail'. Analysed messages and their roles keep their scan categories, so MVP 2's matching, drafts and the F5.3 proof see what the scan produced. 'Set the category' is the UI's own way forward for a message it couldn't analyze.
- **If you decide otherwise:** Change the message and category picked in 05-s5-job-inbox.spec.ts and 06-s6-inviting-tom.spec.ts. MVP 2 scenarios that depend on those categories would need checking.
- **Refs:** e2e/specs/mvp-1/05-s5-job-inbox.spec.ts, 06-s6-inviting-tom.spec.ts; F5.4
- **Status:** accepted

## TBD-389 · S2 returns to the onboarding AI step by its address
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2 (mvp1-specs)
- **Context:** Each spec gets a fresh browser, but S2 continues the onboarding step S1 left Maria on. After signing in, an admin who already has a mailbox lands in the job inbox, not on 'Pick your AI'.
- **Options:**
  1. Do S2 in Settings > AI, which has Save rather than 'Save and continue'
  2. Sign in, then open /w/<id>/setup/ai
- **Chosen:** Sign in, then open /w/<id>/setup/ai and keep the scenario's 'Save and continue' leading to Start scan. This keeps the onboarding flow the scenario describes. S3 then starts the scan from the Scan page, which uses the same ScanPage component.
- **If you decide otherwise:** Use Settings > AI and check 'Saved.' instead of the move to the scan step.
- **Refs:** e2e/specs/mvp-1/02-s2-maria-picks-the-ai.spec.ts
- **Status:** superseded by TBD-427

## TBD-390 · Tom's two intake answers
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2 (mvp1-specs)
- **Context:** S7 says Tom fills two answers, but no fixture holds his values because his thin mailbox states none.
- **Options:**
  1. Values taken from the persona text in MVP-1.md
  2. Arbitrary values
- **Chosen:** Roles you're looking for: 'Band 6 nurse'; Working languages: 'English'. Both come from the Tom persona in docs/mvp/MVP-1.md. They are what Tom would type, and they stay in his confirmed profile for MVP 2's S1 and S10.
- **If you decide otherwise:** Change the FILLED list in 07-s7-toms-thin-inbox.spec.ts.
- **Refs:** e2e/specs/mvp-1/07-s7-toms-thin-inbox.spec.ts; MVP-1 Personas
- **Status:** accepted

## TBD-391 · Show 'Not checked yet' on every inbox row without a sender check
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2 (cvs-senders)
- **Context:** S2/S3 require a job message without a stored check to say so in the list. The SenderBadge slot's pinned props carry only `sender` (verdict or null), and InboxPage is outside this task's paths, so the badge can't tell a job row from a non-job row.
- **Options:**
  1. Show a neutral 'Not checked yet' badge whenever sender is null
  2. Keep showing nothing for null and leave S2/S3 failing
  3. Add a category prop to SenderBadge that InboxPage doesn't pass yet
- **Chosen:** Show a neutral 'Not checked yet' badge whenever sender is null. A missing badge reads as 'nothing to worry about', which is the unsafe failure for scams (NORTH_STAR, F5). Non-job rows only appear behind the Show toggle, and the badge is true for them too: their sender isn't checked.
- **If you decide otherwise:** If the owner wants no badge on non-job rows, InboxPage (the inbox owner) can pass the category and SenderBadge can return null for not_job; it's a one-line change on each side.
- **Refs:** apps/web/src/pages/senders/index.tsx; apps/web/src/pages/inbox/InboxPage.tsx:152; docs/mvp/MVP-2.md S2, S3, F5.1
- **Status:** superseded by TBD-422

## TBD-392 · Key the mark lookup by the message's RFC Message-ID in the path
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2 (cvs-senders)
- **Context:** The address had to leave the URL. Message-IDs are already URL path segments in the messages routes (/messages/:messageId), so the new route follows the same convention.
- **Options:**
  1. GET /senders/messages/:messageId/mark (server reads From from the workspace-scoped row)
  2. POST a lookup with the address in the body
  3. Return the applied mark inside the message detail
- **Chosen:** GET /senders/messages/:messageId/mark (server reads From from the workspace-scoped row). This is the route shape the finding suggested. It keeps GET semantics and the existing query cache, it is workspace-scoped through packages/db, and a message outside the workspace gets 404. A Message-ID is no more sensitive than the existing /messages/:messageId paths.
- **If you decide otherwise:** Folding the mark into MessageDetail would need a schema and inbox change owned by other workstreams.
- **Refs:** apps/server/src/routes/senders.ts; packages/db/src/queries/senders.ts findMessageSenderMark; apps/web/src/paths.ts apiPaths.messageSenderMark
- **Status:** accepted

## TBD-393 · Make the test setup robust in the files I own, not in the shared test database pool
- **Kind:** decision
- **Where:** MVP 2 · Fix round 2 (assistant)
- **Context:** The cascade comes from a timed-out setup keeping on with shared module variables and pooled PGlite databases. The general fix would be in packages/db/src/testing.ts or apps/server/src/testing, both outside this task's paths.
- **Options:**
  1. Make each owned test's setup publish only while it is current, and close it when superseded
  2. Change openTestDatabase/createTestDeps so a closed database can't be reused while still in use (outside allowed paths)
  3. Raise the hook timeouts (owned by the e2e-fixtures task)
- **Chosen:** Each owned test's setup publishes only while it is current and closes it when superseded (history.test.ts, routes/assistant.test.ts, db queries/assistant.test.ts). It is the root-cause fix the task asked for within its allowed paths, and it makes these files fail only with the real timeout instead of misleading seed and FK errors.
- **If you decide otherwise:** Other test files can still cascade under heavy load until the shared helper or those files get the same protection; the e2e-fixtures or a db-testing task should do it.
- **Refs:** apps/server/src/routes/history.test.ts, apps/server/src/routes/assistant.test.ts, packages/db/src/queries/assistant.test.ts, packages/db/src/testing.ts, vitest.config.ts (isolate:false, hookTimeout 30s)
- **Status:** accepted

## TBD-394 · Create the missing MVP 1 state through the UI before S1
- **Kind:** decision
- **Where:** MVP 2 · Validate (S1)
- **Context:** S1 expects Maria (and Tom) to exist from the MVP 1 scenarios, but the stack had no users. Maria's sign-in failed, and the earlier 'specs' were only stack health checks.
- **Options:**
  1. Stop and report S1 as not walkable
  2. Register Maria and Tom through the UI and set up Maria's AI, then walk S1
  3. Replay all of MVP 1 (mailbox, 600-message scan, intake) first
- **Chosen:** Registered Maria (E2E-SECRET-maria-login) and Tom (E2E-SECRET-tom-login) through the Create account form, saved Maria's AI as OpenAI-compatible http://fake-ai:8080/v1 with key E2E-SECRET-ai-key, then walked S1. S1 needs only an account and a workspace to reach the CVs page. The CVs feature is a stub, so a full MVP 1 replay would not change S1's result, and these minimal steps let the walk still check what a person sees.
- **If you decide otherwise:** If the owner wants MVP 2 runs to replay MVP 1 first, the workflow has to run MVP 1's scenarios or specs that create that state. The current e2e/specs/mvp-1 has only stack checks. The two accounts and Maria's AI settings now exist on stack jobfilly-e2e-20261016-070152 for the later scenarios.
- **Refs:** e2e/reports/mvp-2/20261016T070152Z-r2-walkthrough/specs.log; app.log auth.registered x2, ai.settings_saved
- **Status:** accepted

## TBD-395 · CV fixture files taken from an unmerged branch for the walk
- **Kind:** decision
- **Where:** MVP 2 · Validate (S1)
- **Context:** The CV fixtures needed for the file picker are not on mvp-2.
- **Options:**
  1. Report S1 as unwalkable without files
  2. Use the fixture files from mvp-2-fix-r1-e2e-fixtures, unchanged, in the scratchpad
- **Chosen:** Took them with git show into the session scratchpad. Nothing was committed or added to the tree. This keeps the walk faithful to the spec's fixtures without changing the branch. In the end it made no difference: the page has no upload control.
- **If you decide otherwise:** Nothing changes; the files are outside the repo.
- **Refs:** git show mvp-2-fix-r1-e2e-fixtures:e2e/fixtures/maria/cvs/*
- **Status:** accepted

## TBD-396 · Did not complete Maria's MVP 1 onboarding (connect mailbox, scan, confirm profile) during the S2 walkthrough
- **Kind:** decision
- **Where:** MVP 2 · Validate (S2)
- **Context:** Maria's workspace had no mailbox, and S2 relies on MVP 1's end state. Completing it would mean walking MVP 1's S1 to S5, which this task doesn't list. It also wouldn't change the outcome, because this build has no sync job, no seed deliver and no usage view.
- **Options:**
  1. Walk MVP 1 onboarding inside S2 to create the precondition
  2. Report the missing precondition and walk S2 as far as it goes
- **Chosen:** Report the missing precondition and walk S2 as far as it goes. The protocol limits each walkthrough to the steps the scenario lists. Merging the slices is the real fix, and replaying MVP 1's scenarios belongs to the run, not to S2.
- **If you decide otherwise:** If the orchestrator wants scenario agents to set up missing earlier-MVP state themselves, S2 would first connect Maria's mailbox (Other IMAP, E2E-SECRET-maria-imap), run the scan and confirm the profile. On this build S2 would still fail F1.1, F1.2, F1.5 and F1.6.
- **Refs:** docs/mvp/README.md 'The test stack' (MVP 2 relies on the profile Maria confirmed in MVP 1); docs/mvp/MVP-2.md S2
- **Status:** accepted

## TBD-397 · Walk S3 against the given stack instead of rebuilding the missing earlier state
- **Kind:** decision
- **Where:** MVP 2 · Validate (S3)
- **Context:** S3 assumes Maria's MVP 1 profile, her three CVs from S1 and the Berlin message delivered in S2. None of these exist in the stack: no mailbox, no seed deliver command, no CV fixtures.
- **Options:**
  1. Walk S3 as far as the UI allows and report it failed
  2. Connect Maria's mailbox and run the MVP 1 setup myself to make the state
  3. Mark S3 not run
- **Chosen:** Walk S3 as far as the UI allows and report it failed. The protocol says a scenario starts from the state earlier scenarios leave behind, and a scenario counts as passed only if it was walked. Even with the setup redone, the Berlin role can't be delivered and the match, CV and draft UI are stubs, so the outcome would be the same and the stack would be left in a state the next agents don't expect.
- **If you decide otherwise:** If the owner wants each walkthrough agent to rebuild missing preconditions, the S3 agent would also do the mailbox setup and scan. S3 would still fail until seed deliver and inspect, the delivered-mail and CV fixtures, and the MVP 2 UI exist.
- **Refs:** docs/mvp/README.md 'Validation protocol' and 'One run plays the scenarios of every MVP up to the current one'; e2e/seed/main.ts; apps/web/src/pages/{match,cvs,drafts}/index.tsx
- **Status:** accepted

## TBD-398 · Report S4 as failed instead of building missing state by other means
- **Kind:** decision
- **Where:** MVP 2 · Validate (S4)
- **Context:** S4 needs a remote-EU draft, a data-engineering role and the Data engineering (EN) CV. None of these exist, and none can be created through the UI or the seed on this stack, because the MVP 2 code and fixtures are not merged into mvp-2.
- **Options:**
  1. Mark S4 failed with the evidence, and name the root cause (slice branches not merged)
  2. Create the state with API calls or database writes
  3. Rebuild the stack from an unmerged slice branch
- **Chosen:** Mark S4 failed with the evidence, and name the root cause (slice branches not merged). The validation protocol forbids API calls and database reads during the walkthrough, and it forbids marking a scenario passed unless it was walked. Rebuilding the stack from another branch is outside a walkthrough agent's remit and would not validate mvp-2.
- **If you decide otherwise:** If the orchestrator merges the verified slice and fix branches into mvp-2 and starts a fresh stack (replaying MVP 1's scenarios first), S4 can be walked for real.
- **Refs:** docs/mvp/README.md (Validation protocol 1, Quality gates); git branch --no-merged mvp-2; apps/server/src/routes/drafts.ts; apps/server/src/routes/cvs.ts; apps/web/src/pages/drafts/index.tsx; apps/web/src/pages/cvs/index.tsx; e2e/seed/main.ts
- **Status:** accepted

## TBD-399 · Did not rebuild the MVP 1 state (mailbox, AI, scan, profile) to reach S5
- **Kind:** decision
- **Where:** MVP 2 · Validate (S5)
- **Context:** Maria has no mailbox connected in this run. S5 relies on state from MVP 1 and from MVP 2 S2, which delivers the Zurich, Basel and Dublin roles with 'seed deliver'.
- **Options:**
  1. Run MVP 1 S1–S5 by hand inside this S5 walkthrough
  2. Walk what S5 can reach, record the missing state and features, and mark it failed
- **Chosen:** Walk what S5 can reach, record the missing state and features, and mark it failed. The protocol allows only the steps S5 lists. Even with the MVP 1 state rebuilt, S5 still couldn't run: 'seed deliver' and the delivery fixtures don't exist, and the decision inbox is a stub on every layer.
- **If you decide otherwise:** Rebuilding the MVP 1 state would change S5's outcome only after the replies slice, the seed 'deliver' command and the MVP 2 fixtures are built.
- **Refs:** apps/web/src/pages/decisions/index.tsx; apps/server/src/routes/decisions.ts; e2e/seed/main.ts; e2e/reports/mvp-2/20261016T070152Z-r2-walkthrough/specs.log
- **Status:** accepted

## TBD-400 · Did not set up S6's missing preconditions by hand during the walkthrough
- **Kind:** decision
- **Where:** MVP 2 · Validate (S6)
- **Context:** S6 starts from the state earlier scenarios leave behind: Maria's connected mailbox, the first scan's backlog with the scam, and the MVP 2 delivered mail. None of it exists on this stack, and S6 lists no infrastructure steps.
- **Options:**
  1. Report S6 as failed and leave the stack untouched
  2. Connect Maria's mailbox through the UI, run `seed load maria` and a scan to create the backlog, then walk S6
- **Chosen:** Report S6 as failed and leave the stack untouched. The validation protocol allows infrastructure steps only where the scenario lists them. Rebuilding MVP 1 state would change the shared stack for the scenarios after this one. And even with that state, the scenario still couldn't pass: `seed deliver` doesn't exist, the dns/rdap services are missing, and the sender check and sender-mark route are stubs that return 501.
- **If you decide otherwise:** If the owner wants S6 walked from a rebuilt state, the run must first replay MVP 1's S1–S5 (mailbox, AI, scan, profile) on the stack. The F5 slice (domain lookups, sender marks, badge), the dns/rdap services and seed deliver must also be built before S6 can pass.
- **Refs:** docs/mvp/README.md › Validation protocol §1 and The test stack; docs/mvp/MVP-2.md S6, F5; apps/server/src/routes/senders.ts; apps/server/src/senders/lookup.ts; e2e/seed/main.ts; docker/compose.e2e.yaml
- **Status:** accepted

## TBD-401 · Did not create the missing MVP 1 / S2 state myself to make S7 walkable
- **Kind:** decision
- **Where:** MVP 2 · Validate (S7)
- **Context:** S7 needs the Amsterdam and Singapore roles (delivered in S2), a job alert and the first scan's backlog with Maria's confirmed profile (MVP 1). None of that exists on the stack. S7 lists no infrastructure steps.
- **Options:**
  1. Connect Maria's mailbox, run the first scan, confirm intake and `seed deliver` the batch myself, then walk S7
  2. Walk S7 as written on the state the run left behind and report it as blocked
- **Chosen:** Walk S7 as written and report it as blocked. The protocol allows infrastructure steps only where a scenario lists them, and S7 lists none. Replaying MVP 1 S1-S5 and MVP 2 S2 inside S7 would mean walking other scenarios under S7's name and changing the state that S8-S12 start from. Also, with match/rules/drafts still returning 501, recreating the state would not make any S7 criterion pass.
- **If you decide otherwise:** The validation phase should run the MVP 1 scenarios (or their specs) first on the fresh stack, merge the MVP 2 slice branches, then walk S7 again. Only then can F4.2, F6.1 and F1.6 be judged.
- **Refs:** docs/mvp/README.md 'The test stack' (one run plays every MVP's scenarios in order; MVP 2 relies on the profile Maria confirmed in MVP 1); docs/mvp/MVP-2.md S7
- **Status:** accepted

## TBD-402 · Rebuild S10's starting state through the UI
- **Kind:** decision
- **Where:** MVP 2 · Validate (S10)
- **Context:** S10 starts with 'Maria sets Tom back to Viewer', which assumes MVP 1 S6 left Tom as an Editor in Maria's workspace. In this run Tom was not a member: app.log had no invite or role events, and the Members page listed only Maria.
- **Options:**
  1. Mark S10 as failed on its precondition and stop
  2. Create the precondition the way a person would (Maria invites Tom as Editor, Tom accepts), then walk S10
- **Chosen:** Create the precondition through visible UI: Members > invite tom.okafor@inbox.example as Editor > Tom signs in and presses Accept > Maria sets him to Viewer. This uses only person-level actions that MVP 1 already specifies. It lets the walk test the parts of S10 that can be tested (role change, viewer nav, server 403s) without editing the spec, and it reports the gap instead of hiding it.
- **If you decide otherwise:** S10 would have produced no evidence at all, and the role-guard behaviour would have gone untested in this run.
- **Refs:** docs/mvp/MVP-1.md S6; docs/mvp/MVP-2.md S10; log 07:41:57Z workspace.invite_created, 07:42:29Z workspace.invite_accepted, 07:42:50Z workspace.role_changed
- **Status:** accepted

## TBD-403 · Probe with made-up ids because no proposal, decision or draft exists
- **Kind:** decision
- **Where:** MVP 2 · Validate (S10)
- **Context:** The probes need a real proposal, decision and draft id. None can exist, because the handlers are 501 stubs.
- **Options:**
  1. Skip the probes
  2. Probe with syntactically valid made-up UUIDs and compare the result with an editor (Maria)
- **Chosen:** Made-up UUIDs, with Maria's session as a control (501 for her, 403 for Tom). The control shows the 403 comes from the role check, not from a missing object. The result is reported with that limit.
- **If you decide otherwise:** The role guard would have gone unverified on the live stack.
- **Refs:** apps/server/src/routes/{assistant,decisions,drafts}.ts; log 07:43:47Z 403 lines
- **Status:** accepted

## TBD-404 · Connected Maria's mailbox through the UI before walking S11
- **Kind:** decision
- **Where:** MVP 2 · Validate (S11)
- **Context:** S11 assumes the state earlier scenarios leave behind, but Maria's workspace had no connected mailbox. Without one, the missing sync events would prove nothing about the sync itself.
- **Options:**
  1. Walk S11 with no mailbox and report everything as precondition-blocked
  2. Connect Maria's mailbox as a person would (Other IMAP, imap:3143, plain text), without starting a scan, so the sync and outage steps could be observed
- **Chosen:** Connected the mailbox through the visible setup form (Test connection showed 'Connected: Inbox, Sent', then Save and continue), kept the AI settings already saved, and did not start a scan. It produces direct evidence that no sync runs for a connected mailbox, which separates a missing feature from missing setup. It uses only person actions in the UI and adds no scan data that later regression specs might trip on.
- **If you decide otherwise:** Maria's workspace would still have no mailbox. If the next scenario or spec run (S12) expects a workspace without a mailbox, disconnect it under Settings › Mailbox, or start a fresh stack.
- **Refs:** app.log mailbox.connected 2026-10-16T07:46:42.520Z mailboxId 3704779f-2035-411e-905e-254116593acc
- **Status:** accepted

## TBD-405 · Killed app-b although no sync.started instance existed
- **Kind:** decision
- **Where:** MVP 2 · Validate (S11)
- **Context:** The scenario says to kill the replica named in the next sync.started, but no sync.started was ever logged.
- **Options:**
  1. Skip the kill step
  2. Kill one replica anyway to see whether a lease or sync is taken over and whether the UI survives
- **Chosen:** Killed app-b at 07:51:02Z and started it again at 07:52:37Z. It still exercises the takeover path. No job.lease_expired appeared, which confirms there was no sync job to take over, and it shows the UI keeps working through app-a.
- **If you decide otherwise:** Nothing would change in the result; the step would just be recorded as not performed.
- **Refs:** app.log app-b server.ready 2026-10-16T07:52:38.169Z
- **Status:** accepted

## TBD-406 · How to walk S12 'All MVP 1 specs pass'
- **Kind:** decision
- **Where:** MVP 2 · Validate (S12)
- **Context:** S12 has no UI steps and no camera mark. The MVP 1 spec suite has no scenario specs (only a stack smoke test and a skipped F5.3 proof), so running it proves little about MVP 1 behaviour.
- **Options:**
  1. Only run `pnpm e2e:specs --mvp 1` and report its result
  2. Run the specs, then walk MVP 1's main paths by hand in the browser (scan, intake confirm, inbox facts, Esc, sign-out/Back/sign-in)
  3. Re-walk all of MVP 1 S1-S11 on this stack
- **Chosen:** Ran the specs, then did a short hand walk of MVP 1's main paths as Maria. This included pressing Start scan and confirming the intake with Amsterdam removed, because no MVP 1 scan or profile existed yet in this run. I saved 3 evidence screenshots, although S12 marks no camera step. The criterion is literally the specs, so running them is the scenario. The specs cover no MVP 1 scenario, so a visible-UI walk was the only real regression evidence. S12 is the last scenario, so changing state (scan, profile) no longer affects later steps. A full S1-S11 re-walk would re-register users and repeat infrastructure steps the scenario doesn't list.
- **If you decide otherwise:** If only the spec run counts, S12 is '3 passed, 2 skipped' and fails on the skips. If S12 is meant to re-prove MVP 1's scenarios, they must first be codified with the names fixed in e2e/fixtures/f53-proof.ts (TBD-148/TBD-324) and run on a fresh stack before MVP 2's scenarios.
- **Refs:** docs/mvp/MVP-2.md S12; docs/mvp/README.md 'How an MVP ends'/'Sign-off'; TBD-324; e2e/reports/mvp-2/20261016T070152Z-r2-walkthrough/S12-specs-mvp-1.log, S12-01..03 screenshots
- **Status:** accepted

## TBD-407 · Count skipped specs as not passing
- **Kind:** decision
- **Where:** MVP 2 · Validate (S12)
- **Context:** The spec run exits 0 with 3 passed and 2 skipped, and the workflow's computed task describes the earlier run as 'all passed'.
- **Options:**
  1. Treat exit 0 as S12 passed
  2. Treat skipped specs as not passing, so S12 fails
- **Chosen:** S12 reported as not passed. 'All MVP 1 specs pass' cannot hold while 2 of 5 specs never run, and README's sign-off requires earlier MVPs' specs to pass rather than skip. Marking it passed would claim a check that never ran.
- **If you decide otherwise:** If the owner accepts the skip guard (TBD-142) as compliant during walkthrough rounds, S12 passes on the 3 stack specs plus the hand walk. The confirm run must still have codified MVP 1 specs.
- **Refs:** e2e/specs/mvp-1/99-f5.3-stored-equals-expected.spec.ts; e2e/fixtures/f53-proof.ts; TBD-142
- **Status:** accepted

## TBD-408 · Every slice's fixes continue its newest fix-r2 branch, scoped to the verifier findings
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3
- **Context:** Validation failed in S1-S12 for one main reason: no MVP 2 slice or fix branch is merged into mvp-2 (HEAD 8e79340, only fix-r1-web-shell). In rounds 1 and 2 each slice's fix branch failed verification, so the integrate step never merged it, and the stack ran foundation stubs.
- **Options:**
  1. Continue each slice's newest fix-r2 branch, scoped to its verifier findings plus the validation criteria it owns
  2. One task that merges every branch into a fresh branch and fixes everything
  3. A task that changes .claude/workflows/build-mvp.js so unverified branches merge too
- **Chosen:** Continue each slice's newest fix-r2 branch, scoped to its verifier findings plus the validation criteria it owns. The fix-r2 branches are the newest version of each slice (fix-r2-cvs-senders and fix-r2-mailbox are rebased rewrites of r1, and the others descend from r1). Fixing exactly what blocked verification is what lets them merge. One merge-everything task would be judged on about 100 items and would almost surely fail some, which would again merge nothing. Changing the workflow mid-run has no effect on the script that is running, and loosening the verify gate is the owner's call, not the build's.
- **If you decide otherwise:** If verification keeps failing on new hygiene findings, mvp-2 stays stubs and every validation round fails the same way. The owner may then want the integrate step to merge branches whose criterion findings pass even when hygiene findings remain.
- **Refs:** .claude/workflows/build-mvp.js:296-305, 384-422; git branch --no-merged mvp-2
- **Status:** accepted

## TBD-409 · Rules-match and assistant go into one task on mvp-2-fix-r2-assistant
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3
- **Context:** mvp-2-fix-r2-assistant already holds mvp-2-rules-match (merge 2575ca8) and changes its files (words.ts, engine.test.ts, match/index.tsx). The rules-match fixes (febc022, 5025fb4, 5b438b2) aren't in it, and both branches' findings touch apps/web/src/pages/match/index.tsx and packages/core/src/rules.
- **Options:**
  1. Two tasks with overlapping paths
  2. One task on the assistant branch that first merges mvp-2-fix-r2-rules-match
- **Chosen:** One task on the assistant branch that first merges mvp-2-fix-r2-rules-match. Owned paths must not overlap, and the two slices share files. With one branch the integrator merges both slices together and resolves the rules and match conflicts once.
- **If you decide otherwise:** Two tasks would both edit match/index.tsx and words.ts, and integration would conflict between two diverging fixes of the same code.
- **Refs:** git log --merges mvp-2..mvp-2-fix-r2-assistant; git diff mvp-2-rules-match mvp-2-fix-r2-rules-match --stat
- **Status:** accepted

## TBD-410 · Contract, seniority, permit and remote fits: no built-in negation word list; anything not a plain match is unknown
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3
- **Context:** saysPlainly decides 'fits' unless one of four English words comes first. It misses "isn't" and every other language ('Keine Festanstellung' fits 'Festanstellung'), which breaks 'Unknown means ask' and 'Nothing market-specific in code'.
- **Options:**
  1. Add more English negations (n't)
  2. Claim a fit only when the role's and the profile's wording match once normalised (or the profile phrase stands alone in its clause), and make everything else unknown
  3. Move the judgement into match.v1 in packages/ai
- **Chosen:** Claim a fit only when the role's and the profile's wording match once normalised (or the profile phrase stands alone in its clause), and make everything else unknown. It is language-neutral, never guesses, and stays inside packages/core. The match.v1 route would need changes in packages/ai/src/tasks and the fake-AI fixtures, which other tasks own this round.
- **If you decide otherwise:** Users will see more 'unknown' verdicts, and so more decisions, on loosely worded contracts. If that turns out too noisy, the owner can move the judgement to match.v1 later.
- **Refs:** packages/core/src/rules/words.ts:86-138; packages/core/src/match/match.ts:258-530; NORTH_STAR 'Fully dynamic across markets'
- **Status:** accepted

## TBD-411 · A 'No' answer under a grouped decision resolves it for those roles without writing a profile item; contradicting free text gets the 400 'doesn't fit'
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3
- **Context:** answers.ts fills the item from the group key's parts after the user's words, so 'No' or 'Cork' writes Dublin hybrid into the profile. needs.ts drops both Yes and No, which leaves nothing to click.
- **Options:**
  1. Refuse every negative answer
  2. Affirmative choice writes the parts' item; negative choice resolves the decision for the waiting roles and writes nothing; contradicting free text gets 400
  3. Store whatever the words say and ignore the parts
- **Chosen:** Affirmative choice writes the parts' item; negative choice resolves the decision for the waiting roles and writes nothing; contradicting free text gets 400. It keeps answers clickable (F7.2), never writes what the user turned down ('Nothing changes without the user's say') and never guesses.
- **If you decide otherwise:** Refusing every 'No' would leave roles waiting forever. Storing the words would bring back the parts-versus-words mismatch the F7.6 grouping fix addressed.
- **Refs:** packages/core/src/decisions/answers.ts:75-81,159; needs.ts:84-88; apps/server/src/routes/decisions.ts:70-96
- **Status:** superseded: draft.v1 now says which choices decline (4827ae9); a declining choice, or typed words that state no item, answers the waiting roles only and writes nothing instead of getting a 400 (7da5d80)

## TBD-412 · Sender checks show 'Not checked yet' only for job mail
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3
- **Context:** The new state shows on every message without a check and promises a check that never comes for non-job mail.
- **Options:**
  1. Keep it on every message
  2. Show it only for job mail, and nothing (or 'Sender checks are for job mail only') for other mail
- **Chosen:** Show it only for job mail, and nothing (or 'Sender checks are for job mail only') for other mail. F5.1 covers job-mail senders, and the pipeline checks only job mail, so the notice on other mail is false.
- **If you decide otherwise:** Non-job rows would keep showing a permanent 'Not checked yet'.
- **Refs:** apps/web/src/pages/senders/index.tsx:44,151-156; packages/db/src/queries/evaluations.ts:39-43
- **Status:** accepted

## TBD-413 · Shared files get exactly one owner: ARCHITECTURE goes to the foundation task, test timeouts to e2e-fixtures, db tables and migrations to replies; no task edits TBD.md
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3
- **Context:** docs/ARCHITECTURE.md, vitest.config.ts, packages/db/src/tables.ts and the migrations are changed on several slice branches, and owned paths must not overlap.
- **Options:**
  1. Let several tasks edit them
  2. One owner each; other tasks report boundary changes as decisions and rerun timeout-only failures alone
- **Chosen:** One owner each; other tasks report boundary changes as decisions and rerun timeout-only failures alone. Only the foundation task needs an ARCHITECTURE edit (the mailbox split). The load-tolerant timeouts already started on the e2e-fixtures branch. Of all the tasks, only the replies task might need a table change. The orchestrator records TBD entries from results.
- **If you decide otherwise:** Overlapping edits would conflict at integration.
- **Refs:** CLAUDE.md Docs rule; .claude/workflows/build-mvp.js:387
- **Status:** accepted

## TBD-414 · The fixture check against the real rules engine waits until the engine and the fixtures are both on mvp-2
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3
- **Context:** consistency.test.ts carries a drifting copy of rule matching. The real engine is on the rules-assistant branch and the fixtures are on the e2e-fixtures branch, so neither branch can run that check alone.
- **Options:**
  1. Keep the copy
  2. Delete the copy, keep the semantics-free assertions, and add the engine-based fixture test in packages/core after integration
- **Chosen:** Delete the copy, keep the semantics-free assertions, and add the engine-based fixture test in packages/core after integration. A copy measures itself rather than the engine, which is the same pattern that 582eab3 and 459c240 removed.
- **If you decide otherwise:** The fixture checks would disagree with the engine on the unbefristet/befristet case.
- **Refs:** e2e/fixtures/consistency.test.ts:1558-1590
- **Status:** accepted (done: packages/core runs the real engine over the persona fixtures, fc8737e)

## TBD-415 · No code task for the unwritten report.md
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3
- **Context:** The close step's Write of e2e/reports/mvp-2/…-r2-walkthrough/report.md was refused by the harness ('Subagents should return findings as text'). The content is in the close result.
- **Options:**
  1. Create a fix task for it
  2. Leave it to the orchestrator or a step that is allowed to write run reports
- **Chosen:** Leave it to the orchestrator or a step that is allowed to write run reports. It is a run artifact blocked by the agent harness, not a defect in the repository.
- **If you decide otherwise:** A fix task would have no source change to make.
- **Refs:** close result of validation run 2
- **Status:** accepted

## TBD-416 · The check that hide-by-contract rules spare permanent roles moves to packages/core
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3 (e2e-fixtures)
- **Context:** The e2e fixture check had its own copy of rule matching, with `contains` matching substrings. The real rules engine (rules-match) matches `contains` on whole words, so the two disagree on unbefristet/befristet. e2e imports no package code, and the engine is not on this branch.
- **Options:**
  1. Keep the copy in e2e
  2. Delete the copy, keep only checks that need no matching semantics, and later check against the real engine from packages/core
  3. Import the engine into e2e
- **Chosen:** Delete the copy and keep only the presence checks: permanent contracts in maria/expected.json, and hide-by-contract conditions in assistant/requests.json. Once both are on mvp-2, packages/core runs the real engine against the fixtures, the way packages/core/src/sender/fixtures.test.ts already checks the sender data. A copy of the engine can only drift from it. The fixture-to-package direction is already set up: packages/schema/src/fixtures.test.ts and packages/core/src/sender/fixtures.test.ts both read e2e fixtures, and e2e imports no package code.
- **If you decide otherwise:** Keeping the copy would let fixture checks pass or fail on matching rules the app doesn't use, and the unbefristet/befristet case would be checked wrongly.
- **Refs:** e2e/fixtures/consistency.test.ts (commit 4415544); a follow-up packages/core rules fixture test once rules-match and the fixtures are both on mvp-2
- **Status:** accepted (done: packages/core runs the real engine over the persona fixtures, fc8737e)

## TBD-417 · Core tests read the fixtures with node:fs and are typechecked by their own tsconfig
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3 (e2e-fixtures)
- **Context:** The task allowed either a packages/core/tsconfig.test.json, or reading with node:fs and dropping the ImportMeta augmentation.
- **Options:**
  1. tsconfig.test.json only, keeping import.meta.glob and the augmentation
  2. node:fs only
  3. Both: node:fs plus tsconfig.test.json with Node types
- **Chosen:** Both. The test uses node:fs, tsconfig.json excludes *.test.ts, and tsconfig.test.json (types: node) checks the tests. The typecheck script runs both. This matches packages/schema. Production core keeps types: [] and has no I/O types, and no global type augmentation is left anywhere.
- **If you decide otherwise:** Keeping the glob augmentation would carry a hand-written copy of Vite's types in the test.
- **Refs:** packages/core/tsconfig.json, packages/core/tsconfig.test.json, packages/core/package.json (commit b6544dd)
- **Status:** accepted

## TBD-418 · Which errors count as 'the mail server can't be used' (MailUnavailableError)
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3 (mailbox)
- **Context:** The finding asked that only connection, IMAP and TLS errors map to MailUnavailableError and that everything else be rethrown. imapflow has no single error class, so I needed a rule that recognises its errors and Node's socket/TLS errors.
- **Options:**
  1. Recognise errors by their known properties: MailError, authenticationFailed/tlsFailed, an IMAP responseStatus/serverResponseCode, imapflow's own codes (ImapFlowErrorCode: connection, timeout, server-response, parser kinds), Node E* socket and DNS codes, and TLS codes
  2. Treat any error that has a string `code` as a mail error
  3. Keep mapping everything (the old behaviour)
- **Chosen:** Recognise errors by their known properties (isMailFailure in packages/mail/src/errors.ts). This keeps bugs and schema mismatches (RangeError, ZodError, TypeError with Node ERR_* codes) out of the 'unreachable' status. Real server, network and TLS failures still show as can't-reach, with back-off and retry. A rule based on any string code would also catch Node ERR_ programming errors.
- **If you decide otherwise:** If imapflow adds a new error code that isn't on the list, that failure would show as reason `error` ('Something went wrong while syncing') instead of 'unreachable'. The sync still retries it with back-off; only the status wording differs. Fix by adding the code to IMAPFLOW_CODE.
- **Refs:** packages/mail/src/errors.ts (isMailFailure), packages/mail/src/client.ts (available), apps/server/src/sync/run.ts:426-436
- **Status:** accepted

## TBD-419 · A schema mismatch in what the server sent fails the whole sync with reason `error`
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3 (mailbox)
- **Context:** fetchSince now parses the whole result with FetchSinceResultSchema. One value that is still invalid after the INTERNALDATE fix (for example a non-numeric UIDVALIDITY) makes that sync fail as `error` and back off, instead of leaving out only the bad message.
- **Options:**
  1. Parse the whole result and fail the sync (shows 'Something went wrong', retried with back-off)
  2. Drop only the messages that fail the schema and sync the rest
- **Chosen:** Parse the whole result and fail the sync. This matches the 'validated where it enters' rule and the finding's fix. A dropped message would never be seen again once the cursor moves past it, which loses mail without anyone noticing. The fields that can still fail now are ones the server itself controls (UIDVALIDITY, UID), not message content, so a failure there points to a real server problem.
- **If you decide otherwise:** If the owner would rather sync the rest, change fetchSince to safeParse each SyncedEnvelope and log and skip the invalid ones. The cursor logic in sync/run.ts would then need to keep the cursor from moving past a skipped UID.
- **Refs:** packages/mail/src/client.ts (fetchSince), packages/schema/src/mailbox.ts (FetchSinceResultSchema)
- **Status:** accepted

## TBD-420 · How to keep a single messages.updated on a category correction
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3 (foundation)
- **Context:** requestReevaluation published messages.updated {} and the category route published a second one, {messageIds:[id]}.
- **Options:**
  1. Remove the route's second publish (the event becomes {} with no ids)
  2. Have requestReevaluation publish the scope's messageIds when the scope is {messageIds}, and remove the route's publish
- **Chosen:** requestReevaluation publishes {messageIds:[...]} for a messageIds scope ({} for every other scope), and the route publishes nothing of its own. The single event still tells the inbox which message changed, as the route meant to. Every other caller of a messageIds scope (CV delete, CV override, decisions) gets the same more precise event for free.
- **If you decide otherwise:** If only the route's publish were removed, the event would carry no ids; the web UI refetches the list either way, so users wouldn't notice.
- **Refs:** apps/server/src/profile/changes.ts, apps/server/src/routes/messages.ts, apps/server/src/routes/messages.test.ts
- **Status:** accepted

## TBD-421 · Upper bound for a role position path param
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3 (foundation)
- **Context:** RoleParamsSchema.position had no upper bound; every position column is int4.
- **Options:**
  1. .max(2_147_483_647), the int4 limit
  2. .max(10_000), the earlier bound
- **Chosen:** .max(2_147_483_647), as a module constant MAX_ROLE_POSITION. It is exactly what the columns hold, so the schema never rejects a position the database could store and never lets through one it can't. A role-count limit isn't in the spec.
- **If you decide otherwise:** With 10_000, positions from 10_001 up would be refused as 404 even though the database could hold them.
- **Refs:** packages/schema/src/cv.ts, packages/schema/src/index.test.ts
- **Status:** accepted

## TBD-422 · Where the 'job mail only' gate lives, and what non-job and failed mail say
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3 (cvs-senders)
- **Context:** The fix could gate SenderBadge and SenderPanel in InboxPage and MessageDetail, or inside the senders slot. The task also left open whether non-job detail hides the panel or explains itself, and said nothing about mail the model failed on, which is also never checked.
- **Options:**
  1. Gate in InboxPage/MessageDetail and hide the panel for non-job mail
  2. Pass category and analysisStatus to the slot, gate inside it, keep the panel with an explanation
- **Chosen:** Pass category and analysisStatus to SenderBadge and SenderPanel, and gate inside the senders slot. Non-job mail says 'Sender checks are for job mail only.' and failed mail says 'This sender isn't checked, as the email couldn't be analyzed.' Trusted and Blocked stay available to editors on both. One rule in the slice that owns sender checks, matching the db's isJobMessage (job category, analysis done). The page never says nothing or something false, and a sender can still be marked from any of its emails. Failed job-category mail is never checked either, so promising a check there would be the same bug.
- **If you decide otherwise:** If the owner prefers hiding the panel for non-job mail, return null from SenderPanel when isCheckedMail is false and there is no check. This drops the marks on non-job mail.
- **Refs:** apps/web/src/pages/senders/index.tsx (isCheckedMail, NoCheck); packages/db/src/queries/evaluations.ts:39-43
- **Status:** accepted

## TBD-423 · NOTIFY on the existing dedicated LISTEN connection rather than a third connection or the pool
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3 (scan-feedback)
- **Context:** A NOTIFY through the pool queued behind every pooled query, so live events were late while the pipeline kept the pool busy.
- **Options:**
  1. Keep NOTIFY through the pool
  2. Add a second dedicated connection just for NOTIFY
  3. NOTIFY on the existing dedicated LISTEN connection
- **Chosen:** NOTIFY on the existing dedicated LISTEN connection; pgNotifier no longer takes a pool. It removes the pool wait without adding a Postgres connection per replica. All NOTIFYs from a replica now go out in order on one session. Postgres still delivers a session's own notifications to it, which the local streams need. A NOTIFY reopens the connection at once if it has dropped.
- **If you decide otherwise:** A separate NOTIFY client would let a LISTEN reconnect and a NOTIFY fail independently, at the cost of one more connection per replica. Keeping the pool would leave the measured 150-400 ms+ wait per event under load.
- **Refs:** packages/db/src/notify.ts, packages/db/src/client.ts, packages/db/src/notify.test.ts
- **Status:** accepted

## TBD-424 · Live events from a scan run go out from an ordered, coalescing outbox that the run never awaits
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3 (scan-feedback)
- **Context:** Storing had to be separated from publishing, and the stop must still be the last event.
- **Options:**
  1. Fire each publish independently (concurrent, unordered)
  2. Ordered outbox, not awaited, newer scan.progress replacing a waiting one
  3. Keep awaiting publishes
- **Chosen:** Ordered outbox; the job waits for it only at the very end. Writes and batches never wait on NOTIFY. Order is kept, so no progress goes out after scan.stopped. With all NOTIFYs on one connection they are serialised anyway, so this costs nothing in practice. Coalescing keeps the queue short while NOTIFY is slow.
- **If you decide otherwise:** Unordered publishes could deliver a progress event after the stop, and the existing hub-order assertions would break.
- **Refs:** apps/server/src/jobs/scan/run.ts
- **Status:** accepted

## TBD-425 · The browser applies scan.progress and scan.stopped data directly to the current-scan query
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3 (scan-feedback)
- **Context:** Even with fast events, the screen waited for GET /scans/current, which under pool load took 0.8-2.8 s by itself; the routes are outside this task's paths.
- **Options:**
  1. Only refetch on events (as before)
  2. Apply event data at once, guarded, and still refetch
- **Chosen:** Apply at once with guards (same scan, status and counts never move back, nothing after a stop), cancel a request under way, then refetch as before. The event carries exactly what was stored, so the screen can show it without a database round trip. The refetch still fills in stoppedAt and totalTokens. Users see faster updates and no other behaviour change; for a moment after a stop, the 'Ended …' time is missing until the refetch answers.
- **If you decide otherwise:** Without it, the 2 s bound depends on how fast GET /scans/current answers under load, which the measurement showed can pass 2 s.
- **Refs:** apps/web/src/hooks/useLiveEvents.ts, apps/web/src/hooks/queryKeys.ts, apps/web/src/pages/scan/queries.ts
- **Status:** accepted

## TBD-426 · Changed the r2 held-tick test's exact assertion to a lower bound
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3 (scan-feedback)
- **Context:** The test 'stores each finished batch's counts before it says so live, also while a tick is still being sent' asserted that what was stored when each messages.updated was published equalled [0, 20, 25, 25] exactly. With the outbox, batch 1's event can wait behind the held tick while batch 2 is stored, so it now reads [0, 25, 25, 25].
- **Options:**
  1. Keep exact equality (would fail, by design of the new behaviour)
  2. Assert each value is at least the batch's own counts
  3. Delete the test
- **Chosen:** Assert each stored value is at least that batch's counts (and four of them). The bug it guards (a stale tick's older counts standing for a finished batch, [0, 0, 25, 25] before r2) still fails this check. Only the exact timing it relied on has changed on purpose. Nothing was deleted or skipped.
- **If you decide otherwise:** Keeping exact equality would make the test fail on correct behaviour.
- **Refs:** apps/server/src/jobs/scan/scan.test.ts
- **Status:** accepted

## TBD-427 · How S2 reaches the AI form without typing a URL
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3 (mvp1-specs)
- **Context:** S1 leaves Maria on the onboarding 'Pick your AI' step, but each spec has its own browser. When she signs in again she lands in the Job inbox (WorkspaceIndex only restarts onboarding when there is no mailbox), so the onboarding step can only be reached by typing /setup/ai, which docs/mvp/README.md forbids.
- **Options:**
  1. Main nav Settings › AI (same AiForm in settings mode: Save, then 'Saved.'), then Main nav Scan
  2. Share one page across the S1 and S2 files with a worker-scoped Playwright fixture
  3. Merge S1 and S2 into one spec file
- **Chosen:** Main nav Settings › AI, then Main nav Scan. It uses only visible links, runs the same form, provider list, Test, privacy line and ai.settings_saved, and keeps one spec file per scenario as the every-scenario check requires. A worker fixture would lose per-test traces and break if the worker restarts. Merging would break the one-file-per-scenario layout.
- **If you decide otherwise:** If the owner wants S2 to keep pressing the onboarding 'Save and continue', S1 and S2 need a shared page (worker fixture or merged file), and the every-scenario check in e2e/stack.test.ts would have to accept one file covering two scenarios.
- **Refs:** e2e/specs/mvp-1/02-s2-maria-picks-the-ai.spec.ts; apps/web/src/layout/Home.tsx (WorkspaceIndex); docs/mvp/README.md › Walk it like a person
- **Status:** accepted

## TBD-428 · Cleanup that restores MVP 1's end state when a spec fails
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3 (mvp1-specs)
- **Context:** S8 (budget 5), S9 (killed replica) and S11 (Postgres, app-b, slow fake AI) change shared stack state. S8 and S9 only restored it on success, so one failure left later specs, including MVP 2's, on a broken stack.
- **Options:**
  1. withCleanup(body, cleanup): always clean up, and report the body's error if it failed
  2. try/finally with the cleanup's error replacing the original
  3. No cleanup on failure
- **Chosen:** withCleanup in e2e/specs/shared.ts, used by S8 (budget back to 300 through Settings › AI), S9 (start the killed replica, wait for it and the proxy to be ready) and S11 (start Postgres and both replicas, bring back a quick fake AI, wait until ready). Later specs start from a stack that is close to MVP 1's end state, and the reported failure is still the real one.
- **If you decide otherwise:** Without it, one failed S8 or S9 run leaves the budget at 5 or a replica down, and every later spec fails for reasons that have nothing to do with it.
- **Refs:** e2e/specs/shared.ts withCleanup; 08-s8-budget-stop.spec.ts; 09-s9-replica-dies.spec.ts; 11-s11-startup-health-shutdown.spec.ts
- **Status:** accepted

## TBD-429 · How a 'No' click on a question whose parts fill the whole item is represented
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3 (replies)
- **Context:** F7.2 needs clickable answers. A 'No' to places:IE:Dublin:hybrid or remote:EU can't be a profile item, and the old code dropped both Yes and No.
- **Options:**
  1. A choice whose value is its words under an object-item key means 'turned down' (schema turnsDown); no new column
  2. Add a nullable choice value plus a new answer shape, or a 'declined' flag column with a migration
  3. Refuse all negatives and rely on 'Don't ask for this message'
- **Chosen:** Words as the choice value under an object-item key mean 'turned down'. answerOf returns kind 'declined', the route resolves the waiting roles and stores the words as the decision's answer, and nothing is written to the profile, whatever useForSimilar says. No migration and no change to DecisionAnswer. A string can never be an item of those keys, so it can't be confused with one. The label always says what happens.
- **If you decide otherwise:** Without it there is no clickable 'No' (F7.2), or a 'No' click writes the parts' item, which breaks 'nothing changes without the user's say'.
- **Refs:** packages/schema/src/decisions.ts turnsDown; packages/core/src/decisions/answers.ts answerOf; apps/server/src/routes/decisions.ts
- **Status:** superseded: a 'No' is now a choice draft.v1 marks with `declines` (4827ae9, 7da5d80), not words under a key whose items are objects

## TBD-430 · A declined answer counts for the waiting roles only and is asked again for later mail
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3 (replies)
- **Context:** The profile has no way to record 'not open to Dublin hybrid' without making up an item or a deal breaker.
- **Options:**
  1. Per-role only: the waiting roles get their draft and later mail asks again
  2. Write a deal_breaker or a negative extra entry to the profile
- **Chosen:** Per-role only. The draft prompt gets the answer as an extra entry (extra.answer_<groupKey>, label = the question, value = [the words]), which exists only in the prompt. Never invent profile content. 'Unknown means ask' still holds: a later message asks again, and the user can answer or dismiss it.
- **If you decide otherwise:** A later role with the same group key would never be asked, and the profile would hold an item the user never wrote.
- **Refs:** packages/core/src/drafts/entries.ts; apps/server/src/drafts/write.ts roleAnswers
- **Status:** accepted for MVP 2 (owner, 2026-10-16): a declined place or remote answer is asked again for later mail; revisit in MVP 3 by storing a remembered no.

## TBD-431 · A small yes/no and field-word vocabulary in core to read answer words
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3 (replies)
- **Context:** Telling 'Yes' from 'No'/'None'/'Cork' and spotting 'a month' against a per-year question needs some word knowledge. Country and currency codes come from Intl (ISO standards).
- **Options:**
  1. A short multilingual yes/no and pay-period/mode word list, refusing whenever unsure
  2. Change draft.v1 so the model marks affirmative and negative choices (packages/ai, not in my paths)
  3. Refuse every free-text answer under a group key with parts
- **Chosen:** The word list in packages/core/src/decisions/words.ts: yes/no words in common European languages, pay-period and work-mode words, ISO codes via Intl, currency signs via Intl narrowSymbol. Anything unclear is refused (400), never guessed. It is not market- or user-specific data, and it only ever narrows what gets written. A false refusal costs the user a retype or a click. A false accept would write something they turned down.
- **If you decide otherwise:** If the owner prefers model-marked choices, packages/ai's draft.v1 output would need a per-choice flag, and the fixtures would need regenerating.
- **Refs:** packages/core/src/decisions/words.ts
- **Status:** superseded: core/decisions/words.ts no longer has yes/no or field word lists; it reads only digits, ISO codes, currency signs and the key's own words, and draft.v1 says which choices decline (7da5d80, 4827ae9)

## TBD-432 · Merged mvp-2 into the fix branch
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3 (replies)
- **Context:** PageFrame exists only on mvp-2, and the task asks to check that it can't hide the replies pages, and to get the branch merged.
- **Options:**
  1. Merge mvp-2 into mvp-2-fix-r3-replies (clean, no conflicts)
  2. Leave it to integration and test without PageFrame
- **Chosen:** Merged mvp-2, then added a shell-level test of the real pages under PageFrame. It is the only way to test PageFrame with the real pages, and it shows the merge is conflict-free.
- **If you decide otherwise:** Integration would have to resolve the merge, and the PageFrame check could only run after it.
- **Refs:** 3902377; apps/web/src/layout/RepliesPages.test.tsx
- **Status:** accepted

## TBD-433 · Boundary change to report (ARCHITECTURE not edited)
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3 (replies)
- **Context:** packages/schema now exports turnsDown, packages/core exports answerOf and the Answer type, and DraftAnswer now needs groupKey and question.
- **Options:**
  1. Report it here for the architecture owner
  2. Edit docs/ARCHITECTURE.md (forbidden for this task)
- **Chosen:** Reported here. ARCHITECTURE could note that a decision answer is either an item or a declined no that writes nothing and is given to the draft only. The task forbids editing docs/ARCHITECTURE.md.
- **If you decide otherwise:** ARCHITECTURE would describe answers as items only.
- **Refs:** packages/schema/src/decisions.ts; packages/core/src/decisions/index.ts; packages/core/src/drafts/entries.ts
- **Status:** accepted

## TBD-434 · What a 'clause' is when a fit is claimed (saysPlainly)
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3 (rules-assistant)
- **Context:** F4.1 fix: drop the English negation list. A fit is claimed only when the wording is the same once normalised, or the profile phrase is a whole-word phrase with no other words in its clause. 'Permanent: no' must come out unknown, so where a clause ends has to be defined.
- **Options:**
  1. A clause ends at a comma, semicolon, slash, line break, or a full stop followed by a space; a colon, dash, bracket or '?' does not end one
  2. Also end clauses at colons and dashes
  3. Allow no clause splitting at all: only exact whole-text equality
- **Chosen:** A clause ends at a comma, semicolon, slash, line break, or a full stop followed by a space. List punctuation, which is the same in any language, keeps the common fits ('Permanent, full-time', 'Senior / Lead', 'EU, UK', 'No relocation; permanent'). Keeping a colon, dash or '?' inside the clause keeps a label and its answer together ('Permanent: no', 'Permanent — no', 'Permanent? No'), so those are unknown. No word list is needed. A remaining edge case is 'Permanent, no', which would fit.
- **If you decide otherwise:** Change CLAUSE_BREAK in packages/core/src/rules/words.ts and the cases in words.test.ts. Exact-equality-only would make 'Permanent, full-time' unknown and lower many scores.
- **Refs:** packages/core/src/rules/words.ts (saysPlainly, CLAUSE_BREAK); packages/core/src/rules/words.test.ts; packages/core/src/match/match.test.ts
- **Status:** superseded: a fit now needs the same words once normalised, or the phrase as the last clause, and a slash no longer ends a clause, so 'Permanent, no' is unknown (ddae724)

## TBD-435 · Remote scopes like 'within the EU' are now unknown, not fits (changes TBD-247's outcome)
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3 (rules-assistant)
- **Context:** TBD-247 said 'within the EU' still fits a profile's 'EU'. Under the new rule from this task, any other word in the clause makes it unknown. Fixture roles with remoteScope 'within the EU', 'innerhalb der EU' or 'em qualquer país da UE' lose the remote fit: the place part goes from 20 to 10 points. A role scoring 70-79 that relied on it could fall under the reply threshold. This includes the MVP-2 'remote EU role on CET hours', if its extract fixture says 'within the EU'.
- **Options:**
  1. Follow the task's rule: unknown (and so asked)
  2. Keep a special case for scope words
- **Chosen:** Follow the task's rule: unknown. The task explicitly says everything except the same wording, or a clause that is exactly the phrase, is unknown and so asked, never guessed. A special case would bring back a language-specific word list. I updated the match.test.ts expectations that encoded the old fits: 'within the EU', 'PT or Lisbon', 'EU citizen or work permit'. Each now has an unknown case plus a list-punctuation fit case; no test was removed.
- **If you decide otherwise:** If the remote-EU e2e role must keep its draft, the e2e-fixtures slice can set its remoteScope to 'EU' (or 'EU, …'), or the owner can accept the lower score. An alternative is a match.v1 scope-closeness judgement (TBD-247 option 2).
- **Refs:** packages/core/src/match/match.ts (scopeCovered, remotePlaceCovered); e2e/fixtures/ai/maria/extract.json; TBD-247; docs/mvp/MVP-2.md S4
- **Status:** accepted

## TBD-436 · Shape of the inbox row's no-score state
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3 (rules-assistant)
- **Context:** MessageListItem.fit had to tell 'job role not scored yet' apart from 'no roles' without breaking callers outside this task's paths (InboxPage tests, slots.test, IntakePage.test, the server tests).
- **Options:**
  1. fit becomes the union {score, capped, stale} | {score: null, why: 'pending'|'unscored'} | null
  2. A separate new field (e.g. fitMissing)
  3. Make fit.score nullable and use stale for pending
- **Chosen:** fit becomes the union with score: null and an explicit why. One field says where the fit score goes and reads clearly in the UI. Existing literals like {score: 72, capped, stale} and `fit?.score` reads still typecheck, so files outside my paths needed no type changes. Only one exact-equality expectation changed (messages.test.ts). 'pending' covers both not-yet-evaluated and stale roles, matching how MatchPanel treats a stale evaluation with no score. The not-job guard lives in toListItem.
- **If you decide otherwise:** Switch ListFitSchema in packages/schema/src/messages.ts plus fitOf in packages/db/src/queries/inbox.ts and FitScore in apps/web/src/pages/match/index.tsx.
- **Refs:** packages/schema/src/messages.ts (ListFitSchema); packages/db/src/queries/inbox.ts (noFit, fitOf); apps/web/src/pages/match/index.tsx (FitScore, NoFitChip)
- **Status:** accepted

## TBD-437 · markInMailbox uses bound parameters on the test PGlite client; switch to markDraftSaved after integration
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3 (rules-assistant)
- **Context:** Rule: workspace-scoped everything. markDraftSaved lives on the replies branch. apps/server has no drizzle-orm dependency, so drizzle's sql template isn't importable there, and adding the dependency would touch apps/server/package.json, outside this task's paths.
- **Options:**
  1. A bound-parameter, workspace-scoped statement through the test database's PGlite client ($client.query with $1/$2)
  2. Add drizzle-orm to apps/server
  3. Add a temporary draft writer to a packages/db file in my paths (e.g. queries/assistant.ts)
- **Chosen:** A bound-parameter, workspace-scoped statement on the test PGlite client, asserting exactly one row changed. No dependency change and no stray product function in the wrong module, which the replies slice would duplicate. It removes the string interpolation the finding was about.
- **If you decide otherwise:** After integration, replace markInMailbox in apps/server/src/routes/assistant.test.ts with a call to packages/db markDraftSaved (draft id from claimDraft, a DraftRef and a content hash).
- **Refs:** apps/server/src/routes/assistant.test.ts (markInMailbox); mvp-2-fix-r2-replies packages/db/src/queries/drafts.ts (markDraftSaved)
- **Status:** superseded: the test marks the draft in the mailbox through packages/db's testing export markTestDraftInMailbox (d5891f6)

## TBD-438 · entryLabel reads extra slugs in words everywhere
- **Kind:** decision
- **Where:** MVP 2 · Fix round 3 (rules-assistant)
- **Context:** The two copies had drifted: the web replaced -/_ with spaces, core kept the raw slug. A third copy (labelOf in packages/core/src/profile/changes.ts, used only when an entry has no stored label) also kept the raw slug.
- **Options:**
  1. Spaced words ('notice period')
  2. Raw slug ('notice-period')
- **Chosen:** Spaced words, in one entryLabel in packages/schema/src/profile.ts used by all three places. It matches the match panel and the rules engine's fact labels, and plain words fit the history and proposal lines.
- **If you decide otherwise:** Drop the .replace in entryLabel; single-word slugs such as 'relocation' are unaffected either way.
- **Refs:** packages/schema/src/profile.ts (entryLabel); packages/core/src/assistant/words.ts; packages/core/src/profile/changes.ts; apps/web/src/pages/match/index.tsx
- **Status:** accepted

## TBD-439 · A preferred CV is a switch, not the tag word "preferred"
- **Kind:** decision
- **Where:** MVP 2 · Fix (cvs-senders, F2.1, S1)
- **Context:** The CV choice gave extra weight to a CV tagged with the English word "preferred", which is a user-typed word hard-coded in packages/core/src/cv/choice.ts and breaks "nothing user-specific in code".
- **Options:**
  1. Keep the tag word and record an exception to the hard rule
  2. A structured "Preferred CV" switch on each CV (`Cv.preferred`, migration 0002_cv_preferred, `PATCH /cvs/:cvId`); tag words carry no weight
- **Chosen:** Option 2, decided by the owner on 2026-10-16. S1 in docs/mvp/MVP-2.md now says Maria turns on **Preferred CV** for Backend (EN) (owner edit).
- **If you decide otherwise:** Revert 5d84f96, 447b6eb, db12651, 3d8f22a, 66c5f9e and 2bcb931, and restore the S1 wording.
- **Refs:** F2.1, S1, packages/core/src/cv/choice.ts, packages/db migration 0002_cv_preferred
- **Status:** accepted

## TBD-440 · A new message reusing a stored Message-ID takes over its row
- **Kind:** open item
- **Where:** MVP 2 · Security review
- **Context:** Messages are matched by Message-ID (F1.3), so a new message reusing the Message-ID of stored job mail takes over that row's mailbox location. A later draft then quotes the new message and goes to its sender, while the stored sender check judged the original. Exploiting it needs a Message-ID already in the user's inbox.
- **Options:**
  1. Leave it
  2. Treat a Message-ID match with a different From address as a new message
- **Chosen:** Left as is for now; revisit with MVP 3's sync.
- **If you decide otherwise:** Matching by Message-ID when envelopes are saved or a folder is re-indexed would also compare the From address, and a mismatch would be stored as a new message.
- **Refs:** F1.3; packages/db/src/queries/messages.ts saveEnvelopes
- **Status:** open

## TBD-441 · Gmail is the only OAuth mail provider
- **Kind:** decision
- **Where:** MVP 3 · Spec (owner change before the MVP 3 build)
- **Context:** MVP 3 F3 planned OAuth sign-in for Microsoft and Google. The owner said on 2026-10-16: "needs to support only gmail, i dont care about microsoft and outlook".
- **Options:**
  1. Keep Microsoft and Google OAuth
  2. Google (Gmail) OAuth only; IMAP with an app password stays open to any provider
- **Chosen:** Option 2, by the owner. docs/mvp/MVP-3.md F3 structure, F3.2 and S4, and docs/NORTH_STAR.md, now name Google only.
- **If you decide otherwise:** Restore the Microsoft client settings, F3.2's Microsoft button and S4's Microsoft step.
- **Refs:** MVP-3 F3.1–F3.3, S4
- **Status:** accepted

## TBD-442 · S11 gets two deliveries of its own
- **Kind:** decision
- **Where:** MVP 2 · Validation (S11)
- **Context:** All fourteen listed deliveries are used by S2 and S5, Tom has none, and `seed deliver` refuses duplicates, so S11's "deliver one message" and "new mail flows again" could not be walked.
- **Options:**
  1. Reuse a delivered message by resetting the seed
  2. Two new deliveries tagged S11
- **Chosen:** Option 2: `s11-failover` (onsite Munich) and `s11-recovery` (onsite Vienna), both capped by her places, so they get no draft and no decision (ab3ee55). The fixture list and S11 in docs/mvp/MVP-2.md name them (owner edit, decided on the owner's behalf).
- **If you decide otherwise:** Remove the two deliveries and the spec lines; S11's delivery steps can then not be walked.
- **Refs:** S11, F1.2–F1.4; e2e/fixtures/build/deliveries.ts
- **Status:** accepted

## TBD-443 · A remote scope in free words stays unknown
- **Kind:** decision
- **Where:** MVP 2 · Fix round 1 (match, I4)
- **Context:** Every remote role shows "Unknown — Remote, within the EU — not compared with your remote 'EU'". A token match ("EU" in "within the EU") would make it a fit, but without word lists it also makes "Non EU", "not the EU" and "außerhalb der EU" fits, which breaks "unknown means ask".
- **Options:**
  1. Token match in core (abd3b4d, not merged)
  2. Keep unknown (TBD-435) and let the AI judge scope closeness later (match.v1, TBD-247 option 2)
- **Chosen:** Option 2 for MVP 2: safety over convenience. Revisit in MVP 3 with a scope verdict from match.v1.
- **If you decide otherwise:** Merge abd3b4d from branch orch2-core and accept the negation cases as fits.
- **Refs:** F4.1, TBD-247, TBD-435, packages/core/src/match/match.ts
- **Status:** accepted

## TBD-444 · A reply may ask whether the user can work the role's hours
- **Kind:** decision
- **Where:** MVP 2 · Real-AI run (draft.v1, apac-1)
- **Context:** With a real model, draft.v1 for the UTC+8 remote role asks "Are you able to work these hours?" (key `remote:UTC+08:00`). That becomes a decision and holds the reply, while expected.json expects a draft with no needs. Maria's profile states no working hours, so the answer is unknown.
- **Options:**
  1. Tell draft.v1 not to ask about hours
  2. Keep asking; "unknown means ask"
- **Chosen:** Option 2. The hard rule wins over the fixture's expectation; the fake AI keeps answering without the question. Scheduling (availability for a call) is no longer asked (0ab2569).
- **If you decide otherwise:** Add a sentence to draft.v1's instruction that working hours are left to the user's reading of the role.
- **Refs:** F6.1, F7.1, CLAUDE.md "Unknown means ask"
- **Status:** accepted

## TBD-445 · The assistant meets 8 of 10 test requests with a real model
- **Kind:** open item
- **Where:** MVP 2 · Sign-off (real-AI quality)
- **Context:** The threshold is 9 of the 10 requests in e2e/fixtures/assistant/requests.json, graded on the same kind of change with the same effect on the stored roles. With Anthropic claude-sonnet-5-5 the assistant got 8 (e2e/reports/mvp-2/20261017T015103Z-specs-and-assistant). #1 "Asian time zones" sometimes ends at UTC+09:00 (or +12) instead of +14, so it keeps the UTC+10 role; #6 "keine befristeten Stellen" covers German, English, Dutch and Portuguese phrases but sometimes leaves out "a termo". Nothing was ever applied without Apply. Fixes so far: a flat wire schema (705363a), contains for free-text facts (6192afe), the job mail's languages in the prompt (2c90ade).
- **Options:**
  1. Keep tuning the prompt; region or wording hints would be market-specific
  2. Sign off with this open item; the user can edit a proposal before Apply
  3. Loosen the fixture expectations
- **Chosen:** Option 2, by the owner on 2026-10-17. MVP 2 is "accepted with open items".
- **If you decide otherwise:** Revisit in MVP 3: for example, let the assistant show the roles a rule would hide before Apply (the preview already counts them), or ask back when a region is ambiguous.
- **Refs:** F8, MVP-2 "Quality with a real AI provider", requests.json #1 and #6
- **Status:** open

## TBD-446 · MVP 3 plan and foundation decisions (D1–D28)
- **Kind:** decision
- **Where:** MVP 3 · Plan and foundation (orchestrated build, 2026-10-17)
- **Context:** The orchestrator planned MVP 3 as seven parallel slices on a shared foundation (8579de2..2a09d31). These choices were made on the owner's behalf, as the owner asked.
- **Options:** Per decision, as written below.
- **Chosen:**
  - **D1 · Seven slices.** The workflow's plan check allows six; this plan uses seven so that no
    slice owns another's files and the fixtures have one owner. Merging `send` into `mailboxes`
    gets to six if required.
  - **D2 · Foundation does the cross-cutting plumbing, not only stubs.** Mailbox addressing
    (`messages.mailbox_id`, `connectMailbox(deps, ws, mailboxId)`), the inbox filter and row fields,
    scope enforcement on the drafts/send mounts and in the messages routes, and `recordActivity` at
    the existing "draft saved" point are done by the foundation, because otherwise three slices
    would edit the same files. With one mailbox and one profile everything behaves as in MVP 2.
  - **D3 · Same Message-ID in two mailboxes is one message.** Messages stay unique per workspace;
    the first mailbox to store it keeps it. `messages.mailbox_id` is nullable (rows of a mailbox
    disconnected before MVP 3) and backfilled for every other row; null reads as the workspace's
    first mailbox.
  - **D4 · Disconnect deletes the messages.** `messages.mailbox_id` cascades, so F7.4's "everything
    tied to its messages" follows from the foreign keys (roles, evaluations, drafts, decisions rows,
    sends).
  - **D5 · OAuth endpoints and hosts.** `JOBFILLY_GOOGLE_IMAP_HOST`/`_SMTP_HOST` take a URL
    (`imaps://imap.gmail.com:993`, `smtps://smtp.gmail.com:465`; plain `imap://`/`smtp://` only with
    `JOBFILLY_ALLOW_INSECURE_MAIL`), so the test stack can point at GreenMail's plain ports. The
    address comes from the token answer's `id_token` email claim (received directly from the token
    endpoint, so no signature check), no extra userinfo URL. Redirect URI
    `${PUBLIC_URL}/api/oauth/google/callback`; scope `https://mail.google.com/ openid email`.
  - **D6 · Test stack OAuth account.** The Google mailbox is a third GreenMail account
    (`maria.gmail@gmail.example`); the fake server's access token equals that account's password so
    GreenMail's XOAUTH2 accepts it. If GreenMail has no XOAUTH2, S4 still completes the sign-in and
    the IMAP login is proven in an integration test (F3.3 allows it).
  - **D7 · Two new AI prompts, no new model slots.** `focus.v1` (the re-run hint read into places,
    languages, contracts, work modes) runs on the `intake` model; `answer.v1` (a question answered
    from tool results, with sources) runs on the `assistant` model. `ai_settings.models` doesn't
    change, so no data migration.
  - **D8 · Questions go through assistant.v1 first.** assistant.v1's answer gains `lookups` (read-only
    tool requests, default empty); the server runs them and asks `answer.v1`. Answers come back as
    JSON, never as provider tool calls (TBD-25).
  - **D9 · Sending replaces MVP 2's "nothing is sent".** MVP-3's scope lists only MVP 1's one-mailbox
    limit as replaced, but F4 replaces MVP 2 F6.6 too. The no-SMTP guard tests are narrowed (not
    deleted): SMTP only in `packages/mail/src/smtp/`, only `apps/server/src/send/` sends, nothing
    sends without a confirmed token.
  - **D10 · Confirmation token is stateless.** An HMAC over workspace, draft, user and the draft's
    content hash, 15 minutes; editing the draft changes the hash, so the user confirms again.
  - **D11 · Delayed send is a queue feature.** `jobs.run_at`: the claim skips jobs not yet due;
    Undo cancels the `sends` row, so the job does nothing.
  - **D12 · Sent copy.** Appended over IMAP unless the preset says the provider saves it (Gmail);
    the job looks for the Message-ID in Sent first, so a retry never adds a second copy.
  - **D13 · A sent draft keeps its row.** `drafts.status = sent` keeps the role's one live draft, so
    no new automatic draft is made for a role already answered.
  - **D14 · Pipeline-only members.** They see roles, facts, matches, stages, the profile and the
    decision inbox; not message bodies, drafts (and sending), non-job mail or the assistant's
    message text tool. Hidden resources answer 404.
  - **D15 · Pipeline stages are derived on read.** Only a manual stage is stored (`role_stages`);
    `pipeline.stage_changed` is logged for manual changes. "Time in stage" is the date of the mail
    that set it, or the manual change.
  - **D16 · Activity log rows hold ids, not names or addresses.** Actor and target are user ids
    (set null when the account goes: "Deleted user"), plus `actor_kind` user/system; so a deleted
    account leaves neither name nor email in `pg_dump`.
  - **D17 · Account deletion.** Owned workspaces are listed with their members and deleted after
    confirmation; memberships elsewhere end; invites to the user's email go too; `scans.started_by`
    becomes nullable (set null) so a scan someone else's workspace kept doesn't block it.
  - **D18 · Re-run intake.** Starting a re-run clears the workspace's unconfirmed intake answers and
    intake.v1 extras; Confirm makes a new profile and leaves the others untouched (the MVP 1
    "exists" refusal goes for re-runs).
  - **D19 · F1.4's fixture cross-check** is added by the integrator once `profiles` and `fixtures`
    are both merged (as TBD-414 did in MVP 2); each slice proves its own part alone.
  - **D20 · F2.3 "says how many changed"** answers with the impact preview's count (no model call)
    at once; the re-evaluation itself finishes within the minute as before.
  - **D21 · Fake OAuth through the proxy** on its own port (`127.0.0.1:8084`), the app reaches
    `http://oauth:8080` inside the stack.
  - **D22 · MVP 1 S7's "no second mailbox" step** is updated in the codify step, as MVP-3 says.
  - **D23 · Dropping the one-mailbox unique isn't backward compatible for one step:** an MVP 2
    replica's "connect a mailbox" fails during a rolling update to MVP 3 (its ON CONFLICT target is
    gone). Everything else in 0003 is additive.
  - **D24 · Pipeline-only members are closed by default (security review of 83b854a):** the two
    message PUTs (category, CV override) let a pipeline-only editor change non-job mail. Fixed in
    9bca444: `requireJobMail` on every per-message route, and `mount` closes every module to such a
    member unless opened; export and sending are closed, decisions, CVs, intake, settings and
    members stay open (no mail content). `access/scope.test.ts` proves each refused route 404s for
    them and not for a full member.
  - **D25 · A pipeline-only admin can't export:** the export holds drafts and every message's
    metadata, so it is closed to that scope like drafts.
  - **D26 · assistant.v1's `lookups` defaults to none,** so answers written before MVP 3 (fixtures,
    stored tests) still read; it is not in the JSON Schema's `required`, which strict structured
    output on an OpenAI-compatible server may refuse. The assistant slice decides with the real-AI run.
  - **D27 · Account deletion asks for the password** (`DeleteAccountInputSchema`).
  - **D28 · A flaky MVP 2 test fixed, not skipped:** `routes/drafts.test.ts` "shows each draft's
    status" tied both drafts on the standing test clock; it now advances the clock a second
    (d9dfc1c).
- **If you decide otherwise:** Each decision names what it changes; reopen it here and the orchestrator updates the code.
- **Refs:** docs/mvp/MVP-3.md F1–F9, docs/ARCHITECTURE.md
- **Status:** accepted

## TBD-447 · MVP 3 slice decisions
- **Kind:** decision
- **Where:** MVP 3 · Build (six slices, merged 2026-10-17)
- **Context:** Each slice reported the choices it made where the spec left room. Made on the owner's behalf, as the owner asked.
- **Options:** Per decision; the slice reports are summarised below.
- **Chosen:**
  - **send (F4):** the confirmation shows the message read back from the exact bytes that will leave; a token is refused if the message built now differs from the stored hash; after the server accepts a message, a failure to file the Sent or Drafts copy doesn't undo the send (logged at warn); an SMTP failure fails the send once with no retry (the user sends again); discarding a sent draft gives 409; the provider files its own sent copy for a Google mailbox or a preset marked so; a stored SMTP password is kept only for the same host (so the IMAP password is no longer reused for SMTP); a Google mailbox needs no SMTP setup; a draft carries its latest send so Undo and the reason survive a reload.
  - **mailboxes (F3, F7.4):** a Google mailbox uses the server's Google IMAP settings and the token's email, and stays reconnect_needed (skipped by the sync) until signed in again; tokens are refreshed within 5 minutes of expiry, Google unreachable counts as unreachable (retried) and only a refused refresh means Reconnect needed; after sign-in the browser goes back to onboarding or Settings › Mailbox with `?oauth=<outcome>`; a wrong or used state gets a 400 JSON answer; the IMAP login is tested before anything is stored; disconnect deletes open decisions left with no messages, keeps answered ones, and doesn't revoke the token at Google; the mailbox name shows only with two or more mailboxes; a pipeline-only admin may start a Google sign-in; expired sign-ins are cleaned up on the next start.
  - **workspace-admin (F6, F7, F9):** a role change logs both workspace.role_changed and member.role_changed; only the owner deletes a workspace (typed name; a wrong password gives 403); leaving is DELETE /members/<own id>; following F6.3, an admin may demote or remove another admin (the owner is always an admin); nobody changes their own role or scope, and a pipeline-only admin can grant only "job pipeline only"; the activity cursor is the last entry's id; deleting an account records account.deleted in each workspace and deletes invites to and from it; fflate makes the ZIP; the export leaves out mailbox and AI settings, message UIDs and CV text; the invite form sends a scope only when it isn't "everything".
  - **applications (F5):** interview, assessment, offer and rejection mail always set their stage; replies and application updates only move forward; "closed" is only set by hand; the no-reply flag counts 21 days from the user's last action and stops when the other side writes; the same role means title plus company (or the agency's client); a stage set by hand on a merged item is stored on the chosen role; next-step wording is UI text; a sent reply counts once the SMTP server accepted it; manual stages and profile choices survive re-analysis (5c02540).
  - **profiles (F1, F2):** the assignment scores place (same country +2, same city +2, or +1 when the profile names no city), remote with a remote entry +3, title/language/contract +1 each, and a profile's own hide rule −10; ties go to the oldest profile; a hand choice wins while that profile is on; the re-run focus matches places, work modes, contract words, other words, then languages; re-run is admin-only after the first scan with a confirmed profile, and fails if the hint can't be read; the intake form follows the latest re-run; "changed" counts a role hidden or shown, a moved score, a rule's effect or reply eligibility, from stored match answers; rule DELETE and Undo return no count; editors can switch a profile on or off.
  - **assistant (F8):** a turn that asks for lookups is a question, and any proposal in it is dropped; "unreviewed drafts" means status in_mailbox; "interviews in the last 30 days" counts roles currently at interview that reached it in the window; a pipeline-only member sees no draft information at all; earlier answers go back with their refs; profile names are matched case-insensitively as substrings; links are worked out when the thread is read; assistant.v1's `lookups` stays optional (D26), to settle in the real-AI run; the assistant says drafts can be sent from the Drafts page.
- **If you decide otherwise:** Reopen the line here; each names the behaviour it sets.
- **Refs:** docs/mvp/MVP-3.md F1–F9, TBD-446
- **Status:** accepted

## TBD-448 · No rate limit on password checks
- **Kind:** open item
- **Where:** MVP 3 · Security review
- **Context:** Sign-in, account deletion and workspace deletion check the account password, and nothing limits how often. A hijacked session or an attacker with an account could guess passwords without limit. Workspace deletion now asks for the password (d7e3a0e).
- **Options:**
  1. Leave it
  2. Per-account throttling stored in Postgres (shared by every replica), e.g. N failures per 15 minutes, then 429
- **Chosen:** Left for now: throttling needs state shared across replicas, and the owner asked to keep MVP 3 simple. Revisit before running the server for other people.
- **If you decide otherwise:** Add a failed-attempts table keyed by account with a sliding window, checked by every password route.
- **Refs:** CLAUDE.md "Kubernetes-ready: no state on local disk"; routes/auth.ts, routes/account.ts, routes/workspace.ts
- **Status:** open

## TBD-449 · MVP 3 fixture decisions
- **Kind:** decision
- **Where:** MVP 3 · Build (fixtures slice)
- **Context:** Choices the fixtures slice made where the spec left room.
- **Options:**
  1. As chosen below
- **Chosen:** The second mailbox (maria-home) has no expected.json of its own; its truth sits in Maria's file under mvp3. New roles' fit, needs and drafts are written against the profile MVP 2 starts with, and their MVP 3 profile is recorded separately (mvp3.assignments). S9's interview count is two (Nordlicht, and Brandung once S6 moves it by hand); Lindwurm has moved on to offer, so it isn't counted. Where open items depend on the run, the fake answers list every link that could apply and the server keeps only those its lookups returned. German mail and her replies both write "München". Soak mail: Maria's generated roles are onsite in Munich (no drafts); Tom's may get drafts. maria-gmail gets no mail; S4 only needs its sign-in to complete.
- **If you decide otherwise:** Change the generator in e2e/fixtures/build and regenerate.
- **Refs:** docs/mvp/MVP-3.md "Fixtures added", S1, S4, S6, S9
- **Status:** accepted

## TBD-450 · Pipeline-only admins can't change where mail goes
- **Kind:** decision
- **Where:** MVP 3 · Security review
- **Context:** A pipeline-only admin could change SMTP or AI settings or connect a mailbox, and so redirect mail text to a server they control.
- **Options:**
  1. Leave settings open (D24)
  2. Close the routes that change where mail or its text goes
- **Chosen:** Option 2 (f3f371f): SMTP save and test, AI save and test, POST /mailboxes and its test, and Google sign-in start need full access; reads stay open. Old assistant answers that used full-access data are hidden from pipeline-only members, failing closed (e69d2aa, ad95fbf). Live events are filtered and the stream closes on a role or scope change (ca1aa9d, 82d52ba). The web still shows those forms to pipeline-only admins (they get 404): a small follow-up.
- **If you decide otherwise:** Reopen D24 and remove requireFullAccess from those routes.
- **Refs:** TBD-446 D24, docs/mvp/MVP-3.md F6
- **Status:** accepted

## TBD-451 · A profile's hide rule hides; it doesn't move the role
- **Kind:** decision
- **Where:** MVP 3 · Validation (S3, F1.3, F2.1)
- **Context:** The profiles slice gave a profile's own hide rule a −10 penalty in profile assignment (TBD-447), so the walkthrough's UTC+5 hide rule moved the three Asia-Pacific roles to the other profile instead of hiding them; "It changes 3 roles" but Hidden stayed empty.
- **Options:**
  1. Keep the penalty (a rule steers roles between profiles)
  2. Assign by fit alone; the assigned profile's rules then apply, so hide means hidden
- **Chosen:** Option 2 (54af0e5), decided by the orchestrator on the owner's behalf: it is how S3 reads ("it hides …") and keeps assignment explainable. Re-run setup now reads only evidence that fits the whole hint (cee2e10), and one failing message no longer stops a scan (00ab4e4).
- **If you decide otherwise:** Bring back a rules term in assignProfile (packages/core/src/assign/assign.ts).
- **Refs:** MVP-3 F1.3, F2.1, S3; TBD-447 (profiles)
- **Status:** accepted

## TBD-452 · Not an enterprise platform: brief downtime is fine
- **Kind:** decision
- **Where:** MVP 3 · Spec (owner change, 2026-10-17)
- **Context:** The owner said: "dont overcomplicate things like upgrade during a scan, this is not a platform for enterprice, is fine having some downtime". For the soak they chose "Short version, 20 min".
- **Options:**
  1. Keep the zero-downtime requirements (no failed requests during restarts, scans completing through restarts, upgrade during a scan, pre-upgrade migration hook, PodDisruptionBudget, a 2-hour soak)
  2. Simplify: restarts bring the app back with nobody signed out and nothing lost or done twice; brief downtime is fine
- **Chosen:** Option 2, by the owner. docs/mvp/MVP-3.md: F10.1 (the app comes back, scans and syncs end, never stuck), F10.2 (the proxy routes only to ready replicas), F10.3 (20-minute soak, measured between minutes 5 and 10), S10, H1 (a PodDisruptionBudget only when replicas ≥ 2, owner's follow-up; plus an optional Istio DestinationRule with sticky sessions, off by default), H2 (migrations at startup only), H5 (install and the full suite; an upgrade may cause brief downtime); docs/mvp/README.md's soak line.
- **If you decide otherwise:** Restore the earlier F10, S10 and H1/H2/H5 text from git history.
- **Refs:** MVP-3 F10, S10, H1–H5
- **Status:** accepted

