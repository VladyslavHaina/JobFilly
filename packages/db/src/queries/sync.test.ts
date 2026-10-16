import { NEVER_SYNCED } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import { createMailbox, deleteMailbox, getMailboxConnection } from "./mailboxes";
import { createScan, stopScan } from "./scans";
import {
  getMailboxSyncStatus,
  getSyncState,
  listMailboxesToSync,
  recordSyncFailure,
  recordSyncSuccess,
} from "./sync";

// The continuous sync's cursor, status and back-off per mailbox and folder (F1.1, F1.4).

let conn: DatabaseConnection;
const ws: Record<"a" | "b", { id: string; user: string; mailbox: string }> = {
  a: { id: "", user: "", mailbox: "" },
  b: { id: "", user: "", mailbox: "" },
};

const T0 = new Date("2026-10-15T10:42:00Z");
const later = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

beforeEach(async () => {
  conn = await openTestDatabase();
  for (const key of ["a", "b"] as const) {
    const r = await registerAccount(conn.db, {
      name: key,
      email: `${key}@x.example`,
      passwordHash: "h",
      workspaceName: key,
    });
    if (!r.ok) throw new Error("expected ok");
    const m = await createMailbox(conn.db, r.workspaceId, {
      address: `${key}@x.example`,
      host: "imap.x.example",
      port: 993,
      tlsMode: "tls",
      username: key,
      secretCiphertext: "sealed",
      sentFolderPath: "Sent",
    });
    if (!m.ok) throw new Error("expected ok");
    ws[key] = { id: r.workspaceId, user: r.user.id, mailbox: m.mailboxId };
  }
});
afterEach(() => conn.close());

const status = async (key: "a" | "b") => (await getMailboxConnection(conn.db, ws[key].id))?.status;

describe("the sync cursor", () => {
  it("is empty before the first sync, then moves with each sync that worked", async () => {
    const { id, mailbox } = ws.a;
    expect(await getSyncState(conn.db, id, mailbox, "INBOX")).toBeNull();
    expect(await getMailboxSyncStatus(conn.db, id, mailbox)).toEqual(NEVER_SYNCED);

    expect(
      await recordSyncSuccess(conn.db, id, mailbox, {
        folderPath: "INBOX",
        uidValidity: 7,
        lastUid: 12,
        at: T0,
      }),
    ).toBe(true);
    await recordSyncSuccess(conn.db, id, mailbox, {
      folderPath: "INBOX",
      uidValidity: 8,
      lastUid: 3,
      at: later(15),
    });
    expect(await getSyncState(conn.db, id, mailbox, "INBOX")).toEqual({
      uidValidity: 8,
      lastUid: 3,
      lastSyncedAt: later(15),
      failingSince: null,
      lastError: null,
      lastErrorReason: null,
      failures: 0,
      nextAttemptAt: null,
    });
    expect(await getMailboxSyncStatus(conn.db, id, mailbox)).toEqual({
      state: "ok",
      lastSyncedAt: later(15).toISOString(),
      failingSince: null,
      reason: null,
      message: null,
    });
  });

  it("is kept per workspace: another workspace neither reads nor writes it", async () => {
    await recordSyncSuccess(conn.db, ws.a.id, ws.a.mailbox, {
      folderPath: "INBOX",
      uidValidity: 7,
      lastUid: 12,
      at: T0,
    });
    expect(await getSyncState(conn.db, ws.b.id, ws.a.mailbox, "INBOX")).toBeNull();
    expect(await getMailboxSyncStatus(conn.db, ws.b.id, ws.a.mailbox)).toEqual(NEVER_SYNCED);
    expect(
      await recordSyncSuccess(conn.db, ws.b.id, ws.a.mailbox, {
        folderPath: "INBOX",
        uidValidity: 1,
        lastUid: 1,
        at: T0,
      }),
    ).toBe(false);
    expect(
      await recordSyncFailure(conn.db, ws.b.id, ws.a.mailbox, {
        folderPath: "INBOX",
        failures: 1,
        nextAttemptAt: later(15),
        reason: "error",
        message: "x",
        at: T0,
      }),
    ).toBe(false);
    expect(await getSyncState(conn.db, ws.a.id, ws.a.mailbox, "INBOX")).toMatchObject({
      uidValidity: 7,
      lastUid: 12,
      failures: 0,
    });
  });

  it("is gone with its mailbox, and a disconnected mailbox records nothing", async () => {
    const { id, mailbox } = ws.a;
    await recordSyncSuccess(conn.db, id, mailbox, {
      folderPath: "INBOX",
      uidValidity: 7,
      lastUid: 12,
      at: T0,
    });
    await deleteMailbox(conn.db, id, mailbox);
    expect(await getSyncState(conn.db, id, mailbox, "INBOX")).toBeNull();
    expect(
      await recordSyncSuccess(conn.db, id, mailbox, {
        folderPath: "INBOX",
        uidValidity: 7,
        lastUid: 13,
        at: T0,
      }),
    ).toBe(false);
  });
});

