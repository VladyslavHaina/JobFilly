import type { MailboxAuth, MailboxStatus, TlsMode } from "@jobfilly/schema";
import { and, asc, eq } from "drizzle-orm";
import type { Database } from "../client";
import { mailboxes } from "../tables";

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
}

export interface StoredMailbox extends MailboxInsert {
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
    .select({
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
    })
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

/** Disconnects: deletes the row and with it the sealed secret (F2.5). */
export async function deleteMailbox(
  db: Database,
  workspaceId: string,
  mailboxId: string,
): Promise<boolean> {
  const rows = await db
    .delete(mailboxes)
    .where(and(eq(mailboxes.workspaceId, workspaceId), eq(mailboxes.id, mailboxId)))
    .returning({ id: mailboxes.id });
  return rows.length > 0;
}
