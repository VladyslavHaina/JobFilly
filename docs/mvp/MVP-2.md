# MVP 2 — It works my inbox every day

**Goal:** new job mail is sorted, checked and matched as it arrives. Good matches have a reply
waiting in the mailbox's Drafts folder, with the right CV attached when asked for. Anything the app
can't answer lands in the decision inbox, once. The user steers the automation by talking to the
assistant.

**Why it's worth having on its own:** the daily routine — reading recruiter mail, judging fit,
writing the same replies — is done before the user opens their mail, and nothing leaves without
them.

## Scope

**In:** continuous sync; several CVs with tags and AI metadata, and a CV choice per role; rules in
the profile; explainable match; sender check; automatic and manual drafts saved to the mailbox;
the decision inbox; the assistant for changing preferences and rules.

**Out (MVP 3):** sending from the app, several profiles and mailboxes, editing every profile entry
by hand, the application pipeline, selective sharing, export and delete, OAuth mail sign-in, the
assistant answering questions about the job search.

## Build order

F1 → F2 → F3 → F4 → F5 → F6 → F7 → F8.

## Fixtures added

- **CVs:** Maria — "Backend (EN)" PDF, "Backend (DE)" DOCX, "Data engineering (EN)" PDF; Tom —
  "Nurse (EN)" DOCX. The expected tags, skills and CV choice per role are in `expected.json`. The
  fake AI's answer for "Data engineering (EN)" includes one skill that is not in the CV.
