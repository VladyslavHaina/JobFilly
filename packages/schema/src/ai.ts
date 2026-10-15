import { z } from "zod";
import { IsoDateTimeSchema } from "./common";
import { AddressSchema, MailFolderSchema } from "./mailbox";
import { ConfidenceSchema, ProfileKeySchema, ProfileValueSchema } from "./profile";

/** Every provider is an equal option; openai-compatible covers Ollama, LM Studio and similar. */
export const AiProviderIdSchema = z.enum(["anthropic", "openai", "google", "openai-compatible"]);
export type AiProviderId = z.infer<typeof AiProviderIdSchema>;

/** The tasks a workspace picks a model for. */
export const AI_TASKS = ["classify", "extract", "prefs", "intake"] as const;
export const AiTaskSchema = z.enum(AI_TASKS);
export type AiTask = z.infer<typeof AiTaskSchema>;

/** Stable prompt ids (ARCHITECTURE › AI); the first line of every prompt names one. */
export const TASK_IDS = [
  "classify.v1",
  "extract.v1",
  "prefs.v1",
  "intake.v1",
  "ai.test.v1",
] as const;
export const TaskIdSchema = z.enum(TASK_IDS);
export type TaskId = z.infer<typeof TaskIdSchema>;

/** A model name per task. */
export const AiModelsSchema = z.object({
  classify: z.string().trim().min(1),
  extract: z.string().trim().min(1),
  prefs: z.string().trim().min(1),
  intake: z.string().trim().min(1),
});
export type AiModels = z.infer<typeof AiModelsSchema>;

/** Each scan run may make at most this many model calls unless the workspace sets another. */
export const DEFAULT_BUDGET_PER_RUN = 300;
export const BudgetPerRunSchema = z.number().int().min(1).max(100_000);

/** AI settings as the API returns them: never the key, only whether one is stored. */
export const AiSettingsPublicSchema = z.object({
  provider: AiProviderIdSchema,
  baseUrl: z.string().nullable(),
  models: AiModelsSchema,
  budgetPerRun: BudgetPerRunSchema,
  hasKey: z.boolean(),
  /** The data for the one line "Your mail is read by <provider> (<host>)" (F3.2). */
  readBy: z.object({ provider: z.string(), host: z.string() }),
});
export type AiSettingsPublic = z.infer<typeof AiSettingsPublicSchema>;

/** Saving or testing settings. `apiKey` is write-only; leaving it out keeps the stored key. */
export const AiSettingsInputSchema = z.object({
  provider: AiProviderIdSchema,
  baseUrl: z.url().nullable(),
  models: AiModelsSchema,
  apiKey: z.string().min(1).optional(),
  budgetPerRun: BudgetPerRunSchema.default(DEFAULT_BUDGET_PER_RUN),
});
export type AiSettingsInput = z.input<typeof AiSettingsInputSchema>;

/** What packages/ai needs to make calls: the opened key, only ever inside the server. */
export const AiClientSettingsSchema = z.object({
  provider: AiProviderIdSchema,
  baseUrl: z.string().nullable(),
  models: AiModelsSchema,
  apiKey: z.string().nullable(),
});
export type AiClientSettings = z.infer<typeof AiClientSettingsSchema>;

/** One message as the model sees it; `text` is untrusted mail content. */
export const AiMailItemSchema = z.object({
  messageId: z.string().min(1),
  folder: MailFolderSchema,
  from: AddressSchema,
  date: IsoDateTimeSchema,
  subject: z.string(),
  text: z.string(),
});
export type AiMailItem = z.infer<typeof AiMailItemSchema>;

/** At most this many messages go into one call (a batch of F4). */
export const AI_BATCH_SIZE = 20;

/**
 * The input of intake.v1: the evidence messages and the current answers, so the model can propose
 * up to five extra questions. `value` is the ProfileEntry value of that key ([] when empty).
 */
export const IntakeExtraInputSchema = z.object({
  items: z.array(AiMailItemSchema).max(AI_BATCH_SIZE),
  answers: z.array(
    z.object({ key: ProfileKeySchema, value: ProfileValueSchema, confidence: ConfidenceSchema }),
  ),
});
export type IntakeExtraInput = z.infer<typeof IntakeExtraInputSchema>;

/** The tokens of one model call; retries are calls too, so they get their own entry. */
export const UsageSchema = z.object({
  task: TaskIdSchema,
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof UsageSchema>;

export const AiErrorKindSchema = z.enum([
  "auth",
  "unreachable",
  "invalid_output",
  "not_retried",
  "provider_error",
]);
export type AiErrorKind = z.infer<typeof AiErrorKindSchema>;

/** A failure in plain words; never the key or the model's raw output. */
export const AiErrorSchema = z.object({ kind: AiErrorKindSchema, message: z.string() });
export type AiError = z.infer<typeof AiErrorSchema>;

/** The result of one task: its data, or why not, with the usage of every call made. */
export function taskResultSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), data, usage: z.array(UsageSchema) }),
    z.object({ ok: z.literal(false), error: AiErrorSchema, usage: z.array(UsageSchema) }),
  ]);
}
export type TaskResult<T> =
  | { ok: true; data: T; usage: Usage[] }
  | { ok: false; error: AiError; usage: Usage[] };

/** The result of a batched task: one outcome per item, valid items kept (TBD-17). */
export function batchResultSchema<T extends z.ZodType>(data: T) {
  return z.object({
    items: z.array(
      z.discriminatedUnion("ok", [
        z.object({ messageId: z.string(), ok: z.literal(true), data }),
        z.object({ messageId: z.string(), ok: z.literal(false), error: AiErrorSchema }),
      ]),
    ),
    usage: z.array(UsageSchema),
  });
}
export type BatchItemResult<T> =
  | { messageId: string; ok: true; data: T }
  | { messageId: string; ok: false; error: AiError };
export interface BatchResult<T> {
  items: BatchItemResult<T>[];
  usage: Usage[];
}

export const AiTestResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    reason: AiErrorKindSchema.exclude(["not_retried"]),
    message: z.string(),
  }),
]);
export type AiTestResult = z.infer<typeof AiTestResultSchema>;
