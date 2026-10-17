import type { MailboxAuth, MailboxRemovalSummary, MailboxStatus, TlsMode } from "@jobfilly/schema";
import { and, asc, eq, exists, inArray, notExists, notInArray, sql } from "drizzle-orm";
import type { Database } from "../client";
import { decisionMessages, decisions, drafts, mailboxes, messages, roles } from "../tables";

// The workspace's mailboxes (one per workspace before MVP 3, several from MVP 3, F3.1, one per
// address). These functions take and return the sealed secret only: sealing, input checks and
// what the API returns stay with the routes.

export interface MailboxInsert {
  address: string;
  host: string;
  port: number;
  tlsMode: TlsMode;
  username: string;
  secretCiphertext: string;
  sentFolderPath: string | null;
  /** MVP 3: password by default; google seals the OAuth tokens as JSON instead (F3.2). */
  authKind?: MailboxAuth;
}

export interface StoredMailbox extends MailboxInsert {
  workspaceId: string;
  mailboxId: string;
  status: MailboxStatus;
  /** MVP 3: a password mailbox, or a Google one whose secret is its sealed OAuth tokens. */
  authKind: MailboxAuth;
}

/** Stores the mailbox; refused with "exists" when the workspace already has one at the address. */
export async function createMailbox(
  db: Database,
  workspaceId: string,
  input: MailboxInsert,
): Promise<{ ok: true; mailboxId: string } | { ok: false; reason: "exists" }> {
  const [row] = await db
    .insert(mailboxes)
    .values({ workspaceId, ...input })
    .onConflictDoNothing({ target: [mailboxes.workspaceId, mailboxes.address] })
    .returning({ id: mailboxes.id });
  return row ? { ok: true, mailboxId: row.id } : { ok: false, reason: "exists" };
}

const STORED = {
  workspaceId: mailboxes.workspaceId,
  mailboxId: mailboxes.id,
  address: mailboxes.address,
  host: mailboxes.host,
  port: mailboxes.port,
  tlsMode: mailboxes.tlsMode,
  username: mailboxes.username,
  secretCiphertext: mailboxes.secretCiphertext,
  sentFolderPath: mailboxes.sentFolderPath,
  status: mailboxes.status,
  authKind: mailboxes.authKind,
};

const ofMailbox = (workspaceId: string, mailboxId: string) =>
  and(eq(mailboxes.workspaceId, workspaceId), eq(mailboxes.id, mailboxId));

/**
 * A mailbox with its sealed secret: the one named, or without a name the workspace's first
 * (oldest) mailbox, which is also where mail stored without a mailbox lives; null when there is
 * no such mailbox.
 */
export async function getMailboxConnection(
  db: Database,
  workspaceId: string,
  mailboxId?: string | null,
): Promise<StoredMailbox | null> {
  const [row] = await db
    .select(STORED)
    .from(mailboxes)
    .where(
      and(
        eq(mailboxes.workspaceId, workspaceId),
        mailboxId ? eq(mailboxes.id, mailboxId) : undefined,
      ),
    )
    .orderBy(asc(mailboxes.createdAt), asc(mailboxes.id))
    .limit(1);
  return row ?? null;
}

/** Every mailbox of the workspace, the oldest first (F3.1). */
export async function listMailboxes(db: Database, workspaceId: string): Promise<StoredMailbox[]> {
  return db
    .select(STORED)
    .from(mailboxes)
    .where(eq(mailboxes.workspaceId, workspaceId))
    .orderBy(asc(mailboxes.createdAt), asc(mailboxes.id));
}

/**
 * Replaces the sealed secret: a Google mailbox's tokens after a refresh (F3.2). False when the
 * mailbox is gone.
 */
export async function updateMailboxSecret(
  db: Database,
  workspaceId: string,
  mailboxId: string,
  secretCiphertext: string,
): Promise<boolean> {
  const rows = await db
    .update(mailboxes)
    .set({ secretCiphertext, updatedAt: sql`now()` })
    .where(ofMailbox(workspaceId, mailboxId))
    .returning({ id: mailboxes.id });
  return rows.length > 0;
}

/**
 * The provider refused the mailbox's OAuth token (F3.2): it shows "Reconnect needed" until the
 * user signs in again. True only when this call changed it, so it is logged once.
 */
export async function markMailboxReconnectNeeded(
  db: Database,
  workspaceId: string,
  mailboxId: string,
): Promise<boolean> {
  const rows = await db
    .update(mailboxes)
    .set({ status: "reconnect_needed", updatedAt: sql`now()` })
    .where(and(ofMailbox(workspaceId, mailboxId), sql`${mailboxes.status} <> 'reconnect_needed'`))
    .returning({ id: mailboxes.id });
  return rows.length > 0;
}

