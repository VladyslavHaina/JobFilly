import { withinReplyWindow } from "@jobfilly/core";
import {
  draftHistory,
  getEvaluations,
  getMailboxConnection,
  getSenderChecks,
  listProfiles,
  listRules,
  loadMessageInputs,
  saveEvaluation,
  saveSenderCheck,
} from "@jobfilly/db";
import type { MailClient } from "@jobfilly/mail";
import type { OriginalMessage, Profile, RoleEvaluation, SenderCheck } from "@jobfilly/schema";
import type { AppDeps } from "../deps";
import { open } from "../secrets";
import { cvChoiceStage } from "./cv-choice";
import { matchStage } from "./match";
import { replyStage } from "./reply";
import { senderStage } from "./sender";
import type { StageContext, Stages } from "./stages";

// The analysis pipeline for one job message (F1.1, F1.6). Order: the sender stage, then per role
// the cv-choice and match stages, then the reply stage.
//
// - The sender stage runs only when the message's sender check is missing (new mail, the
//   backlog) or stale (a sender mark changed). A re-evaluation after a rule, profile, decision or
//   CV change passes the stored check on and never calls body(): re-scoring stays inside the
//   minute of F3.5, F4.6, F7.4 and F8.3 and works while the mailbox is down.
// - When the sender stage fails (the body can't be fetched…), the check stays missing for a later
//   sweep; the roles are still matched and the reply waits for the check (sender_check_pending).
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
  let mail: Promise<MailClient | null> | null = null;
  let body: Promise<string> | null = null;
  let original: Promise<OriginalMessage | null> | null = null;
  const mailbox = () => {
    mail ??= openMailbox(deps, ws);
    return mail;
  };
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
        const client = await mailbox();
        if (!client) throw new Error("no mailbox is connected");
        const fetched = await client.fetchBody(ref);
        if (!fetched) throw new Error("the message is no longer in the mailbox");
        return fetched.text;
      })();
      return body;
    },
    original() {
      original ??= (async () => {
        const client = await mailbox();
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
      try {
        sender = await stages.sender({ message }, ctx);
        await saveSenderCheck(deps.db, ws, messageId, sender, now);
        outcome.senderChecked = true;
      } catch (error) {
        log.warn("pipeline.stage_failed", { stage: "sender", error: errorName(error) });
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
    // Set by the stages' body() or original(), if they asked.
    const client = await (mail as Promise<MailClient | null> | null);
    await client?.close().catch(() => {});
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
