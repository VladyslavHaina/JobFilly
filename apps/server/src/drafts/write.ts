import {
  type DraftAnswer,
  draftEntries,
  findPlaceholders,
  groupNeeds,
  isOpen,
  needsFromQuestions,
} from "@jobfilly/core";
import {
  getAiSettings,
  getCv,
  getEvaluations,
  listProfiles,
  liveDraftFor,
  loadMessageInputs,
  markDraftFailed,
  markDraftSaved,
  releaseClaimWithNeeds,
  roleDecisions,
  type StoredDraft,
  saveDraftText,
} from "@jobfilly/db";
import type { MailClient } from "@jobfilly/mail";
import type {
  AiError,
  DraftCreatePayload,
  DraftFailureKind,
  DraftMailInput,
  DraftRef,
  DraftTaskInput,
  JobFacts,
  MailFolder,
  OriginalMessage,
  Profile,
} from "@jobfilly/schema";
import { aiClientFor } from "../ai-usage";
import type { AppDeps } from "../deps";
import type { Logger } from "../log";
import { type MailboxSession, mailboxSession } from "../pipeline/evaluate";
import { openAiKey } from "../secrets";
import {
  attachmentFor,
  contentHash,
  copyByMessageId,
  DraftMailboxError,
  draftMessageIdFor,
  isMailboxError,
  knowsUid,
  mailboxReason,
  originalFor,
} from "./mailbox";

// The draft.create job's work (F6.1–F6.3): one role's reply, written by draft.v1 and saved to the
// mailbox's Drafts folder, on the role's claim (a `saving` row, packages/db draft-claims). Only
// the claim holder gets here, so two evaluations racing for a role save one copy (F6.4).
//
// 1. The original is fetched from the mailbox (threading headers and the text to quote).
// 2. draft.v1 writes the reply from the profile and the chosen CV only (F6.2). Questions it can't
//    answer from them release the claim and become decisions (F7). A template placeholder is
//    regenerated once (Attempt: 2), then the draft fails with kind content, never retried
//    automatically. No answer at all fails it with kind ai. Draft a reply's questions are asked
//    even when the user chose "Don't ask for this message" before: they asked for this reply.
//    They are recorded with source draft_on_demand, an automatic draft's with source draft.
// 3. The text is kept on the row with the Message-ID its copy will have, then saved to the
//    mailbox with the chosen CV attached when the message asks for one (draft.v1's attachCv). A
//    failure before or in the append fails the draft with kind mailbox and leaves the text, so the
//    sweep's retry saves the same reply without another model call. The append is idempotent: a
//    retry deletes any copy with that Message-ID first, which an attempt may have left when it
//    died or failed after the append (recording it, a live event). Only a failure before or in
//    the append is the mailbox's; after it the row stays saving for the retry.
//
// The leftover copy is found through deleteDraft with UIDVALIDITY 0, which no folder has, so
// packages/mail looks the copy up by its Message-ID (the mailbox slice's client does this for a
// draft whose UID it never learned). This relies on saveDraft giving the copy the Message-ID
// chosen here (MailClient.saveDraft).

const AI_REASONS: Record<AiError["kind"], string> = {
  auth: "The AI provider didn't accept the key",
  unreachable: "Couldn't reach the AI provider",
  invalid_output: "The AI's answer didn't fit, even after a retry",
  not_retried: "The AI's answer didn't fit",
  provider_error: "The AI provider returned an error",
};

type Written =
  | { kind: "text"; subject: string; body: string; language: string; cvId: string | null }
  | { kind: "questions" }
  | { kind: "failed"; failure: DraftFailureKind; reason: string };

interface Role {
  messageId: string;
  position: number;
  facts: JobFacts;
  folder: MailFolder;
}

async function confirmedProfile(deps: AppDeps, ws: string): Promise<Profile | null> {
  return (await listProfiles(deps.db, ws)).find((p) => p.confirmedAt !== null) ?? null;
}

/**
 * The answers given for this role alone, which the draft may use besides the profile: an item,
 * or a no that turned the question down (draftEntries).
 */
function roleAnswers(rows: Awaited<ReturnType<typeof roleDecisions>>): DraftAnswer[] {
  return rows.flatMap((r) =>
    r.state === "resolved" && r.decisionStatus === "answered" && r.profileKey && r.answer !== null
      ? [{ profileKey: r.profileKey, groupKey: r.groupKey, question: r.question, value: r.answer }]
      : [],
  );
}

