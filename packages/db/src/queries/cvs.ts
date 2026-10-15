import type { Cv, CvMediaType, CvReadOutput, CvReadStatus, CvTag } from "@jobfilly/schema";
import { and, asc, eq } from "drizzle-orm";
import type { Database } from "../client";
import { cvs, profileCvs } from "../tables";

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

/** Links a CV to a profile (once; linking again is harmless). */
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
