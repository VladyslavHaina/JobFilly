import { z } from "zod";
import { IsoDateTimeSchema, TextSchema } from "./common";
import { ProfileKeySchema, ProfileSourceSchema, ProfileValueSchema } from "./profile";
import { RuleDraftSchema, RuleSchema } from "./rules";

// The assistant (F8) and the profile changes it proposes. Every change to the profile's entries
// and rules — by hand, by a decision answer, by an applied proposal, by Undo — is a list of
// Changes applied by one service, recorded in the profile history with its before and after.

/**
 * One change to the profile, a closed union. Its semantics are pinned in
 * packages/core/src/profile/changes.ts (applyChanges):
 * - add on a list key (LIST_PROFILE_KEYS) appends the given items, keeping those already there
 *   (an equal item is a no-op); on any other key, or a missing one, it sets the entry;
 * - update replaces the whole value;
 * - remove with a value removes those items from the list; remove with null removes the entry;
 * - a rule is added, replaced (update) or removed by id.
 */
export const ChangeSchema = z.union([
  z.object({ op: z.literal("add"), target: z.literal("rule"), rule: RuleDraftSchema }),
  z.object({
    op: z.literal("update"),
    target: z.literal("rule"),
    ruleId: z.uuid(),
    rule: RuleDraftSchema,
  }),
  z.object({ op: z.literal("remove"), target: z.literal("rule"), ruleId: z.uuid() }),
  z.object({
    op: z.literal("add"),
    target: z.literal("entry"),
    key: ProfileKeySchema,
    value: ProfileValueSchema,
  }),
  z.object({
    op: z.literal("update"),
    target: z.literal("entry"),
    key: ProfileKeySchema,
    value: ProfileValueSchema,
  }),
  z.object({
    op: z.literal("remove"),
    target: z.literal("entry"),
    key: ProfileKeySchema,
    value: ProfileValueSchema.nullable(),
  }),
]);
export type Change = z.infer<typeof ChangeSchema>;

/**
 * The entries and rules a list of changes touched, as they were before or after it. An entry or a
 * rule that didn't exist (yet, or any more) is null. Undo restores `before`.
 */
export const ProfileSnapshotSchema = z.object({
  entries: z.array(z.object({ key: ProfileKeySchema, value: ProfileValueSchema.nullable() })),
  rules: z.array(z.object({ id: z.uuid(), rule: RuleSchema.nullable() })),
});
export type ProfileSnapshot = z.infer<typeof ProfileSnapshotSchema>;

/**
 * A proposal's impact on the current roles (F8.2, F8.5): how many get hidden or shown, how many
 * scores move, how many drafts won't be created, and how many drafts already in the mailbox stay
 * there untouched.
 */
export const ImpactSchema = z.object({
  hides: z.number().int().nonnegative(),
  shows: z.number().int().nonnegative(),
  scoreMoves: z.number().int().nonnegative(),
  draftsNotCreated: z.number().int().nonnegative(),
  draftsInMailbox: z.number().int().nonnegative(),
});
export type Impact = z.infer<typeof ImpactSchema>;

/**
 * One entry or rule a list of changes touches, in plain words before and after it (F8.2, F8.4):
 * "Remote work" from "EU (UTC−1 to UTC+3)" to nothing, or a rule from nothing to "Hide roles
 * whose hours are within UTC+5 to UTC+14". Null: it isn't there (yet, or any more). Worded by
 * packages/core from the before and after snapshots.
 */
export const ChangeLineSchema = z.object({
  target: z.enum(["entry", "rule"]),
  /** The entry's label, or "Rule". */
  label: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
});
export type ChangeLine = z.infer<typeof ChangeLineSchema>;

export const ProposalStatusSchema = z.enum(["open", "applied", "discarded"]);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

