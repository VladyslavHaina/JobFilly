import { z } from "zod";
import { IsoDateTimeSchema, TextSchema } from "./common";
import {
  ProfileEntrySchema,
  ProfileKeySchema,
  ProfileSourceSchema,
  ProfileValueSchema,
} from "./profile";
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
 * rule that didn't exist (yet, or any more) is null. Undo restores `before` exactly: an entry as
 * `entry` holds it (with its confidence, evidence and source), a rule with its id, source and
 * creation. `entry` is absent where `value` is null, and in rows written before it was kept.
 */
export const ProfileSnapshotSchema = z.object({
  entries: z.array(
    z.object({
      key: ProfileKeySchema,
      value: ProfileValueSchema.nullable(),
      entry: ProfileEntrySchema.optional(),
    }),
  ),
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

// --- MVP 3: the assistant answers questions (F8) ---------------------------------------------

/**
 * The read-only lookups the assistant may ask for when the user asks a question (F8.2): what
 * waits on the user (open decisions, drafts not yet reviewed), roles found by words in their
 * title, company or places, one role in full (its facts, match, rules and why it has a draft or
 * not), the pipeline (by stage, over the last days), one message's text (never for a member who
 * sees the pipeline only, F8.3), and the profile. Each runs with the asking member's access.
 */
export const ASSISTANT_TOOLS = [
  "waiting",
  "find_roles",
  "role",
  "pipeline",
  "message_text",
  "profile",
] as const;
export const AssistantToolSchema = z.enum(ASSISTANT_TOOLS);
export type AssistantTool = z.infer<typeof AssistantToolSchema>;

/**
 * One lookup as assistant.v1 asks for it: one flat shape for every tool, the fields a tool
 * doesn't use null (find_roles: words; role: messageId and position; message_text: messageId;
 * pipeline: stage and days).
 */
export const AssistantLookupSchema = z.object({
  tool: AssistantToolSchema,
  words: z.string().nullable(),
  messageId: z.string().nullable(),
  position: z.number().int().nonnegative().nullable(),
  stage: z.string().nullable(),
  days: z.number().int().positive().nullable(),
});
export type AssistantLookup = z.infer<typeof AssistantLookupSchema>;

/**
 * What an answer may point at (F8.1): a role ("<Message-ID>#<position>"), a message (its
 * Message-ID), a decision (its group key) or a role's draft ("<Message-ID>#<position>"). Only
 * refs the lookups returned are kept, so an answer can't link to anything made up (F8.2).
 */
export const AnswerSourceSchema = z.object({
  kind: z.enum(["role", "message", "decision", "draft"]),
  ref: z.string().min(1),
});
export type AnswerSource = z.infer<typeof AnswerSourceSchema>;

/** One lookup's result as answer.v1 sees it: plain lines (mail words untrusted) and its refs. */
export const AnswerToolResultSchema = z.object({
  lookup: AssistantLookupSchema,
  lines: z.array(z.string()),
  sources: z.array(AnswerSourceSchema),
});
export type AnswerToolResult = z.infer<typeof AnswerToolResultSchema>;

/**
 * answer.v1's input: the question (untrusted, any language), its turn and the earlier turns, and
 * the lookups' results. Quoted mail is untrusted data: its instructions never become actions
 * (F8.4).
 */
export const AnswerTaskInputSchema = z.object({
  turn: z.number().int().min(1),
  text: z.string(),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() })),
  results: z.array(AnswerToolResultSchema),
});
export type AnswerTaskInput = z.infer<typeof AnswerTaskInputSchema>;

/** answer.v1: the answer in the user's language, and the refs it used. */
export const AnswerOutputSchema = z.object({
  text: TextSchema,
  sources: z.array(AnswerSourceSchema),
});
export type AnswerOutput = z.infer<typeof AnswerOutputSchema>;

/** A link under an answer, as the API gives it to the page: what it is and where it points. */
export const AssistantLinkSchema = z.object({
  kind: AnswerSourceSchema.shape.kind,
  label: z.string(),
  messageId: z.string().nullable(),
  position: z.number().int().nonnegative().nullable(),
});
export type AssistantLink = z.infer<typeof AssistantLinkSchema>;

export const AssistantMessageSchema = z.object({
  id: z.uuid(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  clarify: AssistantClarifySchema.nullable(),
  proposalId: z.uuid().nullable(),
  at: IsoDateTimeSchema,
  /** MVP 3 (F8.1): the roles, messages, decisions and drafts an answer used; absent before. */
  links: z.array(AssistantLinkSchema).optional(),
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
