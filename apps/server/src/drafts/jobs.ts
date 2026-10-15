import type { JobRegistry } from "../jobs/queue";

// The draft.create job (F6): writes one role's draft and saves it to the mailbox, dedupe key
// draft:<workspaceId>:<messageId>:<position> (jobDedupeKey.draft). It works on the role's claim
// (packages/db draft-claims): MailUnavailableError marks the draft failed with kind mailbox
// ("Couldn't reach the mail server"), which the sweep retries; a row is never left in saving.
// Registered here, spread into jobs/registry.ts; the replies slice adds it.
export const draftJobs: JobRegistry = {};
