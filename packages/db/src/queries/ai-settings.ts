import type { AiModels, AiProviderId } from "@jobfilly/schema";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../client";
import { aiSettings } from "../tables";

// The workspace's AI settings. The key is passed and returned sealed only; sealing, input checks
// and what the API returns stay with the routes.

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
        models: input.models,
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
  return row ?? null;
}
