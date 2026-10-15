import { type MailboxSyncStatus, NEVER_SYNCED } from "@jobfilly/schema";
import { and, eq, exists, sql } from "drizzle-orm";
import type { Database } from "../client";
import { mailboxes, mailboxSync, scans } from "../tables";

// The continuous sync's state per mailbox and folder (mailbox_sync, F1): the folder's UIDVALIDITY
// and the last UID read (the cursor), when it last worked, since when it fails, and the
// back-off's next attempt (F1.4). One sync per mailbox runs at a time (the mail.sync dedupe key,
// F1.2), so these writes never race each other. Each function takes a workspace id, except
// listMailboxesToSync, the scheduler's listing across workspaces (ARCHITECTURE › Workspaces).

export interface SyncState {
  uidValidity: number | null;
  lastUid: number | null;
  lastSyncedAt: Date | null;
  failingSince: Date | null;
  /** Plain words, never the server's own text. */
  lastError: string | null;
  /** Failed syncs in a row; 0 after one that worked. */
  failures: number;
  nextAttemptAt: Date | null;
}

const ofMailbox = (workspaceId: string, mailboxId: string) =>
  and(eq(mailboxSync.workspaceId, workspaceId), eq(mailboxSync.mailboxId, mailboxId));

/** The folder's sync state, or null before its first sync. */
export async function getSyncState(
  db: Database,
  workspaceId: string,
  mailboxId: string,
  folderPath: string,
): Promise<SyncState | null> {
  const [row] = await db
    .select({
      uidValidity: mailboxSync.uidValidity,
      lastUid: mailboxSync.lastUid,
      lastSyncedAt: mailboxSync.lastSyncedAt,
      failingSince: mailboxSync.failingSince,
      lastError: mailboxSync.lastError,
      failures: mailboxSync.failures,
      nextAttemptAt: mailboxSync.nextAttemptAt,
    })
    .from(mailboxSync)
    .where(and(ofMailbox(workspaceId, mailboxId), eq(mailboxSync.folderPath, folderPath)));
  return row ?? null;
}

/** Whether the mailbox is still the workspace's (it may have been disconnected meanwhile). */
async function mailboxOf(db: Database, workspaceId: string, mailboxId: string) {
  const [row] = await db
    .select({ id: mailboxes.id })
    .from(mailboxes)
    .where(and(eq(mailboxes.workspaceId, workspaceId), eq(mailboxes.id, mailboxId)));
  return row !== undefined;
}

/**
 * A sync that worked: the cursor moves to `uidValidity` and `lastUid`, the failure count and the
 * back-off are cleared, and the mailbox is connected again. False when the mailbox is gone.
 */
export async function recordSyncSuccess(
  db: Database,
  workspaceId: string,
  mailboxId: string,
  input: { folderPath: string; uidValidity: number; lastUid: number; at: Date },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await mailboxOf(tx, workspaceId, mailboxId))) return false;
    const values = {
      uidValidity: input.uidValidity,
      lastUid: input.lastUid,
      lastSyncedAt: input.at,
      failingSince: null,
      lastError: null,
      failures: 0,
      nextAttemptAt: null,
      updatedAt: input.at,
    };
    await tx
      .insert(mailboxSync)
      .values({ workspaceId, mailboxId, folderPath: input.folderPath, ...values })
      .onConflictDoUpdate({ target: [mailboxSync.mailboxId, mailboxSync.folderPath], set: values });
    await tx
      .update(mailboxes)
      .set({ status: "connected" })
      .where(and(eq(mailboxes.workspaceId, workspaceId), eq(mailboxes.id, mailboxId)));
    return true;
  });
}

/**
 * A sync that failed (F1.4): `failures` in a row now, the next attempt at `nextAttemptAt`, the
 * reason in plain words, and failing since the first failure in a row (kept from an earlier
 * one). The cursor stays. The mailbox shows as failing. False when the mailbox is gone.
 */
