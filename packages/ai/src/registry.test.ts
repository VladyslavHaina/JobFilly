import type { AiClientSettings, AiProviderId } from "@jobfilly/schema";
import { afterEach, describe, expect, it } from "vitest";
import { createAiClient } from "./client";
import { AI_PROVIDERS, aiProvider } from "./providers";
import { modelRegistry } from "./registry";

// The registry builds each provider from the workspace's settings alone: its models, its key and
// its base URL. Requests go to an injected fetch, so nothing leaves the process.

const KEY = "E2E-SECRET-ai-key";

function settingsFor(
  provider: AiProviderId,
  extra: Partial<AiClientSettings> = {},
): AiClientSettings {
  return {
    provider,
    baseUrl: provider === "openai-compatible" ? "http://llm.local:11434/v1" : null,
    models: { classify: "m-classify", extract: "m-extract", prefs: "m-prefs", intake: "m-intake" },
    apiKey: KEY,
    ...extra,
  };
}

interface Seen {
  url: string;
  headers: Headers;
}

function recordingFetch(answer: () => Response) {
  const seen: Seen[] = [];
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), headers: new Headers(init?.headers) });
    return answer();
  };
  return { seen, fetch: fetchFn as typeof fetch };
}

const unauthorized = () => Response.json({ error: { message: "bad key" } }, { status: 401 });

const mail = {
  messageId: "<a@x.example>",
  folder: "inbox" as const,
  from: { address: "a@x.example", name: null },
  date: "2026-09-28T08:15:00.000Z",
  subject: "s",
  text: "t",
};

/** Every request body a client sends; each is answered 401. */
function bodyRecorder() {
  const bodies: Record<string, unknown>[] = [];
  const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return unauthorized();
  };
  return { bodies, fetch: fetchFn as typeof fetch };
}

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

