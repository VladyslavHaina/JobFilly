# MVP 3 — It grows with me

**Goal:** JobFilly keeps up when life changes — a move, a second job search, a second mailbox. The
user can send from the app with confidence, sees every application in a pipeline, shares the
workspace with exactly the access they choose, takes their data with them, and the server is proven
ready for Kubernetes.

**Why it's worth having on its own:** it turns a good assistant into the place where the whole job
search lives, for as long as it lasts, and makes the self-hosted server safe to run for others.

## Scope

**In:** several profiles, re-running setup and assigning messages to profiles; editing every profile
entry and rule by hand; several mailboxes and OAuth mail sign-in; sending with confirmation and
undo; the application pipeline; selective sharing and member management; export and deletion; the
activity log; the assistant answering questions; the Kubernetes proof. After sign-off: the Helm
chart.

**Replaces from earlier MVPs:** MVP 1's one-mailbox limit (F2.5, and the "no second mailbox" step
in its S7). From this MVP on that check no longer applies, and its spec is updated in the codify
step.

## Build order

F1 → F2 → F3 → F4 → F5 → F6 → F7 → F8 → F9 → F10, then the Helm chart.

## Fixtures added

- **Maria moves to Germany:** new mail about Munich and Hamburg roles in German, paid yearly in EUR,
  permanent contracts; her replies say she has moved and wants permanent roles in Germany. Her
  remote EU mail keeps arriving.
- **Maria's second mailbox:** a personal address with a few job emails. Both of her test accounts
  accept SMTP.
- **Threads for the pipeline** (delivered in S6): application confirmation → interview invite →
  offer; application → rejection; an application with no answer for 25 days; the same role sent by
  two agencies.
- **OAuth:** a fake authorisation server in the test stack, reachable from the browser through the
  proxy and from the app inside the stack.
- **Assistant:** `e2e/fixtures/assistant/questions.json` — ten questions with their expected answers
  and links.
- **Soak:** `seed generate --per-minute 1` delivers generated job mail; the fake AI answers generated
  messages from templates.
- **Seed commands used:** `seed deliver <id>`, `seed inspect sent <persona>`, `seed inspect smtp`,
  `seed generate`.

## F1. Several profiles and re-running setup

**Structure**

- `packages/core`: profile assignment for each role (places, roles, language, rules), with a
  reason; the re-run scan steered by a hint.
- `apps/server`: `/api/workspaces/:id/scans` with `kind: rerun` and `hint`; profile on/off;
  reassignment.
- `apps/web`: **Re-run setup**; profile switcher and on/off; the assigned profile shown on every
  role.

**Acceptance criteria**

