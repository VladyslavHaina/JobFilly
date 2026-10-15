import { withinReplyWindow } from "@jobfilly/core";
import {
  draftHistory,
  getEvaluations,
  getMailboxConnection,
  getSenderChecks,
  listProfiles,
  listRules,
  loadMessageInputs,
  markStale,
  saveEvaluation,
  saveMessageLanguage,
  saveSenderCheck,
} from "@jobfilly/db";
import type { MailClient } from "@jobfilly/mail";
import {
  MESSAGE_GONE_SIGNAL,
  type OriginalMessage,
  type Profile,
  type RoleEvaluation,
  type SenderCheck,
} from "@jobfilly/schema";
import type { AppDeps } from "../deps";
import { open } from "../secrets";
import { cvChoiceStage } from "./cv-choice";
import { matchStage } from "./match";
import { replyStage } from "./reply";
import { senderStage } from "./sender";
import { MessageGoneError, type SenderStageResult, type StageContext, type Stages } from "./stages";

// The analysis pipeline for one job message (F1.1, F1.6). Order: the sender stage, then per role
// the cv-choice and match stages, then the reply stage.
//
// - The sender stage runs only when the message's sender check is missing (new mail, the
//   backlog) or stale (a sender mark changed). A re-evaluation after a rule, profile, decision or
//   CV change passes the stored check on and never calls body(): re-scoring stays inside the
//   minute of F3.5, F4.6, F7.4 and F8.3 and works while the mailbox is down.
// - When the sender stage fails (the mailbox can't be reached…), the check stays missing for a
//   later sweep; the roles are still matched and the reply waits for the check
//   (sender_check_pending).
// - When the message is gone from the mailbox (body() throws MessageGoneError), the check is
//   stored incomplete with the message_gone reason, never "looks fine" (F5.3): a message that
//   can't be read isn't fetched again on every sweep. A scan or sync that sees it again makes
//   the check stale.
// - The sender stage also tells the body's language; it is stored on the message, and when it
//   changed, the roles are evaluated again in the same run (their CV choice may depend on it).
// - With no confirmed profile only the sender stage runs: the roles stay unevaluated, so they are
//   still listed when the intake is confirmed.
// - A role whose cv-choice or match stage fails stays missing or stale for the next sweep; it is
//   never marked evaluated.

const DEFAULT_STAGES: Stages = {
  sender: senderStage,
  cvChoice: cvChoiceStage,
  match: matchStage,
  reply: replyStage,
};

export interface EvaluateOptions {
  origin: StageContext["origin"];
  stages?: Stages;
  /** A mailbox connection shared with other evaluations (a re-evaluation run); closed by its owner. */
  mailbox?: MailboxSession;
}

export interface EvaluateOutcome {
  /** The message exists and is job mail with something to do. */
  found: boolean;
  senderChecked: boolean;
  /** Positions evaluated now, and those whose stages failed. */
  evaluated: number[];
  failed: number[];
}

/** @public The workspace's confirmed profile (one per workspace in MVP 2), or null. */
export async function confirmedProfile(deps: AppDeps, ws: string): Promise<Profile | null> {
  return (await listProfiles(deps.db, ws)).find((p) => p.confirmedAt !== null) ?? null;
}

/**
 * The workspace's mailbox, opened on first use and kept for the evaluations that share it, so a
 * run logs in once, not once per message. An open that failed stays failed for the session: the
 * rest of the run doesn't log in again, and what needed the mailbox waits for the next sweep.
 */
export interface MailboxSession {
  get(): Promise<MailClient | null>;
  close(): Promise<void>;
}

export function mailboxSession(deps: AppDeps, ws: string): MailboxSession {
  let opened: Promise<MailClient | null> | null = null;
  return {
    get() {
      opened ??= openMailbox(deps, ws);
      return opened;
    },
    async close() {
      const client = await opened?.catch(() => null);
      opened = null;
      await client?.close().catch(() => {});
    },
  };
}

/** Opens the workspace's mailbox, or null when none is connected. */
async function openMailbox(deps: AppDeps, ws: string): Promise<MailClient | null> {
  const mailbox = await getMailboxConnection(deps.db, ws);
  if (!mailbox) return null;
  return deps.mail.connect(
    {
      host: mailbox.host,
      port: mailbox.port,
      tlsMode: mailbox.tlsMode,
      username: mailbox.username,
      password: open(deps.config.secretKey, mailbox.secretCiphertext),
    },
    { allowInsecure: deps.config.allowInsecureMail },
  );
}

const errorName = (error: unknown) => (error instanceof Error ? error.name : "unknown");

const GONE_REASON = {
  signal: MESSAGE_GONE_SIGNAL,
  reason: "The message is no longer in the mailbox, so its text couldn't be checked",
};

/** The check of a message whose body couldn't be read: incomplete, at best caution. */
function goneCheck(check: SenderCheck | null): SenderCheck {
  if (!check) return { verdict: "caution", complete: false, reasons: [GONE_REASON], mark: null };
  const named = check.reasons.some((r) => r.signal === MESSAGE_GONE_SIGNAL);
  return {
    ...check,
    verdict: check.verdict === "looks_fine" ? "caution" : check.verdict,
    complete: false,
    reasons: named ? check.reasons : [...check.reasons, GONE_REASON],
  };
}

