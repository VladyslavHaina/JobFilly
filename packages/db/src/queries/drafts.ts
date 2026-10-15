import type { Draft, DraftOrigin, DraftRef, DraftStatus } from "@jobfilly/schema";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Database } from "../client";
import { drafts } from "../tables";
import type { RoleRef } from "./evaluations";

// A draft's content and edits (F6): the reply text only — never the quote of the original, which
// packages/mail adds when it builds the MIME message — and where its copy is in the mailbox
// (folder, UID, UIDVALIDITY, the draft's own Message-ID, a content hash). Who may write a role's
// draft, and when it is tried again, is ./draft-claims.ts.
//
//   saving      ─saveDraftText─▶ saving (the text and the Message-ID the copy will have are
//                                kept, so a retry after a mailbox failure makes no second model
//                                call and finds a copy an earlier attempt may have left)
//   saving      ─markDraftSaved─▶ in_mailbox
//   in_mailbox  ─saveDraftEdit─▶ edited ─saveDraftEdit─▶ edited
//   in_mailbox, edited, failed ─markDraftDiscarded─▶ discarded
//
// An edit and a discard compare and set on the draft's Message-ID, which each mailbox copy has
// its own of: one that read an older copy than the row names by now changes nothing, so its
// caller deletes the copy it made and exactly one remains (F6.4).

type DraftRow = typeof drafts.$inferSelect;

/** A draft with what the server needs besides the API's view: its claim and mailbox copy. */
export interface StoredDraft extends Draft {
  origin: DraftOrigin;
  attempts: number;
  /** Where the copy is in the Drafts folder; null while there is none. */
  mailbox: DraftRef | null;
  /**
   * The Message-ID of the mailbox copy, or of the one draft.create appends (kept before the
   * append); what an edit or a discard compares against. Null before the text is written.
   */
  draftMessageId: string | null;
  contentHash: string | null;
}

function toDraft(row: DraftRow): StoredDraft {
  const mailbox =
    row.mailboxFolder !== null &&
    row.uid !== null &&
    row.uidValidity !== null &&
    row.draftMessageId !== null
      ? {
          path: row.mailboxFolder,
          uid: row.uid,
          uidValidity: row.uidValidity,
          draftMessageId: row.draftMessageId,
        }
      : null;
  return {
    id: row.id,
    messageId: row.messageId,
    position: row.position,
    status: row.status,
    failureKind: row.failureKind ?? null,
    failureReason: row.failureReason,
    subject: row.subject,
    body: row.body,
    language: row.language,
    cvId: row.cvId,
    auto: row.origin !== "on_demand",
    updatedAt: row.updatedAt.toISOString(),
    origin: row.origin,
    attempts: row.attempts,
    mailbox,
    draftMessageId: row.draftMessageId,
    contentHash: row.contentHash,
  };
}

/** The API's view of a stored draft. */
export function publicDraft(draft: StoredDraft): Draft {
  const {
    origin: _o,
    attempts: _a,
    mailbox: _m,
    draftMessageId: _d,
    contentHash: _c,
    ...view
  } = draft;
  return view;
}

/** The workspace's drafts, newest change first; only one message's when `messageId` is given. */
export async function listDrafts(
  db: Database,
  workspaceId: string,
  filter: { messageId?: string } = {},
): Promise<StoredDraft[]> {
  const rows = await db
    .select()
    .from(drafts)
    .where(
      and(
        eq(drafts.workspaceId, workspaceId),
        filter.messageId === undefined ? undefined : eq(drafts.messageId, filter.messageId),
      ),
    )
    .orderBy(desc(drafts.updatedAt), desc(drafts.createdAt));
  return rows.map(toDraft);
}

export async function getDraft(
  db: Database,
  workspaceId: string,
  draftId: string,
): Promise<StoredDraft | null> {
  const [row] = await db
    .select()
    .from(drafts)
    .where(and(eq(drafts.workspaceId, workspaceId), eq(drafts.id, draftId)));
  return row ? toDraft(row) : null;
}

/** The role's live draft (any status but discarded), or null. */
export async function liveDraftFor(
  db: Database,
  workspaceId: string,
  role: RoleRef,
): Promise<StoredDraft | null> {
  const [row] = await db
    .select()
    .from(drafts)
    .where(
      and(
        eq(drafts.workspaceId, workspaceId),
        eq(drafts.messageId, role.messageId),
        eq(drafts.position, role.position),
        ne(drafts.status, "discarded"),
      ),
    );
  return row ? toDraft(row) : null;
}

