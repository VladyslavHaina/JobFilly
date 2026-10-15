import type { TaskId } from "@jobfilly/schema";
import { and, count, eq, sum } from "drizzle-orm";
import type { Database } from "../client";
import { aiUsage } from "../tables";

// Token usage per model call (F3.6). Every call is a row, retries included.

export async function recordAiUsage(
  db: Database,
  workspaceId: string,
  input: {
    scanId: string | null;
    task: TaskId;
    inputTokens: number;
    outputTokens: number;
    at?: Date;
  },
): Promise<void> {
  await db.insert(aiUsage).values({
    workspaceId,
    scanId: input.scanId,
    task: input.task,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    ...(input.at ? { at: input.at } : {}),
  });
}

export interface UsageTotal {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

/** The workspace's usage, across everything or for one scan run. */
export async function usageTotal(
  db: Database,
  workspaceId: string,
  scanId?: string,
): Promise<UsageTotal> {
  const [row] = await db
    .select({
      calls: count(),
      inputTokens: sum(aiUsage.inputTokens),
      outputTokens: sum(aiUsage.outputTokens),
    })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.workspaceId, workspaceId),
        scanId === undefined ? undefined : eq(aiUsage.scanId, scanId),
      ),
    );
  return {
    calls: row?.calls ?? 0,
    inputTokens: Number(row?.inputTokens ?? 0),
    outputTokens: Number(row?.outputTokens ?? 0),
  };
}
