# MVPs

Three MVPs, built one at a time and in order. Each one leaves the product usable and clearly
better:

1. [MVP 1 — It understands my job search](MVP-1.md)
2. [MVP 2 — It works my inbox every day](MVP-2.md)
3. [MVP 3 — It grows with me](MVP-3.md)

Each file has the goal, scope, build order, functions with their structure and acceptance
criteria, end-to-end scenarios, quality thresholds for a real AI provider, and a sign-off table.

## How the build runs

The build is unattended: the owner may be away for days. It never stops to ask and never waits
for input. The saved workflows in `.claude/workflows/` run it exactly as described here, with every
agent at high effort.

### Order

1. MVP 1 → MVP 2 → MVP 3 → the Helm chart. An MVP starts once the previous one has a row in its
   sign-off table, whether *signed off* or *accepted with open items*.
2. Inside an MVP, the phases run in this order:

   | Phase | What happens |
   | --- | --- |
   | Preflight | The MVP branch, a clean tree, the previous MVP done, a green baseline, the tools present |
   | Plan | 3–6 slices with disjoint paths; every criterion assigned exactly once; a critic checks the plan |
   | Foundation | One agent builds the shared contract (schemas, tables, route and page stubs, fixtures layout) and the serial-first criteria; two verifiers check it |
   | Build | Slices are built in parallel, each in its own git worktree, each checked by two independent verifiers |
   | Integrate | Verified branches are merged; `pnpm check`, `pnpm build` and `pnpm unused` must pass |
   | Validate | A fresh test stack, the Playwright MCP walkthrough of every scenario, log checks, leak checks, security probes |
   | Fix | Failures are split into independent tasks, fixed in parallel worktrees, verified, merged, and the whole validation runs again |
   | Codify | The passed scenarios become Playwright specs |
   | Confirm | A spec-only run on a fresh stack, the real-AI quality run, and an evidence audit that tries to refute "done" |
   | Record | Decisions and open items are appended to [TBD.md](../../TBD.md) |
   | Clean up | Unused code and dependencies, branches, worktrees, stacks and old reports are removed |
   | Sign-off | A row in the MVP's sign-off table and a summary |

### Decisions go to TBD.md

- When an important decision comes up — an unclear, contradictory or impossible criterion; a
  choice users would notice; a hard-to-reverse data, architecture, dependency or security choice —
  the build chooses what best serves the criterion and the north star, carries on, and records the
  decision in [TBD.md](../../TBD.md) with the options, the choice and what changes if the owner
  decides otherwise.
- The build never edits acceptance criteria, the north star or other spec text: proposals go to
  TBD.md. When a boundary changes, `docs/ARCHITECTURE.md` is updated and the change is recorded in
  TBD.md too.
- Small implementation choices are not recorded.
- Agents working in parallel never write TBD.md themselves; they report decisions and one agent
  appends them, so the file never conflicts.

### Branches and commits

- MVP *n* lives on branch `mvp-<n>`, created from main (or from `mvp-<n-1>` while that isn't merged
  yet). The build never commits to main, never merges into main, and pushes only the MVP branch, and
  only when started with `"push": true`.
- Every slice and fix has its own branch, `mvp-<n>-<id>`, in its own worktree. The integrator merges
  it with `--no-ff` and deletes it.
- Conventional Commits, small, each one green (`pnpm check`).

### Clean as you go

- `git status` is clean after every phase. Commit only source, tests, fixtures, config and the
  allowed docs — never build output, reports, logs, screenshots, coverage, `.env` files, temporary
  files or generated bindings.
- Delete, in the same change, whatever it made unnecessary: dead code, unused files, exports and
  dependencies, obsolete fixtures and specs, debug output, commented-out code, one-off scripts.
- `pnpm unused` (knip) passes after every integration. Its ignore list in `knip.jsonc` may only
  hold dependencies a later MVP needs.
- No TODO or FIXME is left behind, and no stub or fake outside tests and `e2e/`.
- Dependencies are added to the package that uses them, with one version per dependency across the
  workspace; the 7-day minimum release age stays.
- Every test stack is taken down with its volumes at the end of its run, even after a failure, and
  background log captures and browsers are stopped. The three newest report folders per MVP are
  kept; older ones are deleted.
- Worktrees and merged branches are removed. An unmerged branch is kept only if it holds work that
  isn't merged, and then it is listed in TBD.md.

### Quality gates

- A slice or fix is done when its criteria have tests that would fail without the code, `pnpm
  check` is green, and two independent verifiers — one for criteria and tests, one for architecture
  and hygiene — could not refute it.
