import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { AiClientSettings, AiTask } from "@jobfilly/schema";
import type { LanguageModel } from "ai";

// The provider registry: the workspace's settings pick one provider, and each task its own
// model. Every provider is built the same way from the settings alone: its key (never read from
// the environment), its base URL when one is set, and the injected fetch. Nothing here prefers one
// vendor over another.

type FetchFunction = typeof fetch;

/** The model a task runs on, built from the workspace's settings. */
export type ModelFor = (task: AiTask) => LanguageModel;

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
  return (task) => build(settings.models[task]);
}
