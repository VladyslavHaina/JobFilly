import { z } from "zod";
import { IsoDateTimeSchema, TextSchema } from "./common";

// Reply drafts (F6). A draft row holds only the reply text; the quote of the original is added
// when the MIME message is built, so the database never stores a mail body. At most one live
// draft (any status but discarded) exists per role.

/**
 * - saving: the short claim while the draft is written to the mailbox (only the claim holder
 *   writes it);
 * - in_mailbox: saved to the Drafts folder; edited: an editor saved changes, replaced there too;
 * - discarded: deleted from the mailbox; never recreated automatically (TBD-193);
 * - failed: see failureKind;
 * - sent (MVP 3, F4.4): sent from the app; its Drafts copy is gone. It keeps the role's one live
 *   draft, so no new automatic draft is made for a role already answered.
 */
export const DraftStatusSchema = z.enum([
  "saving",
  "in_mailbox",
  "edited",
  "discarded",
  "failed",
  "sent",
]);
export type DraftStatus = z.infer<typeof DraftStatusSchema>;

/**
 * Why a draft failed: `mailbox` when the mail server couldn't be reached or refused the append;
 * `ai` when the draft.v1 call gave no draft (the provider failed or timed out, its answer didn't
 * fit even after the client's retry, or no AI is set up). Both are retried by the sweep, up to 5
 * attempts in all, each retry checked against the reply policy first. `content` is never retried
 * automatically: draft.v1 wrote a placeholder twice (F6.2), or the reply policy held the retry
 * (the message left the reply window, the sender is high risk, a rule holds it; the reason says
 * which, "Not tried again: …"). Draft a reply takes any failed row back (F6.5).
 */
export const DraftFailureKindSchema = z.enum(["mailbox", "ai", "content"]);
export type DraftFailureKind = z.infer<typeof DraftFailureKindSchema>;

export const DraftSchema = z.object({
  id: z.uuid(),
  messageId: z.string(),
  position: z.number().int().nonnegative(),
  status: DraftStatusSchema,
  failureKind: DraftFailureKindSchema.nullable(),
  /** Plain words for the Drafts page (F6.7), e.g. "Couldn't reach the mail server". */
  failureReason: z.string().nullable(),
  /** Null while the first version is being written. */
  subject: z.string().nullable(),
  body: z.string().nullable(),
  language: z.string().nullable(),
  /** The CV attached, if any; null once that CV is deleted (the mailbox draft stays, F2.5). */
  cvId: z.uuid().nullable(),
  /**
   * Whether the mailbox copy carries a CV attachment (F6.3). Stays true when that CV is deleted
   * (cvId goes null, F2.5): the copy keeps its attachment, and an edit keeps it too. The server
   * always sends it; it is optional so a page reading a draft from a replica that doesn't send it
   * yet (a rolling update) still reads it, as without an attachment.
   */
  cvAttached: z.boolean().optional(),
  /** True for a draft the app made on its own, false for Draft a reply. */
  auto: z.boolean(),
  updatedAt: IsoDateTimeSchema,
});
export type Draft = z.infer<typeof DraftSchema>;

export const DraftListSchema = z.object({ items: z.array(DraftSchema) });
export type DraftList = z.infer<typeof DraftListSchema>;

/** GET /drafts: every draft of the workspace, or one message's (the draft panel). */
export const DraftListQuerySchema = z.object({ messageId: z.string().min(1).optional() });
export type DraftListQuery = z.infer<typeof DraftListQuerySchema>;

/** PATCH /drafts/:draftId: the edited reply; saving replaces the mailbox draft (F6.4). */
export const DraftUpdateSchema = z.object({
  subject: TextSchema.max(998),
  body: TextSchema.max(100_000),
});
export type DraftUpdate = z.infer<typeof DraftUpdateSchema>;

/** POST /drafts: Draft a reply for one role, whatever its score (F6.5). */
export const DraftCreateSchema = z.object({
  messageId: z.string().min(1),
  position: z.number().int().nonnegative(),
});
export type DraftCreate = z.infer<typeof DraftCreateSchema>;