- Nothing counts as passing without evidence: a test name, a scenario step actually performed and
  observed, a log line, a screenshot.
- A failing test is never deleted or skipped to get green, and a scenario is never marked passed
  unless it was walked.
- Everything from earlier MVPs keeps working: their specs run in every validation.

### Fix rounds

- After a validation run that isn't clean: triage into independent tasks → parallel fixes →
  verification → integration → a full new validation run.
- Up to 4 rounds, then one deep round that starts from the root cause and may take a different
  approach. Whatever still fails becomes an open item in TBD.md, the MVP is *accepted with open
  items*, and the build moves on.

### How an MVP ends

- **Signed off:** every point under [Sign-off](#sign-off) is met.
- **Accepted with open items:** something is missing — failures left after the deep round, a
  real-AI run without a key, validation tools unavailable — and each gap is an entry in TBD.md. The
  next MVP starts anyway.

### Starting it

From a Claude Code session opened in this repository, in a permission mode that doesn't prompt,
with the machine kept awake:

- Everything in order: "use a workflow: run build-all".
- One MVP: "use a workflow: run build-mvp with mvp 2".
- Re-validate an MVP after an environment problem, without planning or building again: "run
  build-mvp with mvp 2 and from validate".
- The Helm chart on its own: "run build-helm".

The real-AI quality runs and the Helm install read the environment variables listed in
[TBD.md](../../TBD.md) under "Needed from the owner".

## The test stack

`docker/compose.e2e.yaml`, started fresh for every run:

| Service | What it is |
| --- | --- |
| `proxy` | Round-robin reverse proxy at `http://127.0.0.1:8080`, routing only to replicas whose `/api/health/ready` answers 200. It also exposes each replica directly — `:8081` for `app-a`, `:8082` for `app-b`, `:8083` for `app-c` — for read-only checks (writes through these ports fail the `Origin` check by design) |
| `app-a`, `app-b` | Two replicas of the same image (MVP 3 adds `app-c`), with `hostname` set to their name, a read-only root filesystem, `/tmp` as tmpfs, a non-root user, a non-default `PORT`, and `stop_grace_period: 30s` |
| `postgres` | The database |
| `imap` | Disposable mail server (GreenMail), in memory: IMAP and SMTP with one or more accounts per persona. Pause it to simulate an outage; never stop it, or its mail is gone |
| `seed` | Loads `e2e/fixtures/<persona>/mail` into the mailboxes; during a run it also delivers new mail and inspects folders (each MVP lists the commands it uses) |
| `fake-ai` | OpenAI-compatible stub with canned answers |
| `dns`, `rdap` | From MVP 2: CoreDNS with a fixture zone and a fake RDAP service, for the domain checks |
| `oauth` | From MVP 3: a fake OAuth authorisation server, reachable through the proxy |

Commands:

| Command | What it does |
| --- | --- |
| `pnpm e2e` | Starts a fresh stack, runs every spec, takes the stack down with its volumes |
| `pnpm e2e:stack up` | Starts a fresh stack under its own compose project name, which it prints |
| `pnpm e2e:stack down` | Takes that stack down with its containers, networks and volumes |
| `pnpm e2e:specs [--mvp <n>]` | Runs the specs (all, or one MVP's) against the running stack |
| `pnpm e2e:soak` | MVP 3 sign-off only: the 20-minute soak against a fresh three-replica stack |

- The fake AI is set up through the UI like any OpenAI-compatible endpoint (base URL
  `http://fake-ai:8080/v1`). It answers from `e2e/fixtures/ai/` by task id plus a key: the
  `Message-ID`s in the prompt (classification, extraction, drafts), the `Message-ID` and role
  position (matching), the CV's content hash (CV reading), the user's message and turn (assistant),
  a template for generated soak mail, or nothing (`ai.test.v1`). It returns HTTP 500 (and logs why)
  for any prompt it has no answer for, so a missing fixture is never silent. Every answer waits
  `FAKE_AI_DELAY_MS` (300 in the test stack), so runs last long enough for mid-run steps and
  "thinking" states are visible.
- Fixture dates are relative ("12 days ago"): `seed` sets each message's `Date` header and IMAP
  internal date from the current time, so the 90-day window, the 14-day reply window and the
  21-day pipeline flag behave the same on every run. `seed deliver` appends over IMAP and never
  uses SMTP, so `seed inspect smtp` shows only what the app itself sent.
- One run plays the scenarios of every MVP up to the current one, in order, on one fresh stack.
  Later scenarios start from the state earlier ones leave behind — MVP 2 relies on the profile
  Maria confirmed in MVP 1.
- Only the test stack sets `JOBFILLY_ALLOW_INSECURE_MAIL=true`.

## Fixtures

- Synthetic only: no real people, mailboxes or companies' real recruiters.
- Two personas, defined in MVP 1, each with a mailbox, CVs (from MVP 2), new mail to deliver during
  runs, and `expected.json` holding the ground truth per message (category, job facts, sender
  verdict, match, profile answers).
- **Sentinels:** every fixture message body contains a unique marker `BODYSENTINEL-<id>` at least
  1,000 characters into its decoded text (and the same in its HTML part), so a stored snippet never
  carries it; every test password and API key is a unique string `E2E-SECRET-<name>`; test messages
  typed into the assistant carry `E2E-CHAT-<n>`. The leak checks below look for them.

## Validation protocol (every MVP, every run)

### 1. Walk it like a person (Playwright MCP)

- A fresh browser context per persona at 1440×900 (if the browser tool can hold only one, sign out
  completely between personas). Scenarios marked *narrow* are repeated at 1024×768.
- Start at `http://127.0.0.1:8080`. Move only by clicking visible links and buttons, typing into
  visible fields, and the keyboard (Tab, Enter, Esc) where a scenario asks for it. The only URLs
  typed by hand are the start URL and invite links a person would receive.
- During the walkthrough: no API calls, no database reads, no hidden elements. Allowed where a
  scenario lists them: infrastructure steps (killing or pausing a service, delivering mail with
  `seed`), verification steps (`seed inspect …`, unpacking a downloaded file), and probes.
- Uploading a file through the page's file picker is a person's action and is fine.
- **Probes** are `curl` requests listed inside the scenario that creates the state they need. They
  sign in with `curl` to get their own session and send `Origin: http://127.0.0.1:8080`, except the
  probe that tests the `Origin` check itself.
- After each step: read the accessibility snapshot and check the expected text or state is
  visible; screenshot every step marked 📸; check the browser console shows no errors and no failed
  requests. Expected failures are only the ones a scenario provokes on purpose (a wrong password, a
  refused action).
- Write down anything a person would trip over, even when the criterion passes: unclear wording,
  more than 2 seconds without feedback, broken layout, dead ends. These are **findings**: blockers
  and important ones are fixed before sign-off; minor ones are listed in the sign-off notes.

### 2. Watch the logs

- Before the walkthrough, capture every app replica into the run folder, e.g.
  `docker compose -p <project> -f docker/compose.e2e.yaml logs -f --no-log-prefix app-a app-b > <run>/app.log`
  (add `app-c` from MVP 3).
- After each scenario, check:
  - every event listed for the scenario appears, with the listed fields;
  - no line at level `error` or `fatal` and no stack trace, unless the scenario expects one;
  - across the run, `http.request` lines show every replica served requests (`instance` field).

### 3. Leak checks (end of run)

- No `BODYSENTINEL-*`, `E2E-SECRET-*`, `E2E-CHAT-*` or fixture subject line appears in `app.log`.
- A `pg_dump` of the database contains no `E2E-SECRET-*` (passwords are hashed, secrets encrypted)
  and, in fake-AI runs, no `BODYSENTINEL-*` (message bodies are never stored).
- In a real-AI run, the real key appears in neither.

### 4. Security probes

They run inside their scenarios (see the rules above), at the moment the state they need exists:
cross-workspace access, role limits, cross-origin writes, sessions after sign-out, send tokens.

### 5. Codify

Every scenario that passes becomes a Playwright spec in `e2e/specs/mvp-<n>/` that repeats the same
human steps with role- and label-based locators. CI runs `pnpm e2e` on every pull request.

### 6. Report

Each run writes `e2e/reports/mvp-<n>/<timestamp>-.../` (git-ignored): `report.md` with pass or fail
per criterion and scenario plus the findings, the screenshots, and `app.log`.

## Sign-off

- Every acceptance criterion passes and points to the scenario or test that proves it.
- Two consecutive clean runs, each on a fresh stack: the walkthrough run, then a spec-only run. Clean
  means no failed criterion, no blocker or important finding, no unexpected error logs, no leaks.
- One run with a real AI provider meets the MVP's quality thresholds.
- The evidence audit finds nothing to refute.
- All earlier MVPs' specs pass, except steps a later MVP explicitly replaces (it says so under
  its scope), which are updated in that MVP's codify step.
- The sign-off table at the end of the MVP file gets a row: date, status, commit, run folder, real
  AI provider, and the TBD.md entries still open.