describe("the provider registry", () => {
  const expected: Record<AiProviderId, { url: string; key: (h: Headers) => string | null }> = {
    anthropic: {
      url: "https://api.anthropic.com/v1/messages",
      key: (h) => h.get("x-api-key"),
    },
    openai: {
      url: "https://api.openai.com/v1/responses",
      key: (h) => h.get("authorization"),
    },
    google: {
      url: "https://generativelanguage.googleapis.com/v1beta/models/m-classify:generateContent",
      key: (h) => h.get("x-goog-api-key"),
    },
    "openai-compatible": {
      url: "http://llm.local:11434/v1/chat/completions",
      key: (h) => h.get("authorization"),
    },
  };

  it.each(AI_PROVIDERS.map((p) => p.id))("builds %s from the settings", async (provider) => {
    const { seen, fetch } = recordingFetch(unauthorized);
    const result = await createAiClient(settingsFor(provider), { fetch }).test();
    expect(seen.map((s) => s.url)).toEqual([expected[provider].url]);
    expect(expected[provider].key(seen[0]?.headers ?? new Headers())).toContain(KEY);
    expect(result).toEqual({
      ok: false,
      error: { kind: "auth", message: "The provider didn't accept the key" },
      usage: [{ task: "ai.test.v1", inputTokens: 0, outputTokens: 0 }],
    });
  });

  it.each(["anthropic", "openai", "google"] as const)(
    "sends %s requests to the base URL when one is set",
    async (provider) => {
      const { seen, fetch } = recordingFetch(unauthorized);
      await createAiClient(settingsFor(provider, { baseUrl: "https://proxy.example/v1" }), {
        fetch,
      }).test();
      expect(seen[0]?.url).toMatch(/^https:\/\/proxy\.example\/v1\//);
    },
  );

  it("never falls back to a key from the server's environment", async () => {
    process.env.ANTHROPIC_API_KEY = "ENV-KEY";
    process.env.OPENAI_API_KEY = "ENV-KEY";
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "ENV-KEY";
    for (const provider of AI_PROVIDERS.map((p) => p.id)) {
      const { seen, fetch } = recordingFetch(unauthorized);
      const result = await createAiClient(settingsFor(provider, { apiKey: null }), {
        fetch,
      }).test();
      for (const s of seen) expect([...s.headers.values()].join(" ")).not.toContain("ENV-KEY");
      expect(result).toMatchObject({ ok: false, error: { kind: "auth" } });
    }
  });

  it("asks OpenAI for strict output except on extract.v1 and prefs.v1", async () => {
    const { bodies, fetch } = bodyRecorder();
    const client = createAiClient(settingsFor("openai"), { fetch });
    await client.classify([mail]);
    await client.extract(mail);
    await client.prefs([mail]);
    await client.intake({ items: [], answers: [] });
    const formats = bodies.map(
      (b) => (b as { text?: { format?: { strict?: boolean; name?: string } } }).text?.format,
    );
    expect(formats.map((f) => [f?.name, f?.strict])).toEqual([
      ["classify_v1", true],
      ["extract_v1", false],
      ["prefs_v1", false],
      ["intake_v1", true],
    ]);
  });

  it("sends no Authorization header to a compatible endpoint without a key", async () => {
    const { seen, fetch } = recordingFetch(unauthorized);
    await createAiClient(settingsFor("openai-compatible", { apiKey: null }), { fetch }).test();
    expect(seen[0]?.headers.get("authorization")).toBeNull();
  });

  it("uses each task's model, and every provider has defaults for all four tasks", () => {
    for (const info of AI_PROVIDERS) {
      const modelFor = modelRegistry(settingsFor(info.id, { models: info.defaultModels }));
      for (const task of ["classify", "extract", "prefs", "intake"] as const) {
        const model = modelFor(task).model as { modelId: string; provider: string };
        expect(model.modelId).toBe(aiProvider(info.id).defaultModels[task]);
        expect(model.provider).toContain(info.id);
      }
    }
  });
});

describe("the extra facts of extract.v1 and prefs.v1", () => {
  // Anthropic's structured output closes every object of the schema it is sent, so an open
  // `extra` record could only come back as {}, with no error. `extra` goes out as a list of
  // closed {key, value} objects instead, which every provider can express. Checked on the body
  // each SDK really sends for the provider's default models.
  const entries = {
    type: "array",
    items: {
      type: "object",
      properties: { key: { type: "string" }, value: { type: "string" } },
      required: ["key", "value"],
      additionalProperties: false,
    },
  };
  // biome-ignore lint/suspicious/noExplicitAny: walking into a provider's request body
  const sentSchema: Record<"anthropic" | "google", (body: any) => any> = {
    anthropic: (body) => body.output_config.format.schema,
    google: (body) => body.generationConfig.responseJsonSchema,
  };

  it.each(["anthropic", "google"] as const)(
    "can be expressed in the schema sent to %s",
    async (provider) => {
      const { bodies, fetch } = bodyRecorder();
      const settings = settingsFor(provider, { models: aiProvider(provider).defaultModels });
      const client = createAiClient(settings, { fetch });
      await client.extract(mail);
      await client.prefs([mail]);
      const [extract, prefs] = bodies.map(sentSchema[provider]);
      expect(extract.properties.roles.items.properties.extra).toEqual(entries);
      expect(prefs.properties.items.items.properties.preferences.properties.extra).toEqual(entries);
    },
  );
});

describe("failures in plain words", () => {
  it("says the provider can't be reached when the request never gets an answer", async () => {
    const fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;
    const result = await createAiClient(settingsFor("openai-compatible"), { fetch }).test();
    expect(result).toMatchObject({ ok: false, error: { kind: "unreachable" } });
  });

  it("names the HTTP status of a provider error, and never the key", async () => {
    const { fetch } = recordingFetch(() =>
      Response.json({ error: { message: `server broke for ${KEY}` } }, { status: 500 }),
    );
    const result = await createAiClient(settingsFor("openai-compatible"), { fetch }).classify([
      {
        messageId: "<a@x.example>",
        folder: "inbox",
        from: { address: "a@x.example", name: null },
        date: "2026-09-28T08:15:00.000Z",
        subject: "s",
        text: "t",
      },
    ]);
    expect(result.items).toEqual([
      {
        messageId: "<a@x.example>",
        ok: false,
        error: {
          kind: "provider_error",
          message: "The provider answered with an error (HTTP 500)",
        },
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(result.usage).toHaveLength(1);
  });
});
