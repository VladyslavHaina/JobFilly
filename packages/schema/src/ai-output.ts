import { z } from "zod";
import { AnswerOutputSchema, AssistantLookupSchema, ChangeSchema } from "./assistant";
import { CategorySchema } from "./category";
import { TextSchema } from "./common";
import { JobFactsAnswerSchema } from "./facts";
import { ScanFocusSchema } from "./focus";
import { ExtraQuestionSchema, MAX_EXTRA_QUESTIONS, PreferencesAnswerSchema } from "./profile";

// The structured outputs the model must return, one per task id. packages/ai validates every
// answer against these (per item for batched tasks) and never patches an invalid one up. The
// model writes the input shape (the JSON Schema sent to the provider is made from it); parsing
// gives the output shape, where `extra` lists are the { key: value } records of the app.

/** classify.v1: a category per message of the batch. */
export const ClassifyOutputSchema = z.object({
  items: z.array(z.object({ messageId: z.string(), category: CategorySchema })),
});
export type ClassifyOutput = z.infer<typeof ClassifyOutputSchema>;

/** extract.v1: the facts of every role one message contains (a job alert lists several). */
export const ExtractOutputSchema = z.object({
  messageId: z.string(),
  roles: z.array(JobFactsAnswerSchema),
});
export type ExtractOutput = z.infer<typeof ExtractOutputSchema>;

/** prefs.v1: the preferences each of the user's own replies states. */
export const PrefsOutputSchema = z.object({
  items: z.array(z.object({ messageId: z.string(), preferences: PreferencesAnswerSchema })),
});
export type PrefsOutput = z.infer<typeof PrefsOutputSchema>;

/** intake.v1: the wording of up to five extra questions found in the mail. */
export const IntakeExtraOutputSchema = z.object({
  questions: z.array(ExtraQuestionSchema).max(MAX_EXTRA_QUESTIONS),
});
export type IntakeExtraOutput = z.infer<typeof IntakeExtraOutputSchema>;

/** ai.test.v1: the one tiny structured call behind the Test button (F3.1). */
export const AiTestOutputSchema = z.object({ ok: z.literal(true) });
export type AiTestOutput = z.infer<typeof AiTestOutputSchema>;

/** cv.v1: what a CV says about its writer, every skill as the CV writes it (F2.1, F2.2). */
export const CvReadOutputSchema = z.object({
  language: z.string().nullable(),
  skills: z.array(TextSchema),
  roleFamilies: z.array(TextSchema),
  seniority: TextSchema.nullable(),
  countryHints: z.array(TextSchema),
  formatHints: z.array(TextSchema),
});
export type CvReadOutput = z.infer<typeof CvReadOutputSchema>;

/** fits, conflicts or unknown: the verdict of a match part (F4.1). */
export const FitVerdictSchema = z.enum(["fits", "conflicts", "unknown"]);

/** match.v1: only the fuzzy parts of the match (F4): the title against the target roles, and
 * how close each of the role's skills is to the CV and profile skills. */
export const MatchAiOutputSchema = z.object({
  titleFit: z.object({ verdict: FitVerdictSchema, reason: TextSchema }),
  skillCloseness: z.array(
    z.object({ skill: TextSchema, verdict: FitVerdictSchema, reason: TextSchema }),
  ),
});
export type MatchAiOutput = z.infer<typeof MatchAiOutputSchema>;

/**
 * One answer draft.v1 offers to a question: its words, in the language of the mail, and whether
 * choosing it turns the question down (`declines`): a no, or anything but what the question's
 * group key describes. The model reads every language, so it says what each answer means; the
 * app never reads a yes or a no from the words (packages/core decisions/answers.ts choiceOf).
 */
const DraftChoiceSchema = z.object({ label: TextSchema, declines: z.boolean() });
export type DraftChoice = z.infer<typeof DraftChoiceSchema>;

/**
 * draft.v1: the reply, in the language of the incoming message (F6.1); the profile keys it used;
 * whether to attach the chosen CV (the message asks for one, F6.3); and the questions it couldn't
 * answer from the profile and the CV, which go to the decision inbox instead of a guess (F6.2).
 */
export const DraftOutputSchema = z.object({
  subject: TextSchema,
  body: TextSchema,
  language: TextSchema,
  usedEntries: z.array(z.string()),
  attachCv: z.boolean(),
  questions: z.array(
    z.object({
      profileKey: z.string().nullable(),
      groupKey: z.string(),
      question: TextSchema,
      choices: z.array(DraftChoiceSchema),
    }),
  ),
});
export type DraftOutput = z.infer<typeof DraftOutputSchema>;

/**
 * assistant.v1: a reply, plus a clarifying question with choices (F8.6) or a proposal of changes
 * (F8.2), or neither. It can only propose; applying is the user's separate request.
 */
