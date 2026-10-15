# JobFilly — North Star

> Agreed with the owner on 2026-10-14. This is what we are building and why; every other
> document and every design decision answers to it.

## Headline

**Connect your mail. JobFilly learns your job search and handles the busywork.**

## Who it is for

People looking for **professional roles, in any country**, in any field, not only tech.

## How it works

1. **Connect mail** over IMAP: an app password where the provider offers one, OAuth over IMAP
   where a provider requires it (Outlook.com, for example).
2. **Pick an AI provider.** A guided choice kept as simple as possible: no price tables, no
   privacy lecture. Every provider is an equal option, local or cloud.
3. **First scan:** the last 90 days, smart, and it stops once it's confident.
   - A free pass without AI first: sender, headers, known job boards, applicant-tracking
     senders, people the user has already replied to.
   - Then the AI reads likely job mail in small batches, newest first, including the sent
     folder.
   - It stops when new batches no longer change the profile, or at a budget cap. It does
     **not** try to read everything: a 200-emails-a-day inbox would be too expensive.
4. **Intake form.** Pre-filled from the scan, showing how sure the AI is about each answer. The
   user confirms or corrects. Example questions: where are you looking for work, remote or
   onsite, which kinds of mail should get a reply.
5. **Day to day.** Mail is sorted, job details are pulled out, and roles are matched against the
   profile. **Good matches get a reply drafted automatically**; the user reviews it and presses
   send.
6. **Decision inbox.** When a message raises something the profile can't answer yet (for example
   "would you relocate to Dublin?", "rate expectation in CHF?", "is a 12-month fixed-term
   contract OK?"), that message goes to the decision inbox and **is not answered until the user
   decides**. The answer is written into the profile, so the same question is not asked twice.
   The intake is only the beginning; the profile matures over time.
7. **Re-run setup** by hand at any time, for example after moving country. An optional hint ("I'm
   now looking in Germany") steers the scan. The result is a **new profile next to the existing
   ones**, not a replacement.

## Profiles

- A **profile** is a set of preferences, options and rules, stored as a JSON payload. The intake
  generates it; answers from the decision inbox keep extending it.
- **Several profiles can coexist** (e.g. "US contract", "Germany permanent"). Each can be
  switched on or off, and everything in it can be edited by hand.
- **Fully dynamic across markets.** There are no per-market packs or built-in vocabularies:
  contract types, pay formats and work permits are whatever the profile has learned from the
  user's mail and answers.

## What stays non-negotiable

- **Nothing is sent without a button press for that message.** Automation only ever writes
  drafts.
- **Unknown means ask, never guess.** That's the decision inbox.
- **Explainable match.** Every score and decision points to the profile entries it used. Skills
  are never invented, and the score is never called an "ATS score".
- **No auto-apply.**
- **The mailbox is the source of truth for mail.** Profiles, decisions and other local choices
  must survive any re-sync.
- **You choose where your mail goes.** The app always shows which AI provider handles it.

## Platforms

A desktop app (macOS and Windows) and a self-hosted Docker web app, from one codebase.

## Pricing

Everything is free, with an optional one-time supporter license. No subscription.

## North-star metric (proposed)

Time from connecting mail to a profile the user confirms as correct. Target: under 10 minutes,
with very little typing. Secondary signal: the decision inbox gets smaller week over week as the
profile matures.

## Open questions

- Which few fields stay fixed so mail can still be sorted and compared across profiles (e.g. pay
  amount + currency + period)?
- When several profiles are active, how is a message assigned to one, and how is that choice
  shown?
- What counts as "confident enough" for each intake question, and what is the scan's default
  budget cap?
- How login works for the Docker web app.
