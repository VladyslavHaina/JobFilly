import {
  type AiClientSettings,
  type AiError,
  type AiEvent,
  type AiMailItem,
  type AiTask,
  type AiTestOutput,
  AiTestOutputSchema,
  type AnswerOutput,
  AnswerOutputSchema,
  type AnswerTaskInput,
  type AssistantAnswer,
  AssistantRequestSchema,
  type AssistantTaskInput,
  AssistantWireAnswerSchema,
  type BatchItemResult,
  type BatchResult,
  type Category,
  ClassifyOutputSchema,
  type CvReadInput,
  type CvReadOutput,
  CvReadOutputSchema,
  type DraftOutput,
  DraftOutputSchema,
  type DraftTaskInput,
  type ExtractOutput,
  ExtractOutputSchema,
  type FocusTaskInput,
  type IntakeExtraInput,
  type IntakeExtraOutput,
  IntakeExtraOutputSchema,
  type MatchAiOutput,
  MatchAiOutputSchema,
  type MatchTaskInput,
  type Preferences,
  PrefsOutputSchema,
  type ScanFocus,
  ScanFocusSchema,
  type TaskId,
  type TaskResult,
  type Usage,
} from "@jobfilly/schema";
import {
  APICallError,
  generateText,
  type LanguageModelUsage,
  LoadAPIKeyError,
  NoObjectGeneratedError,
  Output,
  RetryError,
} from "ai";
import type { ZodType } from "zod";
import { buildPrompt, type MailTaskId, type Prompt, promptFor } from "./prompt";
import { type ModelFor, modelRegistry, type TaskModel } from "./registry";

// Every model call of the app goes through this client. Each call is one request to the provider
// (the SDK's own retries are off, so the scan budget counts exactly) and adds one Usage entry,
// retries included. An answer is checked against its schema from @jobfilly/schema; what fails is
// retried once in one follow-up call and then reported per item, never patched up (F3.4).
// ai.output_invalid events carry only the task id, the reason, how many items failed and
// the attempt: never the model's output or anything from the mail.

export interface AiClientOptions {
  /** Replaces the global fetch (tests). */
  fetch?: typeof fetch;
  onEvent?: (event: AiEvent) => void;
}

export interface CallOptions {
  /** 1 makes no retry: invalid items come back as not_retried (the run's budget is spent). */
  maxCalls?: 1 | 2;
}

export interface AiClient {
  classify(
    items: AiMailItem[],
    options?: CallOptions,
  ): Promise<BatchResult<{ category: Category }>>;
  extract(item: AiMailItem, options?: CallOptions): Promise<TaskResult<ExtractOutput>>;
  prefs(
    items: AiMailItem[],
    options?: CallOptions,
  ): Promise<BatchResult<{ preferences: Preferences }>>;
  intake(input: IntakeExtraInput, options?: CallOptions): Promise<TaskResult<IntakeExtraOutput>>;
  test(): Promise<TaskResult<AiTestOutput>>;
  /** cv.v1: what one CV says (F2.1); every skill is checked against the text by the caller. */
  readCv(input: CvReadInput, options?: CallOptions): Promise<TaskResult<CvReadOutput>>;
  /** match.v1: the fuzzy parts of one role's match (F4). */
  match(input: MatchTaskInput, options?: CallOptions): Promise<TaskResult<MatchAiOutput>>;
  /** draft.v1: one reply draft (F6). */
  draft(input: DraftTaskInput, options?: CallOptions): Promise<TaskResult<DraftOutput>>;
  /**
   * assistant.v1: one assistant turn (F8). Its proposal may hold changes outside rules and
   * entries (AssistantAnswerSchema): the caller refuses those with the reply kept (F8.7).
   */
  assistant(input: AssistantTaskInput, options?: CallOptions): Promise<TaskResult<AssistantAnswer>>;
  /** focus.v1 (MVP 3): a re-run's hint read into what the scan focuses on (F1.1). */
  focus(input: FocusTaskInput, options?: CallOptions): Promise<TaskResult<ScanFocus>>;
  /** answer.v1 (MVP 3): a question answered from lookup results, with their refs (F8). */
  answer(input: AnswerTaskInput, options?: CallOptions): Promise<TaskResult<AnswerOutput>>;
}

