import { AI_PROVIDERS, aiProvider, aiReadBy } from "@jobfilly/ai";
import { getAiSettings, type StoredAiSettings, saveAiSettings } from "@jobfilly/db";
import {
  type AiClientSettings,
  type AiProviderList,
  type AiSettingsInput,
  AiSettingsInputSchema,
  type AiSettingsPublic,
  type AiSettingsResponse,
  type AiTestResult,
} from "@jobfilly/schema";
import { type Context, Hono } from "hono";
import { requireRole, validJson, type WorkspaceEnv } from "../access";
import { aiClientFor } from "../ai-usage";
import type { AppDeps } from "../deps";
import { openAiKey, seal } from "../secrets";

// The workspace's AI provider settings (F3): the provider catalogue, read, save, test. The key is
// sealed before it is stored and never returned or logged (F3.3); the answer carries only whether
// one is stored and the one privacy line's provider and host (F3.2).
//
// A stored key only ever goes to the provider and base URL it was saved for: saving or testing
// another provider or base URL without typing a key never sends the old key anywhere new.

type Parsed = ReturnType<typeof AiSettingsInputSchema.parse>;

/** A stored key that is the empty string means "no key" (saveAiSettings keeps a null key). */
const NO_KEY = "";

function toPublic(s: StoredAiSettings, key: string | null): AiSettingsPublic {
  return {
    provider: s.provider,
    baseUrl: s.baseUrl,
    models: s.models,
    budgetPerRun: s.budgetPerRun,
    hasKey: key !== null,
    readBy: aiReadBy(s.provider, s.baseUrl),
  };
}

const sameEndpoint = (a: { provider: string; baseUrl: string | null }, b: AiSettingsInput) =>
  a.provider === b.provider && (a.baseUrl ?? null) === (b.baseUrl ?? null);

/** The form's problem in plain words, or null when it can be saved or tested. */
function problem(input: Parsed, keyKnown: boolean): string | null {
  const info = aiProvider(input.provider);
  if (info.baseUrlRequired && !input.baseUrl) return "Enter the base URL of the endpoint";
  if (info.keyRequired && !input.apiKey && !keyKnown) return `Enter the API key for ${info.label}`;
  return null;
}

export function aiRoutes(deps: AppDeps) {
  const key = deps.config.secretKey;
  /** The stored key in clear, or null when there is none (or it was sealed under another key). */
  const openKey = (stored: StoredAiSettings | null): string | null => {
    try {
      return openAiKey(key, stored?.keyCiphertext);
    } catch {
      return null;
    }
  };

  /** The stored settings, if the form's provider and base URL are the ones they were saved for. */
  async function storedFor(c: Context<WorkspaceEnv>, input: AiSettingsInput) {
    const stored = await getAiSettings(deps.db, c.get("workspaceId"));
    return stored && sameEndpoint(stored, input) ? stored : null;
  }

  return new Hono<WorkspaceEnv>()
    .get("/", requireRole("viewer"), async (c) => {
      const stored = await getAiSettings(deps.db, c.get("workspaceId"));
      const body: AiSettingsResponse = {
        settings: stored ? toPublic(stored, openKey(stored)) : null,
      };
      return c.json(body);
    })
    .get("/providers", requireRole("viewer"), (c) => {
      const list: AiProviderList = { items: [...AI_PROVIDERS] };
      return c.json(list);
    })
    .put("/", requireRole("admin"), validJson(AiSettingsInputSchema), async (c) => {
      const input = c.req.valid("json");
      const same = await storedFor(c, input);
      const keptKey = openKey(same);
      const invalid = problem(input, keptKey !== null);
      if (invalid) return c.json({ error: "invalid", message: invalid }, 400);
      const saved: StoredAiSettings = {
        provider: input.provider,
        baseUrl: input.baseUrl,
        models: input.models,
        budgetPerRun: input.budgetPerRun,
        // A new key replaces the old; no key keeps it for the same endpoint (null), and clears
        // it for another one.
        keyCiphertext: input.apiKey ? seal(key, input.apiKey) : same ? null : seal(key, NO_KEY),
      };
      await saveAiSettings(deps.db, c.get("workspaceId"), saved);
      c.get("log").info("ai.settings_saved", { provider: input.provider });
      const body: AiSettingsResponse = {
        settings: toPublic(saved, input.apiKey ?? keptKey),
      };
      return c.json(body);
    })
    .post("/test", requireRole("admin"), validJson(AiSettingsInputSchema), async (c) => {
      const workspaceId = c.get("workspaceId");
      const input = c.req.valid("json");
      const apiKey = input.apiKey ?? openKey(await storedFor(c, input));
      const invalid = problem(input, apiKey !== null);
      if (invalid) return c.json({ error: "invalid", message: invalid }, 400);
      const settings: AiClientSettings = {
        provider: input.provider,
        baseUrl: input.baseUrl,
        models: input.models,
        apiKey,
      };
      const result = await aiClientFor(deps, workspaceId, settings).test();
      let body: AiTestResult = { ok: true };
      if (!result.ok) {
        const reason = result.error.kind === "not_retried" ? "invalid_output" : result.error.kind;
        c.get("log").warn("ai.test_failed", { reason });
        body = { ok: false, reason, message: result.error.message };
      }
      return c.json(body);
    });
}
