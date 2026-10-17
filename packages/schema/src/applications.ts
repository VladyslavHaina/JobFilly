import { z } from "zod";
import { IsoDateTimeSchema } from "./common";
import { AddressSchema } from "./mailbox";

// The application pipeline (MVP 3, F5). Every role has a stage derived from its mail (an interview
// invite moves it to interview); an editor can set one by hand, which wins over the derived one.
// The same role sent by two agencies is one item with both senders.

/** The stages in the order a role moves through them; rejected and closed end it. */
export const APPLICATION_STAGES = [
  "new",
  "replied",
  "applied",
  "interview",
  "assessment",
  "offer",
  "rejected",
  "closed",
] as const;
export const ApplicationStageSchema = z.enum(APPLICATION_STAGES);
export type ApplicationStage = z.infer<typeof ApplicationStageSchema>;

/** A role with no reply for this many days is flagged (F5.2). */
export const NO_REPLY_FLAG_DAYS = 21;

/** One role of a message, as the pipeline names it: the Message-ID and the role's position. */
export const RoleRefSchema = z.object({
  messageId: z.string().min(1),
  position: z.number().int().nonnegative(),
});
export type RoleRef = z.infer<typeof RoleRefSchema>;

/**
 * One item of the pipeline: a role, or the same role from several senders (F5.3), with its stage,
 * whether the stage was set by hand, since when it is there, the next step in plain words, and
 * the no-reply flag (F5.2).
 */
export const PipelineItemSchema = z.object({
  /** The first role of the group; stage changes are made on it. */
  role: RoleRefSchema,
  /** Every role the item stands for, the first one included. */
  roles: z.array(RoleRefSchema).min(1),
  title: z.string().nullable(),
  company: z.string().nullable(),
  senders: z.array(AddressSchema),
  stage: ApplicationStageSchema,
  stageSource: z.enum(["derived", "you"]),
  /** When the role reached its stage: the mail that moved it there, or the change by hand. */
  since: IsoDateTimeSchema,
  nextStep: z.string(),
  /** No reply for NO_REPLY_FLAG_DAYS days. */
  noReply: z.boolean(),
});
export type PipelineItem = z.infer<typeof PipelineItemSchema>;

/** GET /pipeline: every item, grouped by stage in APPLICATION_STAGES order. */
export const PipelineSchema = z.object({
  stages: z.array(z.object({ stage: ApplicationStageSchema, items: z.array(PipelineItemSchema) })),
});
export type Pipeline = z.infer<typeof PipelineSchema>;

/** PUT /pipeline/stage: an editor sets a role's stage by hand; null goes back to the derived one. */
export const SetStageInputSchema = z.object({
  role: RoleRefSchema,
  stage: ApplicationStageSchema.nullable(),
});
export type SetStageInput = z.infer<typeof SetStageInputSchema>;