const MESSAGES = {
  invalid_output: "The AI's answer didn't fit the expected format, even after one retry",
  not_retried: "The AI's answer didn't fit the expected format, and no call was left to retry",
  auth: "The provider didn't accept the key",
  unreachable: "The provider can't be reached",
} as const;

type Reason = AiEvent["reason"];

/** What one request gave: the answer's text, or why there is none. */
interface Attempt {
  text: string | null;
  usage: Usage;
  error: AiError | null;
}

function tokens(usage: LanguageModelUsage | undefined): Omit<Usage, "task"> {
  return { inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 };
}

/**
 * The provider's error type from its error answer: `error.type` (Anthropic, OpenAI and the
 * OpenAI-compatible servers) or `error.status` (Google). Only a short code is taken, never the
 * provider's message.
 */
function providerErrorType(responseBody: string | undefined): string | undefined {
  try {
    const error = (JSON.parse(responseBody ?? "") as { error?: Record<string, unknown> }).error;
    const type = error?.type ?? error?.status;
    return typeof type === "string" && /^[\w.-]{1,64}$/.test(type) ? type : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A failed request in plain words; never the key, the request or the provider's answer. A
 * provider error also gives its HTTP status and error type for the logs.
 */
function transportError(error: unknown): AiError {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  if (LoadAPIKeyError.isInstance(cause)) return { kind: "auth", message: MESSAGES.auth };
  if (APICallError.isInstance(cause)) {
    const status = cause.statusCode;
    if (status === 401 || status === 403) return { kind: "auth", message: MESSAGES.auth };
    if (status === undefined) return { kind: "unreachable", message: MESSAGES.unreachable };
    const providerType = providerErrorType(cause.responseBody);
    return {
      kind: "provider_error",
      message: `The provider answered with an error (HTTP ${status})`,
      httpStatus: status,
      ...(providerType ? { providerErrorType: providerType } : {}),
    };
  }
  // fetch itself failed (DNS, refused, reset, timeout): no answer came back at all.
  if (cause instanceof TypeError || (cause instanceof Error && cause.name === "AbortError")) {
    return { kind: "unreachable", message: MESSAGES.unreachable };
  }
  return { kind: "provider_error", message: "The provider's answer couldn't be read" };
}

async function request(
  { model, providerOptions }: TaskModel,
  taskId: TaskId,
  prompt: Prompt,
  schema: ZodType,
): Promise<Attempt> {
  try {
    const result = await generateText({
      model,
      system: prompt.system,
      prompt: prompt.user,
      output: Output.object({ schema, name: taskId.replaceAll(".", "_") }),
      maxRetries: 0,
      ...(providerOptions ? { providerOptions } : {}),
    });
    return { text: result.text, usage: { task: taskId, ...tokens(result.usage) }, error: null };
  } catch (error) {
    // The model answered, but not with what the schema asks: it is checked below like any answer.
    if (NoObjectGeneratedError.isInstance(error)) {
      return {
        text: error.text ?? "",
        usage: { task: taskId, ...tokens(error.usage) },
        error: null,
      };
    }
    return {
      text: null,
      usage: { task: taskId, inputTokens: 0, outputTokens: 0 },
      error: transportError(error),
    };
  }
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

type BatchItemSchema<T> = ZodType<{ messageId: string } & T>;

/**
 * A Message-ID as compared with the model's answer: models often write it without its angle
 * brackets, which is still the same id. The answer is kept under the id that was sent.
 */
function idKey(messageId: string): string {
  return messageId
    .trim()
    .replace(/^<(.*)>$/, "$1")
    .trim();
}

export function clientFromModels(modelFor: ModelFor, options: AiClientOptions = {}): AiClient {
  const report = (event: Omit<AiEvent, "event">) =>
    options.onEvent?.({ event: "ai.output_invalid", ...event });

  /** One answer per item; valid items are kept, the others retried once together. */
  async function batch<T>(
    task: AiTask,
    taskId: MailTaskId,
    items: AiMailItem[],
    schema: ZodType,
    itemSchema: BatchItemSchema<T>,
    maxCalls: 1 | 2,
  ): Promise<BatchResult<T>> {
    const done = new Map<string, BatchItemResult<T>>();
    const usage: Usage[] = [];
    let pending = dedupe(items);
    for (let attempt = 1 as 1 | 2; pending.length > 0; attempt = 2) {
      const answer = await request(modelFor(task), taskId, buildPrompt(taskId, pending), schema);
      usage.push(answer.usage);
      if (answer.error) {
        for (const item of pending) {
          done.set(item.messageId, { messageId: item.messageId, ok: false, error: answer.error });
        }
        break;
      }
      const { valid, reason } = checkItems(answer.text ?? "", pending, itemSchema);
      for (const [messageId, { messageId: _id, ...data }] of valid) {
        done.set(messageId, { messageId, ok: true, data: data as T });
      }
      pending = pending.filter((item) => !valid.has(item.messageId));
      if (pending.length === 0) break;
      report({ taskId, reason, items: pending.length, attempt });
      if (attempt === 2 || maxCalls === 1) {
        const kind = attempt === 2 ? "invalid_output" : "not_retried";
        for (const item of pending) {
          done.set(item.messageId, {
            messageId: item.messageId,
            ok: false,
            error: { kind, message: MESSAGES[kind] },
          });
        }
        break;
      }
    }
    return {
      items: items.flatMap((item) => {
        const result = done.get(item.messageId);
        return result ? [result] : [];
      }),
      usage,
    };
  }

  /**
   * One answer for the whole call; retried once when it doesn't fit. The provider is asked for
   * `sent` (by default `schema`, which the answer is checked against).
   */
  async function single<T>(
    task: AiTask,
    taskId: TaskId,
    prompt: Prompt,
    schema: ZodType<T>,
    maxCalls: 1 | 2,
    accept: (data: T) => boolean = () => true,
    sent: ZodType = schema,
  ): Promise<TaskResult<T>> {
    const usage: Usage[] = [];
    for (let attempt = 1 as 1 | 2; ; attempt = 2) {
      const answer = await request(modelFor(task), taskId, prompt, sent);
      usage.push(answer.usage);
      if (answer.error) return { ok: false, error: answer.error, usage };
      const json = parseJson(answer.text ?? "");
      const parsed = json.ok ? schema.safeParse(json.value) : null;
      if (parsed?.success && accept(parsed.data)) return { ok: true, data: parsed.data, usage };
      const reason = !json.ok ? "parse" : parsed?.success ? "message_id" : "schema";
      report({ taskId, reason, items: 1, attempt });
      if (attempt === 2 || maxCalls === 1) {
        const kind = attempt === 2 || taskId === "ai.test.v1" ? "invalid_output" : "not_retried";
        return { ok: false, error: { kind, message: MESSAGES[kind] }, usage };
      }
    }
  }

  return {
    classify: (items, opts) =>
      batch(
        "classify",
        "classify.v1",
        items,
        ClassifyOutputSchema,
        ClassifyOutputSchema.shape.items.element,
        opts?.maxCalls ?? 2,
      ),
    prefs: (items, opts) =>
      batch(
        "prefs",
        "prefs.v1",
        items,
        PrefsOutputSchema,
        PrefsOutputSchema.shape.items.element,
        opts?.maxCalls ?? 2,
      ),
    extract: async (item, opts) => {
      const result = await single(
        "extract",
        "extract.v1",
        buildPrompt("extract.v1", [item]),
        ExtractOutputSchema,
        opts?.maxCalls ?? 2,
        // An answer about another message is not an answer about this one.
        (data) => idKey(data.messageId) === idKey(item.messageId),
      );
      return result.ok
        ? { ...result, data: { ...result.data, messageId: item.messageId } }
        : result;
    },
    intake: (input, opts) =>
      single(
        "intake",
        "intake.v1",
        buildPrompt("intake.v1", input.items, input.answers),
        IntakeExtraOutputSchema,
        opts?.maxCalls ?? 2,
      ),
    // The Test button makes exactly one tiny call (F3.1), on the classify model.
    test: () =>
      single("classify", "ai.test.v1", buildPrompt("ai.test.v1", []), AiTestOutputSchema, 1),
    readCv: (input, opts) =>
      single("cv", "cv.v1", promptFor("cv.v1", input), CvReadOutputSchema, opts?.maxCalls ?? 2),
    match: (input, opts) =>
      single(
        "match",
        "match.v1",
        promptFor("match.v1", input),
        MatchAiOutputSchema,
        opts?.maxCalls ?? 2,
      ),
    draft: (input, opts) =>
      single(
        "draft",
        "draft.v1",
        promptFor("draft.v1", input),
        DraftOutputSchema,
        opts?.maxCalls ?? 2,
      ),
    // The model is asked for rule and entry changes only, but a proposal with a change outside
    // them (a mailbox, a member…) is still an answer: its reply reaches the user, and the server
    // refuses the proposal in words (F8.7) instead of failing the whole turn. The model writes
    // flat changes (AssistantRequestSchema), which are read back into Changes and checked.
    assistant: (input, opts) =>
      single(
        "assistant",
        "assistant.v1",
        promptFor("assistant.v1", input),
        AssistantWireAnswerSchema,
        opts?.maxCalls ?? 2,
        undefined,
        AssistantRequestSchema,
      ),
    // A re-run's hint is read on the intake model, a question answered on the assistant's.
    focus: (input, opts) =>
      single(
        "intake",
        "focus.v1",
        promptFor("focus.v1", input),
        ScanFocusSchema,
        opts?.maxCalls ?? 2,
      ),
    answer: (input, opts) =>
      single(
        "assistant",
        "answer.v1",
        promptFor("answer.v1", input),
        AnswerOutputSchema,
        opts?.maxCalls ?? 2,
      ),
  };
}

/** The same Message-ID twice in one call would make the answers ambiguous: it is sent once. */
function dedupe(items: AiMailItem[]): AiMailItem[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.messageId) && seen.add(item.messageId));
}

/** The valid answers for the pending items, and why the others failed. */
function checkItems<T>(
  text: string,
  pending: AiMailItem[],
  itemSchema: BatchItemSchema<T>,
): { valid: Map<string, { messageId: string } & T>; reason: Reason } {
  const valid = new Map<string, { messageId: string } & T>();
  const json = parseJson(text);
  if (!json.ok) return { valid, reason: "parse" };
  const answers = (json.value as { items?: unknown } | null)?.items;
  if (!Array.isArray(answers)) return { valid, reason: "schema" };
  // Each answer's id, normalised, back to the id that was sent.
  const wanted = new Map(pending.map((item) => [idKey(item.messageId), item.messageId]));
  const repeated = new Set<string>();
  let schemaError = false;
  let unknownId = false;
  for (const answer of answers) {
    const parsed = itemSchema.safeParse(answer);
    if (!parsed.success) {
      schemaError = true;
      continue;
    }
    const id = wanted.get(idKey(parsed.data.messageId));
    if (id === undefined) {
      unknownId = true;
      continue;
    }
    if (valid.has(id) || repeated.has(id)) repeated.add(id);
    else valid.set(id, { ...parsed.data, messageId: id });
  }
  // An item answered twice has no single answer: picking one would be a guess, so the item stays
  // pending as invalid output and is retried like any other.
  for (const id of repeated) valid.delete(id);
  if (repeated.size > 0) schemaError = true;
  return { valid, reason: schemaError ? "schema" : unknownId ? "message_id" : "missing" };
}

export function createAiClient(
  settings: AiClientSettings,
  options: AiClientOptions = {},
): AiClient {
  return clientFromModels(modelRegistry(settings, options.fetch), options);
}
