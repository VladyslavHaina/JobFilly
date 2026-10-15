import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
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
});
