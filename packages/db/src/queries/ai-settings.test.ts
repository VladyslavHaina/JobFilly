import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { aiSettings } from "../tables";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import { getAiSettings, saveAiSettings } from "./ai-settings";

let conn: DatabaseConnection;
let workspaceId: string;

beforeEach(async () => {
  conn = await openTestDatabase();
  const r = await registerAccount(conn.db, {
    name: "Maria",
    email: "maria@inbox.example",
    passwordHash: "h",
    workspaceName: "Maria's workspace",
  });
  if (!r.ok) throw new Error("expected ok");
  workspaceId = r.workspaceId;
});
afterEach(() => conn.close());

const models = {
  classify: "m1",
  extract: "m2",
  prefs: "m3",
  intake: "m4",
  cv: "m5",
  match: "m6",
  draft: "m7",
  assistant: "m8",
};

describe("AI settings", () => {
  it("is null until saved, then upserts", async () => {
    expect(await getAiSettings(conn.db, workspaceId)).toBeNull();
    const settings = {
      provider: "openai-compatible" as const,
      baseUrl: "http://fake-ai:8080/v1",
      models,
      keyCiphertext: "sealed-1",
      budgetPerRun: 300,
    };
    await saveAiSettings(conn.db, workspaceId, settings);
    expect(await getAiSettings(conn.db, workspaceId)).toEqual(settings);
    await saveAiSettings(conn.db, workspaceId, {
      ...settings,
      budgetPerRun: 5,
      keyCiphertext: "sealed-2",
    });
    expect(await getAiSettings(conn.db, workspaceId)).toEqual({
      ...settings,
      budgetPerRun: 5,
      keyCiphertext: "sealed-2",
    });
  });

  it("keeps the stored key when saved with keyCiphertext null", async () => {
    await saveAiSettings(conn.db, workspaceId, {
      provider: "anthropic",
      baseUrl: null,
      models,
      keyCiphertext: "sealed-1",
      budgetPerRun: 300,
    });
    await saveAiSettings(conn.db, workspaceId, {
      provider: "anthropic",
      baseUrl: null,
      models: { ...models, classify: "m9" },
      keyCiphertext: null,
      budgetPerRun: 10,
    });
    expect(await getAiSettings(conn.db, workspaceId)).toMatchObject({
      keyCiphertext: "sealed-1",
      budgetPerRun: 10,
      models: { classify: "m9" },
    });
  });

  // An MVP 1 replica still serving during a rolling update knows only these four tasks.
  const mvp1Models = { classify: "c1", extract: "e1", prefs: "p1", intake: "i1" };

  it("reads all eight models from a row an MVP 1 replica inserted", async () => {
    await saveAiSettings(conn.db, workspaceId, {
      provider: "anthropic",
      baseUrl: null,
      models: mvp1Models as typeof models,
      keyCiphertext: null,
      budgetPerRun: 300,
    });
    expect((await getAiSettings(conn.db, workspaceId))?.models).toEqual({
      ...mvp1Models,
      cv: "e1",
      match: "e1",
      draft: "e1",
      assistant: "e1",
    });
  });

  it("keeps the newer tasks' models when an MVP 1 replica saves", async () => {
    const settings = {
      provider: "anthropic" as const,
      baseUrl: null,
      models,
      keyCiphertext: null,
      budgetPerRun: 300,
    };
    await saveAiSettings(conn.db, workspaceId, settings);
    await saveAiSettings(conn.db, workspaceId, {
      ...settings,
      models: mvp1Models as typeof models,
    });
    const [row] = await conn.db
      .select({ models: aiSettings.models })
      .from(aiSettings)
      .where(eq(aiSettings.workspaceId, workspaceId));
    expect(row?.models).toEqual({ ...models, ...mvp1Models });
    expect((await getAiSettings(conn.db, workspaceId))?.models).toEqual({
      ...models,
      ...mvp1Models,
    });
  });
});