export async function evaluateMessage(
  deps: AppDeps,
  ws: string,
  messageId: string,
  options: EvaluateOptions,
): Promise<EvaluateOutcome> {
  const stages = options.stages ?? DEFAULT_STAGES;
  const outcome: EvaluateOutcome = {
    found: false,
    senderChecked: false,
    evaluated: [],
    failed: [],
  };
  const [message] = await loadMessageInputs(deps.db, ws, [messageId]);
  if (!message) return outcome;
  outcome.found = true;
  const log = deps.log.child({ workspaceId: ws });
  const now = deps.clock.now();
  const profile = await confirmedProfile(deps, ws);
  const rules = profile ? await listRules(deps.db, ws, profile.id) : [];

  // The mailbox is opened only when a stage asks for the body or the original.
  const own = options.mailbox ? null : mailboxSession(deps, ws);
  const session = options.mailbox ?? (own as MailboxSession);
  let body: Promise<string> | null = null;
  let gone = false;
  let original: Promise<OriginalMessage | null> | null = null;
  const ref = {
    folderPath: message.folderPath,
    uidValidity: message.uidValidity,
    uid: message.uid,
  };
  const ctx: StageContext = {
    deps,
    ws,
    profile,
    rules,
    now,
    origin: options.origin,
    log,
    body() {
      body ??= (async () => {
        const client = await session.get();
        if (!client) throw new Error("no mailbox is connected");
        const fetched = await client.fetchBody(ref);
        if (!fetched) {
          gone = true;
          throw new MessageGoneError();
        }
        return fetched.text;
      })();
      return body;
    },
    original() {
      original ??= (async () => {
        const client = await session.get();
        if (!client) throw new Error("no mailbox is connected");
        return client.fetchOriginal(ref);
      })();
      return original;
    },
  };

  try {
    const [stored] = await getSenderChecks(deps.db, ws, [messageId]);
    let sender: SenderCheck | null = stored && !stored.stale ? stripCheck(stored) : null;
    if (!stored || stored.stale) {
      let result: SenderStageResult | null = null;
      try {
        result = await stages.sender({ message }, ctx);
      } catch (error) {
        if (!gone) log.warn("pipeline.stage_failed", { stage: "sender", error: errorName(error) });
      }
      if (gone) {
        // The language stays as last detected: nothing new was read.
        result = { check: goneCheck(result?.check ?? null), language: message.language };
        log.warn("pipeline.message_gone", { stage: "sender" });
      }
      if (result) {
        sender = result.check;
        await saveSenderCheck(deps.db, ws, messageId, sender, now);
        outcome.senderChecked = true;
        if (await saveMessageLanguage(deps.db, ws, messageId, result.language)) {
          message.language = result.language;
          await markStale(deps.db, ws, { messageIds: [messageId] }, now);
        }
      }
    }

    if (profile) {
      const existing = new Map(
        (await getEvaluations(deps.db, ws, [messageId])).map((e) => [e.position, e]),
      );
      for (const [position, facts] of message.facts.entries()) {
        const current = existing.get(position);
        if (current && !current.stale) continue;
        try {
          const role = { position, facts };
          const cvChoice = await stages.cvChoice({ message, role }, ctx);
          const evaluation = await stages.match({ message, role, cvChoice }, ctx);
          await saveEvaluation(deps.db, ws, messageId, { ...evaluation, position }, now);
          outcome.evaluated.push(position);
        } catch (error) {
          outcome.failed.push(position);
          log.warn("pipeline.stage_failed", { stage: "match", position, error: errorName(error) });
        }
      }

      const evaluations: RoleEvaluation[] = (await getEvaluations(deps.db, ws, [messageId]))
        .filter((e) => !e.stale)
        .map(({ messageId: _m, ...e }) => e);
      const history = await draftHistory(
        deps.db,
        ws,
        message.facts.map((_, position) => ({ messageId, position })),
      );
      try {
        await stages.reply(
          {
            message,
            sender,
            evaluations,
            draftHistory: new Map(
              message.facts.map((_, position) => [
                position,
                history.get(`${messageId}#${position}`) ?? { hadDraft: false, dismissed: false },
              ]),
            ),
            withinReplyWindow: withinReplyWindow(message.receivedAt, now, profile),
          },
          ctx,
        );
      } catch (error) {
        log.warn("pipeline.stage_failed", { stage: "reply", error: errorName(error) });
      }
    }
  } finally {
    // Opened by the stages' body() or original(), if they asked; a shared one is its owner's.
    await own?.close();
  }

  log.info("pipeline.message_processed", {
    origin: options.origin,
    senderChecked: outcome.senderChecked,
    rolesEvaluated: outcome.evaluated.length,
    rolesFailed: outcome.failed.length,
  });
  await deps.live.publish(ws, { type: "messages.updated", data: { messageIds: [messageId] } });
  return outcome;
}

function stripCheck(stored: SenderCheck & { messageId: string; stale: boolean }): SenderCheck {
  return {
    verdict: stored.verdict,
    complete: stored.complete,
    reasons: stored.reasons,
    mark: stored.mark,
  };
}
