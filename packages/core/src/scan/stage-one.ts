import type { Envelope, StageOneContext, StageOneOutcome } from "@jobfilly/schema";
import { orderNewestFirst } from "./batches";
import { isAlertSender, platformOf } from "./platforms";

// Stage one (F4.2): sorts envelopes from their headers alone, without a model call, in this
// order:
//
//   1. own_reply  - a message the user wrote (in Sent, or from one of their own addresses); the
//                   scan reads it for the preferences it states;
//   2. job_alert  - sent from a job platform's alert address (job-platforms.json), even with
//                   bulk headers, which real alerts carry;
//   3. not_job    - mailing-list or bulk mail (List-Id, List-Unsubscribe, Precedence bulk, list
//                   or junk) from a sender that is no job platform and that the user never
//                   replied to;
//   4. likely_job - everything else, for the model.
//
// The reasons are a few plain words: never a subject or an address.

const BULK_PRECEDENCE = /^(bulk|list|junk)$/i;

const normal = (address: string) => address.trim().toLowerCase();

function hasBulkHeaders(e: Envelope): boolean {
  return (
    e.listId !== null || e.listUnsubscribe !== null || BULK_PRECEDENCE.test(e.precedence ?? "")
  );
}

/**
 * One envelope per Message-ID. The same message can sit in Inbox and Sent (mail to oneself, or a
 * provider that files both); the Sent copy is kept, because the user wrote it.
 */
function uniqueByMessageId(envelopes: readonly Envelope[]): Envelope[] {
  const byId = new Map<string, Envelope>();
  for (const e of envelopes) {
    const seen = byId.get(e.messageId);
    if (!seen || (seen.folder !== "sent" && e.folder === "sent")) byId.set(e.messageId, e);
  }
  return [...byId.values()];
}

/**
 * Sorts envelopes from their headers alone (F4.2). Every envelope (once per Message-ID) comes back
 * in exactly one list, newest first, with its verdict and reason, in the shape packages/db's
 * saveEnvelopes stores (StageOneOutcomeSchema).
 */
export function stageOne(envelopes: Envelope[], ctx: StageOneContext): StageOneOutcome {
  const own = new Set(ctx.ownAddresses.map(normal));
  const messages = orderNewestFirst(uniqueByMessageId(envelopes));
  const byId = new Map(messages.map((e) => [e.messageId, e]));
  const isOwn = (e: Envelope) => e.folder === "sent" || own.has(normal(e.from.address));

  // The senders the user replied to: the author (and Reply-To) of every message one of the
  // user's own messages answers.
  const repliedTo = new Set<string>();
  for (const e of messages) {
    if (!isOwn(e) || e.inReplyTo === null) continue;
    const original = byId.get(e.inReplyTo);
    if (!original || isOwn(original)) continue;
    for (const a of [original.from, ...original.replyTo]) repliedTo.add(normal(a.address));
  }

  const outcome: StageOneOutcome = { handled: [], candidates: [], ownReplies: [] };
  for (const envelope of messages) {
    const from = normal(envelope.from.address);
    if (isOwn(envelope)) {
      outcome.ownReplies.push({ envelope, verdict: "own_reply", reason: "your own message" });
    } else if (isAlertSender(from, ctx.platforms)) {
      outcome.handled.push({ envelope, verdict: "job_alert", reason: "job platform alert" });
    } else if (
      hasBulkHeaders(envelope) &&
      platformOf(from, ctx.platforms) === null &&
      !repliedTo.has(from)
    ) {
      outcome.handled.push({ envelope, verdict: "not_job", reason: "mailing list or bulk mail" });
    } else {
      outcome.candidates.push({ envelope, verdict: "likely_job", reason: likelyReason(from) });
    }
  }
  return outcome;

  function likelyReason(from: string): string {
    if (platformOf(from, ctx.platforms)) return "from a job platform";
    if (repliedTo.has(from)) return "from someone you replied to";
    return "needs a closer look";
  }
}
