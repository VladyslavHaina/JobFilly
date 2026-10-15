import type {
  AiClientSettings,
  AiMailItem,
  AiTestOutput,
  BatchResult,
  Category,
  ExtractOutput,
  IntakeExtraInput,
  IntakeExtraOutput,
  Preferences,
  TaskId,
  TaskResult,
} from "@jobfilly/schema";

// The AI provider registry. Every model call in the app goes through here. Providers are equals:
// the workspace picks one, and each task can use its own model. Structured output is validated
// against @jobfilly/schema, retried once when invalid, and never patched up. Mail content is
// passed as untrusted data (F3.5). The connect slice implements this module; the names and types
// below are the contract.

/** Reported when an answer fails its schema; never carries model output or mail content. */
export interface AiEvent {
  event: "ai.output_invalid";
  taskId: TaskId;
  reason: "schema" | "missing" | "parse";
  /** How many items were invalid. */
  items: number;
  /** 1 for the first answer, 2 for the retry. */
  attempt: number;
}

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
}

export function createAiClient(_settings: AiClientSettings, _options?: AiClientOptions): AiClient {
  throw new Error("createAiClient is not built yet (connect slice)");
}
