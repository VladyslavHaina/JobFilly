import { DRAFT_CREATE_JOB, DraftCreatePayloadSchema } from "@jobfilly/schema";
import { defineJob, type JobRegistry } from "../jobs/queue";
import { createDraft } from "./write";

// The draft.create job (F6): writes one role's draft and saves it to the mailbox, dedupe key
// draft:<workspaceId>:<messageId>:<position> (jobDedupeKey.draft). It works on the role's claim
// (packages/db draft-claims), and a row is left in saving only once its copy is in the mailbox,
// for the retry to record (./write.ts):
//
// - MailUnavailableError marks the draft failed with kind mailbox ("Couldn't reach the mail
//   server"), which the sweep retries.
// - A draft.v1 call that gives no draft (a TaskResult that isn't ok: the provider failed or timed
//   out, the answer didn't fit even after the client's retry; or no AI is set up) marks it failed
//   with kind ai and a plain reason ("Couldn't reach the AI provider", "No AI model is set up"),
//   which the sweep retries under the same 5-attempt cap. A draft.v1 answer with questions
//   releases the claim instead (releaseDraftClaim), with the needs.
// - A placeholder twice (F6.2) is kind content, never retried automatically.
//
// Whoever enqueues it holds the claim: the reply stage (origin auto or decision), Draft a reply
// (on_demand) and the sweep (retry). Registered here, spread into jobs/registry.ts.
export const draftJobs: JobRegistry = {
  [DRAFT_CREATE_JOB]: defineJob(DraftCreatePayloadSchema, (ctx) =>
    createDraft(ctx.deps, ctx.payload, { signal: ctx.signal }),
  ),
};
