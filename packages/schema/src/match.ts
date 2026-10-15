import { z } from "zod";
import { FitVerdictSchema, MatchAiOutputSchema } from "./ai-output";
import { IsoDateTimeSchema } from "./common";
import { CvChoiceSchema } from "./cv";
import { NeedSpecSchema } from "./decisions";
import { ProfileKeySchema } from "./profile";
import { RuleActionSchema } from "./rules";

// The explainable match (F4) and a role's whole evaluation: its fit score with every verdict, the
// rule that hides it, what each rule does to it, and the CV the app would use.

/** A hard conflict caps the score at this (F4.2). */
export const HARD_CONFLICT_CAP = 40;

export const VerdictSchema = FitVerdictSchema;
export type Verdict = z.infer<typeof VerdictSchema>;

/**
 * One profile entry (entryKey) or rule (ruleId) applied to a role, with its reason ("Berlin,
 * hybrid — fits your 'Berlin, hybrid'"). `hard` conflicts are listed first and cap the score.
 * `need` is set only on an unknown a reply can't go without: pay in another currency gives
 * {profileKey min_pay, groupKey min_pay:CHF:year, question "Minimum pay in CHF per year?"}. The
 * reply stage reads needs from here and never works facts out again.
 */
export const MatchVerdictSchema = z.object({
  entryKey: ProfileKeySchema.nullable(),
  ruleId: z.uuid().nullable(),
  verdict: VerdictSchema,
  reason: z.string(),
  hard: z.boolean(),
  need: NeedSpecSchema.nullable(),
});
export type MatchVerdict = z.infer<typeof MatchVerdictSchema>;

export const MatchSchema = z.object({
  /** The fit score, never called an ATS score (F4.5). */
  score: z.number().int().min(0).max(100),
  verdicts: z.array(MatchVerdictSchema),
  /** From the chosen CV and the profile; a missing skill is never a fit (F4.4). */
  skills: z.object({ matched: z.array(z.string()), missing: z.array(z.string()) }),
  cvId: z.uuid().nullable(),
  capped: z.boolean(),
});
export type Match = z.infer<typeof MatchSchema>;

/**
 * A stored match.v1 answer (match_ai_answers): the model's output and the hash of exactly what it
 * was shown (role title and skills, the profile's target roles and skills, the chosen CV's
 * skills). A rule or pay change leaves the hash alone, so re-scoring needs no model call.
 */
export const MatchAiAnswerSchema = MatchAiOutputSchema.extend({
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type MatchAiAnswer = z.infer<typeof MatchAiAnswerSchema>;

/** What one rule does to a role. An ask_first effect carries a need with profileKey null. */
export const RuleEffectSchema = z.object({
  ruleId: z.uuid(),
  action: RuleActionSchema,
  reason: z.string(),
  need: NeedSpecSchema.nullable(),
});
export type RuleEffect = z.infer<typeof RuleEffectSchema>;

/**
 * A role's evaluation (role_evaluations). `match` is null while the role can't be scored;
 * `hidden` names the rule that hides it (F3.3, F3.4); `stale` is set when a change made the
 * evaluation out of date, so a stale score is never shown as current (F4.6).
 */
export const RoleEvaluationSchema = z.object({
  position: z.number().int().nonnegative(),
  match: MatchSchema.nullable(),
  hidden: z.object({ ruleId: z.uuid(), reason: z.string() }).nullable(),
  ruleEffects: z.array(RuleEffectSchema),
  cvChoice: CvChoiceSchema,
  stale: z.boolean(),
  evaluatedAt: IsoDateTimeSchema,
});
export type RoleEvaluation = z.infer<typeof RoleEvaluationSchema>;
