import type {
  ExtraQuestion,
  IntakeEdit,
  IntakeExtrasStatus,
  Profile,
  ProfileEntry,
  ProfileKey,
  ProfileSource,
  ProfileValue,
} from "@jobfilly/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "../client";
import { intakeAnswers, intakeExtras, profiles, workspaces } from "../tables";

// Profiles, the intake answers edited before Confirm and the cached extra questions (tables
// profiles, intake_answers and intake_extras). Every function takes a workspace id.

// --- Intake answers ------------------------------------------------------------------------------

type AnswerRow = typeof intakeAnswers.$inferSelect;

const toEdit = (row: AnswerRow): IntakeEdit => ({
  key: row.key as ProfileKey,
  value: row.value,
  source: row.source,
  updatedBy: row.updatedBy,
  updatedAt: row.updatedAt.toISOString(),
});

/** The user's edits to the intake form so far, oldest first. */
export async function listIntakeAnswers(db: Database, workspaceId: string): Promise<IntakeEdit[]> {
  const rows = await db
    .select()
    .from(intakeAnswers)
    .where(eq(intakeAnswers.workspaceId, workspaceId))
    .orderBy(asc(intakeAnswers.updatedAt), asc(intakeAnswers.key));
  return rows.map(toEdit);
}

/** Sets one answer of the intake form, replacing an earlier edit of the same key. */
export async function saveIntakeAnswer(
  db: Database,
  workspaceId: string,
  input: {
    key: ProfileKey;
    value: ProfileValue;
    source: ProfileSource;
    updatedBy: string | null;
    at: Date;
  },
): Promise<IntakeEdit> {
  const set = {
    value: input.value,
    source: input.source,
    updatedBy: input.updatedBy,
    updatedAt: input.at,
  };
  const [row] = await db
    .insert(intakeAnswers)
    .values({ workspaceId, key: input.key, ...set })
    .onConflictDoUpdate({ target: [intakeAnswers.workspaceId, intakeAnswers.key], set })
    .returning();
  if (!row) throw new Error("saveIntakeAnswer: no row returned");
  return toEdit(row);
}

// --- Extra questions (intake.v1, made once per workspace) -----------------------------------------
//
// The row is the claim: the caller whose insert wins makes the one call, everyone else sees
// 'pending' until it finishes. A claim left pending by a replica that died can be taken over by
// one caller once it is older than the caller's cut-off.

export interface IntakeExtrasState {
  status: Exclude<IntakeExtrasStatus, "none">;
  questions: ExtraQuestion[];
  claimedBy: string | null;
  claimedAt: Date | null;
}

export async function getIntakeExtras(
  db: Database,
  workspaceId: string,
): Promise<IntakeExtrasState | null> {
  const [row] = await db
    .select({
      status: intakeExtras.status,
      questions: intakeExtras.questions,
      claimedBy: intakeExtras.claimedBy,
      claimedAt: intakeExtras.claimedAt,
    })
    .from(intakeExtras)
    .where(eq(intakeExtras.workspaceId, workspaceId));
  return row ?? null;
}

/**
 * Claims the extra-questions call (INSERT … ON CONFLICT DO NOTHING): true for the one caller that
 * created the row, false for everyone else.
 */
export async function claimIntakeExtras(
  db: Database,
  workspaceId: string,
  claim: { instance: string; at: Date },
): Promise<boolean> {
  const rows = await db
    .insert(intakeExtras)
    .values({
      workspaceId,
      status: "pending",
      questions: [],
      claimedBy: claim.instance,
      claimedAt: claim.at,
      updatedAt: claim.at,
    })
    .onConflictDoNothing()
    .returning({ workspaceId: intakeExtras.workspaceId });
  return rows.length > 0;
}

/**
 * Takes over a claim still pending since before `staleBefore`, under a row lock, so only one of
 * several callers gets it. True for that caller.
 */
export async function takeOverIntakeExtras(
  db: Database,
  workspaceId: string,
  claim: { instance: string; at: Date; staleBefore: Date },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: intakeExtras.status, claimedAt: intakeExtras.claimedAt })
      .from(intakeExtras)
      .where(eq(intakeExtras.workspaceId, workspaceId))
      .for("update");
    if (row?.status !== "pending") return false;
    if (row.claimedAt && row.claimedAt >= claim.staleBefore) return false;
    await tx
      .update(intakeExtras)
      .set({ claimedBy: claim.instance, claimedAt: claim.at, updatedAt: claim.at })
      .where(eq(intakeExtras.workspaceId, workspaceId));
    return true;
  });
}