/** Asks draft.v1 for the reply (attempt 1, and attempt 2 after a placeholder). */
async function writeReply(
  deps: AppDeps,
  ws: string,
  draft: StoredDraft,
  role: Role,
  original: OriginalMessage,
  log: Logger,
): Promise<Written> {
  const settings = await getAiSettings(deps.db, ws);
  if (!settings) return { kind: "failed", failure: "ai", reason: "No AI model is set up" };
  let ai: ReturnType<typeof aiClientFor>;
  try {
    ai = aiClientFor(deps, ws, {
      provider: settings.provider,
      baseUrl: settings.baseUrl,
      models: settings.models,
      apiKey: openAiKey(deps.config.secretKey, settings.keyCiphertext),
    });
  } catch {
    return { kind: "failed", failure: "ai", reason: "The AI provider isn't set up correctly" };
  }
  const profile = await confirmedProfile(deps, ws);
  const [evaluation] = (await getEvaluations(deps.db, ws, [role.messageId])).filter(
    (e) => e.position === role.position,
  );
  const cvId = evaluation?.cvChoice.cvId ?? null;
  const cv = cvId ? await getCv(deps.db, ws, cvId) : null;
  const decided = await roleDecisions(deps.db, ws, [role]);
  const answeredHere = new Set(
    decided
      .filter((r) => r.state === "resolved" && r.decisionStatus === "answered")
      .map((r) => r.groupKey),
  );
  const input: Omit<DraftTaskInput, "attempt"> = {
    mail: {
      messageId: original.messageId,
      folder: role.folder,
      from: original.from,
      date: original.date,
      subject: original.subject,
      text: original.text,
    },
    position: role.position,
    role: role.facts,
    entries: draftEntries(profile?.entries ?? [], roleAnswers(decided)),
    cv:
      cv && cv.text !== null
        ? { name: cv.name, language: cv.language, skills: cv.skills, text: cv.text }
        : null,
  };

  for (const attempt of [1, 2] as const) {
    const result = await ai.draft({ ...input, attempt });
    if (!result.ok) return { kind: "failed", failure: "ai", reason: AI_REASONS[result.error.kind] };
    const out = result.data;
    // What it couldn't back up from the profile and the CV is asked, never guessed (F6.2).
    const needs = needsFromQuestions(out.questions).filter((n) => isOpen(n, profile, answeredHere));
    if (needs.length > 0) {
      const now = deps.clock.now();
      // Draft a reply's questions are told apart: only they keep waiting, and get the draft once
      // answered, when the policy holds the role (the reply stage).
      const onDemand = draft.origin === "on_demand";
      const groups = groupNeeds(
        needs.map((n) => ({
          ...n,
          source: onDemand ? ("draft_on_demand" as const) : ("draft" as const),
          messageId: role.messageId,
          position: role.position,
        })),
      );
      const { released, created } = await releaseClaimWithNeeds(
        deps.db,
        ws,
        draft.id,
        groups,
        now,
        { reopen: onDemand },
      );
      if (released) {
        for (const d of created)
          log.info("decision.created", { decisionId: d.id, source: "draft" });
        await deps.live.publish(ws, { type: "decisions.updated", data: {} });
      }
      return { kind: "questions" };
    }
    const placeholders = findPlaceholders(`${out.subject}\n${out.body}`);
    if (placeholders.length > 0) {
      log.warn("draft.rejected_placeholder", { draftId: draft.id, attempt });
      continue;
    }
    log.info("draft.created", {
      draftId: draft.id,
      origin: draft.origin,
      attempt,
      language: out.language,
      attachCv: out.attachCv && cv !== null,
    });
    return {
      kind: "text",
      subject: out.subject,
      body: out.body,
      language: out.language,
      cvId: out.attachCv && cv ? cv.id : null,
    };
  }
  return {
    kind: "failed",
    failure: "content",
    reason: "The draft still held a template placeholder after one retry",
  };
}

/** What goes to the mailbox: the reply, with the Message-ID chosen for its copy. */
interface Prepared {
  client: MailClient;
  mail: DraftMailInput & { draftMessageId: string };
  /** The text was written by an earlier attempt, which may have left a copy behind. */
  retry: boolean;
}

/**
 * Writes the role's claimed draft and saves it to the mailbox. A role with no `saving` claim has
 * nothing to do (another job finished it). Aborted on shutdown, it leaves the claim for the job's
 * next run or the sweep.
 */
