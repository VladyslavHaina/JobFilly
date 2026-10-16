import { withinReplyWindow } from "@jobfilly/core";
import {
  type BackOff,
  clearStageFailure,
  clearStageFailures,
  draftHistory,
  getEvaluations,
  getSenderChecks,
  getStageHolds,
  listProfiles,
  listRules,
  loadMessageInputs,
  markStale,
  recordStageFailure,
  roleKey,
  saveEvaluation,
  saveMessageLanguage,
  saveSenderCheck,
} from "@jobfilly/db";
import type { MailClient } from "@jobfilly/mail";
import {
  CHECK_FAILED_SIGNAL,
  MESSAGE_GONE_SIGNAL,
  type OriginalMessage,
  type Profile,
  type RoleEvaluation,
  type SenderCheck,
} from "@jobfilly/schema";
import { MINUTE } from "../clock";
import type { AppDeps } from "../deps";
import { failureFields } from "../log";
import { connectMailbox } from "../mailbox";
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
// - When the sender stage fails (the mailbox can't be reached…), an incomplete check is stored
//   with the neutral check_failed reason ("Couldn't check this sender yet"), never "looks fine"
//   (F5.3), so the inbox shows that the check is incomplete instead of nothing. A check stored
//   earlier keeps what it found: its verdict (looks fine drops to caution, high risk stays) and an
//   editor's mark. It still counts as missing: it is checked again by a later sweep, the roles
//   are still matched, and the reply waits for a real check (sender_check_pending).
// - A stage that throws is logged with why (failureFields: the error's name, kind or code and a
//   short masked reason) and recorded in stage_failures (packages/db): it is tried again at the
//   next sweep, then with a back-off doubling from one sync interval up to an hour, so a stage
//   that keeps failing doesn't repeat its calls and log lines on every tick. A change that makes
//   the item stale again ends the wait. A message whose every pending stage still waits is left
//   alone: no stage, no reply stage, no log line.
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

/** The workspace's confirmed profile (one per workspace in MVP 2), or null. */
async function confirmedProfile(deps: AppDeps, ws: string): Promise<Profile | null> {
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
      opened ??= connectMailbox(deps, ws);
      return opened;
    },
    async close() {
      const client = await opened?.catch(() => null);
      opened = null;
      await client?.close().catch(() => {});
    },
  };
}

/** The longest a failing stage waits between tries (it starts at one sync interval). */
const MAX_BACK_OFF_MS = 60 * MINUTE;

const backOffOf = (deps: AppDeps): BackOff => ({
  intervalMs: deps.config.syncIntervalSeconds * 1000,
  capMs: MAX_BACK_OFF_MS,
});

const FAILED_REASON = {
  signal: CHECK_FAILED_SIGNAL,
  reason: "Couldn't check this sender yet. JobFilly tries again shortly.",
};

/**
 * The check of a message whose sender stage failed: incomplete, at best caution. A check stored
 * earlier keeps its verdict and its mark (a known high risk or an editor's mark isn't lost).
 */
function failedCheck(check: SenderCheck | null): SenderCheck {
  if (!check) return { verdict: "caution", complete: false, reasons: [FAILED_REASON], mark: null };
  return {
    ...check,
    verdict: check.verdict === "looks_fine" ? "caution" : check.verdict,
    complete: false,
    reasons: isFailedCheck(check) ? check.reasons : [...check.reasons, FAILED_REASON],
  };
}