/**
 * Hands back the pending claim made at `claimedAt` (its call was abandoned): claimed_at becomes
 * null, so the next caller takes it over at once. A newer claim or a stored outcome is left alone.
 */
export async function releaseIntakeExtras(
  db: Database,
  workspaceId: string,
  claimedAt: Date,
): Promise<boolean> {
  const rows = await db
    .update(intakeExtras)
    .set({ claimedAt: null })
    .where(
      and(
        eq(intakeExtras.workspaceId, workspaceId),
        eq(intakeExtras.status, "pending"),
        eq(intakeExtras.claimedAt, claimedAt),
      ),
    )
    .returning({ workspaceId: intakeExtras.workspaceId });
  return rows.length > 0;
}

/**
 * Stores the call's outcome. Only the current claim may: false when the claim was taken over in
 * the meantime (its result then wins).
 */
export async function finishIntakeExtras(
  db: Database,
  workspaceId: string,
  input: {
    claim: { instance: string; at: Date };
    status: "done" | "failed";
    questions: ExtraQuestion[];
    at: Date;
  },
): Promise<boolean> {
  const rows = await db
    .update(intakeExtras)
    .set({ status: input.status, questions: input.questions, updatedAt: input.at })
    .where(
      and(
        eq(intakeExtras.workspaceId, workspaceId),
        eq(intakeExtras.status, "pending"),
        eq(intakeExtras.claimedBy, input.claim.instance),
        eq(intakeExtras.claimedAt, input.claim.at),
      ),
    )
    .returning({ workspaceId: intakeExtras.workspaceId });
  return rows.length > 0;
}

// --- Profiles ----------------------------------------------------------------------------------

type ProfileRow = typeof profiles.$inferSelect;

const toProfile = (row: ProfileRow): Profile => ({
  id: row.id,
  workspaceId: row.workspaceId,
  name: row.name,
  entries: row.entries,
  confirmedAt: row.confirmedAt?.toISOString() ?? null,
});

/** The workspace's profiles, oldest first. */
export async function listProfiles(db: Database, workspaceId: string): Promise<Profile[]> {
  const rows = await db
    .select()
    .from(profiles)
    .where(eq(profiles.workspaceId, workspaceId))
    .orderBy(asc(profiles.createdAt), asc(profiles.id));
  return rows.map(toProfile);
}

/**
 * Saves the confirmed intake as the workspace's profile. MVP 1 has one profile per workspace, so
 * a second Confirm is refused ("exists"); the workspace row is locked while checking, so two
 * Confirms at once still make one profile.
 */
export async function createConfirmedProfile(
  db: Database,
  workspaceId: string,
  input: { name: string; entries: ProfileEntry[]; createdBy: string; at: Date },
): Promise<{ ok: true; profile: Profile } | { ok: false; reason: "exists" }> {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for("update");
    const [existing] = await tx
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.workspaceId, workspaceId))
      .limit(1);
    if (existing) return { ok: false as const, reason: "exists" as const };
    const [row] = await tx
      .insert(profiles)
      .values({
        workspaceId,
        name: input.name,
        entries: input.entries,
        confirmedAt: input.at,
        createdBy: input.createdBy,
        createdAt: input.at,
        updatedAt: input.at,
      })
      .returning();
    if (!row) throw new Error("createConfirmedProfile: no row returned");
    return { ok: true as const, profile: toProfile(row) };
  });
}

/**
 * Changes a profile under a row lock: `change` gets the current profile and returns its new name
 * and entries, or an error that is passed back unchanged. null when the profile isn't there.
 */
export async function updateProfile<E>(
  db: Database,
  workspaceId: string,
  profileId: string,
  change: (
    current: Profile,
  ) => { ok: true; name: string; entries: ProfileEntry[] } | { ok: false; error: E },
  at: Date,
): Promise<{ ok: true; profile: Profile } | { ok: false; error: E } | null> {
  return db.transaction(async (tx) => {
    const where = and(eq(profiles.workspaceId, workspaceId), eq(profiles.id, profileId));
    const [row] = await tx.select().from(profiles).where(where).for("update");
    if (!row) return null;
    const next = change(toProfile(row));
    if (!next.ok) return next;
    const [updated] = await tx
      .update(profiles)
      .set({ name: next.name, entries: next.entries, updatedAt: at })
      .where(where)
      .returning();
    if (!updated) throw new Error("updateProfile: no row returned");
    return { ok: true as const, profile: toProfile(updated) };
  });
}

/** Whether the workspace has confirmed its intake (it then has a profile). */
export async function hasProfile(db: Database, workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`1` })
    .from(profiles)
    .where(eq(profiles.workspaceId, workspaceId))
    .limit(1);
  return row !== undefined;
}