export async function createDraft(
  deps: AppDeps,
  payload: DraftCreatePayload,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  const ws = payload.workspaceId;
  const draft = await liveDraftFor(deps.db, ws, payload);
  if (draft?.status !== "saving") return;
  const log = deps.log.child({ workspaceId: ws, draftId: draft.id });
  const publish = () =>
    deps.live.publish(ws, { type: "drafts.updated", data: { messageIds: [payload.messageId] } });
  const fail = async (kind: DraftFailureKind, reason: string) => {
    await markDraftFailed(deps.db, ws, draft.id, { kind, reason, now: deps.clock.now() });
    log.warn("pipeline.stage_failed", { stage: "draft", kind, attempts: draft.attempts });
    await publish();
  };
  /** Nothing is in the mailbox from this attempt: the draft fails with kind mailbox. */
  const failBeforeSaved = async (error: unknown) => {
    if (options.signal?.aborted) throw error;
    if (!isMailboxError(error)) {
      const name = error instanceof Error ? error.name : "unknown";
      log.warn("pipeline.stage_failed", { stage: "draft", error: name });
    }
    await fail("mailbox", mailboxReason(error));
  };

  const session = mailboxSession(deps, ws);
  try {
    let prepared: Prepared | null;
    try {
      prepared = await prepare(deps, payload, draft, session, log, { fail, publish });
    } catch (error) {
      return await failBeforeSaved(error);
    }
    if (!prepared) return;
    const { client, mail, retry } = prepared;

    let ref: DraftRef;
    try {
      if (retry) {
        // An earlier attempt may have appended this copy without recording it (it failed after
        // the append, or its replica died): that copy goes first, so one lands (F6.3, F6.4).
        const { path } = await client.ensureDraftsFolder();
        await client.deleteDraft(copyByMessageId(path, mail.draftMessageId));
      }
      ref = await client.saveDraft(mail);
    } catch (error) {
      return await failBeforeSaved(error);
    }

    // The copy is in the mailbox. A failure from here on (the database, a live event) isn't the
    // mailbox's: the row stays saving, and the retry finds this copy by its Message-ID.
    const saved = await markDraftSaved(deps.db, ws, draft.id, {
      ref,
      contentHash: contentHash(mail),
      attachmentName: mail.attachment?.fileName ?? null,
      now: deps.clock.now(),
    });
    if (!saved) {
      // Another run of this claim (the sweep took a stale one back) recorded its own copy, with
      // this same kept Message-ID. Only a ref with the copy's UID may go: one without (a server
      // without UIDPLUS, UIDVALIDITY 0) is found by Message-ID and would take the winner's copy.
      if (!knowsUid(ref)) {
        log.warn("draft.copy_left", { draftId: draft.id, reason: "uid_unknown" });
        return;
      }
      await client.deleteDraft(ref).catch(() => {
        log.warn("draft.copy_left", { draftId: draft.id, reason: "delete_failed" });
      });
      return;
    }
    log.info("draft.saved_to_mailbox", { draftId: draft.id, attached: mail.attachment !== null });
    await publish();
    await deps.live.publish(ws, {
      type: "messages.updated",
      data: { messageIds: [payload.messageId] },
    });
  } finally {
    await session.close();
  }
}

/**
 * The original, the reply and the mailbox for the append; null when the draft is done without
 * one (its questions became decisions, or it failed). Any throw happens before the append.
 */
async function prepare(
  deps: AppDeps,
  payload: DraftCreatePayload,
  draft: StoredDraft,
  session: MailboxSession,
  log: Logger,
  done: { fail(kind: DraftFailureKind, reason: string): Promise<void>; publish(): Promise<void> },
): Promise<Prepared | null> {
  const ws = payload.workspaceId;
  const [message] = await loadMessageInputs(deps.db, ws, [payload.messageId]);
  const facts = message?.facts[payload.position];
  if (!facts) {
    await done.fail("content", "This role is no longer in the message");
    return null;
  }
  const original = await originalFor(deps, ws, session, payload.messageId);

  // A retry after a mailbox failure (or a run that died): the reply is written already, with the
  // Message-ID its copy gets (saveDraftText keeps both together).
  const kept =
    draft.subject !== null && draft.body !== null && draft.draftMessageId !== null
      ? {
          subject: draft.subject,
          body: draft.body,
          cvId: draft.cvId,
          draftMessageId: draft.draftMessageId,
        }
      : null;
  let text: { subject: string; body: string; cvId: string | null; draftMessageId: string };
  if (kept) {
    text = kept;
  } else {
    const role = { ...payload, facts, folder: message.folder };
    const written = await writeReply(deps, ws, draft, role, original, log);
    if (written.kind === "questions") {
      await done.publish();
      return null;
    }
    if (written.kind === "failed") {
      await done.fail(written.failure, written.reason);
      return null;
    }
    const draftMessageId = await draftMessageIdFor(deps, ws);
    await saveDraftText(deps.db, ws, draft.id, {
      ...written,
      draftMessageId,
      now: deps.clock.now(),
    });
    text = { ...written, draftMessageId };
  }

  const attachment = await attachmentFor(deps, ws, text.cvId);
  const client = await session.get();
  if (!client) throw new DraftMailboxError("No mailbox is connected");
  return {
    client,
    retry: kept !== null,
    mail: {
      original,
      reply: { subject: text.subject, body: text.body },
      attachment,
      draftMessageId: text.draftMessageId,
    },
  };
}
