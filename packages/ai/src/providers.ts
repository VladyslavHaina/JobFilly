import { type AiModels, type AiProvider, type AiProviderId, baseUrlHost } from "@jobfilly/schema";

// The provider catalogue: what the registry and the settings form know about each provider. The
// server serves it over GET /ai/providers (AiProviderListSchema), the way packages/mail's presets
// are served, so the web app never carries vendor hosts or model names of its own.

const sameModel = (model: string): AiModels => ({
  classify: model,
  extract: model,
  prefs: model,
  intake: model,
});

/**
 * The short list of providers, in the order the form shows them; all are equal options. The
 * default models are only pre-selected in the form: every one can be changed in Settings › AI,
 * and none is used unless the workspace saves it.
 */
export const AI_PROVIDERS: readonly AiProvider[] = [
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

export function aiProvider(id: AiProviderId): AiProvider {
  const info = AI_PROVIDERS.find((p) => p.id === id);
  if (!info) throw new Error(`unknown AI provider ${id}`);
  return info;
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