const isFailedCheck = (check: SenderCheck) =>
  check.reasons.some((r) => r.signal === CHECK_FAILED_SIGNAL);

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

  const backOff = { ...backOffOf(deps), now };
  /** Records a failed stage and logs why, and when it is tried again. */
  const failed = async (
    stage: "sender" | "cv_choice" | "match",
    error: unknown,
    position?: number,
  ) => {
    const { failures, retryAt } = await recordStageFailure(
      deps.db,
      ws,
      position === undefined
        ? { messageId, stage: "sender" }
        : { messageId, stage: "match", position },
      backOff,
    );
    log.warn("pipeline.stage_failed", {
      stage,
      ...(position === undefined ? {} : { position }),
      ...failureFields(error),
      failures,
      retryAt,
    });
  };

  // What is to do, and what of it still waits out a back-off (stage_failures).
  const [stored] = await getSenderChecks(deps.db, ws, [messageId]);
  const senderWork = !stored || stored.stale || isFailedCheck(stored);
  let holds = await getStageHolds(deps.db, ws, messageId, now);
  const evaluationsBefore = profile ? await getEvaluations(deps.db, ws, [messageId]) : [];
  const rolesToDo = profile
    ? message.facts
        .map((_, position) => position)
        .filter((p) => {
          const current = evaluationsBefore.find((e) => e.position === p);
          return !current || current.stale;
        })
    : [];
  const senderDue = senderWork && !holds.sender;
  const rolesDue = rolesToDo.filter((p) => !holds.positions.includes(p));
  const waiting = (senderWork && holds.sender) || rolesDue.length < rolesToDo.length;
  if (waiting && !senderDue && rolesDue.length === 0) {
    // Everything pending waits out its back-off, and nothing changed since the last try.
    return outcome;
  }

  let rolesWaiting = 0;
  try {
    let sender: SenderCheck | null = stored && !stored.stale ? stripCheck(stored) : null;
    if (senderDue) {
      let result: SenderStageResult | null = null;
      let failure: { error: unknown } | null = null;
      try {
        result = await stages.sender({ message }, ctx);
      } catch (error) {
        failure = { error };
      }
      if (gone) {
        // The language stays as last detected: nothing new was read.
        result = { check: goneCheck(result?.check ?? null), language: message.language };
        log.warn("pipeline.message_gone", { stage: "sender" });
      }
      if (result) {
        sender = result.check;
        await saveSenderCheck(deps.db, ws, messageId, sender, now);
        await clearStageFailure(deps.db, ws, { messageId, stage: "sender" });
        outcome.senderChecked = true;
        if (await saveMessageLanguage(deps.db, ws, messageId, result.language)) {
          message.language = result.language;
          await markStale(deps.db, ws, { messageIds: [messageId] }, now);
          // A new question for every role: an evaluated one is stale now, and one never evaluated
          // (no stale flag to show the change) has its wait ended here.
          await clearStageFailures(deps.db, ws, { messageIds: [messageId] });
          holds = await getStageHolds(deps.db, ws, messageId, now);
        }
      } else if (failure) {
        // Incomplete, never "looks fine", and still to do (F5.3).
        sender = failedCheck(stored ? stripCheck(stored) : null);
        await saveSenderCheck(deps.db, ws, messageId, sender, now);
        await failed("sender", failure.error);
      }
    }

    if (profile) {
      const existing = new Map(
        (await getEvaluations(deps.db, ws, [messageId])).map((e) => [e.position, e]),
      );
      for (const [position, facts] of message.facts.entries()) {
        const current = existing.get(position);
        if (current && !current.stale) continue;
        if (holds.positions.includes(position)) {
          rolesWaiting += 1;
          continue;
        }
        let stage: "cv_choice" | "match" = "cv_choice";
        try {
          const role = { position, facts };
          const cvChoice = await stages.cvChoice({ message, role }, ctx);
          stage = "match";
          const evaluation = await stages.match({ message, role, cvChoice }, ctx);
          await saveEvaluation(deps.db, ws, messageId, { ...evaluation, position }, now);
          await clearStageFailure(deps.db, ws, { messageId, stage: "match", position });
          outcome.evaluated.push(position);
        } catch (error) {
          outcome.failed.push(position);
          await failed(stage, error, position);
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
            // A check whose stage failed isn't one: the reply waits (sender_check_pending).
            sender: sender && !isFailedCheck(sender) ? sender : null,
            evaluations,
            draftHistory: new Map(
              message.facts.map((_, position) => [
                position,
                history.get(roleKey({ messageId, position })) ?? {
                  hadDraft: false,
                  dismissed: false,
                },
              ]),
            ),
            withinReplyWindow: withinReplyWindow(message.receivedAt, now, profile),
          },
          ctx,
        );
      } catch (error) {
        // Not backed off: the reply stage runs only when something above changed.
        log.warn("pipeline.stage_failed", { stage: "reply", ...failureFields(error) });
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
    rolesWaiting,
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
