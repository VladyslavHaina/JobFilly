import {
  getMailboxConnection,
  getMailboxSmtp,
  type StoredDraft,
  type StoredMailbox,
  type StoredSmtp,
} from "@jobfilly/db";
import { composeOutgoing, MAIL_PRESETS, type OutgoingMessage } from "@jobfilly/mail";
import { OAuthTokensSchema, type SmtpLogin } from "@jobfilly/schema";
import type { AppDeps } from "../deps";
import { attachmentFor, contentHash, mailboxOf, originalFor } from "../drafts/mailbox";
import { MailboxSecretError } from "../mailbox";
import type { MailboxSession } from "../pipeline/evaluate";
import { open } from "../secrets";

// What the confirmation (routes/send.ts) and the send job (./jobs.ts) share: the mailbox a draft
// is sent from (its message's own, F3.1) with its SMTP settings, the SMTP login, and the outgoing
// message built from the draft as it is now. The secret is opened here and goes only to the SMTP
// port; it is never returned or logged.

export interface SendFrom {
  mailbox: StoredMailbox;
  smtp: StoredSmtp;
}

/**
 * A Google mailbox's SMTP server: only ever the server's own Google settings
 * (JOBFILLY_GOOGLE_SMTP_HOST), never anything a user typed; null when Google isn't set up.
 */
export function googleSmtp(deps: AppDeps, mailbox: StoredMailbox): StoredSmtp | null {
  const google = deps.config.google;
  if (!google) return null;
  return { ...google.smtp, username: mailbox.address, secretCiphertext: null };
}

/**
 * The mailbox the draft's message came from and its SMTP settings: `no_mailbox` when it is gone,
 * `no_smtp` until Settings › Sending has them (F4.1). A Google mailbox sends through Google's
 * server from the server's settings, with nothing to set up.
 */
export async function sendFrom(
  deps: AppDeps,
  ws: string,
  messageId: string,
): Promise<SendFrom | "no_mailbox" | "no_smtp"> {
  const mailbox = await getMailboxConnection(deps.db, ws, await mailboxOf(deps, ws, messageId));
  if (!mailbox) return "no_mailbox";
  const smtp =
    mailbox.authKind === "google"
      ? googleSmtp(deps, mailbox)
      : await getMailboxSmtp(deps.db, ws, mailbox.mailboxId);
  return smtp ? { mailbox, smtp } : "no_smtp";
}

/**
 * The SMTP login: a Google mailbox signs in with its OAuth access token (XOAUTH2), any other with
 * its SMTP password, or its IMAP password when it has none of its own. Throws MailboxSecretError
 * when the sealed secret won't open with this JOBFILLY_SECRET_KEY.
 */
export function smtpLogin(deps: AppDeps, from: SendFrom): SmtpLogin {
  const { mailbox, smtp } = from;
  const server = { host: smtp.host, port: smtp.port, tlsMode: smtp.tlsMode };
  let secret: string;
  try {
    secret = open(deps.config.secretKey, smtp.secretCiphertext ?? mailbox.secretCiphertext);
  } catch {
    throw new MailboxSecretError();
  }
  if (mailbox.authKind === "google") {
    const tokens = OAuthTokensSchema.parse(JSON.parse(secret));
    return { ...server, username: smtp.username, accessToken: tokens.accessToken };
  }
  return { ...server, username: smtp.username, password: secret };
}

/**
 * Whether the provider files every message sent through it in Sent itself (Gmail, D12), so the
 * app must not append a copy of its own: a Google mailbox, or SMTP settings on a preset's server
 * that says so.
 */
export function providerSavesSentCopy(from: SendFrom): boolean {
  if (from.mailbox.authKind === "google") return true;
  const host = from.smtp.host.trim().toLowerCase();
  return MAIL_PRESETS.some((p) => p.smtp?.savesSentCopy && p.smtp.host === host);
}

/**
 * The draft as the message that leaves: the reply, the quote of its original (read from the
 * mailbox now, never stored) and its attachment — the CV, or once the CV is deleted (F2.5) the
 * file its mailbox copy carries — with the given Message-ID and Date. `contentHash` is of what is
 * sent, as the draft's own is of its copy, so the two must agree.
 */
export async function buildOutgoing(
  deps: AppDeps,
  ws: string,
  session: MailboxSession,
  draft: StoredDraft,
  input: { address: string; messageId: string; date: Date },
): Promise<{ message: OutgoingMessage; contentHash: string }> {
  const original = await originalFor(deps, ws, session, draft.messageId);
  let attachment = await attachmentFor(deps, ws, draft.cvId);
  if (!attachment && draft.attachmentName !== null && draft.mailbox) {
    const client = await session.get(await mailboxOf(deps, ws, draft.messageId));
    attachment = (await client?.draftAttachment(draft.mailbox)) ?? null;
  }
  const reply = { subject: draft.subject ?? "", body: draft.body ?? "" };
  const message = await composeOutgoing({
    original,
    reply,
    attachment,
    from: { address: input.address, name: null },
    messageId: input.messageId,
    date: input.date,
  });
  return { message, contentHash: contentHash({ reply, attachment }) };
}
