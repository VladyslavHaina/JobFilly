import {
  completeSend,
  failSend,
  getDraft,
  getSend,
  markSendAccepted,
  recordActivity,
  type StoredSend,
  startSend,
} from "@jobfilly/db";
import { SmtpError } from "@jobfilly/mail";
import { MAIL_SEND_JOB, type MailSendPayload, MailSendPayloadSchema } from "@jobfilly/schema";
import type { AppDeps } from "../deps";
import { isMailboxError, mailboxReason } from "../drafts/mailbox";
import { defineJob, type JobRegistry } from "../jobs/queue";
import type { Logger } from "../log";
import { mailboxSession } from "../pipeline/evaluate";
import { buildOutgoing, providerSavesSentCopy, sendFrom, smtpLogin } from "./outgoing";

// mail.send (MVP 3, F4.2, F4.4): sends one confirmed message once its Undo delay is over (the
// job's run_at), unless Undo cancelled it. It is the only code that calls the SMTP port, and it
// sends only a send row the user confirmed with a token for the draft's exact content:
//
// 1. The draft must still be the content that was confirmed (its hash, and the hash of the
//    message built now); a draft edited or discarded since fails the send with why, and nothing
//    leaves (the user confirms again).
// 2. startSend takes the row from scheduled to sending; Undo races on the same row, so one wins.
// 3. One SMTP call. Its Message-ID was chosen when the user confirmed. Once the server accepts it
//    the row records so (markSendAccepted): a run after a crash never sends it again. A run that
//    finds the row sending but not accepted can't know whether it left, so it fails the send
//    rather than risk a second copy (at most once).
// 4. The copy goes to Sent unless the provider files it itself (D12); appendSent looks for the
//    Message-ID first, so a retry never files a second one. The Drafts copy is deleted, and the
//    send and its draft are marked sent (D13), in the activity log with who confirmed it.
//
// A failure of the mail server after the message left never undoes the send: what is left over
// (the Sent copy, the Drafts copy) is logged, and the send is still marked sent.

const CHANGED =
  "The draft changed after you confirmed it, so it wasn't sent. Check it and send it again.";
const GONE = "The draft is no longer there, so nothing was sent.";
const NO_SMTP = "This mailbox has no SMTP settings any more, so nothing was sent.";
const INTERRUPTED =
  "Sending was interrupted, so it may not have gone. Check your Sent folder before sending again.";

const live = (status: string) => status === "in_mailbox" || status === "edited";

