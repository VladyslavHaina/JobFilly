import type { Cv, CvMediaType, CvReadOutput, CvReadStatus, CvTag } from "@jobfilly/schema";
import { and, asc, eq, exists, isNotNull, or, sql } from "drizzle-orm";
import type { Database } from "../client";
import { cvs, profileCvs, profiles, roleCvChoices, roles } from "../tables";

// CVs (F2): the file in Postgres (at most 5 MB, F2.4), its text, what cv.v1 read, and the tags.
// The foundation's base queries: the replies slice (the attachment and draft.v1's input) and the
// rules-match slice (the chosen CV's skills) read CVs through these, never through the
// cvs-senders slice, which owns this module afterwards and keeps these signatures.

type CvRow = typeof cvs.$inferSelect;

const cvColumns = {
  id: cvs.id,
  name: cvs.name,
  fileName: cvs.fileName,
  mediaType: cvs.mediaType,
  sizeBytes: cvs.sizeBytes,
  contentHash: cvs.contentHash,
  metadata: cvs.metadata,
  tags: cvs.tags,
  preferred: cvs.preferred,
  readStatus: cvs.readStatus,
  createdAt: cvs.createdAt,
};

type CvColumns = Pick<CvRow, keyof typeof cvColumns>;

function toCv(row: CvColumns): Cv {
  const m = row.metadata;
  return {
    id: row.id,
    name: row.name,
    fileName: row.fileName,
    mediaType: row.mediaType,
    sizeBytes: row.sizeBytes,
    contentHash: row.contentHash,
    language: m?.language ?? null,
    skills: m?.skills ?? [],
    roleFamilies: m?.roleFamilies ?? [],
    seniority: m?.seniority ?? null,
    countryHints: m?.countryHints ?? [],
    formatHints: m?.formatHints ?? [],
    tags: row.tags,
    preferred: row.preferred,
    readStatus: row.readStatus,
    uploadedAt: row.createdAt.toISOString(),
  };
}

/**
 * Stores an uploaded CV, not read yet unless `metadata` (what cv.v1 read) is given. The table
 * refuses a file over 5 MB.
 */
export async function insertCv(
  db: Database,
  workspaceId: string,
  input: {
    name: string;
    fileName: string;
    mediaType: CvMediaType;
    bytes: Uint8Array;
    contentHash: string;
    text?: string | null;
    metadata?: CvReadOutput | null;
    readStatus?: CvReadStatus;
    tags?: CvTag[];
    createdBy: string | null;
    at: Date;
  },
): Promise<Cv> {
  const [row] = await db
    .insert(cvs)
    .values({
      workspaceId,
      name: input.name,
      fileName: input.fileName,
      mediaType: input.mediaType,
      sizeBytes: input.bytes.byteLength,
      content: input.bytes,
      contentHash: input.contentHash,
      text: input.text ?? null,
      metadata: input.metadata ?? null,
      readStatus: input.readStatus ?? (input.metadata ? "done" : "pending"),
      tags: input.tags ?? [],
      createdBy: input.createdBy,
      createdAt: input.at,
      updatedAt: input.at,
    })
    .returning(cvColumns);
  if (!row) throw new Error("insertCv: no row returned");
  return toCv(row);
}

/**
 * Links a CV to a profile (once; linking again is harmless). The composite foreign keys refuse a
 * profile or a CV of another workspace.
 */
export async function linkProfileCv(
  db: Database,
  workspaceId: string,
  profileId: string,
  cvId: string,
): Promise<void> {
  await db.insert(profileCvs).values({ workspaceId, profileId, cvId }).onConflictDoNothing();
}

/** The workspace's CVs, oldest first. */
export async function listCvs(db: Database, workspaceId: string): Promise<Cv[]> {
  const rows = await db
    .select(cvColumns)
    .from(cvs)
    .where(eq(cvs.workspaceId, workspaceId))
    .orderBy(asc(cvs.createdAt), asc(cvs.id));
  return rows.map(toCv);
}

/** The CVs a profile uses, oldest first. */
export async function listProfileCvs(
  db: Database,
  workspaceId: string,
  profileId: string,
): Promise<Cv[]> {
  const rows = await db
    .select(cvColumns)
    .from(profileCvs)
    .innerJoin(cvs, eq(cvs.id, profileCvs.cvId))
    .where(
      and(
        eq(profileCvs.workspaceId, workspaceId),
        eq(profileCvs.profileId, profileId),
        eq(cvs.workspaceId, workspaceId),
      ),
    )
    .orderBy(asc(cvs.createdAt), asc(cvs.id));
  return rows.map(toCv);
}

