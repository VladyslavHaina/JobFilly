import { z } from "zod";
import { JobFactsSchema } from "./facts";
import { CategorySchema } from "./messages";
import { ExtraQuestionSchema, MAX_EXTRA_QUESTIONS, PreferencesSchema } from "./profile";

// The structured outputs the model must return, one per task id. packages/ai validates every
// answer against these (per item for batched tasks) and never patches an invalid one up.

/** classify.v1: a category per message of the batch. */
export const ClassifyOutputSchema = z.object({
  items: z.array(z.object({ messageId: z.string(), category: CategorySchema })),
});
export type ClassifyOutput = z.infer<typeof ClassifyOutputSchema>;

/** extract.v1: the facts of every role one message contains (a job alert lists several). */
export const ExtractOutputSchema = z.object({
  messageId: z.string(),
  roles: z.array(JobFactsSchema),
});
export type ExtractOutput = z.infer<typeof ExtractOutputSchema>;

/** prefs.v1: the preferences each of the user's own replies states. */
export const PrefsOutputSchema = z.object({
  items: z.array(z.object({ messageId: z.string(), preferences: PreferencesSchema })),
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

/** The output schema of each task id. */
export const TASK_OUTPUT_SCHEMAS = {
  "classify.v1": ClassifyOutputSchema,
  "extract.v1": ExtractOutputSchema,
  "prefs.v1": PrefsOutputSchema,
  "intake.v1": IntakeExtraOutputSchema,
  "ai.test.v1": AiTestOutputSchema,
} as const;
