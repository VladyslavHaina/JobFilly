import type { Member, Role, WorkspaceSummary } from "@jobfilly/schema";
import { and, asc, eq } from "drizzle-orm";
import type { Database } from "../client";
import { memberships, users, workspaces } from "../tables";

// Workspaces and their members. The owner is an admin who can't be removed or demoted.

/** Creates a workspace with its owner as admin (registration creates the personal one). */
export async function createWorkspace(
  db: Database,
  input: { name: string; ownerId: string },
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(workspaces)
      .values({ name: input.name, ownerId: input.ownerId })
      .returning({ id: workspaces.id });
    if (!row) throw new Error("workspace insert returned nothing");
    await tx
      .insert(memberships)
      .values({ workspaceId: row.id, userId: input.ownerId, role: "admin" });
    return row;
  });
}

/** Adds a member, or sets the role of one already there (never the owner's). */
export async function addMember(
  db: Database,
  workspaceId: string,
  userId: string,
  role: Role,
): Promise<MemberChange> {
  if ((await ownerOf(db, workspaceId)) === userId) return "owner";
  await db
    .insert(memberships)
    .values({ workspaceId, userId, role })
    .onConflictDoUpdate({ target: [memberships.workspaceId, memberships.userId], set: { role } });
  return "ok";
}

/**
 * The workspaces the user belongs to, with their role. Scoped by user, not workspace, on purpose
 * (the signed-in user's own view; ARCHITECTURE › Workspaces, access and sessions).
 */
export async function listWorkspacesForUser(
  db: Database,
  userId: string,
): Promise<WorkspaceSummary[]> {
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      ownerId: workspaces.ownerId,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(workspaces.createdAt), asc(workspaces.id));
  return rows.map((r) => ({ ...r, isOwner: r.ownerId === userId }));
}

/** The user's membership of the workspace, or null when they aren't a member. */
export async function getMembership(
  db: Database,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceSummary | null> {
  const [row] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      ownerId: workspaces.ownerId,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)));
  return row ? { ...row, isOwner: row.ownerId === userId } : null;
}

export async function listMembers(db: Database, workspaceId: string): Promise<Member[]> {
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: memberships.role,
      ownerId: workspaces.ownerId,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.workspaceId, workspaceId))
    .orderBy(asc(memberships.createdAt), asc(users.name));
  return rows.map(({ ownerId, ...r }) => ({ ...r, isOwner: r.userId === ownerId }));
}

export type MemberChange = "ok" | "not_found" | "owner";

async function ownerOf(db: Database, workspaceId: string): Promise<string | null> {
  const [row] = await db
    .select({ ownerId: workspaces.ownerId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  return row?.ownerId ?? null;
}

/** Changes a member's role; the owner's role can't be changed. */
export async function setMemberRole(
  db: Database,
  workspaceId: string,
  userId: string,
  role: Role,
): Promise<MemberChange> {
  if ((await ownerOf(db, workspaceId)) === userId) return "owner";
  const rows = await db
    .update(memberships)
    .set({ role })
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
    .returning({ userId: memberships.userId });
  return rows.length > 0 ? "ok" : "not_found";
}

/** Removes a member; the owner can't be removed. */
export async function removeMember(
  db: Database,
  workspaceId: string,
  userId: string,
): Promise<MemberChange> {
  if ((await ownerOf(db, workspaceId)) === userId) return "owner";
  const rows = await db
    .delete(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
    .returning({ userId: memberships.userId });
  return rows.length > 0 ? "ok" : "not_found";
}
