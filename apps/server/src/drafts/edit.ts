import { getDraft, markDraftDiscarded, type StoredDraft, saveDraftEdit } from "@jobfilly/db";
import type { MailClient } from "@jobfilly/mail";
import type { DraftRef, DraftUpdate } from "@jobfilly/schema";
import type { AppDeps } from "../deps";
import type { Logger } from "../log";
import { type MailboxSession, mailboxSession } from "../pipeline/evaluate";
import {
  attachmentFor,
  contentHash,
  DraftMailboxError,
  isMailboxError,
  mailboxReason,
  originalFor,
} from "./mailbox";

// An editor's changes to a draft (F6.4): saving an edit replaces the mailbox copy, so exactly one
// remains, and discarding deletes it from the mailbox. When the mailbox can't take the change,
// nothing changes and the editor is told why; a draft is never edited in the app but not in the
// mailbox.
//
// Changes racing each other (two editors saving, a save and a discard, on any replicas) are
// compare-and-set on the copy's Message-ID (saveDraftEdit, markDraftDiscarded): each copy has its
// own, and a change made from a copy the row no longer names writes nothing. An edit that loses
// deletes the copy it appended and answers 409. A discard that loses deletes the copy the winner
// made and tries again, so a discard always leaves none.

export type DraftChange =
  | { ok: true; draft: StoredDraft }
  | { ok: false; error: "not_found" | "conflict" | "mailbox"; message: string };

const NOT_FOUND = { ok: false, error: "not_found", message: "No such draft" } as const;
const CHANGED = { ok: false, error: "conflict", message: "The draft changed meanwhile" } as const;

/** How often a discard deletes a newer copy an edit made meanwhile before it gives up. */
const DISCARD_ROUNDS = 3;

/** Runs the mailbox side of a change; any failure there is the mailbox's, in plain words. */
async function inMailbox<T>(
  session: MailboxSession,
  log: Logger,
  work: (client: MailClient) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  try {
    const client = await session.get();
    if (!client) throw new DraftMailboxError("No mailbox is connected");
    return { ok: true, value: await work(client) };
  } catch (error) {
    if (!isMailboxError(error)) {
      log.warn("pipeline.stage_failed", {
        stage: "draft",
        error: error instanceof Error ? error.name : "unknown",
      });
    }
    return { ok: false, reason: mailboxReason(error) };
  }
}

/** Saves an edit: the mailbox copy is replaced with the new text (and the same attachment). */
export async function editDraft(
  deps: AppDeps,
  ws: string,
  draftId: string,
  edit: DraftUpdate,
  log: Logger,
): Promise<DraftChange> {
  const draft = await getDraft(deps.db, ws, draftId);
  if (!draft) return NOT_FOUND;
  const copy = draft.mailbox;
  if ((draft.status !== "in_mailbox" && draft.status !== "edited") || !copy) {
    return { ok: false, error: "conflict", message: "Only a draft in the mailbox can be edited" };
  }
  const reply = { subject: edit.subject, body: edit.body };
  const attachment = await attachmentFor(deps, ws, draft.cvId);
  const session = mailboxSession(deps, ws);
  try {
    const replaced = await inMailbox<DraftRef>(session, log, async (client) => {
      const original = await originalFor(deps, ws, session, draft.messageId);
      return client.replaceDraft(copy, { original, reply, attachment });
    });
    if (!replaced.ok) {
      return {
        ok: false,
        error: "mailbox",
        message: `${replaced.reason}. Your edit wasn't saved.`,
      };
    }
    const saved = await saveDraftEdit(deps.db, ws, draft.id, {
      replaces: copy.draftMessageId,
      ...reply,
      ref: replaced.value,
      contentHash: contentHash({ reply, attachment }),
      now: deps.clock.now(),
    });
    if (!saved) {
      // Another change won since the draft was read: the copy this edit made goes again, so the
      // one the winner left is the only one.
      await inMailbox(session, log, (client) => client.deleteDraft(replaced.value));
      return CHANGED;
    }
    log.info("draft.updated", { draftId: draft.id });
    await deps.live.publish(ws, {
      type: "drafts.updated",
      data: { messageIds: [draft.messageId] },
    });
    return { ok: true, draft: saved };
  } finally {
    await session.close();
  }
}

/** Discards a draft: its mailbox copy is deleted; a failed one never had a copy. */
export async function discardDraft(
  deps: AppDeps,
  ws: string,
  draftId: string,
  log: Logger,
): Promise<DraftChange> {
  const session = mailboxSession(deps, ws);
  try {
    for (let round = 0; round < DISCARD_ROUNDS; round += 1) {
      const draft = await getDraft(deps.db, ws, draftId);
      if (!draft) return NOT_FOUND;
      if (draft.status === "discarded") return { ok: true, draft };
      if (draft.status === "saving") {
        return { ok: false, error: "conflict", message: "The draft is still being saved" };
      }
      const copy = draft.mailbox;
      if (copy) {
        const deleted = await inMailbox(session, log, (client) => client.deleteDraft(copy));
        if (!deleted.ok) {
          return {
            ok: false,
            error: "mailbox",
            message: `${deleted.reason}. The draft is still there.`,
          };
        }
      }
      const discarded = await markDraftDiscarded(deps.db, ws, draft.id, {
        copy: draft.draftMessageId,
        now: deps.clock.now(),
      });
      // Null: an edit replaced the copy meanwhile; the next round deletes the new one.
      if (!discarded) continue;
      log.info("draft.discarded", { draftId: draft.id });
      await deps.live.publish(ws, {
        type: "drafts.updated",
        data: { messageIds: [draft.messageId] },
      });
      return { ok: true, draft: discarded };
    }
    return CHANGED;
  } finally {
    await session.close();
  }
}