describe("a failing sync (F1.4)", () => {
  it("keeps the cursor, counts failures, keeps 'failing since' and backs off", async () => {
    const { id, mailbox } = ws.a;
    await recordSyncSuccess(conn.db, id, mailbox, {
      folderPath: "INBOX",
      uidValidity: 7,
      lastUid: 12,
      at: T0,
    });
    await recordSyncFailure(conn.db, id, mailbox, {
      folderPath: "INBOX",
      failures: 1,
      nextAttemptAt: later(30),
      reason: "unreachable",
      message: "Couldn't reach the mail server",
      at: later(15),
    });
    await recordSyncFailure(conn.db, id, mailbox, {
      folderPath: "INBOX",
      failures: 2,
      nextAttemptAt: later(90),
      reason: "wrong_password",
      message: "The mail server didn't accept the user name or password.",
      at: later(30),
    });
    expect(await getSyncState(conn.db, id, mailbox, "INBOX")).toEqual({
      uidValidity: 7,
      lastUid: 12,
      lastSyncedAt: T0,
      failingSince: later(15),
      lastError: "The mail server didn't accept the user name or password.",
      lastErrorReason: "wrong_password",
      failures: 2,
      nextAttemptAt: later(90),
    });
    expect(await getMailboxSyncStatus(conn.db, id, mailbox)).toEqual({
      state: "failing",
      lastSyncedAt: T0.toISOString(),
      failingSince: later(15).toISOString(),
      reason: "wrong_password",
      message: "The mail server didn't accept the user name or password.",
    });
    expect(await status("a")).toBe("failing");
    expect(await status("b")).toBe("connected");

    // The next sync that works clears it all.
    await recordSyncSuccess(conn.db, id, mailbox, {
      folderPath: "INBOX",
      uidValidity: 7,
      lastUid: 14,
      at: later(90),
    });
    expect(await getSyncState(conn.db, id, mailbox, "INBOX")).toMatchObject({
      lastUid: 14,
      failingSince: null,
      lastError: null,
      lastErrorReason: null,
      failures: 0,
      nextAttemptAt: null,
    });
    expect(await status("a")).toBe("connected");
  });

  it("fails since the first attempt when no sync ever worked", async () => {
    const { id, mailbox } = ws.a;
    await recordSyncFailure(conn.db, id, mailbox, {
      folderPath: "INBOX",
      failures: 1,
      nextAttemptAt: later(15),
      reason: "unreachable",
      message: "Couldn't reach the mail server",
      at: T0,
    });
    expect(await getSyncState(conn.db, id, mailbox, "INBOX")).toMatchObject({
      uidValidity: null,
      lastUid: null,
      failingSince: T0,
    });
    expect(await getMailboxSyncStatus(conn.db, id, mailbox)).toEqual({
      state: "failing",
      lastSyncedAt: null,
      failingSince: T0.toISOString(),
      reason: "unreachable",
      message: "Couldn't reach the mail server",
    });
  });
});

describe("listMailboxesToSync", () => {
  async function stoppedFirstScan(key: "a" | "b") {
    const created = await createScan(conn.db, ws[key].id, {
      kind: "first",
      startedBy: ws[key].user,
      at: T0,
    });
    if (!created.ok) throw new Error("expected ok");
    return created.scan.id;
  }

  it("lists only the mailboxes whose first scan stopped, with their back-off", async () => {
    expect(await listMailboxesToSync(conn.db, "INBOX")).toEqual([]);
    const scanA = await stoppedFirstScan("a");
    await stoppedFirstScan("b");
    // b's first scan still runs.
    expect(await listMailboxesToSync(conn.db, "INBOX")).toEqual([]);
    await stopScan(conn.db, ws.a.id, scanA, "done", T0);
    expect(await listMailboxesToSync(conn.db, "INBOX")).toEqual([
      { workspaceId: ws.a.id, mailboxId: ws.a.mailbox, nextAttemptAt: null },
    ]);
    await recordSyncFailure(conn.db, ws.a.id, ws.a.mailbox, {
      folderPath: "INBOX",
      failures: 1,
      nextAttemptAt: later(30),
      reason: "error",
      message: "x",
      at: T0,
    });
    expect(await listMailboxesToSync(conn.db, "INBOX")).toEqual([
      { workspaceId: ws.a.id, mailboxId: ws.a.mailbox, nextAttemptAt: later(30) },
    ]);
  });
});