/** One CV with its text (null until read), or null. Never the bytes: see getCvFile. */
export async function getCv(
  db: Database,
  workspaceId: string,
  cvId: string,
): Promise<(Cv & { text: string | null }) | null> {
  const [row] = await db
    .select({ ...cvColumns, text: cvs.text })
    .from(cvs)
    .where(and(eq(cvs.workspaceId, workspaceId), eq(cvs.id, cvId)));
  return row ? { ...toCv(row), text: row.text } : null;
}

/** The CV's file, for downloads and draft attachments, or null. */
export async function getCvFile(
  db: Database,
  workspaceId: string,
  cvId: string,
): Promise<{ bytes: Uint8Array; fileName: string; mediaType: CvMediaType } | null> {
  const [row] = await db
    .select({ bytes: cvs.content, fileName: cvs.fileName, mediaType: cvs.mediaType })
    .from(cvs)
    .where(and(eq(cvs.workspaceId, workspaceId), eq(cvs.id, cvId)));
  return row ?? null;
}

// --- Reading, tags, delete, profile links and the CV per role (the cvs-senders slice). --------

/**
 * Links a new CV to every profile of the workspace (MVP 2 has one), so the profile page lists it
 * and its roles can use it.
 */
export async function linkCvToProfiles(
  db: Database,
  workspaceId: string,
  cvId: string,
): Promise<void> {
  const list = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.workspaceId, workspaceId));
  if (list.length === 0) return;
  await db
    .insert(profileCvs)
    .values(list.map((p) => ({ workspaceId, profileId: p.id, cvId })))
    .onConflictDoNothing();
}

/**
 * The CVs a profile's roles choose from, oldest first: those linked to it, and those linked to
 * no profile yet (uploaded before the profile existed), which belong to every profile.
 */
export async function listCvsForProfile(
  db: Database,
  workspaceId: string,
  profileId: string,
): Promise<Cv[]> {
  const links = (profile: string | null) =>
    db
      .select({ one: sql`1` })
      .from(profileCvs)
      .where(
        and(
          eq(profileCvs.workspaceId, workspaceId),
          eq(profileCvs.cvId, cvs.id),
          profile === null ? undefined : eq(profileCvs.profileId, profile),
        ),
      );
  const rows = await db
    .select(cvColumns)
    .from(cvs)
    .where(
      and(
        eq(cvs.workspaceId, workspaceId),
        or(exists(links(profileId)), sql`not ${exists(links(null))}`),
      ),
    )
    .orderBy(asc(cvs.createdAt), asc(cvs.id));
  return rows.map(toCv);
}

/**
 * What cv.v1 read of a CV of the workspace with this content (cv.v1 is keyed by the content
 * hash, so the same file is read once), or null.
 */
export async function findCvReadByHash(
  db: Database,
  workspaceId: string,
  contentHash: string,
): Promise<CvReadOutput | null> {
  const [row] = await db
    .select({ metadata: cvs.metadata })
    .from(cvs)
    .where(
      and(
        eq(cvs.workspaceId, workspaceId),
        eq(cvs.contentHash, contentHash),
        eq(cvs.readStatus, "done"),
      ),
    )
    .orderBy(asc(cvs.createdAt))
    .limit(1);
  return row?.metadata ?? null;
}

/** Stores what cv.v1 read (its skills already checked) and the tags; the CV is then read. */
export async function saveCvRead(
  db: Database,
  workspaceId: string,
  cvId: string,
  input: { metadata: CvReadOutput; tags: CvTag[]; at: Date },
): Promise<Cv | null> {
  const [row] = await db
    .update(cvs)
    .set({ metadata: input.metadata, tags: input.tags, readStatus: "done", updatedAt: input.at })
    .where(and(eq(cvs.workspaceId, workspaceId), eq(cvs.id, cvId)))
    .returning(cvColumns);
  return row ? toCv(row) : null;
}

/** Marks a CV as unreadable (its read failed); it keeps whatever it had. */
export async function markCvReadFailed(
  db: Database,
  workspaceId: string,
  cvId: string,
  at: Date,
): Promise<void> {
  await db
    .update(cvs)
    .set({ readStatus: "failed", updatedAt: at })
    .where(and(eq(cvs.workspaceId, workspaceId), eq(cvs.id, cvId)));
}