export async function recordSyncFailure(
  db: Database,
  workspaceId: string,
  mailboxId: string,
  input: {
    folderPath: string;
    failures: number;
    nextAttemptAt: Date;
    message: string;
    at: Date;
  },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await mailboxOf(tx, workspaceId, mailboxId))) return false;
    const values = {
      failures: input.failures,
      nextAttemptAt: input.nextAttemptAt,
      lastError: input.message,
      updatedAt: input.at,
    };
    await tx
      .insert(mailboxSync)
      .values({
        workspaceId,
        mailboxId,
        folderPath: input.folderPath,
        failingSince: input.at,
        ...values,
      })
      .onConflictDoUpdate({
        target: [mailboxSync.mailboxId, mailboxSync.folderPath],
        set: { ...values, failingSince: sql`coalesce(${mailboxSync.failingSince}, ${input.at})` },
      });
    await tx
      .update(mailboxes)
      .set({ status: "failing" })
      .where(and(eq(mailboxes.workspaceId, workspaceId), eq(mailboxes.id, mailboxId)));
    return true;
  });
}

/**
 * The mailbox's sync status as the API shows it (F1.4), over its folders: failing since the
 * earliest failure while any folder fails, else synced at the latest success, else never.
 */
export async function getMailboxSyncStatus(
  db: Database,
  workspaceId: string,
  mailboxId: string,
): Promise<MailboxSyncStatus> {
  const rows = await db
    .select({
      lastSyncedAt: mailboxSync.lastSyncedAt,
      failingSince: mailboxSync.failingSince,
      lastError: mailboxSync.lastError,
    })
    .from(mailboxSync)
    .where(ofMailbox(workspaceId, mailboxId));
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  const latest = (dates: (Date | null)[]) =>
    dates.reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null);
  const lastSyncedAt = latest(rows.map((r) => r.lastSyncedAt));
  const failing = rows
    .filter((r) => r.failingSince !== null)
    .sort((a, b) => (a.failingSince?.getTime() ?? 0) - (b.failingSince?.getTime() ?? 0));
  const first = failing[0];
  if (first) {
    return {
      state: "failing",
      lastSyncedAt: iso(lastSyncedAt),
      failingSince: iso(first.failingSince),
      message: first.lastError,
    };
  }
  if (lastSyncedAt) {
    return { state: "ok", lastSyncedAt: iso(lastSyncedAt), failingSince: null, message: null };
  }
  return NEVER_SYNCED;
}

export interface MailboxToSync {
  workspaceId: string;
  mailboxId: string;
  /** The back-off's next attempt for the folder, or null when it isn't backing off. */
  nextAttemptAt: Date | null;
}

/**
 * The scheduler's listing across workspaces: every connected mailbox whose workspace's first
 * scan has stopped (the sync never runs before, F1), with the back-off of `folderPath`. The
 * scheduler only enqueues the mail.sync jobs; each job then works through the workspace-scoped
 * functions.
 */
export async function listMailboxesToSync(
  db: Database,
  folderPath: string,
): Promise<MailboxToSync[]> {
  const rows = await db
    .select({
      workspaceId: mailboxes.workspaceId,
      mailboxId: mailboxes.id,
      nextAttemptAt: mailboxSync.nextAttemptAt,
    })
    .from(mailboxes)
    .leftJoin(
      mailboxSync,
      and(eq(mailboxSync.mailboxId, mailboxes.id), eq(mailboxSync.folderPath, folderPath)),
    )
    .where(
      exists(
        db
          .select({ one: sql`1` })
          .from(scans)
          .where(
            and(
              eq(scans.workspaceId, mailboxes.workspaceId),
              eq(scans.kind, "first"),
              eq(scans.status, "stopped"),
            ),
          ),
      ),
    );
  return rows.map((r) => ({ ...r, nextAttemptAt: r.nextAttemptAt ?? null }));
}
