import { changeLines, restoreChanges } from "@jobfilly/core";
import {
  getHistory,
  getHistoryEntry,
  listMembers,
  listProfiles,
  listRules,
  markUndone,
} from "@jobfilly/db";
import {
  type ChangeLine,
  type ProfileHistoryEntry,
  ProfileHistoryEntrySchema,
  type ProfileHistoryItem,
  type ProfileSnapshot,
  ProfileSnapshotSchema,
  type User,
} from "@jobfilly/schema";
import type { AppDeps } from "../deps";
import type { Logger } from "../log";
import { applyAndReevaluate } from "../profile/changes";
import { fail, inTransaction, NOT_FOUND_FAILURE, type Result, refuse } from "./result";

// The profile history (F8.4): every applied change with who, when, the source and the request
// behind it, in plain words before and after, and Undo. Undo restores the entry's `before` as
// Changes through the profile change service (by hand, source you), so the restore is in the
// history too and every role is re-evaluated. Each entry and rule comes back exactly as it was
// (restoreSnapshot: a removed rule keeps its id, source and creation, an entry its evidence).
// The entry is marked undone in the same transaction, so it is undone once. Like Apply, Undo writes no draft: those already in the
// mailbox stay, and the re-evaluation never recreates one a role had.

const NO_SNAPSHOT: ProfileSnapshot = { entries: [], rules: [] };

/** The line of an entry that can't be read, in place of its before and after. */
const UNREADABLE: ChangeLine = {
  target: "entry",
  label: "This change",
  before: "can't be shown",
  after: "can't be shown",
};

/**
 * A history entry as the API lists it. A row the schema refuses (an older one: MVP 3's first
 * hand-made rules stored blank words in their change) never breaks the list: its changes are left
 * out, and its before and after too when they don't read, with one generic line instead. Undo
 * still works from the stored row.
 */
function toItem(entry: ProfileHistoryEntry, names: Map<string, string>): ProfileHistoryItem {
  const byName = entry.by ? (names.get(entry.by) ?? null) : null;
  const parsed = ProfileHistoryEntrySchema.safeParse(entry);
  if (parsed.success) {
    return { ...entry, byName, lines: changeLines(entry.before, entry.after) };
  }
  const before = ProfileSnapshotSchema.safeParse(entry.before);
  const after = ProfileSnapshotSchema.safeParse(entry.after);
  const snapshots = before.success && after.success;
  return {
    ...entry,
    byName,
    changes: [],
    before: snapshots ? before.data : NO_SNAPSHOT,
    after: snapshots ? after.data : NO_SNAPSHOT,
    lines: snapshots ? changeLines(before.data, after.data) : [UNREADABLE],
  };
}

async function memberNames(deps: AppDeps, ws: string): Promise<Map<string, string>> {
  return new Map((await listMembers(deps.db, ws)).map((m) => [m.userId, m.name]));
}

const hasProfile = async (deps: AppDeps, ws: string, profileId: string) =>
  (await listProfiles(deps.db, ws)).some((p) => p.id === profileId);

/** The profile's history, newest first; null when the workspace has no such profile. */
export async function listHistory(
  deps: AppDeps,
  ws: string,
  profileId: string,
): Promise<ProfileHistoryItem[] | null> {
  if (!(await hasProfile(deps, ws, profileId))) return null;
  const [entries, names] = await Promise.all([
    getHistory(deps.db, ws, profileId),
    memberNames(deps, ws),
  ]);
  return entries.map((e) => toItem(e, names));
}

const UNDONE = fail(409, "undone", "This change was already undone.");

/** Undoes one change (POST …/history/:entryId/undo): restores what it changed. */
export async function undoChange(
  deps: AppDeps,
  ws: string,
  user: User,
  input: { profileId: string; entryId: string },
  log: Logger,
): Promise<Result<ProfileHistoryItem>> {
  const entry = await getHistoryEntry(deps.db, ws, input.profileId, input.entryId);
  if (!entry) return NOT_FOUND_FAILURE;
  if (entry.undoneAt) return UNDONE;
  const done = await inTransaction(deps, async (tx) => {
    if (!(await markUndone(tx.db, ws, entry.id, { userId: user.id, at: deps.clock.now() }))) {
      refuse(UNDONE);
    }
    const rules = await listRules(tx.db, ws, input.profileId);
    const result = await applyAndReevaluate(
      tx,
      ws,
      input.profileId,
      restoreChanges(entry.before, { rules }),
      { source: "you", userId: user.id, request: null, restore: entry.before },
    );
    if (!result) refuse(NOT_FOUND_FAILURE);
    if (!result.ok) {
      refuse(fail(409, "stale", "This change can't be undone any more."));
    }
  });
  if (!done.ok) return done;
  log.info("profile.change_undone", { entryId: entry.id });
  const fresh = await getHistoryEntry(deps.db, ws, input.profileId, entry.id);
  if (!fresh) return NOT_FOUND_FAILURE;
  return { ok: true, data: toItem(fresh, await memberNames(deps, ws)) };
}