export async function runSend(
  deps: AppDeps,
  payload: MailSendPayload,
  signal: AbortSignal,
): Promise<void> {
  const ws = payload.workspaceId;
  const log = deps.log.child({ workspaceId: ws, sendId: payload.sendId });
  const send = await getSend(deps.db, ws, payload.sendId);
  if (!send || send.status === "cancelled" || send.status === "sent" || send.status === "failed") {
    return;
  }
  if (send.status === "sending" && send.sentAt === null) {
    return fail(deps, ws, log, send, INTERRUPTED, "interrupted");
  }
  const draft = await getDraft(deps.db, ws, send.draftId);
  if (!draft) return fail(deps, ws, log, send, GONE, "draft_gone");
  const from = await sendFrom(deps, ws, draft.messageId);
  if (typeof from === "string") return fail(deps, ws, log, send, NO_SMTP, from);
  const outgoingMessageId = send.outgoingMessageId ?? "";

  const session = mailboxSession(deps, ws);
  try {
    let built: Awaited<ReturnType<typeof buildOutgoing>> | null = null;
    if (send.status === "scheduled") {
      if (!live(draft.status) || draft.contentHash !== send.contentHash) {
        return fail(deps, ws, log, send, CHANGED, "changed");
      }
      // Shutting down before anything left: the job is handed back and runs again.
      signal.throwIfAborted();
      try {
        built = await buildOutgoing(deps, ws, session, draft, {
          address: from.mailbox.address,
          messageId: outgoingMessageId,
          date: new Date(send.sendAt),
        });
      } catch (error) {
        if (!isMailboxError(error)) throw error;
        return fail(deps, ws, log, send, `${mailboxReason(error)}. Nothing was sent.`, "mailbox");
      }
      if (built.contentHash !== send.contentHash)
        return fail(deps, ws, log, send, CHANGED, "changed");
      // Undo won: nothing is sent.
      if (!(await startSend(deps.db, ws, send.id, deps.clock.now()))) return;
      try {
        await deps.smtp.send(
          await smtpLogin(deps, from),
          built.message.envelope,
          built.message.raw,
          {
            allowInsecure: deps.config.allowInsecureMail,
          },
        );
      } catch (error) {
        const reason =
          error instanceof SmtpError
            ? `${error.message} Nothing was sent.`
            : "The message couldn't be sent. Nothing was sent.";
        // A reason code only: nothing the server said is logged.
        log.warn("send.failed", {
          draftId: send.draftId,
          step: "smtp",
          reason: error instanceof SmtpError ? error.reason : "unknown",
          ...(error instanceof SmtpError && error.code ? { code: error.code } : {}),
        });
        return fail(deps, ws, log, send, reason, null);
      }
      await markSendAccepted(deps.db, ws, send.id, deps.clock.now());
    }

    // It has left. What follows tidies the mailbox and never sends again.
    let sentCopy = "provider";
    if (!providerSavesSentCopy(from)) {
      try {
        built ??= await buildOutgoing(deps, ws, session, draft, {
          address: from.mailbox.address,
          messageId: outgoingMessageId,
          date: new Date(send.sendAt),
        });
        const client = await session.get(from.mailbox.mailboxId);
        const filed = await client?.appendSent({
          raw: built.message.raw,
          messageId: outgoingMessageId,
          date: new Date(send.sendAt),
        });
        sentCopy = !filed ? "no_sent_folder" : filed.appended ? "appended" : "already_there";
      } catch {
        // Told with send.completed below (sentCopy failed, at warn).
        sentCopy = "failed";
      }
    }
    if (draft.mailbox) {
      try {
        const client = await session.get(from.mailbox.mailboxId);
        await client?.deleteDraft(draft.mailbox);
      } catch {
        log.warn("draft.copy_left", { draftId: draft.id, reason: "delete_failed" });
      }
    }
    if (!(await completeSend(deps.db, ws, send, deps.clock.now()))) return;
    await recordActivity(
      deps.db,
      ws,
      {
        kind: "mail.sent",
        actor: send.createdBy ? { kind: "user", userId: send.createdBy } : { kind: "system" },
        targetUserId: null,
        refs: {
          draftId: send.draftId,
          sendId: send.id,
          messageId: send.messageId,
          position: send.position,
          mailboxId: from.mailbox.mailboxId,
        },
      },
      deps.clock.now(),
    );
    if (sentCopy === "failed") log.warn("send.completed", { draftId: send.draftId, sentCopy });
    else log.info("send.completed", { draftId: send.draftId, sentCopy });
    await published(deps, ws, send);
  } finally {
    await session.close();
  }
}

async function published(deps: AppDeps, ws: string, send: StoredSend) {
  await deps.live.publish(ws, { type: "sends.updated", data: { draftId: send.draftId } });
  await deps.live.publish(ws, { type: "drafts.updated", data: { messageIds: [send.messageId] } });
}

/** The send didn't go (or may not have): why, for the draft card, and a reason code for the log. */
async function fail(
  deps: AppDeps,
  ws: string,
  log: Logger,
  send: StoredSend,
  reason: string,
  code: string | null,
): Promise<void> {
  if (!(await failSend(deps.db, ws, send.id, { reason, now: deps.clock.now() }))) return;
  if (code) log.warn("send.failed", { draftId: send.draftId, reason: code });
  await published(deps, ws, send);
}

export const sendJobs: JobRegistry = {
  [MAIL_SEND_JOB]: defineJob(MailSendPayloadSchema, (ctx) =>
    runSend(ctx.deps, ctx.payload, ctx.signal),
  ),
};
