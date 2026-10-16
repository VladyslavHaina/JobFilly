import { z } from "zod";
import { IsoDateTimeSchema, TextSchema } from "./common";
import {
  CoreProfileKeySchema,
  PROFILE_ITEM_SCHEMAS,
  type ProfileItem,
  ProfileItemSchema,
  type ProfileKey,
  ProfileKeySchema,
} from "./profile";

// The decision inbox (F7). A need is a question a reply can't go without; the stage that knows
// why something is unknown states it (a match verdict, a rule effect, a draft's questions). Needs
// with the same group key become one decision listing every message waiting on it (F7.3), and a
// group key is "already answered" once the profile holds an answering item (F7.6, answeredFor in
// packages/core/src/profile/changes.ts).

/**
 * One answer to click: its words, and the profile item it adds when chosen. Words where the key's
 * items are objects (a place, a minimum pay) turn the question down instead: "No" to "Hybrid in
 * Dublin?" answers the messages waiting on it and writes nothing (turnsDown).
 */
export const DecisionChoiceSchema = z.object({ label: TextSchema, value: ProfileItemSchema });
export type DecisionChoice = z.infer<typeof DecisionChoiceSchema>;

/**
 * Whether an answer of `profileKey` turns its question down rather than adding an item: words
 * where the key's items are objects, which words alone never are. Such an answer is for the
 * messages waiting on the decision only, and nothing is written to the profile, whatever
 * "Use this answer for similar mail" says (packages/core decisions/answers.ts answerOf).
 */
export function turnsDown(profileKey: ProfileKey | null, value: ProfileItem): boolean {
  if (profileKey === null || typeof value !== "string") return false;
  const core = CoreProfileKeySchema.safeParse(profileKey);
  return core.success && PROFILE_ITEM_SCHEMAS[core.data] instanceof z.ZodObject;
}

/**
 * What a reply needs answered. `groupKey` groups similar questions ("min_pay:CHF:year");
 * `profileKey` is the entry an answer writes, null for an ask_first rule (answered per message).
 */
export const NeedSpecSchema = z.object({
  groupKey: z.string().min(1),
  profileKey: ProfileKeySchema.nullable(),
  question: TextSchema,
  choices: z.array(DecisionChoiceSchema),
});
export type NeedSpec = z.infer<typeof NeedSpecSchema>;

/**
 * A need with the role waiting on it and what raised it: a match verdict, a rule effect, or a
 * draft's questions. `draft` is an automatic draft's (one the policy let through), and
 * `draft_on_demand` one Draft a reply asked for: when the policy holds the role, only those keep
 * waiting and get their draft once answered (F6.1, F6.5, F7.1).
 */
export const DecisionNeedSchema = NeedSpecSchema.extend({
  source: z.enum(["draft", "draft_on_demand", "match", "rule"]),
  messageId: z.string(),
  position: z.number().int().nonnegative(),
});
export type DecisionNeed = z.infer<typeof DecisionNeedSchema>;

// A group key is the profile key (or another namespace, e.g. "rule") and its parts, joined by
// ":"; "%" and ":" inside a part are percent-encoded, so parseGroupKey is its exact inverse.
const encodePart = (part: string) => part.replace(/%/g, "%25").replace(/:/g, "%3A");
const decodePart = (part: string) => part.replace(/%3A/gi, ":").replace(/%25/g, "%");

/** The group key of a need: groupKeyFor("min_pay", ["CHF", "year"]) is "min_pay:CHF:year". */
export function groupKeyFor(profileKey: string, parts: readonly string[] = []): string {
  return [encodePart(profileKey), ...parts.map(encodePart)].join(":");
}

/** The inverse of groupKeyFor. */
export function parseGroupKey(groupKey: string): { profileKey: string; parts: string[] } {
  const [head = "", ...rest] = groupKey.split(":");
  return { profileKey: decodePart(head), parts: rest.map(decodePart) };
}

export const DecisionStatusSchema = z.enum(["open", "answered"]);
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

/** A decision as the inbox shows it (F7.2): the question, its answers, the messages waiting. */
export const DecisionSchema = z.object({
  id: z.uuid(),
  question: TextSchema,
  profileKey: ProfileKeySchema.nullable(),
  groupKey: z.string(),
  choices: z.array(DecisionChoiceSchema),
  waiting: z.array(
    z.object({
      messageId: z.string(),
      position: z.number().int().nonnegative(),
      subject: z.string(),
    }),
  ),
  status: DecisionStatusSchema,
  createdAt: IsoDateTimeSchema,
});
export type Decision = z.infer<typeof DecisionSchema>;

/** GET /decisions. */
export const DecisionListSchema = z.object({ items: z.array(DecisionSchema) });
export type DecisionList = z.infer<typeof DecisionListSchema>;

/** GET /decisions/count: the open decisions, for the count in the navigation. */
export const DecisionCountSchema = z.object({ open: z.number().int().nonnegative() });
export type DecisionCount = z.infer<typeof DecisionCountSchema>;

/**
 * POST /decisions/:id/answer. For a list-valued key `value` is one item of the list (a MinPay
 * for min_pay), never the whole list: it is added with a Change `add` (source: decision), so the
 * items already there stay (TBD-195). A free-text answer is words, refused when they say no or
 * contradict the group key's parts. `useForSimilar` answers every waiting message and later ones
 * with the same group key (F7.2, F7.6); a choice that turns the question down (turnsDown) is for
 * the waiting messages only, whatever it says.
 */
export const DecisionAnswerSchema = z.object({
  value: ProfileItemSchema,
  useForSimilar: z.boolean(),
});
export type DecisionAnswer = z.infer<typeof DecisionAnswerSchema>;

/** POST /decisions/:id/dismiss: "Don't ask for this message" (F7.5). Not now has no body. */
export const DecisionDismissSchema = z.object({
  messageId: z.string().min(1),
  position: z.number().int().nonnegative(),
});
export type DecisionDismiss = z.infer<typeof DecisionDismissSchema>;
