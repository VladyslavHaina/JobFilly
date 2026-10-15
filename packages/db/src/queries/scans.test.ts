import { EMPTY_SCAN_COUNTS, type StopCause, type StopReason } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import { claimJob } from "./jobs";
import {
  createScan,
  getLatestScan,
  getScan,
  SCAN_RUN_JOB,
  stopScan,
  updateScanProgress,
} from "./scans";

let conn: DatabaseConnection;
let workspaceId: string;
let otherWorkspaceId: string;
let userId: string;
const t0 = new Date("2026-10-01T10:00:00Z");

beforeEach(async () => {
  conn = await openTestDatabase();
  const r = await registerAccount(conn.db, {
    name: "Maria",
    email: "maria@inbox.example",
    passwordHash: "h",
    workspaceName: "Maria's workspace",
  });
  const o = await registerAccount(conn.db, {
    name: "Tom",
    email: "tom@inbox.example",
    passwordHash: "h",
    workspaceName: "Tom's workspace",
  });
  if (!r.ok || !o.ok) throw new Error("expected ok");
  workspaceId = r.workspaceId;
  otherWorkspaceId = o.workspaceId;
  userId = r.user.id;
});
afterEach(() => conn.close());

const progress = {
  status: "running" as const,
  counts: { ...EMPTY_SCAN_COUNTS, handledWithoutAi: 300, likely: 260, analyzed: 20 },
  calls: 2,
  inputTokens: 1000,
  outputTokens: 100,
};

describe("scans", () => {
  it("allows one queued or running scan per workspace", async () => {
    const first = await createScan(conn.db, workspaceId, {
      kind: "first",
      startedBy: userId,
      at: t0,
    });
    if (!first.ok) throw new Error("expected ok");
    expect(first.scan).toMatchObject({
      workspaceId,
      kind: "first",
      status: "queued",
      stopReason: null,
      stopCause: null,
      counts: EMPTY_SCAN_COUNTS,
      calls: 0,
      startedBy: userId,
      startedAt: t0.toISOString(),
      stoppedAt: null,
    });
    expect(
      await createScan(conn.db, workspaceId, { kind: "analyze_rest", startedBy: userId }),
    ).toEqual({ ok: false, reason: "running" });
    expect(
      (await createScan(conn.db, otherWorkspaceId, { kind: "first", startedBy: userId })).ok,
    ).toBe(true);
    await stopScan(conn.db, workspaceId, first.scan.id, "confident", t0);
    expect(
      (await createScan(conn.db, workspaceId, { kind: "analyze_rest", startedBy: userId })).ok,
    ).toBe(true);
  });

  it("enqueues the scan.run job in the same transaction when asked", async () => {
    const created = await createScan(conn.db, workspaceId, {
      kind: "first",
      startedBy: userId,
      at: t0,
      enqueue: true,
    });
    if (!created.ok) throw new Error("expected ok");
    const job = await claimJob(conn.db, {
      owner: "app-a",
      types: [SCAN_RUN_JOB],
      now: t0,
      leaseMs: 1000,
    });
    expect(job?.payload).toEqual({ scanId: created.scan.id, workspaceId });
    expect(
      await createScan(conn.db, workspaceId, { kind: "first", startedBy: userId, enqueue: true }),
    ).toEqual({ ok: false, reason: "running" });
    expect(
      await claimJob(conn.db, { owner: "app-a", types: [SCAN_RUN_JOB], now: t0, leaseMs: 1000 }),
    ).toBeNull();
  });

  it("records progress until stopped, and the first stop wins", async () => {
    const created = await createScan(conn.db, workspaceId, {
      kind: "first",
      startedBy: userId,
      at: t0,
    });
    if (!created.ok) throw new Error("expected ok");
    const id = created.scan.id;
    expect(await updateScanProgress(conn.db, workspaceId, id, progress)).toBe(true);
    expect(await getScan(conn.db, workspaceId, id)).toMatchObject(progress);
    const stoppedAt = new Date(t0.getTime() + 60_000);
    expect(await stopScan(conn.db, workspaceId, id, "cancelled", stoppedAt)).toBe(true);
    expect(await stopScan(conn.db, workspaceId, id, "done", stoppedAt)).toBe(false);
    expect(await updateScanProgress(conn.db, workspaceId, id, { ...progress, calls: 99 })).toBe(
      false,
    );
    expect(await getScan(conn.db, workspaceId, id)).toMatchObject({
      status: "stopped",
      stopReason: "cancelled",
      calls: 2,
      stoppedAt: stoppedAt.toISOString(),
    });
  });

  it("keeps what a failed run ran into, and no cause for any other stop", async () => {
    const stopWith = async (reason: StopReason, cause?: StopCause) => {
      const created = await createScan(conn.db, workspaceId, { kind: "first", startedBy: userId });
      if (!created.ok) throw new Error("expected ok");
      expect(await stopScan(conn.db, workspaceId, created.scan.id, reason, t0, cause)).toBe(true);
      return getScan(conn.db, workspaceId, created.scan.id);
    };
    expect(await stopWith("failed", "mailbox")).toMatchObject({
      stopReason: "failed",
      stopCause: "mailbox",
    });
    expect(await stopWith("failed", "ai")).toMatchObject({ stopCause: "ai" });
    expect(await stopWith("failed", "internal")).toMatchObject({ stopCause: "internal" });
    expect(await stopWith("failed")).toMatchObject({ stopReason: "failed", stopCause: null });
    expect(await stopWith("cancelled", "ai")).toMatchObject({
      stopReason: "cancelled",
      stopCause: null,
    });
  });

  it("never reads or writes another workspace's scan", async () => {
    const created = await createScan(conn.db, workspaceId, { kind: "first", startedBy: userId });
    if (!created.ok) throw new Error("expected ok");
    expect(await getScan(conn.db, otherWorkspaceId, created.scan.id)).toBeNull();
    expect(await updateScanProgress(conn.db, otherWorkspaceId, created.scan.id, progress)).toBe(
      false,
    );
    expect(await stopScan(conn.db, otherWorkspaceId, created.scan.id, "done", t0)).toBe(false);
  });

  it("finds the latest scan, of a kind if asked", async () => {
    expect(await getLatestScan(conn.db, workspaceId)).toBeNull();
    const first = await createScan(conn.db, workspaceId, {
      kind: "first",
      startedBy: userId,
      at: t0,
    });
    if (!first.ok) throw new Error("expected ok");
    await stopScan(conn.db, workspaceId, first.scan.id, "confident", t0);
    const rest = await createScan(conn.db, workspaceId, {
      kind: "analyze_rest",
      startedBy: userId,
      at: new Date(t0.getTime() + 1000),
    });
    if (!rest.ok) throw new Error("expected ok");
    expect((await getLatestScan(conn.db, workspaceId))?.id).toBe(rest.scan.id);
    expect((await getLatestScan(conn.db, workspaceId, "first"))?.id).toBe(first.scan.id);
    expect(await getLatestScan(conn.db, otherWorkspaceId)).toBeNull();
  });
});