/** A proposal card: the change in plain words, before and after, and the impact. */
export const ProposalSchema = z.object({
  id: z.uuid(),
  summary: z.string(),
  changes: z.array(ChangeSchema),
  before: ProfileSnapshotSchema,
  after: ProfileSnapshotSchema,
  /** `before` and `after` in plain words, one line per entry or rule. */
  lines: z.array(ChangeLineSchema),
  impact: ImpactSchema,
  status: ProposalStatusSchema,
  createdAt: IsoDateTimeSchema,
});
export type Proposal = z.infer<typeof ProposalSchema>;

/** A clarifying question with answers to pick (F8.6). */
export const AssistantClarifySchema = z.object({
  question: z.string(),
  choices: z.array(z.string()),
});
export type AssistantClarify = z.infer<typeof AssistantClarifySchema>;

export const AssistantMessageSchema = z.object({
  id: z.uuid(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  clarify: AssistantClarifySchema.nullable(),
  proposalId: z.uuid().nullable(),
  at: IsoDateTimeSchema,
});
export type AssistantMessage = z.infer<typeof AssistantMessageSchema>;

export const AssistantThreadSchema = z.object({
  id: z.uuid(),
  messages: z.array(AssistantMessageSchema),
  proposals: z.array(ProposalSchema),
});
export type AssistantThread = z.infer<typeof AssistantThreadSchema>;

/** GET /assistant: the user's thread in this workspace, or null before the first message. */
export const AssistantStateSchema = z.object({ thread: AssistantThreadSchema.nullable() });
export type AssistantState = z.infer<typeof AssistantStateSchema>;

/** POST /assistant: a message to the assistant, in any language (F8.1). */
export const AssistantSendSchema = z.object({
  threadId: z.uuid().nullable(),
  text: TextSchema.trim().min(1).max(4000),
});
export type AssistantSend = z.infer<typeof AssistantSendSchema>;

/** The answer to one message: the reply, and a clarifying question or a proposal, or neither. */
export const AssistantTurnSchema = z.object({
  threadId: z.uuid(),
  reply: z.string(),
  clarify: AssistantClarifySchema.nullable(),
  proposal: ProposalSchema.nullable(),
});
export type AssistantTurn = z.infer<typeof AssistantTurnSchema>;

/** PATCH /assistant/proposals/:id: edit the changes before Apply (F8.2). */
export const ProposalEditSchema = z.object({ changes: z.array(ChangeSchema).min(1) });
export type ProposalEdit = z.infer<typeof ProposalEditSchema>;

/**
 * One applied change in the profile history (F8.4): who, when, the source and the request behind
 * it, with before and after. `undoneAt` is set once Undo restored `before`.
 */
export const ProfileHistoryEntrySchema = z.object({
  id: z.uuid(),
  at: IsoDateTimeSchema,
  /** The user who made the change; null once that account is gone. */
  by: z.uuid().nullable(),
  source: ProfileSourceSchema,
  /** The words behind it: the assistant request or the decision's question; null by hand. */
  request: z.string().nullable(),
  changes: z.array(ChangeSchema),
  before: ProfileSnapshotSchema,
  after: ProfileSnapshotSchema,
  undoneAt: IsoDateTimeSchema.nullable(),
});
export type ProfileHistoryEntry = z.infer<typeof ProfileHistoryEntrySchema>;

/** A history entry as the API lists it: with the name of who made it and its plain words. */
export const ProfileHistoryItemSchema = ProfileHistoryEntrySchema.extend({
  /** The member's name; null once that account is gone. */
  byName: z.string().nullable(),
  lines: z.array(ChangeLineSchema),
});
export type ProfileHistoryItem = z.infer<typeof ProfileHistoryItemSchema>;

/** GET /profiles/:pid/history, newest first. Undo is a POST with no body. */
export const ProfileHistoryListSchema = z.object({ items: z.array(ProfileHistoryItemSchema) });
export type ProfileHistoryList = z.infer<typeof ProfileHistoryListSchema>;
