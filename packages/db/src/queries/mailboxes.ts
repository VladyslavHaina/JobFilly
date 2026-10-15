import type { MailboxStatus, TlsMode } from "@jobfilly/schema";
import { and, eq } from "drizzle-orm";
import type { Database } from "../client";
import { mailboxes } from "../tables";

// The workspace's mailbox (one per workspace in MVP 1). These functions take and return the
// sealed secret only: sealing, input checks and what the API returns stay with the routes.

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
}

/** Stores the mailbox; refused with "exists" when the workspace already has one. */
export async function createMailbox(
  db: Database,
  workspaceId: string,
  input: MailboxInsert,
): Promise<{ ok: true; mailboxId: string } | { ok: false; reason: "exists" }> {
  const [row] = await db
    .insert(mailboxes)
    .values({ workspaceId, ...input })
    .onConflictDoNothing({ target: mailboxes.workspaceId })
    .returning({ id: mailboxes.id });
  return row ? { ok: true, mailboxId: row.id } : { ok: false, reason: "exists" };
}

/** The workspace's mailbox with its sealed secret, or null when none is connected. */
export async function getMailboxConnection(
  db: Database,
  workspaceId: string,
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
    })
    .from(mailboxes)
    .where(eq(mailboxes.workspaceId, workspaceId));
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