/**
 * Replaces what the user edits of a CV (F2.1): its tags (AI tags kept or removed, their own
 * added), and of what cv.v1 read, the skills (the server checks an added one against the text,
 * F2.2) and the format hints; and whether it is the preferred CV. A field left out stays. The skills and format hints change only on
 * a CV that has been read; null when there is no such CV, or the CV is unread and they were given.
 */
export async function updateCv(
  db: Database,
  workspaceId: string,
  cvId: string,
  change: { tags?: CvTag[]; skills?: string[]; formatHints?: string[]; preferred?: boolean },
  at: Date,
): Promise<Cv | null> {
  const read: Partial<Pick<CvReadOutput, "skills" | "formatHints">> = {};
  if (change.skills) read.skills = change.skills;
  if (change.formatHints) read.formatHints = change.formatHints;
  const editsRead = Object.keys(read).length > 0;
  const [row] = await db
    .update(cvs)
    .set({
      ...(change.tags ? { tags: change.tags } : {}),
      ...(change.preferred !== undefined ? { preferred: change.preferred } : {}),
      ...(editsRead ? { metadata: sql`${cvs.metadata} || ${JSON.stringify(read)}::jsonb` } : {}),
      updatedAt: at,
    })
    .where(
      and(
        eq(cvs.workspaceId, workspaceId),
        eq(cvs.id, cvId),
        editsRead ? isNotNull(cvs.metadata) : undefined,
      ),
    )
    .returning(cvColumns);
  return row ? toCv(row) : null;
}

/**
 * Deletes a CV with its file (F2.5). Its profile links, CV-per-role overrides and stored match
 * answers go with it (CASCADE); drafts and role evaluations stay and forget it (SET NULL), so a
 * draft already in the mailbox stays there. False when there was no such CV.
 */
export async function deleteCv(db: Database, workspaceId: string, cvId: string): Promise<boolean> {
  const rows = await db
    .delete(cvs)
    .where(and(eq(cvs.workspaceId, workspaceId), eq(cvs.id, cvId)))
    .returning({ id: cvs.id });
  return rows.length > 0;
}

/** The CV an editor chose for a role (F2.3), or null for the automatic choice. */
export async function getRoleCvChoice(
  db: Database,
  workspaceId: string,
  role: { messageId: string; position: number },
): Promise<string | null> {
  const [row] = await db
    .select({ cvId: roleCvChoices.cvId })
    .from(roleCvChoices)
    .where(
      and(
        eq(roleCvChoices.workspaceId, workspaceId),
        eq(roleCvChoices.messageId, role.messageId),
        eq(roleCvChoices.position, role.position),
      ),
    );
  return row?.cvId ?? null;
}

export type SetRoleCvChoiceResult =
  | { ok: true; cv: Cv | null }
  | { ok: false; error: "not_found" | "unknown_cv" };

/**
 * An editor's CV for one role (F2.3), or null to go back to the automatic choice. not_found: the
 * workspace has no such role; unknown_cv: no such CV in the workspace.
 */
export async function setRoleCvChoice(
  db: Database,
  workspaceId: string,
  input: { messageId: string; position: number; cvId: string | null; userId: string; at: Date },
): Promise<SetRoleCvChoiceResult> {
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(
      and(
        eq(roles.workspaceId, workspaceId),
        eq(roles.messageId, input.messageId),
        eq(roles.position, input.position),
      ),
    );
  if (!role) return { ok: false, error: "not_found" };
  const where = and(
    eq(roleCvChoices.workspaceId, workspaceId),
    eq(roleCvChoices.messageId, input.messageId),
    eq(roleCvChoices.position, input.position),
  );
  if (input.cvId === null) {
    await db.delete(roleCvChoices).where(where);
    return { ok: true, cv: null };
  }
  const found = await getCv(db, workspaceId, input.cvId);
  if (!found) return { ok: false, error: "unknown_cv" };
  const { text: _text, ...cv } = found;
  const set = { cvId: cv.id, chosenBy: input.userId, chosenAt: input.at };
  await db
    .insert(roleCvChoices)
    .values({ workspaceId, messageId: input.messageId, position: input.position, ...set })
    .onConflictDoUpdate({
      target: [roleCvChoices.workspaceId, roleCvChoices.messageId, roleCvChoices.position],
      set,
    });
  return { ok: true, cv };
}
