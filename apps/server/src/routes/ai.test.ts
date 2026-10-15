import { AI_PROVIDERS, type AiClient } from "@jobfilly/ai";
import { getAiSettings, recordAiUsage, usageTotal } from "@jobfilly/db";
import {
  type AiClientSettings,
  AiProviderListSchema,
  type AiSettingsResponse,
  AiSettingsResponseSchema,
  type AiTestOutput,
  AiTestResultSchema,
  AiUsageListSchema,
  type TaskId,
  type TaskResult,
} from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import type { AiPort } from "../deps";
import { open } from "../secrets";
import {
  createTestDeps,
  fakeAiClient,
  type SeededUser,
  seedAiSettings,
  seedUser,
  seedWorkspace,
  signedIn,
  TEST_SECRET_KEY,
  type TestClient,
  type TestDeps,
} from "../testing";

// The AI settings routes (F3) on PGlite, with a fake AI port: no model is reached.

const KEY = "E2E-SECRET-ai-key";
const models = {
  classify: "m-c",
  extract: "m-e",
  prefs: "m-p",
  intake: "m-i",
  cv: "m-cv",
  match: "m-m",
  draft: "m-d",
  assistant: "m-a",
};
const form = {
  provider: "openai-compatible",
  baseUrl: "http://fake-ai:8080/v1",
  models,
  apiKey: KEY,
  budgetPerRun: 120,
};

interface FakeAi {
  port: AiPort;
  /** The settings of every client made, i.e. of every test call. */
  clients: AiClientSettings[];
  result: TaskResult<AiTestOutput>;
}

function fakeAi(): FakeAi {
  const fake: FakeAi = {
    clients: [],
    result: {
      ok: true,
      data: { ok: true },
      usage: [{ task: "ai.test.v1", inputTokens: 74, outputTokens: 5 }],
    },
    port: {
      client(settings) {
        fake.clients.push(settings);
        const refuse = () => {
          throw new Error("only test() is expected here");
        };
        const client: AiClient = fakeAiClient({
          test: async () => fake.result,
          classify: refuse,
          extract: refuse,
          prefs: refuse,
          intake: refuse,
        });
        return client;
      },
    },
  };
  return fake;
}

let deps: TestDeps;
let ai: FakeAi;
let owner: SeededUser;
let admin: TestClient;
let url: string;

beforeEach(async () => {
  ai = fakeAi();
  deps = await createTestDeps({ ai: ai.port });
  owner = await seedUser(deps, { name: "Maria Santos" });
  admin = await signedIn(createApp(deps), deps, owner);
  url = `/api/workspaces/${owner.workspaceId}/ai`;
});
afterEach(() => deps.close());

const settingsOf = async (res: Response): Promise<AiSettingsResponse> =>
  AiSettingsResponseSchema.parse(await res.json());

describe("roles (F1.8)", () => {
  it("lets viewers read and only admins save and test", async () => {
    const app = createApp(deps);
    const viewer = await seedUser(deps);
    const editor = await seedUser(deps);
    const ws = await seedWorkspace(deps, {
      owner,
      members: [
        { user: viewer, role: "viewer" },
        { user: editor, role: "editor" },
      ],
    });
    const base = `/api/workspaces/${ws.workspaceId}/ai`;
    for (const user of [viewer, editor]) {
      const client = await signedIn(app, deps, user);
      expect((await client.get(base)).status).toBe(200);
      expect((await client.get(`${base}/providers`)).status).toBe(200);
      expect((await client.put(base, form)).status).toBe(403);
      expect((await client.post(`${base}/test`, form)).status).toBe(403);
    }
    expect(ai.clients).toEqual([]);
    expect(await getAiSettings(deps.db, ws.workspaceId)).toBeNull();
  });
});

