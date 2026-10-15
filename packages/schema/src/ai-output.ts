import { z } from "zod";
import { ChangeSchema } from "./assistant";
import { CategorySchema } from "./category";
import { TextSchema } from "./common";
import { JobFactsAnswerSchema } from "./facts";
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
      choices: z.array(TextSchema),
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
});
export type AssistantOutput = z.infer<typeof AssistantOutputSchema>;

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
 * AssistantOutputSchema; this is the same, except that a proposal may hold changes outside rules
 * and entries. The server refuses such a proposal with the reply kept (F8.7) and never stores it.
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

/** The output schema of each task id. */
export const TASK_OUTPUT_SCHEMAS = {
  "classify.v1": ClassifyOutputSchema,
  "extract.v1": ExtractOutputSchema,
  "prefs.v1": PrefsOutputSchema,
  "intake.v1": IntakeExtraOutputSchema,
  "ai.test.v1": AiTestOutputSchema,
  "cv.v1": CvReadOutputSchema,
  "match.v1": MatchAiOutputSchema,
  "draft.v1": DraftOutputSchema,
  "assistant.v1": AssistantOutputSchema,
} as const;
