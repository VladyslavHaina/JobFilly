// The AI provider registry. Every model call in the app goes through here. Providers are equals:
// the workspace picks one, and each task can use its own model. Structured output is validated
// against @jobfilly/schema, retried once when invalid, and never patched up. Mail content is
// passed as untrusted data (F3.5).

export {
  type AiClient,
  type AiClientOptions,
  type CallOptions,
  createAiClient,
} from "./client";
