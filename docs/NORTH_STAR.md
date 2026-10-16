# JobFilly — North Star

> Agreed with the owner on 2026-10-14. It describes the end state; [docs/mvp/](mvp/README.md)
> gets there in three steps. It is a direction, not a contract: when building shows a better way,
> record the proposal in [TBD.md](../TBD.md); the owner decides and updates this file.

## Headline

**Connect your mail. JobFilly learns your job search and handles the busywork.**

## Who it is for

People looking for **professional roles, in any country**, in any field — and the people who help
them (a partner, a friend, a career coach), who can be invited into their workspace.

## How it works

1. **Sign up.** Anyone who can reach the server can register. Everyone gets their own workspace.
2. **Connect mail** over IMAP: an app password where the provider offers one, OAuth over IMAP
   for Gmail. Gmail is the main provider; Microsoft and Outlook sign-in are out of scope.
3. **Pick an AI provider.** A short guided choice; every provider is an equal option, local or
   cloud. One honest line says which provider reads the mail — no price tables, no lecture.
4. **First scan:** the last 90 days, smart, and it stops once it's confident.
   - A free pass without AI first: headers, known job platforms and applicant-tracking senders,
     people the user has already replied to.
   - Then the AI reads likely job mail in small batches, newest first, including the sent folder.
   - It stops when new batches no longer change the profile, or at a budget cap. It does **not**
     read everything: a 200-emails-a-day inbox would be too expensive.
5. **Intake form.** Pre-filled from the scan, with how sure the app is about each answer and why.
   The user confirms or corrects by clicking; typing is the exception.
6. **CVs.** Upload one or more and tag them ("backend, English", "data, German"). The AI adds
   metadata and picks the right CV for each role, saying why.
7. **Day to day.** New mail is sorted, job facts are extracted, the sender is checked, and each
   role is matched against the profile and the best CV. **Good matches get a reply drafted into
   the mailbox's Drafts folder**; the user reviews it and sends.
8. **Decision inbox.** Only when an answer is needed to reply to a good match ("would you relocate
   to Dublin?", "minimum pay in CHF?"). Similar questions are grouped, one answer can cover all
   similar mail, and the reply waits until the user decides. The answer goes into the profile, so
   it is never asked twice.
9. **Assistant.** A small chat for telling JobFilly what changed: "lately I don't want jobs in
   Asian time zones, ignore them". It proposes the change as a clear before/after with how many
   current roles it affects; nothing changes until the user presses Apply, and every change can be
   undone.
10. **Re-run setup** at any time, for example after moving country. An optional hint ("I'm now
    looking in Germany") steers the scan. The result is a new profile next to the existing ones.

## Workspaces and sharing

- A **workspace** holds mailboxes, CVs, profiles, the job inbox, drafts, decisions and AI
  settings. Every user gets a personal one at sign-up.
- Admins (starting with the owner) invite people by email and give each a role: **viewer** (sees), **editor** (works
  the job search: profile, decisions, drafts, assistant changes) or **admin** (also members,
  mailboxes, AI settings). Admins also choose what a member sees: everything, or the job pipeline
  without mail content.
- One person can belong to several workspaces and switch between them.

## Profiles and rules

- A **profile** is a set of preferences and rules, stored as JSON. The intake creates it;
  decisions, CVs and the assistant extend it; every entry can be edited by hand and records where
  it came from.
- **Rules** are the automation's instructions in plain words with a precise meaning underneath:
  "hide roles outside UTC−1 to UTC+3", "never draft replies to job alerts", "always ask before
  replying to agencies". They are evaluated the same way every time, so every outcome can be
  explained.
- **Several profiles can coexist** ("Remote EU", "Germany permanent"), each switched on or off.
- **Fully dynamic across markets:** contract types, pay formats and work permits are whatever the
  profile has learned from the user's mail and answers — never built-in market vocabularies.

## Universal job facts

Every role found in mail is described by the same small set of facts, using international
standards instead of market rules: title; company (and the client behind an agency, if named);
countries (ISO 3166) and cities; work mode (remote, hybrid, onsite) and remote scope; time zones
(UTC offsets) when stated; pay as a range with an ISO 4217 currency and a period (hour, day, week,
month, year) plus the original wording; contract, seniority and work-permit wording as written;
skills and languages as written; the apply link. Anything else the mail says is kept as extra
facts. Profiles stay fully dynamic; these facts are what they are matched against, which keeps
sorting and explanations possible in every country.

## Sender check

Every sender of job mail gets an estimate with reasons: asks for payment or ID documents before an
offer, a free-mail address posing as a company recruiter, a brand-new or mail-less domain,
chat-only hiring, a sender that doesn't match the company. High risk means no automatic draft and
a visible warning.

## What stays non-negotiable

- **Nothing is sent without a button press for that message.** Automation only writes drafts.
- **Unknown means ask, never guess.** That's the decision inbox.
- **Nothing changes without the user's say.** The assistant and the AI propose; the user applies.
- **Explainable match.** Every score and decision points to the profile entries and rules it
  used. Skills are never invented, and the score is never called an "ATS score".
- **No auto-apply.**
- **The mailbox is the source of truth for mail.** Profiles, CVs, rules, decisions and drafts in
  progress survive any re-sync.
- **You choose where your mail goes**, and the app always shows which AI provider reads it.
- **Your data is yours:** export everything, delete everything.

## Platform

- **A self-hosted server:** Docker today, Kubernetes for the end state.
- **PostgreSQL holds everything** — data, sessions, the job queue and live updates — so a
  deployment is just the app plus Postgres.
- **Login is a cookie-based session stored in Postgres.** No sticky sessions: any replica serves
  any request, and many people can use the same server at once.
- **Kubernetes-ready from MVP 1:** stateless replicas, settings from environment variables,
  health and readiness checks, JSON logs on stdout, graceful shutdown, migrations safe when
  replicas start together, background work that carries on when a replica dies.
- **Release:** a Helm chart, built after MVP 3 passes its end-to-end validation.

## Pricing

Everything is free, with an optional one-time supporter license. No subscription. Revisit if a
hosted service for other people becomes the plan.

## Metrics

- **North star:** job emails handled per week without the user opening them — sorted correctly,
  and good matches with a reviewed draft waiting.
- **Onboarding:** time from connecting mail to a confirmed profile. Target under 10 minutes, with
  very little typing.
- **Guardrails:** corrections the user has to make, the size of the decision inbox (should shrink
  week over week), AI cost per workspace per week.

## Roadmap

1. [MVP 1 — It understands my job search](mvp/MVP-1.md)
2. [MVP 2 — It works my inbox every day](mvp/MVP-2.md)
3. [MVP 3 — It grows with me](mvp/MVP-3.md)
4. Helm chart, once MVP 3 is signed off.

## Open questions

- How "confident enough" and the default scan budget should be tuned with real mailboxes (MVP 1
  sets defaults).
- When several profiles are active, which signals decide where a message belongs (MVP 3 sets the
  first version).
- Google requires a security review before a server open to the public may use OAuth for Gmail;
  until then Gmail connects with an app password.
- Pricing, if a hosted service for others becomes the plan.
