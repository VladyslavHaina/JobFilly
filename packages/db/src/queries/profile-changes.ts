import type {
  Change,
  Profile,
  ProfileEntry,
  ProfileHistoryEntry,
  ProfileSnapshot,
  ProfileSource,
  Rule,
} from "@jobfilly/schema";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "../client";
import { profileHistory, profiles, rules } from "../tables";
import { toRule } from "./rules";

// The profile change service's storage (ARCHITECTURE › The profile change service): every change
// to a profile's entries and rules — by hand, a decision answer, an applied proposal, an undo — is
// a list of Changes applied under a row lock, written with its profile_history row (who, when,
// the source, the request, before and after) in one transaction.
//
// The Change semantics live in packages/core (applyChanges), which packages/db doesn't import:
// the caller passes it as `apply`, so this module stays storage only.

/** A profile with its rules, as `apply` gets them. */
export interface ProfileState {
  profile: Profile;
  rules: Rule[];
}

/** What `apply` returns: the new entries and rules, and the touched ones before and after. */
export type ApplyResult<E> =
  | {
      ok: true;
      entries: ProfileEntry[];
      rules: Rule[];
      before: ProfileSnapshot;
      after: ProfileSnapshot;
    }
  | { ok: false; error: E };

export interface ChangeMeta<E> {
  source: ProfileSource;
  /** Who asked; null for the system. */
  userId: string | null;
  /** The words behind the change (the assistant request, the decision's question), or null. */
  request: string | null;
  at: Date;
  /** packages/core's applyChanges, bound to its context (ids, source, time). */
  apply: (state: ProfileState, changes: readonly Change[]) => ApplyResult<E>;
}

export type ApplyProfileChangesResult<E> =
  | { ok: true; profile: Profile; rules: Rule[]; entry: ProfileHistoryEntry | null }
  | { ok: false; error: E };

type ProfileRow = typeof profiles.$inferSelect;
type HistoryRow = typeof profileHistory.$inferSelect;

const toProfile = (row: ProfileRow): Profile => ({
  id: row.id,
  workspaceId: row.workspaceId,
  name: row.name,
  entries: row.entries,
  confirmedAt: row.confirmedAt?.toISOString() ?? null,
  enabled: row.enabled,
});

function toHistoryEntry(row: HistoryRow): ProfileHistoryEntry {
  return {
    id: row.id,
    at: row.at.toISOString(),
    by: row.by,
    source: row.source,
    request: row.request,
    changes: row.changes,
    before: row.before,
    after: row.after,
    undoneAt: row.undoneAt?.toISOString() ?? null,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Applies `changes` to the profile and its rules in one transaction, under a row lock: `apply`
 * gets the current state and returns the next; entries, rules and the history row are written
 * together. A list that changes nothing writes no history (entry null). Null when the workspace
 * has no such profile; an `apply` error is passed back unchanged and nothing is written.
 */
export async function applyProfileChanges<E>(
  db: Database,
  workspaceId: string,
  profileId: string,
  changes: readonly Change[],
  meta: ChangeMeta<E>,
): Promise<ApplyProfileChangesResult<E> | null> {
  return db.transaction(async (tx) => {
    const where = and(eq(profiles.workspaceId, workspaceId), eq(profiles.id, profileId));
    const [row] = await tx.select().from(profiles).where(where).for("update");
    if (!row) return null;
    const current = (
      await tx
        .select()
        .from(rules)
        .where(and(eq(rules.workspaceId, workspaceId), eq(rules.profileId, profileId)))
    ).map(toRule);
    const next = meta.apply({ profile: toProfile(row), rules: current }, changes);
    if (!next.ok) return next;

    const [updated] = await tx
      .update(profiles)
      .set({ entries: next.entries, updatedAt: meta.at })
      .where(where)
      .returning();
    if (!updated) throw new Error("applyProfileChanges: no row returned");

    const before = new Map(current.map((r) => [r.id, r]));
    const after = new Map(next.rules.map((r) => [r.id, r]));
    const removed = current.filter((r) => !after.has(r.id)).map((r) => r.id);
    if (removed.length > 0) {
      await tx
        .delete(rules)
        .where(and(eq(rules.workspaceId, workspaceId), inArray(rules.id, removed)));
    }
    for (const rule of next.rules) {
      const old = before.get(rule.id);
      const values = {
        description: rule.description,
        conditions: rule.when,
        action: rule.then,
        enabled: rule.enabled,
        source: rule.source,
        updatedAt: meta.at,
      };
      if (!old) {
        await tx.insert(rules).values({
          id: rule.id,
          workspaceId,
          profileId,
          createdBy: rule.createdBy,
          createdAt: new Date(rule.createdAt),
          ...values,
        });
      } else if (!same(old, rule)) {
        await tx
          .update(rules)
          .set(values)
          .where(and(eq(rules.workspaceId, workspaceId), eq(rules.id, rule.id)));
      }
    }

    let entry: ProfileHistoryEntry | null = null;
    if (!same(next.before, next.after)) {
      const [history] = await tx
        .insert(profileHistory)
        .values({
          workspaceId,
          profileId,
          at: meta.at,
          by: meta.userId,
          source: meta.source,
          request: meta.request,
          changes: [...changes],
          before: next.before,
          after: next.after,
        })
        .returning();
      if (!history) throw new Error("applyProfileChanges: no history row returned");
      entry = toHistoryEntry(history);
    }
    return { ok: true as const, profile: toProfile(updated), rules: next.rules, entry };
  });
}

/** A profile's history, newest first (F8.4). */
export async function getHistory(
  db: Database,
  workspaceId: string,
  profileId: string,
): Promise<ProfileHistoryEntry[]> {
  const rows = await db
    .select()
    .from(profileHistory)
    .where(
      and(eq(profileHistory.workspaceId, workspaceId), eq(profileHistory.profileId, profileId)),
    )
    .orderBy(desc(profileHistory.at), desc(profileHistory.id));
  return rows.map(toHistoryEntry);
}

/** One history entry of a profile, or null. */
export async function getHistoryEntry(
  db: Database,
  workspaceId: string,
  profileId: string,
  entryId: string,
): Promise<ProfileHistoryEntry | null> {
  const [row] = await db
    .select()
    .from(profileHistory)
    .where(
      and(
        eq(profileHistory.workspaceId, workspaceId),
        eq(profileHistory.profileId, profileId),
        eq(profileHistory.id, entryId),
      ),
    );
  return row ? toHistoryEntry(row) : null;
}

/**
 * Marks an entry undone (Undo, F8.4), once: false when it was undone already or isn't there.
 * Pass the transaction that applies the restoring changes.
 */
export async function markUndone(
  db: Database,
  workspaceId: string,
  entryId: string,
  input: { userId: string | null; at: Date },
): Promise<boolean> {
  const rows = await db
    .update(profileHistory)
    .set({ undoneAt: input.at, undoneBy: input.userId })
    .where(
      and(
        eq(profileHistory.workspaceId, workspaceId),
        eq(profileHistory.id, entryId),
        isNull(profileHistory.undoneAt),
      ),
    )
    .returning({ id: profileHistory.id });
  return rows.length > 0;
}
