import { z } from "zod";
import {
  CurrencyCodeSchema,
  IsoDateTimeSchema,
  PayPeriodSchema,
  TextSchema,
  TimeZoneRangeSchema,
} from "./common";

// Rules in the profile (F3): "when every condition holds, then …". A condition names a universal
// job fact or a message field; a rule only applies when that fact is known (F3.2). The engine in
// packages/core gives the same outcome for the same input, with the rule that caused it.

/** The facts a condition can test: universal job facts and message fields, plus extra.<key>. */
export const RULE_FACTS = [
  "places.country",
  "workMode",
  "timeZones",
  "pay",
  "contract",
  "company",
  "agency",
  "sender.domain",
  "category",
  "skills",
  "languages",
] as const;
export const RuleFactSchema = z.union([
  z.enum(RULE_FACTS),
  z.string().regex(/^extra\.[a-z0-9][a-z0-9_-]{0,63}$/, "extra.<key>"),
]);
export type RuleFact = z.infer<typeof RuleFactSchema>;

export const RULE_OPS = [
  "in",
  "not_in",
  "within",
  "outside",
  "below",
  "contains",
  "equals",
  "missing",
] as const;
export const RuleOpSchema = z.enum(RULE_OPS);
export type RuleOp = z.infer<typeof RuleOpSchema>;

/** A pay threshold: compared only with pay in the same currency and period (F4.3). */
export const PayThresholdSchema = z.object({
  amount: z.number().nonnegative(),
  currency: CurrencyCodeSchema,
  period: PayPeriodSchema,
});
export type PayThreshold = z.infer<typeof PayThresholdSchema>;

/**
 * What a condition compares with, a closed union: words (country codes, work modes, categories,
 * domains, skills…), a UTC offset range (within/outside), a pay threshold (below), a number, or
 * null (missing takes no value).
 */
export const ConditionValueSchema = z.union([
  z.array(TextSchema),
  TimeZoneRangeSchema,
  PayThresholdSchema,
  z.number(),
  z.null(),
]);
export type ConditionValue = z.infer<typeof ConditionValueSchema>;

export const ConditionSchema = z.object({
  fact: RuleFactSchema,
  op: RuleOpSchema,
  value: ConditionValueSchema,
});
export type Condition = z.infer<typeof ConditionSchema>;

/** What a rule does to a role it matches. */
export const RULE_ACTIONS = ["hide", "no_draft", "ask_first", "cap_score"] as const;
export const RuleActionSchema = z.enum(RULE_ACTIONS);
export type RuleAction = z.infer<typeof RuleActionSchema>;

/** Where a rule came from (F3.1): the user, a decision answer, or an applied assistant proposal. */
export const RuleSourceSchema = z.enum(["you", "decision", "assistant"]);
export type RuleSource = z.infer<typeof RuleSourceSchema>;

/**
 * A rule's content as a Change adds or updates it (and as assistant.v1 proposes it). `then` is the
 * spec's name (F3); it is a string, never a function, so a rule is never mistaken for a promise
 * (biome.json turns noThenProperty off for it).
 */
export const RuleDraftSchema = z.object({
  /**
   * In plain words: "Hide roles whose hours are outside UTC−1 to UTC+3" (F3.1). Trimmed, and
   * never blank: a rule is always shown by what it does, so clearing the words on a proposal card
   * (F8.2) or in a request is refused where it enters. A refinement rather than a length, so the
   * JSON Schema assistant.v1 is given stays as it is.
   */
  description: TextSchema.trim().refine((s) => s.length > 0, "Describe the rule in words"),
  when: z.array(ConditionSchema).min(1),
  then: RuleActionSchema,
  enabled: z.boolean(),
});
export type RuleDraft = z.infer<typeof RuleDraftSchema>;

export const RuleSchema = RuleDraftSchema.extend({
  id: z.uuid(),
  profileId: z.uuid(),
  source: RuleSourceSchema,
  createdAt: IsoDateTimeSchema,
  /** The user who made it; null once that account is gone. */
  createdBy: z.uuid().nullable(),
});
export type Rule = z.infer<typeof RuleSchema>;

/** GET /profiles/:pid/rules. */
export const RuleListSchema = z.object({ items: z.array(RuleSchema) });
export type RuleList = z.infer<typeof RuleListSchema>;

/** PATCH /profiles/:pid/rules/:ruleId: on or off (F3.5). Remove is DELETE with no body. */
export const RuleToggleSchema = z.object({ enabled: z.boolean() });
export type RuleToggle = z.infer<typeof RuleToggleSchema>;
