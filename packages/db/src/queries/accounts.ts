import type { AccountDeletionPreview, User } from "@jobfilly/schema";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { Database } from "../client";
import { invites, memberships, sessions, users, workspaces } from "../tables";
import { recordActivity } from "./activity";

// User accounts. Users aren't workspace data: they are found by id or by email. Deleting an
// account (MVP 3, F7.3) works on the user's own view across workspaces, by user id and email
// (ARCHITECTURE › Workspaces, access and sessions): the workspaces they own and belong to, and
// the invites to their email.

export interface StoredUser extends User {
  passwordHash: string;
}

export type RegisterResult =
  | { ok: true; user: User; workspaceId: string }
  | { ok: false; reason: "email_taken" };

/**
 * Creates the user and their personal workspace, with the user as owner and admin, in one
 * transaction. `email` must already be lower case.
 */
export async function registerAccount(
  db: Database,
  input: { name: string; email: string; passwordHash: string; workspaceName: string },
): Promise<RegisterResult> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ name: input.name, email: input.email, passwordHash: input.passwordHash })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id, name: users.name, email: users.email });
    if (!user) return { ok: false as const, reason: "email_taken" as const };
    const [workspace] = await tx
      .insert(workspaces)
      .values({ name: input.workspaceName, ownerId: user.id })
      .returning({ id: workspaces.id });
    if (!workspace) throw new Error("workspace insert returned nothing");
    await tx
      .insert(memberships)
      .values({ workspaceId: workspace.id, userId: user.id, role: "admin" });
    return { ok: true as const, user, workspaceId: workspace.id };
  });
}

export async function findUserByEmail(db: Database, email: string): Promise<StoredUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, email.toLowerCase()));
  return row ?? null;
}

/**
 * What deleting the user's account takes (F7.3): the workspaces they own, with their other
 * members, which go with it; and the others, which they just leave.
 */
export async function accountDeletionPreview(
  db: Database,
  userId: string,
): Promise<AccountDeletionPreview> {
  const mine = await db
    .select({ workspaceId: workspaces.id, name: workspaces.name, ownerId: workspaces.ownerId })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(workspaces.createdAt), asc(workspaces.id));
  const owned = mine.filter((w) => w.ownerId === userId);
  const others =
    owned.length === 0
      ? []
      : await db
          .select({ workspaceId: memberships.workspaceId, userId: users.id, name: users.name })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(
            and(
              inArray(
                memberships.workspaceId,
                owned.map((w) => w.workspaceId),
              ),
              ne(memberships.userId, userId),
            ),
          )
          .orderBy(asc(memberships.createdAt), asc(users.name));
  return {
    owned: owned.map((w) => ({
      workspaceId: w.workspaceId,
      name: w.name,
      members: others
        .filter((m) => m.workspaceId === w.workspaceId)
        .map((m) => ({ userId: m.userId, name: m.name })),
    })),
    memberOf: mine
      .filter((w) => w.ownerId !== userId)
      .map((w) => ({ workspaceId: w.workspaceId, name: w.name })),
  };
}

export interface DeletedAccount {
  /** The workspaces the user owned, deleted, each with the members whose access ended. */
  deletedWorkspaces: { workspaceId: string; memberIds: string[] }[];
  /** The workspaces the user belonged to and left. */
  leftWorkspaceIds: string[];
  /** The user's sessions, ended. */
  sessionIds: string[];
}

/**
 * Deletes the account (F7.3), in one transaction: the workspaces the user owns, with everything
 * in them; their memberships elsewhere, sessions and the invites to their email; then the user.
 * The activity log of every workspace they leave keeps their actions with the actor gone
 * ("Deleted user", D16), and records the deletion itself. Afterwards no row holds their name or
 * email.
 */
export async function deleteAccount(
  db: Database,
  user: { id: string; email: string },
  at: Date,
): Promise<DeletedAccount> {
  return db.transaction(async (tx) => {
    const preview = await accountDeletionPreview(tx, user.id);
    const userSessions = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, user.id));
    for (const w of preview.memberOf) {
      await recordActivity(
        tx,
        w.workspaceId,
        {
          kind: "account.deleted",
          actor: { kind: "user", userId: user.id },
          targetUserId: null,
          refs: {},
        },
        at,
      );
    }
    await tx.delete(workspaces).where(eq(workspaces.ownerId, user.id));
    await tx.delete(invites).where(eq(invites.email, user.email.toLowerCase()));
    await tx.delete(users).where(eq(users.id, user.id));
    return {
      deletedWorkspaces: preview.owned.map((w) => ({
        workspaceId: w.workspaceId,
        memberIds: w.members.map((m) => m.userId),
      })),
      leftWorkspaceIds: preview.memberOf.map((w) => w.workspaceId),
      sessionIds: userSessions.map((s) => s.id),
    };
  });
}
