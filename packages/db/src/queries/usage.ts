import type { AiUsageDay, TaskId } from "@jobfilly/schema";
import { and, count, eq, sql, sum } from "drizzle-orm";
import { type Database, queryRows } from "../client";
import { aiUsage } from "../tables";

// Token usage per model call (MVP 1 F3.6, MVP 2 F1.5). Every call is a row, retries included.
// The server records it at one point, apps/server/src/ai-usage.ts, which every AI call goes
// through.

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

/** The workspace's model calls and tokens per day (UTC), newest first (F1.5). */
export async function usagePerDay(
  db: Database,
  workspaceId: string,
  options: { days?: number } = {},
): Promise<AiUsageDay[]> {
  const rows = await queryRows<{
    day: string;
    calls: number | string;
    input_tokens: number | string;
    output_tokens: number | string;
  }>(
    db,
    sql`select to_char(${aiUsage.at} at time zone 'UTC', 'YYYY-MM-DD') as day,
          count(*) as calls,
          coalesce(sum(${aiUsage.inputTokens}), 0) as input_tokens,
          coalesce(sum(${aiUsage.outputTokens}), 0) as output_tokens
        from ${aiUsage}
        where ${aiUsage.workspaceId} = ${workspaceId}
        group by 1
        order by 1 desc
        limit ${options.days ?? 30}`,
  );
  return rows.map((r) => ({
    day: r.day,
    calls: Number(r.calls),
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
  }));
}