/**
 * Signed in again (F3.2): the new sealed secret, the server and the Sent folder the test found,
 * and connected. Its messages, cursor and everything else stay. False when the mailbox is gone.
 */
export async function reconnectMailbox(
  db: Database,
  workspaceId: string,
  mailboxId: string,
  input: Omit<MailboxInsert, "address" | "authKind">,
): Promise<boolean> {
  const rows = await db
    .update(mailboxes)
    .set({ ...input, status: "connected", updatedAt: sql`now()` })
    .where(ofMailbox(workspaceId, mailboxId))
    .returning({ id: mailboxes.id });
  return rows.length > 0;
}

/** The mailbox's messages (by the composite key) as a subquery. */
const messagesOf = (db: Database, workspaceId: string, mailboxId: string) =>
  db
    .select({ messageId: messages.messageId })
    .from(messages)
    .where(and(eq(messages.workspaceId, workspaceId), eq(messages.mailboxId, mailboxId)));

/**
 * The open decisions that wait only on this mailbox's roles: with its messages gone they wait on
 * nothing, so a disconnect removes them too. Answered ones stay, as their answers are in the
 * profile.
 */
function openDecisionsOnlyOf(db: Database, workspaceId: string, mailboxId: string) {
  const mine = messagesOf(db, workspaceId, mailboxId);
  const rowsOf = (inMailbox: boolean) =>
    db
      .select({ one: sql`1` })
      .from(decisionMessages)
      .where(
        and(
          eq(decisionMessages.workspaceId, workspaceId),
          eq(decisionMessages.decisionId, decisions.id),
          inMailbox
            ? inArray(decisionMessages.messageId, mine)
            : notInArray(decisionMessages.messageId, mine),
        ),
      );
  return db
    .select({ id: decisions.id })
    .from(decisions)
    .where(
      and(
        eq(decisions.workspaceId, workspaceId),
        eq(decisions.status, "open"),
        exists(rowsOf(true)),
        notExists(rowsOf(false)),
      ),
    );
}

/**
 * What disconnecting the mailbox removes (F7.4): its synced messages and their roles, drafts and
 * the open decisions waiting only on them; null when there is no such mailbox.
 */
export async function getMailboxRemovalSummary(
  db: Database,
  workspaceId: string,
  mailboxId: string,
): Promise<MailboxRemovalSummary | null> {
  const [mailbox] = await db
    .select({ address: mailboxes.address })
    .from(mailboxes)
    .where(ofMailbox(workspaceId, mailboxId));
  if (!mailbox) return null;
  const mine = messagesOf(db, workspaceId, mailboxId);
  const count = sql<number>`count(*)::int`;
  const [[m], [r], [d], [q]] = await Promise.all([
    db
      .select({ n: count })
      .from(messages)
      .where(and(eq(messages.workspaceId, workspaceId), eq(messages.mailboxId, mailboxId))),
    db
      .select({ n: count })
      .from(roles)
      .where(and(eq(roles.workspaceId, workspaceId), inArray(roles.messageId, mine))),
    db
      .select({ n: count })
      .from(drafts)
      .where(and(eq(drafts.workspaceId, workspaceId), inArray(drafts.messageId, mine))),
    db.select({ n: count }).from(openDecisionsOnlyOf(db, workspaceId, mailboxId).as("d")),
  ]);
  return {
    address: mailbox.address,
    messages: m?.n ?? 0,
    roles: r?.n ?? 0,
    drafts: d?.n ?? 0,
    decisions: q?.n ?? 0,
  };
}

/**
 * Disconnects (F2.5, F7.4): deletes the row and with it the sealed secret, its sync state, its
 * waiting Google sign-ins and its messages with everything tied to them (the foreign keys
 * cascade), and the open decisions that waited only on those messages.
 */
export async function deleteMailbox(
  db: Database,
  workspaceId: string,
  mailboxId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const orphaned = (await openDecisionsOnlyOf(tx, workspaceId, mailboxId)).map((d) => d.id);
    const rows = await tx
      .delete(mailboxes)
      .where(ofMailbox(workspaceId, mailboxId))
      .returning({ id: mailboxes.id });
    if (rows.length === 0) return false;
    if (orphaned.length > 0) {
      await tx
        .delete(decisions)
        .where(and(eq(decisions.workspaceId, workspaceId), inArray(decisions.id, orphaned)));
    }
    return true;
  });
}
