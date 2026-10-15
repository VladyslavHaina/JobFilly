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

## Build order

F1 → F2 → F3 → F4 → F5 → F6 → F7 → F8 → F9 → F10, then the Helm chart.

## Fixtures added

- **Maria moves to Germany:** new mail about Munich and Hamburg roles in German, paid yearly in EUR,
  permanent contracts; her replies say she has moved and wants permanent roles in Germany. Her
  remote EU mail keeps arriving.
- **Maria's second mailbox:** a personal address with a few job emails, and SMTP for sending.
- **Threads for the pipeline:** application confirmation → interview invite → offer; application →
  rejection; an application with no answer for 25 days; the same role sent by two agencies.
- **OAuth:** a fake authorisation server in the test stack.
- **Seed commands used:** `seed deliver <id>`, `seed inspect sent <persona>`,
  `seed inspect inbox <address>` (what the test SMTP server delivered).

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

- **F2.1** Editors can change every profile entry and rule by hand: values, the rule's conditions
  and action, on/off, delete.
- **F2.2** Every change — by hand, decision, assistant or scan — is in the history with who, when
  and the source, and can be undone.
- **F2.3** A change re-evaluates affected roles within a minute and says how many changed.

## F3. Several mailboxes and OAuth

**Structure**

- `packages/mail`: XOAUTH2 for IMAP and SMTP; SMTP settings per mailbox.
- `apps/server`: OAuth authorisation-code flow with PKCE for Microsoft and Google, enabled when
  their client settings are in the environment (`JOBFILLY_MICROSOFT_CLIENT_ID`,
  `JOBFILLY_MICROSOFT_CLIENT_SECRET`, `JOBFILLY_GOOGLE_CLIENT_ID`, `JOBFILLY_GOOGLE_CLIENT_SECRET`);
  encrypted tokens with automatic refresh.
- `apps/web`: mailboxes list; a mailbox filter in the inbox.

**Acceptance criteria**

- **F3.1** An admin connects several mailboxes to a workspace. Every message shows which mailbox it
  came from, and the inbox can be filtered by mailbox.
- **F3.2** **Sign in with Microsoft** and **Sign in with Google** appear only when the server has
  their client settings. Tokens are encrypted and refreshed automatically; a revoked token turns the
  mailbox to "Reconnect needed", and nothing is lost.
- **F3.3** The OAuth flow is tested against the fake authorisation server. IMAP login with the token
  is tested against the test mail server if it supports XOAUTH2, otherwise in an integration test
  against a fake IMAP server. Sign-off adds one run with a real Outlook.com test account.

## F4. Sending with confirmation

**Structure**

- `packages/mail`: SMTP sending; a copy saved to Sent when the provider doesn't do it itself.
- `apps/server`: a confirmation token bound to the draft's exact content; a send job delayed 10
  seconds; cancel.
- `apps/web`: **Send** on a draft; the confirmation dialog; **Undo**.

**Acceptance criteria**

- **F4.1** Editors and admins can press **Send** on a draft. A confirmation shows the recipients,
  subject, attachments and exact text.
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
  workspaces after confirmation, and removes the user from the rest.
- **F7.4** Disconnecting a mailbox deletes its credentials, its synced metadata and everything tied
  to its messages, and says so before confirming.

## F8. Assistant answers questions

**Acceptance criteria**

- **F8.1** The assistant answers questions about the job search — "what's waiting on me?", "why was
  the Zurich role hidden?", "how many interviews did I have this month?" — with links to the roles
  and messages it used.
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
- **F10.3** A two-hour soak with one new message per minute per workspace: memory per replica stays
  within 20% of where it started, no job fails, p95 API latency stays under 300 ms on the test
  stack.
- **F10.4** [ARCHITECTURE](../ARCHITECTURE.md) lists everything a deployment needs: environment
  variables, port, probes, the migrate command, and the resource use observed in the soak.

## Log events

`scan.started {kind: rerun}`, `profile.assigned {profileId}`, `profile.updated`,
`mailbox.oauth_connected`, `mailbox.reconnect_needed` (warn), `send.confirmed`, `send.undone`,
`send.completed`, `pipeline.stage_changed`, `member.scope_changed`, `member.removed`,
`workspace.ownership_transferred`, `export.completed`, `workspace.deleted`, `account.deleted`,
`assistant.answered {sources}`.

## End-to-end scenarios