export const AssistantOutputSchema = z.object({
  reply: TextSchema,
  clarify: z.object({ question: TextSchema, choices: z.array(TextSchema) }).nullable(),
  proposal: z.object({ summary: TextSchema, changes: z.array(ChangeSchema) }).nullable(),
  /**
   * MVP 3 (F8): for a question, the read-only lookups whose results answer.v1 answers it from;
   * empty otherwise. An answer without the field (before MVP 3) reads as none.
   */
  lookups: z.array(AssistantLookupSchema).default([]),
});
/** As the model writes it: `lookups` may be left out. */
export type AssistantOutput = z.input<typeof AssistantOutputSchema>;

/**
 * A Change as assistant.v1 asks the model for it: one flat object for every Change, with the
 * rule (a RuleDraft) and the entry's value as JSON text, and the fields a change doesn't use
 * null. The nested Change union compiled to a grammar Anthropic refuses as too large (HTTP 400),
 * so the JSON Schema the provider is given stays flat. The answer is decoded
 * (assistantAnswerFromRequest) and then checked against ChangeSchema like any answer.
 */
const ChangeRequestSchema = z.object({
  op: z.enum(["add", "update", "remove"]),
  target: z.enum(["rule", "entry"]),
  /** The rule an update or a remove changes. */
  ruleId: z.string().nullable(),
  /** The profile entry's key. */
  key: z.string().nullable(),
  /** The rule an add or an update sets, as JSON text: { description, when, then, enabled }. */
  rule: z.string().nullable(),
  /** The entry's value as JSON text; null with remove removes the whole entry. */
  value: z.string().nullable(),
});

/** What the provider is asked for in assistant.v1: AssistantOutputSchema, the changes as above. */
export const AssistantRequestSchema = AssistantOutputSchema.extend({
  proposal: z.object({ summary: TextSchema, changes: z.array(ChangeRequestSchema) }).nullable(),
});

/** The value of JSON text; anything else, or text that isn't JSON, is undefined, which fails. */
function jsonText(text: unknown): unknown {
  if (text === null) return null;
  if (typeof text !== "string") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** One change of the answer in ChangeSchema's shape; a change outside rules and entries as is. */
function changeFromRequest(change: unknown): unknown {
  if (typeof change !== "object" || change === null) return change;
  const { op, target, ruleId, key, rule, value } = change as Record<string, unknown>;
  if (target === "rule") {
    return {
      op,
      target,
      ...(op === "add" ? {} : { ruleId }),
      ...(op === "remove" ? {} : { rule: jsonText(rule) }),
    };
  }
  if (target === "entry") return { op, target, key, value: jsonText(value) };
  return change;
}

/**
 * An assistant.v1 answer as AssistantRequestSchema writes it, in AssistantAnswerSchema's shape:
 * each change's rule and value read from their JSON text. Nothing is checked here; the result is
 * checked against AssistantAnswerSchema (AssistantWireAnswerSchema).
 */
function assistantAnswerFromRequest(answer: unknown): unknown {
  if (typeof answer !== "object" || answer === null) return answer;
  const { proposal } = answer as { proposal?: unknown };
  if (typeof proposal !== "object" || proposal === null) return answer;
  const { changes } = proposal as { changes?: unknown };
  if (!Array.isArray(changes)) return answer;
  return { ...answer, proposal: { ...proposal, changes: changes.map(changeFromRequest) } };
}

/**
 * A change in an assistant.v1 answer that targets neither a rule nor a profile entry (a mailbox,
 * a member, the AI settings…), which the model can't propose (F8.7). It passes the answer check
 * only so that the server can refuse the proposal in words and keep the reply; a rule or entry
 * change that is malformed is not one of these and fails the check like any wrong answer.
 */
const OutsideChangeSchema = z
  .looseObject({ target: z.unknown().optional() })
  .refine((change) => change.target !== "rule" && change.target !== "entry");

/**
 * What packages/ai checks an assistant.v1 answer against. The provider is asked for
 * AssistantRequestSchema; this is AssistantOutputSchema, except that a proposal may hold changes
 * outside rules and entries. The server refuses such a proposal with the reply kept (F8.7) and never stores it.
 */
export const AssistantAnswerSchema = AssistantOutputSchema.extend({
  proposal: z
    .object({
      summary: TextSchema,
      changes: z.array(z.union([ChangeSchema, OutsideChangeSchema])),
    })
    .nullable(),
});
export type AssistantAnswer = z.infer<typeof AssistantAnswerSchema>;

/** What packages/ai checks the provider's assistant.v1 answer against: decoded, then checked. */
export const AssistantWireAnswerSchema = z.preprocess(
  assistantAnswerFromRequest,
  AssistantAnswerSchema,
);

/** The output schema each task id asks the provider for. */
export const TASK_OUTPUT_SCHEMAS = {
  "classify.v1": ClassifyOutputSchema,
  "extract.v1": ExtractOutputSchema,
  "prefs.v1": PrefsOutputSchema,
  "intake.v1": IntakeExtraOutputSchema,
  "ai.test.v1": AiTestOutputSchema,
  "cv.v1": CvReadOutputSchema,
  "match.v1": MatchAiOutputSchema,
  "draft.v1": DraftOutputSchema,
  "assistant.v1": AssistantRequestSchema,
  "focus.v1": ScanFocusSchema,
  "answer.v1": AnswerOutputSchema,
} as const;
