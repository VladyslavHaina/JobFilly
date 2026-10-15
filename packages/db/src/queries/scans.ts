import {
  EMPTY_SCAN_COUNTS,
  type Scan,
  type ScanCounts,
  type ScanKind,
  type StopReason,
} from "@jobfilly/schema";
import { and, desc, eq, ne } from "drizzle-orm";
import type { Database } from "../client";
import { scans } from "../tables";
import { enqueueJob } from "./jobs";

// Scan runs. At most one is queued or running per workspace (a partial unique index). Once a
// scan is stopped nothing moves it again, so a cancel can't be overwritten by a late progress
// update from the worker.

/** The queue job type that runs a scan; its payload is a ScanRunPayload. */
export const SCAN_RUN_JOB = "scan.run";

type ScanRow = typeof scans.$inferSelect;

function toScan(row: ScanRow): Scan {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    kind: row.kind,
    status: row.status,
    stopReason: row.stopReason,
    counts: row.counts,
    calls: row.calls,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    startedBy: row.startedBy,
    startedAt: row.startedAt.toISOString(),
    stoppedAt: row.stoppedAt?.toISOString() ?? null,
  };
}

/**
 * Creates a queued scan; refused with "running" while another is queued or running. With
 * `enqueue`, the 'scan.run' job is added in the same transaction, so a queued scan always has a
 * job to run it.
 */
export async function createScan(
  db: Database,
  workspaceId: string,
  input: { kind: ScanKind; startedBy: string; at?: Date; enqueue?: boolean },
): Promise<{ ok: true; scan: Scan } | { ok: false; reason: "running" }> {
  const at = input.at ?? new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(scans)
      .values({
        workspaceId,
        kind: input.kind,
        status: "queued",
        counts: EMPTY_SCAN_COUNTS,
        startedBy: input.startedBy,
        startedAt: at,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) return { ok: false as const, reason: "running" as const };
    if (input.enqueue) {
      await enqueueJob(tx, workspaceId, {
        type: SCAN_RUN_JOB,
        payload: { scanId: row.id, workspaceId },
        now: at,
      });
    }
    return { ok: true as const, scan: toScan(row) };
  });
}

export async function getScan(
  db: Database,
  workspaceId: string,
  scanId: string,
): Promise<Scan | null> {
  const [row] = await db
    .select()
    .from(scans)
    .where(and(eq(scans.workspaceId, workspaceId), eq(scans.id, scanId)));
  return row ? toScan(row) : null;
}

/** The most recently started scan (of one kind, if given), or null. */
export async function getLatestScan(
  db: Database,
  workspaceId: string,
  kind?: ScanKind,
): Promise<Scan | null> {
  const [row] = await db
    .select()
    .from(scans)
    .where(and(eq(scans.workspaceId, workspaceId), kind ? eq(scans.kind, kind) : undefined))
    .orderBy(desc(scans.startedAt), desc(scans.id))
    .limit(1);
  return row ? toScan(row) : null;
}

/**
 * Records the worker's progress. A no-op (false) once the scan is stopped, so it never undoes a
 * cancel or a stop.
 */
export async function updateScanProgress(
  db: Database,
  workspaceId: string,
  scanId: string,
  progress: {
    status: "queued" | "running";
    counts: ScanCounts;
    calls: number;
    inputTokens: number;
    outputTokens: number;
  },
): Promise<boolean> {
  const rows = await db
    .update(scans)
    .set(progress)
    .where(
      and(eq(scans.workspaceId, workspaceId), eq(scans.id, scanId), ne(scans.status, "stopped")),
    )
    .returning({ id: scans.id });
  return rows.length > 0;
}

/** Stops the scan with its reason; false when it had already stopped (the first stop wins). */
export async function stopScan(
  db: Database,
  workspaceId: string,
  scanId: string,
  stopReason: StopReason,
  at: Date,
): Promise<boolean> {
  const rows = await db
    .update(scans)
    .set({ status: "stopped", stopReason, stoppedAt: at })
    .where(
      and(eq(scans.workspaceId, workspaceId), eq(scans.id, scanId), ne(scans.status, "stopped")),
    )
    .returning({ id: scans.id });
  return rows.length > 0;
}
