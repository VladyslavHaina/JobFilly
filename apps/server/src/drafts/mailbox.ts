import { createHash, randomUUID } from "node:crypto";
import { getCvFile, getMailboxConnection, getMessageRef } from "@jobfilly/db";
import { MailUnavailableError } from "@jobfilly/mail";
import {
  CV_MIME_TYPES,
  type DraftAttachment,
  type DraftMailInput,
  type DraftRef,
  type OriginalMessage,
} from "@jobfilly/schema";
import type { AppDeps } from "../deps";
import type { MailboxSession } from "../pipeline/evaluate";

// The mailbox side of a draft (F6.3, F6.4): the original it replies to, fetched from the mailbox
// each time and never stored (packages/mail threads the draft to it and quotes it), the CV to
// attach, and the content hash kept with the mailbox copy. The MIME message and the Drafts
// folder belong to packages/mail.

/** The mail server can't be used for this draft; plain words for the Drafts page (F6.7). */
export class DraftMailboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftMailboxError";
  }
}

const NO_MAILBOX = "No mailbox is connected";
const GONE = "The message is no longer in the mailbox";

/**
 * The original the draft replies to: its threading headers (Message-ID, References) and the text
 * to quote, as ctx.original() gives it to the pipeline's stages. Throws MailUnavailableError when
 * the server can't be reached and DraftMailboxError when there is no mailbox or no message.
 */
export async function originalFor(
  deps: AppDeps,
  ws: string,
  session: MailboxSession,
  messageId: string,
): Promise<OriginalMessage> {
  const ref = await getMessageRef(deps.db, ws, messageId);
  if (!ref) throw new DraftMailboxError(GONE);
  const client = await session.get();
  if (!client) throw new DraftMailboxError(NO_MAILBOX);
  const original = await client.fetchOriginal(ref);
  if (!original) throw new DraftMailboxError(GONE);
  return original;
}

/** The chosen CV as the draft's attachment, or null when there is none (or it was deleted). */
export async function attachmentFor(
  deps: AppDeps,
  ws: string,
  cvId: string | null,
): Promise<DraftAttachment | null> {
  if (!cvId) return null;
  const file = await getCvFile(deps.db, ws, cvId);
  if (!file) return null;
  return {
    fileName: file.fileName,
    contentType: CV_MIME_TYPES[file.mediaType],
    bytes: new Uint8Array(file.bytes),
  };
}

/**
 * A new draft's own Message-ID header, on the mailbox address's domain, chosen before the append
 * and kept on the draft row (saveDraftText), so a retry can find the copy an attempt left.
 */
export async function newDraftMessageId(deps: AppDeps, ws: string): Promise<string> {
  const address = (await getMailboxConnection(deps.db, ws))?.address ?? "";
  const domain = /^[^\s@<>]+@([^\s@<>]+\.[^\s@<>]+)$/.exec(address)?.[1] ?? "jobfilly.invalid";
  return `<${randomUUID()}@${domain}>`;
}

/**
 * Where a copy with this Message-ID may be although its UID was never recorded: UIDVALIDITY 0
 * is never a folder's (RFC 3501), so deleting it finds the copy by its Message-ID.
 */
export const copyByMessageId = (path: string, draftMessageId: string): DraftRef => ({
  path,
  uid: 0,
  uidValidity: 0,
  draftMessageId,
});

/** SHA-256 of what the mailbox copy holds of ours: the subject, the body and the attachment. */
export function contentHash(input: Pick<DraftMailInput, "reply" | "attachment">): string {
  const hash = createHash("sha256");
  hash.update(input.reply.subject).update("\0").update(input.reply.body).update("\0");
  if (input.attachment)
    hash.update(input.attachment.fileName).update("\0").update(input.attachment.bytes);
  return hash.digest("hex");
}

/** Plain words for why the mailbox couldn't take the draft. */
export function mailboxReason(error: unknown): string {
  if (error instanceof MailUnavailableError || error instanceof DraftMailboxError) {
    return error.message;
  }
  return "Couldn't save the draft to the mailbox";
}

/** Whether an error came from the mailbox (or its absence), not from our own code. */
export function isMailboxError(error: unknown): boolean {
  return error instanceof MailUnavailableError || error instanceof DraftMailboxError;
}
