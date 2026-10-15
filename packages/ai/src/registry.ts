import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { AiClientSettings, AiTask } from "@jobfilly/schema";
import type { generateText, LanguageModel } from "ai";

// The provider registry: the workspace's settings pick one provider, and each task its own
// model. Every provider is built the same way from the settings alone: its key (never read from
// the environment), its base URL when one is set, and the injected fetch. Nothing here prefers one
// vendor over another.

type FetchFunction = typeof fetch;

type ProviderOptions = Parameters<typeof generateText>[0]["providerOptions"];

/** The model a task runs on, built from the workspace's settings, with any options it needs. */
export interface TaskModel {
  model: LanguageModel;
  providerOptions?: ProviderOptions;
}
export type ModelFor = (task: AiTask) => TaskModel;

/**
 * OpenAI's strict structured-output mode needs every key required; the prefs.v1 schema has
 * optional keys (TBD-45). extract.v1 was sent the same way while its `extra` was an open record;
 * `extra` now goes out as a list of closed {key, value} objects, and extract.v1 stays non-strict
 * until a run against OpenAI shows strict mode takes its patterns. For those tasks OpenAI gets
 * the same JSON Schema without strict mode; the answer is still validated against the schema
 * here, as every answer is.
 */
const NOT_STRICT: ReadonlySet<AiTask> = new Set(["extract", "prefs"]);

export function modelRegistry(settings: AiClientSettings, fetchFn?: FetchFunction): ModelFor {
  // A provider SDK falls back to its own environment variable when no key is passed; the empty
  // string keeps the workspace's settings the only source, so a missing key fails as "auth".
  const apiKey = settings.apiKey ?? "";
  const baseURL = settings.baseUrl ?? undefined;
  const common = { apiKey, baseURL, fetch: fetchFn };
  let build: (modelId: string) => LanguageModel;
  switch (settings.provider) {
    case "anthropic": {
      const provider = createAnthropic(common);
      build = (id) => provider(id);
      break;
    }
    case "openai": {
      const provider = createOpenAI(common);
      build = (id) => provider(id);
      break;
    }
    case "google": {
      const provider = createGoogle(common);
      build = (id) => provider(id);
      break;
    }
    case "openai-compatible": {
      if (!baseURL) throw new Error("an OpenAI-compatible endpoint needs a base URL");
      const provider = createOpenAICompatible({
        name: "openai-compatible",
        baseURL,
        // Local servers (Ollama, LM Studio) need no key: then no Authorization header is sent.
        apiKey: settings.apiKey ?? undefined,
        fetch: fetchFn,
        // Answers come back as JSON in the message content (response_format json_schema), which
        // every compatible server supports, never as tool calls (TBD-25).
        supportsStructuredOutputs: true,
      });
      build = (id) => provider(id);
      break;
    }
  }
  return (task) => ({
    model: build(settings.models[task]),
    ...(settings.provider === "openai" && NOT_STRICT.has(task)
      ? { providerOptions: { openai: { strictJsonSchema: false } } }
      : {}),
  });
}
