import type { ActivityRecord } from "@jobfilly/schema";
import type { Database } from "../client";
import { activityLog } from "../tables";

// The activity log (MVP 3, F9): outward and sharing actions, by id only (no name or address), so
// a deleted account leaves nothing of itself here and its actions show "Deleted user" (F7.3).
// recordActivity is the foundation's, called wherever such an action happens (a draft saved to
// the mailbox, a send, a member change, an export, a deletion); the reading side (the admins'
// list, the export) belongs to the workspace-admin slice.

/** Records one action in the workspace's log, at `at` (the caller's clock). */
export async function recordActivity(
  db: Database,
  workspaceId: string,
  record: ActivityRecord,
  at: Date,
): Promise<void> {
  await db.insert(activityLog).values({
    workspaceId,
    at,
    kind: record.kind,
    actorKind: record.actor.kind,
    actorId: record.actor.kind === "user" ? record.actor.userId : null,
    targetUserId: record.targetUserId,
    refs: record.refs,
  });
}