describe("the provider catalogue (F3.1, F3.2)", () => {
  it("serves packages/ai's short list, each provider with its defaults and no price data", async () => {
    const res = await admin.get(`${url}/providers`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(AiProviderListSchema.parse(JSON.parse(text))).toEqual({ items: [...AI_PROVIDERS] });
    expect(text).not.toMatch(/price|cost|\$|€|per token/i);
  });

  it("is not found for someone outside the workspace", async () => {
    const outsider = await signedIn(createApp(deps), deps, await seedUser(deps));
    const res = await outsider.get(`${url}/providers`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("api.anthropic.com");
  });
});

describe("usage per day (MVP 2 F1.5)", () => {
  const call = (workspaceId: string, at: string, inputTokens: number, task = "match.v1") =>
    recordAiUsage(deps.db, workspaceId, {
      scanId: null,
      task: task as TaskId,
      inputTokens,
      outputTokens: 5,
      at: new Date(at),
    });

  it("gives the workspace's model calls and tokens per day, newest first", async () => {
    const other = await seedUser(deps);
    await call(owner.workspaceId, "2026-10-14T08:00:00Z", 100, "classify.v1");
    await call(owner.workspaceId, "2026-10-15T09:00:00Z", 200, "draft.v1");
    await call(owner.workspaceId, "2026-10-15T23:59:00Z", 300);
    await call(other.workspaceId, "2026-10-15T09:00:00Z", 999);
    const res = await admin.get(`${url}/usage`);
    expect(res.status).toBe(200);
    expect(AiUsageListSchema.parse(await res.json())).toEqual({
      items: [
        { day: "2026-10-15", calls: 2, inputTokens: 500, outputTokens: 10 },
        { day: "2026-10-14", calls: 1, inputTokens: 100, outputTokens: 5 },
      ],
    });
  });

  it("counts the calls the server makes, as they are recorded where they are made", async () => {
    await admin.post(`${url}/test`, form);
    const { items } = AiUsageListSchema.parse(await (await admin.get(`${url}/usage`)).json());
    expect(items).toEqual([
      {
        day: deps.clock.now().toISOString().slice(0, 10),
        calls: 1,
        inputTokens: 74,
        outputTokens: 5,
      },
    ]);
  });

  it("is empty before any call, readable by viewers, and not found for outsiders", async () => {
    const viewer = await seedUser(deps);
    const ws = await seedWorkspace(deps, { owner, members: [{ user: viewer, role: "viewer" }] });
    await call(ws.workspaceId, "2026-10-15T09:00:00Z", 10);
    const app = createApp(deps);
    const base = `/api/workspaces/${ws.workspaceId}/ai/usage`;
    expect(await (await admin.get(`${url}/usage`)).json()).toEqual({ items: [] });
    const asViewer = await (await signedIn(app, deps, viewer)).get(base);
    expect(asViewer.status).toBe(200);
    expect(AiUsageListSchema.parse(await asViewer.json()).items).toHaveLength(1);
    const outsider = await signedIn(app, deps, await seedUser(deps));
    expect((await outsider.get(base)).status).toBe(404);
  });
});

describe("reading and saving (F3.1, F3.2)", () => {
  it("has no settings before an admin saves them", async () => {
    expect(await settingsOf(await admin.get(url))).toEqual({ settings: null });
  });

  it("saves the provider, base URL, models and budget, and logs ai.settings_saved", async () => {
    const res = await admin.put(url, form);
    expect(res.status).toBe(200);
    const expected = {
      settings: {
        provider: "openai-compatible",
        baseUrl: "http://fake-ai:8080/v1",
        models,
        budgetPerRun: 120,
        hasKey: true,
        readBy: { provider: "OpenAI-compatible endpoint", host: "fake-ai:8080" },
      },
    };
    expect(await settingsOf(res)).toEqual(expected);
    expect(await settingsOf(await admin.get(url))).toEqual(expected);
    expect(deps.logs.find((l) => l.event === "ai.settings_saved")).toMatchObject({
      level: "info",
      provider: "openai-compatible",
      workspaceId: owner.workspaceId,
    });
  });

  it("carries only the one privacy line's provider and host, and no price data", async () => {
    await admin.put(url, { ...form, provider: "anthropic", baseUrl: null });
    const text = await (await admin.get(url)).text();
    const { settings } = AiSettingsResponseSchema.parse(JSON.parse(text));
    expect(settings?.readBy).toEqual({ provider: "Anthropic", host: "api.anthropic.com" });
    expect(`Your mail is read by ${settings?.readBy.provider} (${settings?.readBy.host})`).toBe(
      "Your mail is read by Anthropic (api.anthropic.com)",
    );
    expect(text).not.toMatch(/price|cost|\$|€|per token/i);
  });

  it("defaults the budget to 300 calls", async () => {
    const { budgetPerRun: _b, ...rest } = form;
    expect((await settingsOf(await admin.put(url, rest))).settings?.budgetPerRun).toBe(300);
  });

  it("needs a base URL for an OpenAI-compatible endpoint and a key for the vendors", async () => {
    const noBase = await admin.put(url, { ...form, baseUrl: null });
    expect(noBase.status).toBe(400);
    expect(await noBase.json()).toEqual({
      error: "invalid",
      message: "Enter the base URL of the endpoint",
    });
    const { apiKey: _k, ...keyless } = form;
    const noKey = await admin.put(url, { ...keyless, provider: "openai", baseUrl: null });
    expect(noKey.status).toBe(400);
    expect(await noKey.json()).toEqual({
      error: "invalid",
      message: "Enter the API key for OpenAI",
    });
    // A local endpoint needs no key.
    expect((await admin.put(url, keyless)).status).toBe(200);
  });
});

describe("the key (F3.3)", () => {
  it("can't hide in the base URL: one with a user name or password is refused, never stored", async () => {
    const baseUrl = "https://user:E2E-SECRET-in-url@proxy.example/v1";
    const message =
      "Leave the user name and password out of the base URL; put the secret in the API key field";
    const saved = await admin.put(url, { ...form, baseUrl });
    expect(saved.status).toBe(400);
    expect(await saved.json()).toEqual({ error: "invalid", message });
    const tested = await admin.post(`${url}/test`, { ...form, baseUrl });
    expect(tested.status).toBe(400);
    expect(await tested.json()).toEqual({ error: "invalid", message });
    expect(ai.clients).toEqual([]);
    expect(await getAiSettings(deps.db, owner.workspaceId)).toBeNull();
    expect(deps.rawLogs.join("\n")).not.toContain("E2E-SECRET-in-url");
  });

  it("is sealed with AES-256-GCM: never stored in clear, different each time, bound to the key", async () => {
    await admin.put(url, form);
    const first = await getAiSettings(deps.db, owner.workspaceId);
    expect(first?.keyCiphertext).not.toContain(KEY);
    expect(open(TEST_SECRET_KEY, first?.keyCiphertext ?? "")).toBe(KEY);
    await admin.put(url, form);
    const second = await getAiSettings(deps.db, owner.workspaceId);
    expect(second?.keyCiphertext).not.toBe(first?.keyCiphertext);
    expect(() => open(new Uint8Array(32).fill(7), second?.keyCiphertext ?? "")).toThrow();
  });

  it("is never returned or logged", async () => {
    const saved = await (await admin.put(url, form)).text();
    const read = await (await admin.get(url)).text();
    await admin.post(`${url}/test`, form);
    const stored = (await getAiSettings(deps.db, owner.workspaceId))?.keyCiphertext ?? "-";
    for (const text of [saved, read, deps.rawLogs.join("\n")]) {
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(stored);
    }
  });

  it("is kept by a save without a key, for the same provider and base URL", async () => {
    await admin.put(url, form);
    const { apiKey: _k, ...keyless } = form;
    const res = await admin.put(url, { ...keyless, budgetPerRun: 5 });
    expect((await settingsOf(res)).settings).toMatchObject({ hasKey: true, budgetPerRun: 5 });
    const stored = await getAiSettings(deps.db, owner.workspaceId);
    expect(open(TEST_SECRET_KEY, stored?.keyCiphertext ?? "")).toBe(KEY);
  });

  it("is dropped, not carried over, when the base URL changes without a new key", async () => {
    await admin.put(url, form);
    const { apiKey: _k, ...keyless } = form;
    const res = await admin.put(url, { ...keyless, baseUrl: "http://elsewhere.example/v1" });
    expect((await settingsOf(res)).settings?.hasKey).toBe(false);
    await admin.post(`${url}/test`, { ...keyless, baseUrl: "http://elsewhere.example/v1" });
    expect(ai.clients.at(-1)?.apiKey).toBeNull();
  });

  it("reads a cleared key as no key, also after a keyless save to the same endpoint (TBD-129)", async () => {
    await seedAiSettings(deps, owner.workspaceId, {
      provider: "openai-compatible",
      baseUrl: form.baseUrl,
      models,
      apiKey: "",
    });
    const stored = await getAiSettings(deps.db, owner.workspaceId);
    expect(open(TEST_SECRET_KEY, stored?.keyCiphertext ?? "-")).toBe("");
    expect((await settingsOf(await admin.get(url))).settings?.hasKey).toBe(false);
    const { apiKey: _k, ...keyless } = form;
    await admin.post(`${url}/test`, keyless);
    expect(ai.clients.at(-1)?.apiKey).toBeNull();
    const res = await admin.put(url, keyless);
    expect((await settingsOf(res)).settings?.hasKey).toBe(false);
  });
});

describe("test (F3.1)", () => {
  it("makes one ai.test.v1 call with the form's settings and records its usage", async () => {
    const res = await admin.post(`${url}/test`, form);
    expect(AiTestResultSchema.parse(await res.json())).toEqual({ ok: true });
    expect(ai.clients).toEqual([
      { provider: "openai-compatible", baseUrl: "http://fake-ai:8080/v1", models, apiKey: KEY },
    ]);
    expect(await usageTotal(deps.db, owner.workspaceId)).toEqual({
      calls: 1,
      inputTokens: 74,
      outputTokens: 5,
    });
    // Testing saves nothing.
    expect(await getAiSettings(deps.db, owner.workspaceId)).toBeNull();
  });

  it("uses the stored key when the form leaves it empty, for the same endpoint only", async () => {
    await admin.put(url, form);
    const { apiKey: _k, ...keyless } = form;
    await admin.post(`${url}/test`, keyless);
    expect(ai.clients.at(-1)?.apiKey).toBe(KEY);
    const other = await admin.post(`${url}/test`, {
      ...keyless,
      provider: "openai",
      baseUrl: null,
    });
    expect(other.status).toBe(400);
    expect(ai.clients).toHaveLength(1);
  });

  it("gives a plain error and logs ai.test_failed without the key", async () => {
    ai.result = {
      ok: false,
      error: { kind: "auth", message: "The provider didn't accept the key" },
      usage: [{ task: "ai.test.v1", inputTokens: 0, outputTokens: 0 }],
    };
    const res = await admin.post(`${url}/test`, form);
    expect(await res.json()).toEqual({
      ok: false,
      reason: "auth",
      message: "The provider didn't accept the key",
    });
    expect(deps.logs.find((l) => l.event === "ai.test_failed")).toMatchObject({
      level: "warn",
      reason: "auth",
    });
    expect(deps.rawLogs.join("\n")).not.toContain(KEY);
  });
});