- **Mail delivered during runs** (`seed deliver <id>`), all dated within the last 14 days:
  - a Berlin backend role in German that asks for a CV;
  - a remote EU role in English on CET hours (the fake AI's first draft for it contains "[Name]");
  - a hybrid Amsterdam role (Maria removed Amsterdam in MVP 1);
  - an onsite role in Singapore;
  - three remote roles on Asia-Pacific hours (UTC+8, UTC+8, UTC+10), one of which scores 70 or more;
  - a data-engineering role that scores below the reply threshold;
  - a Zurich role and a Basel role, both paid in CHF, both asking for her rate;
  - a remote-first role with a Dublin office that asks whether she would relocate later;
  - a second Zurich role in CHF, delivered after the CHF question is answered;
  - a scam asking for a fee and a passport scan;
  - a "recruiter" for a large company writing from a free-mail address.
  - two onsite backend roles (Munich, Vienna) that her places cap, for S11: `s11-failover` and
    `s11-recovery`, delivered one at a time.
- **The first scan's backlog:** every good match in Maria's MVP 1 mailbox is older than 14 days,
  so the backlog gets matches but no automatic drafts.
- **Assistant:** `e2e/fixtures/assistant/requests.json` — ten requests in English, German and
  Portuguese, each with the change it should produce.
- **Domains:** the test stack adds a DNS server (CoreDNS with a fixture zone) and a fake RDAP
  service, so domain checks run for real without the internet.
- **Seed commands used:** `seed deliver <id>`, `seed inspect drafts <persona>`, `seed inspect smtp`,
  `seed reset-uidvalidity <persona>`.

## F1. Continuous sync

**Structure**

- `packages/mail`: incremental fetch by UID per folder, `UIDVALIDITY` handling.
- `apps/server`: a sync job per mailbox every `JOBFILLY_SYNC_INTERVAL_SECONDS` (15 in the test
  stack); the analysis pipeline per message (sort → facts → sender check → match → draft or
  decision).
- `apps/web`: live inbox updates; mailbox status ("Synced 2 minutes ago", "Can't reach the mail
  server since 10:42").

**Acceptance criteria**

- **F1.1** New mail shows up in the job inbox — sorted, with facts, sender check and match — within
  one sync interval plus processing, live for everyone in the workspace.
- **F1.2** Only one sync per mailbox runs at a time across replicas; a killed replica's sync is
  taken over once its lease expires.
- **F1.3** When the mail server reports a new `UIDVALIDITY`, the app re-indexes the folder and keeps
  every correction, decision and draft, matched by `Message-ID`.
- **F1.4** A failed sync is retried with back-off and shown as mailbox status, never silently.
- **F1.5** Settings › AI shows model calls and tokens per day for the workspace.
- **F1.6** Job messages analysed before this MVP (the first scan's backlog) also get the sender
  check and a match. Drafts are created automatically only for messages received within the reply
  window (profile entry `reply_window_days`, default 14).

## F2. CVs

**Structure**

- `packages/ai`: CV reading (task `cv.v1`, keyed by the CV's content hash): language, skills as
  written, role families, seniority, country and format hints.
- `packages/core`: CV choice per role (tags, metadata, language) with a reason; the skill check
  that drops any skill not found in the CV text.
- `packages/db`: `cvs` (file in Postgres, at most 5 MB, text, skills, tags, metadata), links from
  profile to CVs.
- `apps/server`: `/api/workspaces/:id/cvs` (upload, list, tags, download, delete).
- `apps/web`: CVs page; a CV prompt on the profile page.

**Acceptance criteria**

- **F2.1** Editors upload several PDF or DOCX files. Each gets an AI-suggested language, skills,
  role families, seniority and format hints, shown as editable tags; users add their own tags.
- **F2.2** A skill is listed only if it appears in the CV text. A model answer containing a skill
  that isn't there is dropped and logged as `cv.skill_dropped`.
- **F2.3** Every role shows the CV the app would use and why ("German backend role → Backend
  (DE)"); an editor can change the choice for that role.
- **F2.4** CV files live in Postgres; no replica writes them to disk.
- **F2.5** Deleting a CV removes the file and its links. Drafts already in the mailbox stay there.

## F3. Rules

**Structure**

- `packages/schema` — `Rule { id, profileId, description, when: Condition[], then, enabled,
  source (you | decision | assistant), createdAt, createdBy }`;
  `Condition { fact, op, value }` where `fact` is a universal job fact or message field (`places.
  country`, `workMode`, `timeZones`, `pay`, `contract`, `company`, `agency`, `sender.domain`,
  `category`, `skills`, `languages`, `extra.<key>`) and `op` is one of `in`, `not_in`, `within`,
  `outside`, `below`, `contains`, `equals`, `missing`; `then` is `hide`, `no_draft`, `ask_first` or
  `cap_score`.
- `packages/core`: the rules engine — the same input always gives the same outcome, with the rule
  that caused it.
- `apps/web`: a Rules list on the profile page (description, source, on/off, remove).

**Acceptance criteria**

- **F3.1** Rules are shown in plain words ("Hide roles whose hours are outside UTC−1 to UTC+3") and
  each records its source.
- **F3.2** A rule only applies when the fact is known: a role with no stated time zone is not hidden
  by a time-zone rule, and its explanation says "time zone not stated".
- **F3.3** Every outcome a rule causes names the rule ("Hidden by your rule …").
- **F3.4** Hidden roles stay reachable under a **Hidden** filter, with the reason.
- **F3.5** Switching a rule off or removing it re-evaluates affected roles within a minute.

## F4. Explainable match

**Structure**

- `packages/core`: compares job facts with profile entries and rules, giving *fits*, *conflicts* or
  *unknown* for each; hard conflicts cap the score.
- `packages/ai`: only the fuzzy parts (does a title fit the target roles, how close are the skills)
  — task `match.v1`, one call per role, keyed by `Message-ID` and the role's position in the
  message.
- `packages/schema`: `Match { score, verdicts [{ entryKey | ruleId, verdict, reason }], skills
  { matched, missing }, cvId, capped }`.
- `apps/web`: fit score in the list; a match panel in the message detail.

**Acceptance criteria**

- **F4.1** Every role gets a fit score from 0 to 100 and a list of the profile entries and rules
  that apply, each *fits*, *conflicts* or *unknown* with a reason ("Berlin, hybrid — fits your
  'Berlin, hybrid'").
- **F4.2** A hard conflict — a place or work mode not accepted, pay below the minimum in the same
  currency and period, a deal-breaker, a `cap_score` rule — caps the score at 40 and is listed
  first.
- **F4.3** Pay is compared only in the same currency and period. Anything else is *unknown* with
  the reason ("different currency"); exchange rates are never assumed.
- **F4.4** Matched and missing skills come from the chosen CV and the profile; a missing skill is
  never counted as a fit.
- **F4.5** The UI calls it a "fit score", never an ATS score.
- **F4.6** After a profile or rule change, affected roles are re-scored within a minute; a stale
  score is never shown as current.

## F5. Sender check

**Structure**

- `packages/core`: signals from the message (asks for payment, asks for ID documents before an
  offer, chat-only hiring, free-mail address for a company recruiter, sender doesn't match the
  company) and from the domain (age from RDAP, MX records from DNS), each with a reason.
- `apps/server`: domain lookups with caching; RDAP through `JOBFILLY_RDAP_URL`, DNS through the
  system resolver.
- `apps/web`: a badge (looks fine, caution, high risk) and the reasons.

**Acceptance criteria**

- **F5.1** Every sender of job mail gets a verdict with its reasons, worded as an estimate.
- **F5.2** High risk means no automatic draft and a visible warning on the message.
- **F5.3** A lookup that fails marks the check "incomplete", never "looks fine".
- **F5.4** An editor can mark a sender trusted or blocked; it is kept across syncs and named in the
  explanation.
- **F5.5** Both scams — the one in the first scan's backlog and the one delivered in this MVP — are
  high risk (fee, passport); the free-mail "recruiter" is caution.

## F6. Drafts

**Structure**

- `packages/ai`: reply drafting (task `draft.v1`), output `{ subject, body, language, usedEntries,
  attachCv, questions }`.
- `packages/core`: the reply policy (profile entries `reply_to`, `reply_threshold` default 70 and
  `reply_window_days` default 14) and the placeholder check.
- `packages/mail`: build the MIME message (`In-Reply-To`, `References`, optional CV attachment) and
  save it to Drafts with the `\Draft` flag; replace and delete drafts.
- `packages/db`: `drafts` (status, mailbox reference, content hash). A draft row holds only the
  reply text; the quote of the original message is added when the MIME message is built, so the
  database never stores a mail body.
- `apps/server`: `/api/workspaces/:id/drafts` (list, get, update, discard, create for a role).
- `apps/web`: Drafts page; draft panel in the message detail.

**Acceptance criteria**

- **F6.1** A message gets a reply draft automatically when its category is in the profile's
  `reply_to` (by default recruiter outreach), it arrived within the reply window, its role scores at
  or above the reply threshold, the sender isn't high risk, and no `hide`, `no_draft` or `ask_first`
  rule holds it back. The draft is in the language of the incoming message.
- **F6.2** A draft uses only the profile and the chosen CV. Anything it can't back up becomes a
  question for the decision inbox instead of a guess. A draft containing a template placeholder
  ("[Name]", "{company}") is rejected and regenerated once, then marked failed.
- **F6.3** The draft is saved to the mailbox's Drafts folder, threaded to the original. When the
  message asks for a CV, the chosen CV is attached.
- **F6.4** Editors review and edit drafts in the app. Saving replaces the mailbox draft (exactly one
  copy remains); discarding deletes it from the mailbox.
- **F6.5** Editors can ask for a draft on any role with **Draft a reply**, whatever its score.
- **F6.6** Nothing is sent: the app makes no SMTP connection in this MVP, and `seed inspect smtp`
  shows nothing.
- **F6.7** The Drafts page shows each draft's status: in mailbox, edited, discarded, failed (with
  the reason). Viewers can read drafts but not change them.

## F7. Decision inbox

**Structure**

- `packages/core`: decisions are created from a draft's `questions`, from match unknowns that a
  reply can't go without, and from `ask_first` rules; similar questions are grouped by profile key.
- `packages/db`: `decisions` with the messages waiting on each.
- `apps/server`: `/api/workspaces/:id/decisions` (list, answer, not now, don't ask for this
  message).
- `apps/web`: Decision inbox with a count in the navigation.

**Acceptance criteria**

- **F7.1** A decision is created only when an answer is needed to reply to a good match — not for
  every unknown.
- **F7.2** Each decision shows the question, the messages waiting on it, answers to click plus a
  free-text option, and **Use this answer for similar mail**.
- **F7.3** Similar questions (same profile key, e.g. "minimum pay in CHF per year") become one
  decision listing every waiting message.
- **F7.4** Answering writes a profile entry (source: decision), re-matches the waiting messages and
  creates their drafts within a minute; the decision leaves the inbox.
- **F7.5** **Not now** keeps it. **Don't ask for this message** closes it for that message without a
  draft.
- **F7.6** An answered question is never asked again: a later message that needs the same answer
  uses it.
- **F7.7** Viewers see decisions but can't answer them.

## F8. Assistant

**Structure**

- `packages/ai`: task `assistant.v1` — structured output `{ reply, clarify: { question, choices }
  | null, proposal: { summary, changes: Change[] } | null }`, where a `Change` adds, updates or
  removes a rule or a profile entry.
- `packages/core`: impact preview — the profile with the change applied, run against the current
  roles (how many get hidden or shown, scores that move, drafts that won't be created, drafts already
  in the mailbox).
- `packages/db`: `assistant_threads`, `assistant_messages`, `profile_history` (every change with
  who, when, source and the request behind it).
- `apps/server`: `/api/workspaces/:id/assistant` (send a message), `…/proposals/:id/apply`,
  `…/proposals/:id/discard`, `/api/workspaces/:id/profiles/:pid/history` (list, undo).
- `apps/web`: an **Assistant** panel available on every page; proposal cards; profile history with
  **Undo**.

**Acceptance criteria**

- **F8.1** The assistant opens from every page and understands the user in any language.
- **F8.2** A request to change preferences or automation ("lately I don't want jobs in Asian time
  zones, ignore them") gets a proposal card: the change in plain words, before and after for each
  entry or rule, and the impact on current roles ("hides 3 roles"). Nothing changes until
  **Apply**; the card can be edited (e.g. the time-zone range) before applying.
- **F8.3** **Apply** saves the change (source: assistant) and the inbox reflects it within a
  minute: hidden roles move under **Hidden**, explained by the new rule.
- **F8.4** Every applied change appears in the profile history with who, when, the source and the
  request that led to it. **Undo** restores the previous state and re-evaluates the roles.
- **F8.5** Drafts already in the mailbox are never touched by an applied change, and the impact
  preview says so ("1 draft is already in your mailbox and stays there").
- **F8.6** An unclear request ("stop showing me bad jobs") gets a clarifying question with choices,
  not a guess.
- **F8.7** The assistant can't send mail, invite people, change mailboxes or AI settings, or delete
  data. Asked to, it says it can't and where that's done.
- **F8.8** Viewers can chat but can't apply (disabled in the UI, refused by the server).
- **F8.9** With the fake AI a reply appears within 10 seconds, with a visible "thinking" state
  meanwhile.
- **F8.10** Assistant messages and proposals are stored for the history but never logged.

## Log events

`sync.started {mailboxId}`, `sync.completed {mailboxId, new}`, `sync.failed` (warn),
`sync.uidvalidity_changed`, `pipeline.message_processed`, `cv.uploaded`, `cv.skill_dropped` (warn),
`match.scored`, `rule.applied {ruleId, action}`, `sender.checked {verdict}`,
`sender.lookup_incomplete` (warn), `draft.created`, `draft.saved_to_mailbox`, `draft.updated`,
`draft.discarded`, `draft.rejected_placeholder` (warn), `decision.created`, `decision.answered`,
`assistant.message {threadId}`, `assistant.proposal_created {proposalId, changes}`,
`assistant.proposal_applied`, `assistant.proposal_discarded`, `profile.change_undone`. Every line
carries `instance`.

## End-to-end scenarios

Probes follow the rules in [MVP 1](MVP-1.md#end-to-end-scenarios) (own `curl` session, `Origin`
header set).

| # | Scenario | Covers |
| --- | --- | --- |
| S1 | **CVs** 📸 Maria opens **CVs** → uploads her three CVs with the file picker → each shows suggested tags (language, role family, seniority); "Data engineering (EN)" doesn't list the skill the fake AI invented → she turns on **Preferred CV** for Backend (EN) → the profile page lists all three. Tom uploads "Nurse (EN)" in his own workspace. Probe: Maria's session downloading Tom's CV → 404. Logs: `cv.uploaded` ×4, `cv.skill_dropped`. | F2.1, F2.2, F2.4 |
| S2 | **New mail flows in** `seed deliver` the batch of new messages (except the second Zurich role) → without reloading, they appear within about 30 seconds with category, facts, sender badge and fit score → mailbox status "Synced just now" → Settings › AI shows today's model calls and tokens. Logs: `sync.started`, `sync.completed new=…`, `pipeline.message_processed` per message. | F1.1, F1.2, F1.5, F1.6 |
| S3 | **A good match gets a draft in the mailbox** 📸 Open the Berlin role (German, asks for a CV) → labelled "fit score", ≥ 70, with the reasons listed and the matched and missing skills from the CV → CV "Backend (DE)" chosen with its reason → the draft is in German with the CV attached → verification step: `seed inspect drafts maria` shows exactly one draft in reply to the Berlin message, threaded, with the attachment; `seed inspect smtp` shows nothing. Logs: `match.scored`, `draft.created`, `draft.saved_to_mailbox`. | F4.1, F4.4, F4.5, F2.3, F6.1–F6.3, F6.6 |
| S4 | **Edit, discard, draft on demand** The remote-EU draft exists although the fake AI's first attempt had a placeholder (logs `draft.rejected_placeholder`) → edit it and save → `seed inspect drafts maria` shows one draft for that thread with the new text → discard another draft → gone from the mailbox → open the data-engineering role (below the threshold, no draft) → **Draft a reply** → a draft using "Data engineering (EN)" → delete that CV → it's gone from the CVs page and from the role's CV choice, and `seed inspect drafts maria` still shows the draft. | F6.2, F6.4, F6.5, F6.7, F2.3, F2.5 |
| S5 | **Decisions** 📸 Before answering, the Zurich role shows pay "unknown — different currency" → the decision inbox shows "Minimum pay in CHF per year?" waiting on both the Zurich and the Basel role, and "Would you relocate to Ireland?" waiting on the Dublin role → on the relocation decision press **Not now** (it stays), then **Don't ask for this message** (it closes, no draft) → answer CHF with a suggested amount and **Use this answer for similar mail** → within a minute both roles are re-scored, their drafts appear and the decision is gone → `seed deliver` the second Zurich role → no new decision; its draft uses the answer. Logs: `decision.created` ×2, `decision.answered`. | F7.1–F7.6, F4.3, F4.6 |
| S6 | **Sender check** Both scams are "High risk" with "asks for a fee" and "asks for a passport scan", and neither has a draft → the free-mail recruiter is "Caution" → mark that sender **Trusted** → it stays trusted after the next sync and the explanation says so. | F5.1–F5.5 |
| S7 | **Conflicts and policy** The Amsterdam role and the Singapore onsite role are capped at 40 or less, the conflict listed first, no draft → a job alert never gets a draft → a good match from the first scan's backlog older than 14 days has a match but no automatic draft. | F4.2, F6.1, F1.6 |
| S8 | **Assistant: time zones** 📸 Open **Assistant** → type "Lately I don't want jobs in Asian time zones anymore, ignore them" → a "thinking" state, then a proposal card: "Hide roles whose working hours are UTC+5 or later", impact "hides 3 roles; 1 draft is already in your mailbox and stays there" → change the range to UTC+4 → **Apply** → the three Asia-Pacific roles move under **Hidden** with "Hidden by your rule …", and `seed inspect drafts maria` still shows that draft → the profile history shows the change (source: assistant) → **Undo** → the roles are back. Logs: `assistant.proposal_created`, `assistant.proposal_applied`, `rule.applied action=hide`, `profile.change_undone`. | F8.1–F8.5, F8.9, F3.1–F3.5 |
| S9 | **Assistant: unclear and not allowed** Type "stop showing me bad jobs" → a clarifying question with choices → pick one → a proposal → **Discard** → nothing changed. Type "send my reply to the Berlin recruiter" → "I can't send mail" with where drafts are reviewed. Type a message in German → the reply is in German. Type a message containing `E2E-CHAT-1` → it later appears in the stored history but not in `app.log`. | F8.1, F8.6, F8.7, F8.10 |
| S10 | **Roles** Maria sets Tom back to **Viewer** → Tom sees drafts, decisions and the assistant; editing, answering and **Apply** are disabled. Probes: Tom applying a proposal, answering a decision, editing a draft → 403 each. | F6.7, F7.7, F8.8 |
| S11 | **Resilience** Deliver one message (`seed deliver s11-failover`), read the `instance` of the next `sync.started`, and kill that replica → the next sync runs on the other replica and the message arrives; start the killed replica again → `docker compose pause imap` → the mailbox shows "Can't reach the mail server since …" → `docker compose unpause imap` → the status recovers and new mail flows again (`seed deliver s11-recovery` arrives) → `seed reset-uidvalidity maria` → after the next sync every correction, decision and draft is still there. Logs: `job.lease_expired`, `sync.failed`, `sync.uidvalidity_changed`. | F1.2–F1.4 |
| S12 | **Regression** All MVP 1 specs pass. | — |

**Proven outside the walkthrough:** F2.4 by an integration test (uploads never touch the replica's
disk) plus the read-only root filesystem of the test stack; F8.10 also by the `E2E-CHAT-*` leak
check.

## Quality with a real AI provider (sign-off run)

- Every draft is in the language of the incoming message and contains no placeholders.
- The quality run reads ten drafts and checks every statement against the profile and the CV: at
  least nine are fully backed, and no draft invents a skill.
- CV choice matches `expected.json` for at least 90% of roles.
- Every hard conflict in the fixtures is detected.
- Both scams are high risk; overall sender verdicts agree with `expected.json` at least 80% of the
  time.
- The ten requests in `e2e/fixtures/assistant/requests.json`: at least nine produce the expected
  change, and none is applied without **Apply**.

## Sign-off

| Date | Status | Commit | Run folder | Real AI provider | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-10-17 | accepted with open items | b9c65f0 | e2e/reports/mvp-2/20261016T202151Z-walkthrough (walkthrough, at 9d60e99), e2e/reports/mvp-2/20261017T003832Z-real-ai (real AI, at 5724c92), e2e/reports/mvp-2/20261017T015103Z-specs-and-assistant (specs plus the assistant with real AI, at 2c90ade) | anthropic, claude-sonnet-5-5 | Built and validated with Claude orchestrating agents after the unattended build stopped on 2026-10-16 (most slices had never been merged). Walkthrough: S1–S12 and all criteria pass, S11 in full with its own deliveries (TBD-442); no blockers or important findings; no leaks; probes pass (S1 CV download 404, S10 viewer 403). Specs: e2e/specs/mvp-2 written for S1–S11; `pnpm e2e` 28/28 on a fresh stack at b9c65f0 (MVP 1 17/17 as S12). Real AI: drafts 6/6 in the message's language with no placeholders; 6/6 backed with no invented skill (only 6 drafts exist: apac-1 is held by a working-hours question, TBD-444, and Dublin closed by S5); CV choice 310/310; hard conflicts 164/164; both scams high risk, senders 237/238; assistant 8/10, below 9 (open item TBD-445, accepted by the owner); nothing applied without Apply; key in neither app.log nor pg_dump. Real-AI fixes: assistant wire schema (705363a), classify treats any job offer as job mail (9add172), no scheduling questions in drafts (0ab2569), CV choice across family wordings (30dd23f), contains for free-text facts (6192afe), the job-mail languages in the assistant prompt (2c90ade). Other fixes from validation: sync back-off at start (be6a7c1), outage not blamed on TLS (8c31f1d), re-evaluation yields at batch boundaries (371770d), deadlock-free markStale and stage-failure locking (5724c92, 8b3a656), a failed CV read marked failed (4cee847). Owner decisions: Preferred CV switch (TBD-439), one automatic draft per email (TBD-221), Gmail-only OAuth for MVP 3 (TBD-441), free-word remote scope stays unknown (TBD-443). TBD.md open for MVP 2: TBD-440 (Message-ID reuse), TBD-445 (assistant 8/10). Minor findings left: CVs named after the file and not renamable; "All" stays pressed in the Hidden view; Members role texts still MVP 1's; history writes "EUR 70,000" and an undo is a new "By hand" entry; "No draft for this role." gives no reason; the CV-choice reason shows interim text; the outage status stays up to one back-off after recovery and uses 24-hour time with no hint what to check; a rule reads "country is NL"; answering a decision gives no confirmation; the profile's CV list doesn't mark the preferred CV; an undone proposal still says "Applied"; a viewer's Discard on their own proposal stays enabled; the logged retry delay can be up to half a sync interval longer than the wait. |
