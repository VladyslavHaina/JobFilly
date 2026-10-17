import { z } from "zod";
import { CategorySchema } from "./category";
import { IsoDateTimeSchema } from "./common";
import { CvChoiceSchema } from "./cv";
import { DraftStatusSchema } from "./drafts";
import { JobFactsSchema } from "./facts";
import { AddressSchema, EnvelopeSchema } from "./mailbox";
import { RoleEvaluationSchema } from "./match";
import { RoleProfileSchema } from "./profile";
import { SenderCheckSchema, SenderVerdictSchema } from "./sender";

export { CATEGORIES, type Category, CategorySchema, JOB_CATEGORIES } from "./category";

/** Who set a message's category: the scan, or a person correcting it (kept for good, F5.4). */
export const CategorySourceSchema = z.enum(["scan", "you"]);
export type CategorySource = z.infer<typeof CategorySourceSchema>;

/** pending until the model has answered; failed is shown as "Couldn't analyze" (F3.4). */
export const AnalysisStatusSchema = z.enum(["pending", "done", "failed"]);
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;

/**
 * Stage one's verdict from the headers alone (F4.2): obvious non-job mail, a job-platform alert,
 * one of the user's own replies, or a likely job message for the model.
 */
export const StageOneVerdictSchema = z.enum(["not_job", "likely_job", "own_reply", "job_alert"]);
export type StageOneVerdict = z.infer<typeof StageOneVerdictSchema>;

/** A stored message as packages/db reads it back: the envelope and the state of its analysis. */
export const StoredMessageSchema = z.object({
  envelope: EnvelopeSchema,
  stageOne: StageOneVerdictSchema,
  stageOneReason: z.string().nullable(),
  category: CategorySchema.nullable(),
  categorySource: CategorySourceSchema.nullable(),
  analysisStatus: AnalysisStatusSchema,
  analyzedByScanId: z.uuid().nullable(),
});
export type StoredMessage = z.infer<typeof StoredMessageSchema>;

/** The best fit score of a message's roles; stale while a change hasn't been re-scored (F4.6). */
const ScoredFitSchema = z.object({
  score: z.number().int().min(0).max(100),
  capped: z.boolean(),
  stale: z.boolean(),
});
export type ScoredFit = z.infer<typeof ScoredFitSchema>;

/**
 * A job message whose roles have no fit score: `pending` while one of them is still to be scored
 * (or re-scored), `unscored` when they were all evaluated and none could be scored.
 */
const NoFitScoreSchema = z.object({
  score: z.null(),
  why: z.enum(["pending", "unscored"]),
});
/** Why a job message with roles, or one role, has no fit score. */
export type NoFitWhy = z.infer<typeof NoFitScoreSchema>["why"];

/**
 * Where a row's fit score goes: its best score, why a job message with roles has none, or null
 * when there is nothing to score (no roles, or not job mail).
 */
export const ListFitSchema = z.union([ScoredFitSchema, NoFitScoreSchema]).nullable();
export type ListFit = z.infer<typeof ListFitSchema>;

/**
 * One row of the job inbox. `id` is the RFC Message-ID (URL-encoded in paths). From MVP 2 a row
 * also carries: its fit (ListFitSchema), and when they exist the sender verdict (F5), why it is
 * hidden (only under the Hidden filter, F3.4) and its live draft's status.
 */
export const MessageListItemSchema = z.object({
  id: z.string(),
  from: AddressSchema,
  subject: z.string(),
  date: IsoDateTimeSchema,
  category: CategorySchema.nullable(),
  categorySource: CategorySourceSchema.nullable(),
  analysisStatus: AnalysisStatusSchema,
  fit: ListFitSchema,
  sender: z.object({ verdict: SenderVerdictSchema, complete: z.boolean() }).nullable(),
  hidden: z.object({ reason: z.string() }).nullable(),
  draft: z.object({ status: DraftStatusSchema }).nullable(),
});
export type MessageListItem = z.infer<typeof MessageListItemSchema>;

/** The inbox lists pages of 100 (F5.5). */
export const MESSAGE_PAGE_SIZE = 100;

export const MessageListQuerySchema = z.object({
  category: CategorySchema.optional(),
  /** Search by sender or subject. */
  q: z.string().trim().max(200).optional(),
  /** Include non-job mail (the Show toggle of F5.1). */
  showNonJob: z.enum(["true", "false"]).optional(),
  /**
   * The Hidden filter (F3.4): "true" lists only messages whose roles are all hidden by a rule,
   * each with its reason. By default they are left out.
   */
  hidden: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
});
export type MessageListQuery = z.infer<typeof MessageListQuerySchema>;

export const MessageListSchema = z.object({
  items: z.array(MessageListItemSchema),
  /** How many non-job messages are hidden behind the Show toggle. */
  nonJobCount: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  nextPage: z.number().int().min(2).nullable(),
});
export type MessageList = z.infer<typeof MessageListSchema>;

/**
 * A role of the message detail: its facts, its evaluation (null until evaluated) and the CV the
 * app would use for it (null until chosen).
 */
export const MessageRoleSchema = JobFactsSchema.extend({
  evaluation: RoleEvaluationSchema.nullable(),
  cvChoice: CvChoiceSchema.nullable(),
  /**
   * MVP 3 (F1.3): the profile the role belongs to and why; null until it is evaluated. Absent from
   * a replica of the previous release.
   */
  profile: RoleProfileSchema.nullable().optional(),
});
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const MessageDetailSchema = MessageListItemSchema.extend({
  roles: z.array(MessageRoleSchema),
  /** The sender check with its reasons (F5.1), null until checked. */
  senderCheck: SenderCheckSchema.nullable(),
  /** True for the user's own replies (Sent), which evidence links may point at. */
  ownReply: z.boolean(),
});
export type MessageDetail = z.infer<typeof MessageDetailSchema>;

/** The plain-text body fetched on demand, or `gone` when the mailbox no longer has it. */
export const MessageBodySchema = z.union([
  z.object({ text: z.string() }),
  z.object({ gone: z.literal(true) }),
]);
export type MessageBody = z.infer<typeof MessageBodySchema>;

export const CategoryCorrectionSchema = z.object({ category: CategorySchema });
export type CategoryCorrection = z.infer<typeof CategoryCorrectionSchema>;