const whereStatus = (workspaceId: string, draftId: string, statuses: DraftStatus[]) =>
  and(
    eq(drafts.workspaceId, workspaceId),
    eq(drafts.id, draftId),
    inArray(drafts.status, statuses),
  );

/**
 * Keeps the reply draft.v1 wrote on a claimed (saving) draft, before it goes to the mailbox: a
 * retry after a mailbox failure saves this same text. `cvId` is the CV to attach, or null;
 * `draftMessageId` the Message-ID its mailbox copy gets, chosen before the append.
 */
export async function saveDraftText(
  db: Database,
  workspaceId: string,
  draftId: string,
  input: {
    subject: string;
    body: string;
    language: string | null;
    cvId: string | null;
    draftMessageId: string;
    now: Date;
  },
): Promise<boolean> {
  const rows = await db
    .update(drafts)
    .set({
      subject: input.subject,
      body: input.body,
      language: input.language,
      cvId: input.cvId,
      draftMessageId: input.draftMessageId,
      updatedAt: input.now,
    })
    .where(whereStatus(workspaceId, draftId, ["saving"]))
    .returning({ id: drafts.id });
  return rows.length > 0;
}

/** A claimed draft is in the mailbox now: its copy's reference, and the claim ends. */
export async function markDraftSaved(
  db: Database,
  workspaceId: string,
  draftId: string,
  input: { ref: DraftRef; contentHash: string; now: Date },
): Promise<boolean> {
  const rows = await db
    .update(drafts)
    .set({
      status: "in_mailbox",
      ...refColumns(input.ref),
      contentHash: input.contentHash,
      claimedAt: null,
      failureKind: null,
      failureReason: null,
      updatedAt: input.now,
    })
    .where(whereStatus(workspaceId, draftId, ["saving"]))
    .returning({ id: drafts.id });
  return rows.length > 0;
}

const refColumns = (ref: DraftRef | null) => ({
  mailboxFolder: ref?.path ?? null,
  uid: ref?.uid ?? null,
  uidValidity: ref?.uidValidity ?? null,
  draftMessageId: ref?.draftMessageId ?? null,
});

/** The row still names the copy with this Message-ID (null: it names none). */
const namesCopy = (draftMessageId: string | null) =>
  draftMessageId === null
    ? isNull(drafts.draftMessageId)
    : eq(drafts.draftMessageId, draftMessageId);

/**
 * An editor's saved edit (F6.4), with the reference of the copy that replaced the old one.
 * `replaces` is the Message-ID of the copy the edit replaced. Null when the row names another
 * copy by now (another edit or a discard won), so the caller deletes the copy it made.
 */
export async function saveDraftEdit(
  db: Database,
  workspaceId: string,
  draftId: string,
  input: {
    replaces: string;
    subject: string;
    body: string;
    ref: DraftRef;
    contentHash: string;
    now: Date;
  },
): Promise<StoredDraft | null> {
  const [row] = await db
    .update(drafts)
    .set({
      status: "edited",
      subject: input.subject,
      body: input.body,
      ...refColumns(input.ref),
      contentHash: input.contentHash,
      updatedAt: input.now,
    })
    .where(
      and(whereStatus(workspaceId, draftId, ["in_mailbox", "edited"]), namesCopy(input.replaces)),
    )
    .returning();
  return row ? toDraft(row) : null;
}

/**
 * Discards a draft whose copy is gone from the mailbox (or never got there): it stays listed as
 * discarded and is never recreated automatically (TBD-193). `copy` is the Message-ID the caller
 * read (and deleted). Null when the row names another copy by now (an edit won meanwhile).
 */
export async function markDraftDiscarded(
  db: Database,
  workspaceId: string,
  draftId: string,
  input: { copy: string | null; now: Date },
): Promise<StoredDraft | null> {
  const [row] = await db
    .update(drafts)
    .set({ status: "discarded", ...refColumns(null), claimedAt: null, updatedAt: input.now })
    .where(
      and(
        whereStatus(workspaceId, draftId, ["in_mailbox", "edited", "failed"]),
        namesCopy(input.copy),
      ),
    )
    .returning();
  return row ? toDraft(row) : null;
}
