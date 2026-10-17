import type { ActivityKind, ActivityRecord, ActivityRefs } from "@jobfilly/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "../client";
import { activityLog, invites, roles, users } from "../tables";

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

/**
 * One stored action with what it is about, read for the admins' list and the export: the names
 * of its actor and target while their accounts exist (null once gone), the role a draft or send
 * was for, and the email an invite went to while the invite exists.
 */
export interface StoredActivity {
  id: string;
  at: Date;
  kind: ActivityKind;
  actorKind: "user" | "system";
  actorId: string | null;
  actorName: string | null;
  targetUserId: string | null;
  targetName: string | null;
  refs: ActivityRefs;
  roleTitle: string | null;
  roleCompany: string | null;
  inviteEmail: string | null;
}

/**
 * A page of the workspace's activity log, newest first: up to `limit` entries older than the one
 * with id `before` (from the start without it), and the id to read the next page from (null at
 * the end). Paging by (at, id) never splits or skips entries that share an instant.
 */
export async function listActivity(
  db: Database,
  workspaceId: string,
  options: { before?: string; limit: number },
): Promise<{ items: StoredActivity[]; nextBefore: string | null }> {
  const actor = alias(users, "actor");
  const target = alias(users, "target");
  const before = options.before
    ? sql`(${activityLog.at}, ${activityLog.id}) < (select a.at, a.id from activity_log a
          where a.workspace_id = ${workspaceId} and a.id = ${options.before})`
    : undefined;
  const rows = await db
    .select({
      id: activityLog.id,
      at: activityLog.at,
      kind: activityLog.kind,
      actorKind: activityLog.actorKind,
      actorId: activityLog.actorId,
      actorName: actor.name,
      targetUserId: activityLog.targetUserId,
      targetName: target.name,
      refs: activityLog.refs,
      roleTitle: sql<string | null>`${roles.facts}->>'title'`,
      roleCompany: sql<
        string | null
      >`coalesce(${roles.facts}->>'company', ${roles.facts}->'agency'->>'client')`,
      inviteEmail: invites.email,
    })
    .from(activityLog)
    .leftJoin(actor, eq(actor.id, activityLog.actorId))
    .leftJoin(target, eq(target.id, activityLog.targetUserId))
    .leftJoin(
      roles,
      and(
        eq(roles.workspaceId, activityLog.workspaceId),
        sql`${roles.messageId} = ${activityLog.refs}->>'messageId'`,
        sql`${roles.position}::text = ${activityLog.refs}->>'position'`,
      ),
    )
    .leftJoin(
      invites,
      and(
        eq(invites.workspaceId, activityLog.workspaceId),
        sql`${invites.id}::text = ${activityLog.refs}->>'inviteId'`,
      ),
    )
    .where(and(eq(activityLog.workspaceId, workspaceId), before))
    .orderBy(desc(activityLog.at), desc(activityLog.id))
    .limit(options.limit + 1);
  const items = rows.slice(0, options.limit);
  return {
    items,
    nextBefore: rows.length > options.limit ? (items.at(-1)?.id ?? null) : null,
  };
}