| # | Scenario | Covers |
| --- | --- | --- |
| S1 | **Moving to Germany** 📸 `seed deliver` the Germany batch → Maria presses **Re-run setup**, types the hint → the scan stops → a new intake form proposes German places, EUR per year, permanent → **Confirm** as "Germany permanent" → both profiles listed and on. | F1.1, F1.2 |
| S2 | **Roles go to the right profile** Munich and Hamburg roles show "→ Germany permanent" with the reason; a remote EU role still shows the first profile → reassign one by hand → its match and CV choice update. | F1.3, F1.4 |
| S3 | **Editing by hand** Change the reply threshold to 80, edit a rule's range, switch a rule off → each shows how many roles changed → **Undo** the last change → profile history lists all three with their sources. | F2.1–F2.3 |
| S4 | **Second mailbox** Connect the personal mailbox → its job email appears, marked with that mailbox → filter by mailbox → **Sign in with Microsoft** completes against the fake authorisation server. | F3.1–F3.3 |
| S5 | **Send, then undo** 📸 Open a draft → **Send** → the confirmation shows recipient, subject, attachment and text → confirm → **Undo** within 10 seconds → the test SMTP server received nothing → **Send** again and let it go → exactly one message received, one copy in Sent, the draft gone, the activity log shows it. Edit a different draft after opening its confirmation → sending asks to confirm again. | F4.1–F4.5, F9.1 |
| S6 | **Pipeline** 📸 The pipeline shows the offer thread under Offer, the rejection under Rejected, the silent application flagged after 21 days, and the role from two agencies once with both senders → move a role to Interview by hand → it stays there after the next sync. | F5.1–F5.3 |
| S7 | **Sharing with control** Maria changes Tom to **Job pipeline only** → Tom sees roles, matches and the pipeline but no message bodies or drafts; asking the assistant for a message's text gets "not available" → curl with Tom's cookie on a message body → 404. | F6.1, F6.2, F8.3 |
| S8 | **Members** Maria makes Tom an admin → Tom can manage members → Tom tries to remove Maria, the owner → refused → Maria hands ownership to Tom → she is now an admin and can leave the workspace. | F6.3 |
| S9 | **Ask the assistant** "What's waiting on me?" → open decisions and unreviewed drafts with links → "Why was the Singapore role hidden?" → the rule or conflict, linked → "How many interviews this month?" → the right number with links. | F8.1, F8.2, F8.4 |
| S10 | **Export and delete** 📸 Export Maria's workspace → the ZIP has every listed part, CVs included → delete Tom's workspace (typing its name) → it's gone for its members → Tom deletes his account → he can't sign in; Maria's workspace no longer lists him. Afterwards `pg_dump` has none of Tom's data. | F7.1–F7.3, F9.2 |
| S11 | **Disconnect a mailbox** Disconnect the personal mailbox → the confirmation lists what goes → afterwards none of its messages or credentials remain. | F7.4 |
| S12 | **Rolling restart under load** (scripted) Run F10.1 and F10.2 with the three-replica stack. | F10.1, F10.2 |
| S13 | **Soak** (scripted) Run F10.3 and record the numbers in the report. | F10.3, F10.4 |
| S14 | **Regression** All MVP 1 and MVP 2 specs pass. | — |

**Security probes (curl):** send without a confirmation token, or with a token for older content →
refused; a pipeline-only member reading a body or a draft → 404; the OAuth callback with a wrong
`state` → refused; the export URL from another workspace → 404.

## Quality with a real AI provider (sign-off run)

- Profile assignment matches `expected.json` for at least 90% of roles.
- The re-run with the Germany hint proposes German places, EUR per year and permanent contracts.
- Ten scripted assistant questions: every answer's numbers and links are correct, and nothing is
  made up.

## Sign-off

| Date | Status | Commit | Run folder | Real AI provider | Notes |
| --- | --- | --- | --- | --- | --- |

## After sign-off: the Helm chart

Built only once MVP 3 is signed off.

- **H1** `deploy/helm/jobfilly` contains: a Deployment (2 replicas by default, liveness and
  readiness probes on the health endpoints, resources from the soak, non-root, read-only root
  filesystem with an `emptyDir` for `/tmp`), a Service, an optional Ingress, a PodDisruptionBudget,
  a ConfigMap (`PUBLIC_URL`, `LOG_LEVEL`, sync interval) and a Secret (`DATABASE_URL`,
  `JOBFILLY_SECRET_KEY`, OAuth settings) — or the name of an existing Secret.
- **H2** Migrations run as a pre-install and pre-upgrade hook Job (`node dist/index.js migrate`).
- **H3** PostgreSQL is external by default (`DATABASE_URL`); a bundled database for trying it out
  can be switched on.
- **H4** `helm lint` and `helm template` are clean.
- **H5** Installed on the owner's local cluster with the test services in a separate namespace, the
  full MVP 1–3 suite passes against the Ingress, and a `helm upgrade` to a new image during a scan
  finishes without errors or signed-out users.
