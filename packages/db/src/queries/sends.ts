import type { Send, SmtpSettingsPublic, TlsMode } from "@jobfilly/schema";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "../client";
import { drafts, mailboxes, sends } from "../tables";

// Sending (MVP 3, F4): a mailbox's SMTP settings, the sends table, and marking a draft sent. One
// send is one confirmed draft, never a batch:
//
//   scheduleSend  scheduled (its Undo delay runs to send_at; at most one waits or runs per draft,
//                 the partial unique index sends_one_pending_idx)
//   cancelSend    scheduled ─Undo─▶ cancelled (nothing was sent)
//   startSend     scheduled ─▶ sending (the job; Undo and the job race on this one row, so only
//                 one of them wins)
//   markSendAccepted  sending: the SMTP server took it (sent_at), before the Sent copy and the
//                 draft's mailbox copy are dealt with, so a retry never sends it again
//   completeSend  sending ─▶ sent, and the draft ─▶ sent (D13: the row stays, its copy is gone)
//   failSend      scheduled or sending ─▶ failed, with why in plain words
//
// The SMTP password is sealed by the server (apps/server secrets.ts) before it gets here; these
// functions take and return the sealed value only.

type SendRow = typeof sends.$inferSelect;

/** A send with what the server needs besides the API's view. */
export interface StoredSend extends Send {
  messageId: string;
  position: number;
  mailboxId: string | null;
  /** The content hash of the draft that was confirmed (the token's). */
  contentHash: string;
  /** The Message-ID the sent message has, chosen when it was confirmed. */
  outgoingMessageId: string | null;
  /** Who confirmed it; null once their account is gone. */
  createdBy: string | null;
}

function toSend(row: SendRow): StoredSend {
  return {
    id: row.id,
    draftId: row.draftId,
    status: row.status,
    sendAt: row.sendAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    failureReason: row.failureReason,
    messageId: row.messageId,
    position: row.position,
    mailboxId: row.mailboxId,
    contentHash: row.contentHash,
    outgoingMessageId: row.outgoingMessageId,
    createdBy: row.createdBy,
  };
}

/** The API's view of a stored send. */
export function publicSend(send: StoredSend): Send {
  const {
    messageId: _m,
    position: _p,
    mailboxId: _b,
    contentHash: _c,
    outgoingMessageId: _o,
    createdBy: _u,
    ...view
  } = send;
  return view;
}

/** A mailbox's SMTP settings with the sealed password (null: it uses the mailbox's own secret). */
export interface StoredSmtp extends SmtpSettingsPublic {
  secretCiphertext: string | null;
}

/** The mailbox's SMTP settings, or null until they are set (or there is no such mailbox). */
export async function getMailboxSmtp(
  db: Database,
  workspaceId: string,
  mailboxId: string,
): Promise<StoredSmtp | null> {
  const [row] = await db
    .select({
      host: mailboxes.smtpHost,
      port: mailboxes.smtpPort,
      tlsMode: mailboxes.smtpTlsMode,
      username: mailboxes.smtpUsername,
      secretCiphertext: mailboxes.smtpSecretCiphertext,
    })
    .from(mailboxes)
    .where(and(eq(mailboxes.workspaceId, workspaceId), eq(mailboxes.id, mailboxId)));
  if (!row || row.host === null || row.port === null || row.tlsMode === null) return null;
  if (row.username === null) return null;
  return {
    host: row.host,
    port: row.port,
    tlsMode: row.tlsMode,
    username: row.username,
    secretCiphertext: row.secretCiphertext,
  };
}

/**
 * Saves a mailbox's SMTP settings. `secretCiphertext` undefined keeps the stored password, null
 * clears it (the mailbox's own secret is used). False when there is no such mailbox.
 */
export async function saveMailboxSmtp(
  db: Database,
  workspaceId: string,
  mailboxId: string,
  input: {
    host: string;
    port: number;
    tlsMode: TlsMode;
    username: string;
    secretCiphertext?: string | null;
    now: Date;
  },
): Promise<boolean> {
  const rows = await db
    .update(mailboxes)
    .set({
      smtpHost: input.host,
      smtpPort: input.port,
      smtpTlsMode: input.tlsMode,
      smtpUsername: input.username,
      ...(input.secretCiphertext === undefined
        ? {}
        : { smtpSecretCiphertext: input.secretCiphertext }),
      updatedAt: input.now,
    })
    .where(and(eq(mailboxes.workspaceId, workspaceId), eq(mailboxes.id, mailboxId)))
    .returning({ id: mailboxes.id });
  return rows.length > 0;
}

/**
 * A confirmed send, waiting until `sendAt`. Pass a transaction to enqueue its job with it. Null
 * when the draft already has a send waiting or running (one per action, F4.3).
 */