- **F1.1** An admin presses **Re-run setup**, optionally types a hint ("I've moved to Germany,
  permanent roles only"), and the scan focuses on the hint over the last 90 days. Its intake form
  creates a **new** profile next to the existing ones; existing profiles are untouched.
- **F1.2** Profiles can be switched on and off; at least one stays on.
- **F1.3** Every role is assigned to the best active profile with the reason shown ("Munich role,
  German, permanent → 'Germany permanent'"). An editor can reassign it; matching, CV choice and
  drafting use the assigned profile.
- **F1.4** With the fake AI, Maria's Munich and Hamburg roles go to the new profile and her remote
  EU roles stay with the first one, as in `expected.json`.

## F2. Editing profiles and rules by hand

**Structure:** `apps/web` profile and rules editors; `apps/server` profile and rule update routes
writing `profile_history`.

**Acceptance criteria**

- **F2.1** Editors can change every profile entry and rule by hand — values, a rule's conditions and
  action, on/off, delete — and create new rules.
- **F2.2** Every change — by hand, decision, assistant or scan — is in the history with who, when
  and the source, and can be undone.
- **F2.3** A change re-evaluates affected roles within a minute and says how many changed.

## F3. Several mailboxes and OAuth

**Structure**

- `packages/mail`: XOAUTH2 for IMAP and SMTP; SMTP settings per mailbox.
- `apps/server`: OAuth authorisation-code flow with PKCE for Microsoft and Google, enabled when
  their client settings are in the environment (`JOBFILLY_MICROSOFT_CLIENT_ID`,
  `JOBFILLY_MICROSOFT_CLIENT_SECRET`, `JOBFILLY_GOOGLE_CLIENT_ID`, `JOBFILLY_GOOGLE_CLIENT_SECRET`);
  encrypted tokens with automatic refresh. The test stack overrides each provider's endpoints with
  `JOBFILLY_<PROVIDER>_AUTHORIZE_URL`, `_TOKEN_URL`, `_IMAP_HOST` and `_SMTP_HOST`; the authorize URL
  goes through the proxy so the browser can reach it.
- `apps/web`: mailboxes list; a mailbox filter in the inbox.

**Acceptance criteria**

- **F3.1** An admin connects several mailboxes to a workspace. Every message shows which mailbox it
  came from, and the inbox can be filtered by mailbox.
- **F3.2** **Sign in with Microsoft** and **Sign in with Google** appear only when the server has
  their client settings. Tokens are encrypted and refreshed automatically; a revoked token turns the
  mailbox to "Reconnect needed", and nothing is lost. A callback with a wrong `state` is refused.
- **F3.3** The OAuth flow is tested against the fake authorisation server. IMAP login with the token
  is tested against the test mail server if it supports XOAUTH2, otherwise in an integration test
  against a fake IMAP server. Sign-off adds one run with a real Outlook.com test account.

## F4. Sending with confirmation

**Structure**

- `packages/mail`: SMTP sending; a copy saved to Sent when the provider doesn't do it itself.
- `apps/server`: SMTP settings per mailbox (presets fill them, with a **Test** button); a
  confirmation token bound to the draft's exact content; a send job delayed 10 seconds; cancel.
- `apps/web`: **Send** on a draft; the confirmation dialog; **Undo**.

**Acceptance criteria**

- **F4.1** Editors and admins can press **Send** on a draft of a mailbox with SMTP settings. A
  confirmation shows the recipients, subject, attachments and exact text.
- **F4.2** After confirming, the message waits 10 seconds with **Undo** before anything leaves.
  Undo means nothing is sent.
- **F4.3** One message per action; there is no bulk send. The server refuses a send without a
  confirmation token for that draft's exact content — if the draft changed after confirming, the
  user confirms again.
- **F4.4** After sending, the message is in the mailbox's Sent folder exactly once and the draft is
  gone. The test SMTP server received exactly one message with the exact text.
- **F4.5** Viewers can't send. Every send is in the activity log.

## F5. Application pipeline

**Structure:** `packages/core` stage derivation and duplicate grouping; `apps/web` pipeline view.

**Acceptance criteria**

- **F5.1** Each role has a stage — new, replied, applied, interview, assessment, offer, rejected,
  closed — derived from its mail (an interview invite moves it to interview). An editor can set the
  stage by hand; a manual stage wins over a derived one.
- **F5.2** The pipeline view groups roles by stage, shows how long each has been there and the next
  step, and flags roles with no reply for 21 days.
- **F5.3** The same role sent by two agencies appears once, with both senders.

## F6. Sharing and members

**Acceptance criteria**

- **F6.1** When inviting, and later, an admin chooses what a member sees: **Everything**, or **Job
  pipeline only** (roles, facts, matches, stages and the profile — no message bodies, drafts or
  non-job mail).
- **F6.2** The server enforces the choice: hidden resources answer 404 for that member, the
  assistant included.
- **F6.3** Admins change roles and remove members; members can leave; the owner can't be removed but
  can hand ownership to another admin.

## F7. Your data

**Acceptance criteria**

- **F7.1** An admin downloads the whole workspace as one ZIP: JSON for profiles, rules, CV metadata,
  message metadata, facts, matches, decisions, drafts, the pipeline and the activity log, plus the CV
  files and a schema version. The export streams, so memory stays flat.
- **F7.2** Deleting a workspace needs its name typed in. It removes everything the workspace holds in
  Postgres, credentials and CV files included. The confirmation says that drafts and mail in the
  mailbox stay there.
- **F7.3** Deleting an account lists the workspaces the user owns and their members, deletes those
  workspaces after confirmation, and removes the user from the rest. Activity entries in other
  workspaces keep the action but show the actor as "Deleted user".
- **F7.4** Disconnecting a mailbox deletes its credentials, its synced metadata and everything tied
  to its messages, and says so before confirming.

## F8. Assistant answers questions

**Acceptance criteria**

- **F8.1** The assistant answers questions about the job search — "what's waiting on me?", "why
  didn't the Singapore role get a draft?", "how many interviews did I have in the last 30 days?" —
  with links to the roles and messages it used.
- **F8.2** Answers come from the workspace's data through read-only tools; the assistant never makes
  up a role, a number or a quote.
- **F8.3** It respects the member's access: for a pipeline-only member it can't read message bodies.
- **F8.4** Mail content it quotes is treated as untrusted; an email's instructions never become
  actions.

## F9. Activity log

**Acceptance criteria**

- **F9.1** Admins see a log of outward and sharing actions: drafts saved to the mailbox, mail sent,
  members invited, changed and removed, exports, deletions — who, when, what.
- **F9.2** The activity log is part of the export and is deleted with the workspace.

## F10. Kubernetes proof

**Acceptance criteria**

- **F10.1** The test stack runs three replicas. Two workspaces scan and sync at the same time while
  each replica is restarted in turn, 10 seconds apart: every scan and sync completes, no batch is
  processed twice, nobody is signed out, and no error is logged except expected warnings.
- **F10.2** The proxy sends traffic only to ready replicas, so users see no failed requests during
  the restarts.
- **F10.3** A two-hour soak with one new message per minute per workspace (`pnpm e2e:soak`, run only
  in the sign-off run, never in `pnpm e2e` or CI): memory per replica stays within 20% of its
  average between minutes 10 and 15, no job fails, and p95 API latency (from `http.request`) stays
  under 300 ms on the test stack.
- **F10.4** [ARCHITECTURE](../ARCHITECTURE.md) lists everything a deployment needs: environment
  variables, port, probes, the migrate command, and the resource use observed in the soak.

## Log events

`scan.started {kind: rerun}`, `profile.assigned {profileId}`, `profile.updated`,
`mailbox.oauth_connected`, `mailbox.reconnect_needed` (warn), `send.confirmed`, `send.undone`,
`send.completed`, `pipeline.stage_changed`, `member.scope_changed`, `member.role_changed`,
`member.removed`, `workspace.ownership_transferred`, `export.completed`, `workspace.deleted`,
`account.deleted`, `assistant.answered {sources}`. Every line carries `instance`.

## End-to-end scenarios

Probes follow the rules in [MVP 1](MVP-1.md#end-to-end-scenarios) (own `curl` session, `Origin`
header set). Logs capture all three replicas.

| # | Scenario | Covers |
| --- | --- | --- |
| S1 | **Moving to Germany** 📸 `seed deliver` the Germany batch → Maria presses **Re-run setup**, types the hint → the scan stops → a new intake form proposes German places, EUR per year, permanent → **Confirm** as "Germany permanent" → both profiles listed and on. Logs: `scan.started kind=rerun`, `intake.confirmed`. | F1.1, F1.2 |
| S2 | **Roles go to the right profile** Munich and Hamburg roles show "→ Germany permanent" with the reason; a remote EU role still shows the first profile → reassign one by hand → its match and CV choice update. Logs: `profile.assigned`. | F1.3, F1.4 |
| S3 | **Editing by hand** Create a rule by hand: hide roles in UTC+5 or later → it hides the Asia-Pacific roles and says how many → edit its range to UTC+6 or later → change the reply threshold to 80 → switch the rule off → each change says how many roles changed → **Undo** the last change → profile history lists every change with its source. Logs: `profile.updated`, `rule.applied`, `profile.change_undone`. | F2.1–F2.3 |
| S4 | **Second mailbox** Connect the personal mailbox → its job email appears, marked with that mailbox → filter by mailbox → **Sign in with Microsoft** completes against the fake authorisation server. Probe: the OAuth callback with a wrong `state` → refused. Logs: `mailbox.connected`, `mailbox.oauth_connected`. | F3.1–F3.3 |
| S5 | **Send, then undo** 📸 Add SMTP settings to Maria's main mailbox (the preset fills them) → **Test** → open the Berlin draft → **Send** → the confirmation shows recipient, subject, attachment and text → confirm → **Undo** within 10 seconds → `seed inspect smtp` shows nothing → **Send** again and let it go → `seed inspect smtp` shows exactly one message with the exact text, `seed inspect sent maria` one copy, the draft is gone, the activity log shows it. Open another draft's confirmation, then edit the draft → sending asks to confirm again. Probes: a send without a confirmation token, and one with a token for older content → both refused. Logs: `send.confirmed`, `send.undone`, `send.completed`. | F4.1–F4.5, F9.1 |
| S6 | **Pipeline** 📸 `seed deliver` the pipeline threads → the pipeline shows the offer thread under Offer, the rejection under Rejected, the silent application flagged after 21 days, and the role from two agencies once with both senders → move a role to Interview by hand → it stays there after the next sync. Logs: `pipeline.stage_changed`. | F5.1–F5.3 |
| S7 | **Sharing with control** Maria changes Tom to **Job pipeline only** → Tom sees roles, matches and the pipeline but no message bodies or drafts; asking the assistant for a message's text gets "not available". Probes: Tom's session on a message body and on a draft → 404 each. Logs: `member.scope_changed`. | F6.1, F6.2, F8.3 |
| S8 | **Members** Maria makes Tom an admin with **Everything** → Tom can manage members → Tom tries to remove Maria, the owner → refused → Maria hands ownership to Tom → Tom hands it back to Maria → Maria sets Tom back to **Editor**. Logs: `member.role_changed`, `workspace.ownership_transferred` ×2. | F6.3 |
| S9 | **Ask the assistant** "What's waiting on me?" → open decisions and unreviewed drafts with links → "Why didn't the Singapore role get a draft?" → the place conflict, linked → "How many interviews did I have in the last 30 days?" → the right number with links. Logs: `assistant.answered`. | F8.1, F8.2, F8.4 |
| S10 | **Rolling restart under load** (scripted) Maria and Tom each start a scan in their own workspace while new mail arrives; restart `app-a`, `app-b` and `app-c` in turn, 10 seconds apart → F10.1 and F10.2 hold. | F10.1, F10.2 |
| S11 | **Export and delete** 📸 Export Maria's workspace → verification step: the downloaded ZIP has every listed part, CVs included → Maria removes Tom from her workspace → probe: Tom's session on Maria's export URL → 404 → Tom deletes his own workspace (typing its name) → Tom deletes his account → he can't sign in; Maria's members list doesn't show him; her activity log shows his actions as "Deleted user". Afterwards a `pg_dump` contains neither Tom's email nor his name. Logs: `export.completed`, `member.removed`, `workspace.deleted`, `account.deleted`. | F7.1–F7.3, F9.2 |
| S12 | **Disconnect a mailbox** Disconnect the personal mailbox → the confirmation lists what goes → afterwards none of its messages or credentials remain. | F7.4 |
| S13 | **Regression** All MVP 1 and MVP 2 specs pass, with MVP 1's one-mailbox step updated as stated above. | — |

**Proven outside the walkthrough**

- F7.1 (memory): an integration test exports 5,000 synthetic messages while the process's memory
  grows by less than 50 MB.
- F8.3 and F8.4: unit tests on the assistant's tools (they enforce the member's access, and quoted
  mail is wrapped as untrusted), plus the real-AI quality run.
- F10.3 and F10.4: the soak in the sign-off run, recorded in its report.

## Quality with a real AI provider (sign-off run)

- Profile assignment matches `expected.json` for at least 90% of roles.
- The re-run with the Germany hint proposes German places, EUR per year and permanent contracts.
- The ten questions in `e2e/fixtures/assistant/questions.json`: every answer's numbers and links are
  correct, nothing is made up, and a question asking for a message body as a pipeline-only member
  gets no body.

## Sign-off

| Date | Status | Commit | Run folder | Real AI provider | Notes |
| --- | --- | --- | --- | --- | --- |

## After sign-off: the Helm chart

Built only once MVP 3 has a sign-off row.

- **H1** `deploy/helm/jobfilly` contains: a Deployment (2 replicas by default, liveness and
  readiness probes on the health endpoints, resources from the soak, non-root, read-only root
  filesystem with an `emptyDir` for `/tmp`, `terminationGracePeriodSeconds` of at least 30), a
  Service, an optional Ingress, a PodDisruptionBudget, a ConfigMap (`PUBLIC_URL`, `LOG_LEVEL`, sync
  interval) and a Secret (`DATABASE_URL`, `JOBFILLY_SECRET_KEY`, OAuth settings) — or the name of an
  existing Secret.
- **H2** Migrations run when the app starts, under the advisory lock, so every install works. On
  upgrade a pre-upgrade hook Job runs `node dist/index.js migrate` first, with hook weights that
  create the Secret it needs before it.
- **H3** PostgreSQL is external by default (`DATABASE_URL`); a bundled database for trying it out
  can be switched on.
- **H4** `helm lint` and `helm template` are clean.
- **H5** Installed on the owner's local cluster with the test services in a separate namespace, the
  full MVP 1–3 suite passes against the Ingress, and a `helm upgrade` to a new image during a scan
  finishes without errors or signed-out users.
