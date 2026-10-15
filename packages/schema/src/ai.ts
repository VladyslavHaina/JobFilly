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

/** Reported by packages/ai when an answer fails its schema; never carries model output or mail. */
export const AiEventSchema = z.object({
  event: z.literal("ai.output_invalid"),
  taskId: TaskIdSchema,
  reason: z.enum(["schema", "missing", "parse"]),
  /** How many items were invalid. */
  items: z.number().int().nonnegative(),
  /** 1 for the first answer, 2 for the retry. */
  attempt: z.union([z.literal(1), z.literal(2)]),
});
export type AiEvent = z.infer<typeof AiEventSchema>;

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

/** GET /ai: the workspace's settings, or null before an admin has saved any. */
export const AiSettingsResponseSchema = z.object({ settings: AiSettingsPublicSchema.nullable() });
export type AiSettingsResponse = z.infer<typeof AiSettingsResponseSchema>;

/**
 * One provider as GET /ai/providers serves it to the settings form (F3.2): its name, where its API
 * lives when no base URL is given, what it needs, and the models pre-selected per task. The
 * catalogue itself is packages/ai's; every default can be changed in Settings › AI, and none is
 * used unless the workspace saves it.
 */
export const AiProviderSchema = z.object({
  id: AiProviderIdSchema,
  label: z.string(),
  /** The API's host when no base URL is set; null when the user must give one. */
  defaultHost: z.string().nullable(),
  keyRequired: z.boolean(),
  baseUrlRequired: z.boolean(),
  defaultModels: AiModelsSchema,
});
export type AiProvider = z.infer<typeof AiProviderSchema>;

/** GET /ai/providers: the short list of providers, in the order the form shows them. */
export const AiProviderListSchema = z.object({ items: z.array(AiProviderSchema) });
export type AiProviderList = z.infer<typeof AiProviderListSchema>;

/**
 * What the settings form and packages/ai know about each provider: its name, where its API lives
 * when no base URL is given, what it needs, and the models pre-selected per task (F3.2). Every
 * default can be changed in Settings › AI; none is used unless the workspace saves it.
 */
export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  /** The API's host when no base URL is set; null when the user must give one. */
  defaultHost: string | null;
  keyRequired: boolean;
  baseUrlRequired: boolean;
  defaultModels: AiModels;
}

const sameModel = (model: string): AiModels => ({
  classify: model,
  extract: model,
  prefs: model,
  intake: model,
});

/** The short list of providers, in the order the form shows them; all are equal options. */
export const AI_PROVIDERS: readonly AiProviderInfo[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    defaultHost: "api.anthropic.com",
    keyRequired: true,
    baseUrlRequired: false,
    defaultModels: { ...sameModel("claude-sonnet-5-5"), classify: "claude-haiku-5-5" },
  },
  {
    id: "openai",
    label: "OpenAI",
    defaultHost: "api.openai.com",
    keyRequired: true,
    baseUrlRequired: false,
    defaultModels: { ...sameModel("gpt-5.5"), classify: "gpt-5.4-mini" },
  },
  {
    id: "google",
    label: "Google",
    defaultHost: "generativelanguage.googleapis.com",
    keyRequired: true,
    baseUrlRequired: false,
    defaultModels: { ...sameModel("gemini-3.5-flash"), classify: "gemini-3.5-flash-lite" },
  },
  {
    id: "openai-compatible",
    label: "OpenAI-compatible endpoint",
    defaultHost: null,
    keyRequired: false,
    baseUrlRequired: true,
    defaultModels: sameModel("llama3.1"),
  },
];

export function aiProvider(id: AiProviderId): AiProviderInfo {
  const info = AI_PROVIDERS.find((p) => p.id === id);
  if (!info) throw new Error(`unknown AI provider ${id}`);
  return info;
}

/**
 * The authority of scheme://[user[:password]@]host[:port]/..., or undefined when the URL doesn't
 * have that shape. A URL parser reads a backslash as "/" in http(s) URLs, so one ends the
 * authority too.
 */
const authorityOf = (url: string) => /^[a-z][a-z\d+.-]*:\/\/([^/\\?#]*)/i.exec(url.trim())?.[1];

/**
 * The host[:port] a base URL sends requests to, lower-cased, for the privacy line "Your mail is
 * read by <provider> (<host>)" (F3.2); "" while the URL doesn't have that shape. The user part is
 * never shown: a saved base URL never has one (AiSettingsInputSchema refuses it), but the form
 * shows the line while the user is still typing. The server and the form both use this, so the
 * line reads the same before and after saving.
 */
export function baseUrlHost(baseUrl: string): string {
  const authority = authorityOf(baseUrl) ?? "";
  return authority.slice(authority.lastIndexOf("@") + 1).toLowerCase();
}

/**
 * The data of the one privacy line "Your mail is read by <provider> (<host>)" (F3.2): the base
 * URL's host when one is set, else the provider's own. `host` is "" when it can't be known yet.
 */
export function aiReadBy(
  provider: AiProviderId,
  baseUrl: string | null,
): { provider: string; host: string } {
  const info = aiProvider(provider);
  return { provider: info.label, host: baseUrl ? baseUrlHost(baseUrl) : (info.defaultHost ?? "") };
}

/**
 * A base URL as the user enters it. It is stored in clear and shown back to every member, so it
 * may not carry a user name or password (https://user:secret@host/v1): a secret goes in the API
 * key field, which is sealed and never returned.
 */
const AiBaseUrlSchema = z.url().refine(
  // A URL whose authority can't be found is refused too, rather than trusted to have no user part.
  (value) => authorityOf(value)?.includes("@") === false,
  {
    message:
      "Leave the user name and password out of the base URL; put the secret in the API key field",
  },
);

/** Saving or testing settings. `apiKey` is write-only; leaving it out keeps the stored key. */
export const AiSettingsInputSchema = z.object({
  provider: AiProviderIdSchema,
  baseUrl: AiBaseUrlSchema.nullable(),
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
