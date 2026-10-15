import { AiProviderIdSchema, AiProviderListSchema } from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { AI_PROVIDERS, aiProvider, aiReadBy } from "./providers";

// The provider catalogue (F3.1, F3.2): one entry per provider id, each valid on the wire, and the
// data of the one privacy line.

describe("the provider catalogue", () => {
  it("lists every provider once, each with a default model per task, in its wire shape", () => {
    expect(AI_PROVIDERS.map((p) => p.id)).toEqual(AiProviderIdSchema.options);
    expect(AiProviderListSchema.parse({ items: AI_PROVIDERS })).toEqual({ items: AI_PROVIDERS });
    for (const id of AiProviderIdSchema.options) expect(aiProvider(id).id).toBe(id);
  });

  it("needs a base URL, and no default host, only for an OpenAI-compatible endpoint", () => {
    for (const p of AI_PROVIDERS) {
      expect(p.baseUrlRequired).toBe(p.defaultHost === null);
      expect(p.keyRequired).toBe(!p.baseUrlRequired);
    }
  });
});

describe("aiReadBy", () => {
  it("names the provider and the host that reads the mail", () => {
    expect(aiReadBy("anthropic", null)).toEqual({
      provider: "Anthropic",
      host: "api.anthropic.com",
    });
    expect(aiReadBy("openai-compatible", "http://fake-ai:8080/v1")).toEqual({
      provider: "OpenAI-compatible endpoint",
      host: "fake-ai:8080",
    });
    expect(aiReadBy("openai", "https://user:E2E-SECRET-x@Proxy.example/v1").host).toBe(
      "proxy.example",
    );
    expect(aiReadBy("openai-compatible", null).host).toBe("");
  });
});