export async function scheduleSend(
  db: Database,
  workspaceId: string,
  input: {
    draftId: string;
    messageId: string;
    position: number;
    mailboxId: string;
    contentHash: string;
    outgoingMessageId: string;
    sendAt: Date;
    createdBy: string;
    now: Date;
  },
): Promise<StoredSend | null> {
  const [row] = await db
    .insert(sends)
    .values({
      workspaceId,
      draftId: input.draftId,
      messageId: input.messageId,
      position: input.position,
      mailboxId: input.mailboxId,
      contentHash: input.contentHash,
      outgoingMessageId: input.outgoingMessageId,
      status: "scheduled",
      sendAt: input.sendAt,
      createdBy: input.createdBy,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing({
      target: sends.draftId,
      where: sql`status in ('scheduled', 'sending')`,
    })
    .returning();
  return row ? toSend(row) : null;
}

export async function getSend(
  db: Database,
  workspaceId: string,
  sendId: string,
): Promise<StoredSend | null> {
  const [row] = await db
    .select()
    .from(sends)
    .where(and(eq(sends.workspaceId, workspaceId), eq(sends.id, sendId)));
  return row ? toSend(row) : null;
}

/** Each draft's latest send (by when it was confirmed), for the drafts the list shows. */
export async function latestSends(
  db: Database,
  workspaceId: string,
  draftIds: string[],
): Promise<Map<string, Send>> {
  if (draftIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([sends.draftId])
    .from(sends)
    .where(and(eq(sends.workspaceId, workspaceId), inArray(sends.draftId, draftIds)))
    .orderBy(sends.draftId, desc(sends.createdAt), desc(sends.id));
  return new Map(rows.map((r) => [r.draftId, publicSend(toSend(r))]));
}

const whereSend = (workspaceId: string, sendId: string) =>
  and(eq(sends.workspaceId, workspaceId), eq(sends.id, sendId));

/** Undo (F4.2): the draft's waiting send is cancelled. Null when none waits (too late). */
export async function cancelSend(
  db: Database,
  workspaceId: string,
  draftId: string,
  now: Date,
): Promise<StoredSend | null> {
  const [row] = await db
    .update(sends)
    .set({ status: "cancelled", updatedAt: now })
    .where(
      and(
        eq(sends.workspaceId, workspaceId),
        eq(sends.draftId, draftId),
        eq(sends.status, "scheduled"),
      ),
    )
    .returning();
  return row ? toSend(row) : null;
}

/** The job takes a waiting send; false when Undo (or another run) got there first. */
export async function startSend(
  db: Database,
  workspaceId: string,
  sendId: string,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(sends)
    .set({ status: "sending", updatedAt: now })
    .where(and(whereSend(workspaceId, sendId), eq(sends.status, "scheduled")))
    .returning({ id: sends.id });
  return rows.length > 0;
}

/** The SMTP server accepted the message: from now on it is never sent again. */
export async function markSendAccepted(
  db: Database,
  workspaceId: string,
  sendId: string,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(sends)
    .set({ sentAt: now, updatedAt: now })
    .where(and(whereSend(workspaceId, sendId), eq(sends.status, "sending"), isNull(sends.sentAt)))
    .returning({ id: sends.id });
  return rows.length > 0;
}

/** A send that didn't go (or may not have), with why in plain words. */
export async function failSend(
  db: Database,
  workspaceId: string,
  sendId: string,
  input: { reason: string; now: Date },
): Promise<boolean> {
  const rows = await db
    .update(sends)
    .set({ status: "failed", failureReason: input.reason, updatedAt: input.now })
    .where(and(whereSend(workspaceId, sendId), inArray(sends.status, ["scheduled", "sending"])))
    .returning({ id: sends.id });
  return rows.length > 0;
}

/**
 * The send is done: it is marked sent, and its draft too (D13), whose mailbox copy is gone. The
 * draft keeps its row, so the role keeps its one live draft and none is written for it again.
 */
export async function completeSend(
  db: Database,
  workspaceId: string,
  send: { id: string; draftId: string },
  now: Date,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const done = await tx
      .update(sends)
      .set({ status: "sent", updatedAt: now })
      .where(and(whereSend(workspaceId, send.id), eq(sends.status, "sending")))
      .returning({ id: sends.id });
    if (done.length === 0) return false;
    await tx
      .update(drafts)
      .set({
        status: "sent",
        mailboxFolder: null,
        uid: null,
        uidValidity: null,
        claimedAt: null,
        updatedAt: now,
      })
      .where(and(eq(drafts.workspaceId, workspaceId), eq(drafts.id, send.draftId)));
    return true;
  });
}
