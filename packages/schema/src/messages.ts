import { z } from "zod";
import { IsoDateTimeSchema } from "./common";
import { JobFactsSchema } from "./facts";
import { AddressSchema } from "./mailbox";

/** The nine categories of F5, in the order the UI lists them. */
export const CATEGORIES = [
  "recruiter_outreach",
  "job_alert",
  "application_update",
  "interview",
  "assessment",
  "offer",
  "rejection",
  "other_job",
  "not_job",
] as const;
export const CategorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof CategorySchema>;

/** The categories that count as job mail: every one except not_job. */
export const JOB_CATEGORIES = CATEGORIES.filter(
  (c): c is Exclude<Category, "not_job"> => c !== "not_job",
);

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

/** One row of the job inbox. `id` is the RFC Message-ID (URL-encoded in paths). */
export const MessageListItemSchema = z.object({
  id: z.string(),
  from: AddressSchema,
  subject: z.string(),
  date: IsoDateTimeSchema,
  category: CategorySchema.nullable(),
  categorySource: CategorySourceSchema.nullable(),
  analysisStatus: AnalysisStatusSchema,
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

export const MessageDetailSchema = MessageListItemSchema.extend({
  roles: z.array(JobFactsSchema),
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
