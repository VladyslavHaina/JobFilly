import { cancelSend, getDraft, publicSend, type StoredDraft, scheduleSend } from "@jobfilly/db";
import {
  jobDedupeKey,
  MAIL_SEND_JOB,
  SEND_DELAY_SECONDS,
  type Send,
  type SendPreview,
} from "@jobfilly/schema";
import type { AppDeps } from "../deps";
import { isMailboxError, mailboxReason, newDraftMessageId } from "../drafts/mailbox";
import { enqueue } from "../jobs/queue";
import type { Logger } from "../log";
import { mailboxSession } from "../pipeline/evaluate";
import { buildOutgoing, sendFrom } from "./outgoing";
import { checkSendToken, signSendToken, type TokenSubject } from "./token";

// Sending one draft (MVP 3, F4.1–F4.3): the confirmation shows the message exactly as it will
// leave with a token for this content; confirming with that token schedules it
// SEND_DELAY_SECONDS ahead (the mail.send job's run_at); Undo cancels it while it waits. One
// draft per request, never a batch: there is no route that takes several.

export type SendError =
  | "not_found"
  | "not_sendable"
  | "no_smtp"
  | "invalid_token"
  | "confirm_again"
  | "already_sending"
  | "nothing_to_undo"
  | "mailbox";

export type SendOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: SendError; message: string };

const failed = (error: SendError, message: string) => ({ ok: false as const, error, message });

const NOT_FOUND = failed("not_found", "No such draft");
const NOT_SENDABLE = failed("not_sendable", "Only a draft in the mailbox can be sent");
const NO_SMTP = failed(
  "no_smtp",
  "This mailbox can't send yet. An admin adds its SMTP server in Settings › Sending.",
);
const CONFIRM_AGAIN = failed(
  "confirm_again",
  "The draft changed since you opened Send, or the confirmation expired. Check it and confirm again.",
);

const sendable = (draft: StoredDraft) =>
  (draft.status === "in_mailbox" || draft.status === "edited") && draft.contentHash !== null;

/** Ends a reason as a sentence, once. */
const sentence = (text: string) => (text.endsWith(".") ? text : `${text}.`);

/**
 * The confirmation (F4.1): the recipients, subject, attachments and exact text of the message as
 * it will leave, built now from the draft and its original, and a token for this content.
 */
export async function previewSend(
  deps: AppDeps,
  subject: TokenSubject,
): Promise<SendOutcome<SendPreview>> {
  const ws = subject.workspaceId;
  const draft = await getDraft(deps.db, ws, subject.draftId);
  if (!draft) return NOT_FOUND;
  if (!sendable(draft)) return NOT_SENDABLE;
  const from = await sendFrom(deps, ws, draft.messageId);
  if (typeof from === "string") return NO_SMTP;
  const session = mailboxSession(deps, ws);
  try {
    const now = deps.clock.now();
    const built = await buildOutgoing(deps, ws, session, draft, {
      address: from.mailbox.address,
      // A placeholder: the message is sent with an id of its own, chosen when it is confirmed.
      messageId: newDraftMessageId(from.mailbox.address),
      date: now,
    });
    // The mailbox copy no longer matches the draft (its attachment can't be read back): what
    // would leave isn't what the draft says, so it isn't offered.
    if (built.contentHash !== draft.contentHash) {
      return failed(
        "not_sendable",
        "The draft in your mailbox doesn't match it any more. Edit and save it, then send it.",
      );
    }
    const { token, expiresAt } = signSendToken(
      deps.config.secretKey,
      subject,
      built.contentHash,
      now,
    );
    return {
      ok: true,
      value: {
        draftId: draft.id,
        mailboxId: from.mailbox.mailboxId,
        ...built.message.preview,
        token,
        expiresAt: expiresAt.toISOString(),
      },
    };
  } catch (error) {
    if (!isMailboxError(error)) throw error;
    return failed("mailbox", sentence(mailboxReason(error)));
  } finally {
    await session.close();
  }
}

/**
 * Confirms one draft with the confirmation's token (F4.3): refused without a token of ours for
 * this workspace, draft and user, and with one for content the draft no longer has (it was
 * edited after the confirmation was shown) or that has expired. Schedules the send with its own
 * Message-ID and the mail.send job SEND_DELAY_SECONDS ahead, in one transaction.
 */
export async function confirmSend(
  deps: AppDeps,
  subject: TokenSubject,
  token: string,
  log: Logger,
): Promise<SendOutcome<Send>> {
  const ws = subject.workspaceId;
  const draft = await getDraft(deps.db, ws, subject.draftId);
  if (!draft) return NOT_FOUND;
  const now = deps.clock.now();
  const check = checkSendToken(deps.config.secretKey, subject, token, now);
  if (!check.ok && check.reason === "invalid") {
    return failed("invalid_token", "This confirmation isn't valid. Open Send again.");
  }
  if (!check.ok || check.contentHash !== draft.contentHash) return CONFIRM_AGAIN;
  if (!sendable(draft)) return NOT_SENDABLE;
  const from = await sendFrom(deps, ws, draft.messageId);
  if (typeof from === "string") return NO_SMTP;
  const sendAt = new Date(now.getTime() + SEND_DELAY_SECONDS * 1000);
  const send = await deps.db.transaction(async (tx) => {
    const scheduled = await scheduleSend(tx, ws, {
      draftId: draft.id,
      messageId: draft.messageId,
      position: draft.position,
      mailboxId: from.mailbox.mailboxId,
      contentHash: check.contentHash,
      outgoingMessageId: newDraftMessageId(from.mailbox.address),
      sendAt,
      createdBy: subject.userId,
      now,
    });
    if (!scheduled) return null;
    await enqueue(
      deps,
      ws,
      {
        type: MAIL_SEND_JOB,
        payload: { workspaceId: ws, sendId: scheduled.id },
        dedupeKey: jobDedupeKey.send(scheduled.id),
        runAt: sendAt,
      },
      tx,
    );
    return scheduled;
  });
  if (!send) return failed("already_sending", "This draft is being sent already");
  log.info("send.confirmed", { draftId: draft.id, sendId: send.id, sendAt: send.sendAt });
  await deps.live.publish(ws, { type: "sends.updated", data: { draftId: draft.id } });
  return { ok: true, value: publicSend(send) };
}

/** Undo (F4.2): the draft's waiting send is cancelled, so nothing is sent. */
export async function undoSend(
  deps: AppDeps,
  subject: TokenSubject,
  log: Logger,
): Promise<SendOutcome<Send>> {
  const ws = subject.workspaceId;
  const draft = await getDraft(deps.db, ws, subject.draftId);
  if (!draft) return NOT_FOUND;
  const send = await cancelSend(deps.db, ws, draft.id, deps.clock.now());
  if (!send) {
    return failed(
      "nothing_to_undo",
      "It's too late to undo: the message has gone, or nothing waits",
    );
  }
  log.info("send.undone", { draftId: draft.id, sendId: send.id });
  await deps.live.publish(ws, { type: "sends.updated", data: { draftId: draft.id } });
  return { ok: true, value: publicSend(send) };
}
