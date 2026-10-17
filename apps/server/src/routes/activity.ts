import { listActivity, type StoredActivity } from "@jobfilly/db";
import {
  type ActivityEntry,
  type ActivityKind,
  type ActivityList,
  ActivityQuerySchema,
  DELETED_USER,
  type MemberScope,
  type Role,
} from "@jobfilly/schema";
import { Hono } from "hono";
import { requireRole, validQuery, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";

// The activity log (MVP 3, F9.1): GET / lists outward and sharing actions, newest first, a page
// at a time (?before=<the last entry's id>). Mounted at /api/workspaces/:workspaceId/activity,
// admins only. A row holds ids only (D16); names are read when the log is, so a deleted account
// shows as "Deleted user".

const PAGE = 50;

/** The kinds that are about another member (their name is the entry's target). */
const ABOUT_A_MEMBER: readonly ActivityKind[] = [
  "member.role_changed",
  "member.scope_changed",
  "member.removed",
  "workspace.ownership_transferred",
];

const ROLE_NAMES: Record<Role, string> = { viewer: "Viewer", editor: "Editor", admin: "Admin" };
const SCOPE_NAMES: Record<MemberScope, string> = {
  everything: "everything",
  pipeline: "the job pipeline only",
};

function person(userId: string | null, name: string | null) {
  return userId && name ? { userId, name } : { userId: null, name: DELETED_USER };
}

/** One stored action as the log shows it: who, when, and what in plain words. */
export function activityEntry(row: StoredActivity): ActivityEntry {
  const actor = row.actorKind === "system" ? null : person(row.actorId, row.actorName);
  const target = ABOUT_A_MEMBER.includes(row.kind)
    ? person(row.targetUserId, row.targetName)
    : null;
  return {
    id: row.id,
    at: row.at.toISOString(),
    kind: row.kind,
    actor,
    target,
    what: describe(row, target?.name ?? DELETED_USER),
    refs: row.refs,
  };
}

function describe(row: StoredActivity, target: string): string {
  const role = row.roleTitle
    ? `${row.roleTitle}${row.roleCompany ? ` at ${row.roleCompany}` : ""}`
    : "a role";
  const roleName = row.refs.role ? ROLE_NAMES[row.refs.role] : "a member";
  const scope = row.refs.scope ? SCOPE_NAMES[row.refs.scope] : "everything";
  switch (row.kind) {
    case "draft.saved":
      return `Saved a reply draft to the mailbox: ${role}`;
    case "mail.sent":
      return `Sent the reply: ${role}`;
    case "member.invited":
      return `Invited ${row.inviteEmail ?? "someone"} as ${roleName}, seeing ${scope}`;
    case "member.role_changed":
      return `Made ${target} ${roleName}`;
    case "member.scope_changed":
      return `Let ${target} see ${scope}`;
    case "member.removed":
      return `Removed ${target} from the workspace`;
    case "member.left":
      return "Left the workspace";
    case "workspace.ownership_transferred":
      return `Handed the workspace over to ${target}`;
    case "export.downloaded":
      return "Downloaded the workspace's data";
    case "mailbox.connected":
      return "Connected a mailbox";
    case "mailbox.smtp_changed":
      return "Changed a mailbox's sending settings";
    case "mailbox.disconnected":
      return "Disconnected a mailbox";
    case "ai.settings_changed":
      return "Changed the AI provider settings";
    case "account.deleted":
      return "Deleted their account";
  }
}

export function activityRoutes(deps: AppDeps) {
  return new Hono<WorkspaceEnv>().get(
    "/",
    requireRole("admin"),
    validQuery(ActivityQuerySchema),
    async (c) => {
      const { before } = c.req.valid("query");
      const page = await listActivity(deps.db, c.get("workspaceId"), { before, limit: PAGE });
      return c.json({
        items: page.items.map(activityEntry),
        nextBefore: page.nextBefore,
      } satisfies ActivityList);
    },
  );
}
