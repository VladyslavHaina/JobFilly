import type { AiModels, AiProviderId } from "@jobfilly/schema";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../client";
import { aiSettings } from "../tables";

// The workspace's AI settings. The key is passed and returned sealed only; sealing, input checks
// and what the API returns stay with the routes.
//
// Rolling updates: an MVP 1 replica still serving next to MVP 2 ones writes only its four models
// (classify, extract, prefs, intake). Saving merges the models into the stored ones, so such a save
// can't drop the newer tasks' models, and reading fills a task model that is still missing (a row
// an old replica inserted) from the extract model, as migration 0001_mvp2 does.

export interface StoredAiSettings {
  provider: AiProviderId;
  baseUrl: string | null;
  models: AiModels;
  keyCiphertext: string | null;
  budgetPerRun: number;
}

/**
 * Saves the settings (insert or update). `keyCiphertext: null` keeps the key already stored, so
 * a form that never shows the key again can be saved without retyping it.
 */
export async function saveAiSettings(
  db: Database,
  workspaceId: string,
  input: StoredAiSettings,
): Promise<void> {
  await db
    .insert(aiSettings)
    .values({ workspaceId, ...input })
    .onConflictDoUpdate({
      target: aiSettings.workspaceId,
      set: {
        provider: input.provider,
        baseUrl: input.baseUrl,
        // jsonb `||`: keys of the saved models win, keys only the stored row has are kept.
        models: sql`${aiSettings.models} || excluded.models`,
        budgetPerRun: input.budgetPerRun,
        keyCiphertext:
          input.keyCiphertext === null ? sql`${aiSettings.keyCiphertext}` : input.keyCiphertext,
        updatedAt: sql`now()`,
      },
    });
}

export async function getAiSettings(
  db: Database,
  workspaceId: string,
): Promise<StoredAiSettings | null> {
  const [row] = await db
    .select({
      provider: aiSettings.provider,
      baseUrl: aiSettings.baseUrl,
      models: aiSettings.models,
      keyCiphertext: aiSettings.keyCiphertext,
      budgetPerRun: aiSettings.budgetPerRun,
    })
    .from(aiSettings)
    .where(eq(aiSettings.workspaceId, workspaceId));
  return row ? { ...row, models: withEveryModel(row.models) } : null;
}

/** The tasks MVP 1 replicas don't know, filled like migration 0001_mvp2 fills them. */
const LATER_TASKS = ["cv", "match", "draft", "assistant"] as const;

function withEveryModel(stored: AiModels): AiModels {
  const models = { ...stored };
  for (const task of LATER_TASKS) models[task] ??= stored.extract;
  return models;
}
