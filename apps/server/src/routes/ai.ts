import { AI_PROVIDERS, aiProvider, aiReadBy } from "@jobfilly/ai";
import {
  getAiSettings,
  recordActivity,
  type StoredAiSettings,
  saveAiSettings,
  usagePerDay,
} from "@jobfilly/db";
import {
  type AiClientSettings,
  type AiProviderList,
  type AiSettingsInput,
  AiSettingsInputSchema,
  type AiSettingsPublic,
  type AiSettingsResponse,
  type AiTestResult,
  type AiUsageList,
  baseUrlHost,
} from "@jobfilly/schema";
import { type Context, Hono } from "hono";
import { requireFullAccess, requireRole, validJson, type WorkspaceEnv } from "../access";
import { aiClientFor } from "../ai-usage";
import type { AppDeps } from "../deps";
import { openAiKey, seal } from "../secrets";

// The workspace's AI provider settings (F3): the provider catalogue, read, save, test, and the
// model calls and tokens per day for everyone in the workspace (MVP 2 F1.5). The key is
// sealed before it is stored and never returned or logged (F3.3); the answer carries only whether
// one is stored and the one privacy line's provider and host (F3.2).
//
// A stored key only ever goes to the provider and base URL it was saved for: saving or testing
// another provider or base URL without typing a key never sends the old key anywhere new. Saving
// and testing need full access as well as admin: the provider reads the workspace's mail, so a
// pipeline-only admin can't choose where it goes.

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

/**
 * True when the WHATWG URL parser reads the base URL's scheme, user part or host differently from
 * the schema's own check (TBD-79): "https://ex%41mple.com" or "foo://a\\@b/" pass the schema but
 * would send requests, or a user part, somewhere the privacy line doesn't show. The port is left
 * out, as the parser drops a default one.
 */
function urlsDisagree(baseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return true;
  }
  return (
    !baseUrl.trim().toLowerCase().startsWith(`${url.protocol}//`) ||
    url.username !== "" ||
    url.password !== "" ||
    baseUrlHost(baseUrl).replace(/:\d*$/, "") !== url.hostname
  );
}

/** The form's problem in plain words, or null when it can be saved or tested. */
function problem(input: Parsed, keyKnown: boolean): string | null {
  const info = aiProvider(input.provider);
  if (info.baseUrlRequired && !input.baseUrl) return "Enter the base URL of the endpoint";
  if (input.baseUrl && urlsDisagree(input.baseUrl)) {
    return "Retype the base URL as scheme://host/path, with the host written out plainly";
  }
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
    .get("/usage", requireRole("viewer"), async (c) => {
      // Every model call is recorded where it is made (ai-usage.ts), retries included.
      const body: AiUsageList = { items: await usagePerDay(deps.db, c.get("workspaceId")) };
      return c.json(body);
    })
    .get("/providers", requireRole("viewer"), (c) => {
      const list: AiProviderList = { items: [...AI_PROVIDERS] };
      return c.json(list);
    })
    .put(
      "/",
      requireRole("admin"),
      requireFullAccess(),
      validJson(AiSettingsInputSchema),
      async (c) => {
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
        // No refs: never the provider's host or key in the log.
        await recordActivity(
          deps.db,
          c.get("workspaceId"),
          {
            kind: "ai.settings_changed",
            actor: { kind: "user", userId: c.get("user").id },
            targetUserId: null,
            refs: {},
          },
          deps.clock.now(),
        );
        const body: AiSettingsResponse = {
          settings: toPublic(saved, input.apiKey ?? keptKey),
        };
        return c.json(body);
      },
    )
    .post(
      "/test",
      requireRole("admin"),
      requireFullAccess(),
      validJson(AiSettingsInputSchema),
      async (c) => {
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
      },
    );
}
