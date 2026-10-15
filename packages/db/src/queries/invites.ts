import type {
  Invite,
  InviteStatus,
  PendingInvitation,
  Role,
  WorkspaceSummary,
} from "@jobfilly/schema";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Database } from "../client";
import { invites, memberships, users, workspaces } from "../tables";
import { getMembership } from "./workspaces";

// Invites into a workspace. The admin's side is workspace-scoped; the invitee finds theirs by
// email, and answers one by id (the server checks the email or the link's token first).

type InviteRow = typeof invites.$inferSelect;

export function inviteStatus(row: InviteRow, now: Date): InviteStatus {
  if (row.acceptedAt) return "accepted";
  if (row.declinedAt) return "declined";
  if (row.revokedAt) return "revoked";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  return "pending";
}

function toInvite(row: InviteRow, now: Date): Invite {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: inviteStatus(row, now),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

const isOpen = (now: Date) =>
  and(
    isNull(invites.acceptedAt),
    isNull(invites.declinedAt),
    isNull(invites.revokedAt),
    gt(invites.expiresAt, now),
  );

export async function createInvite(
  db: Database,
  workspaceId: string,
  input: {
    email: string;
    role: Role;
    tokenHash: string;
    invitedBy: string;
    now: Date;
    expiresAt: Date;
  },
): Promise<Invite> {
  const [row] = await db
    .insert(invites)
    .values({
      workspaceId,
      email: input.email.toLowerCase(),
      role: input.role,
      tokenHash: input.tokenHash,
      invitedBy: input.invitedBy,
      createdAt: input.now,
      expiresAt: input.expiresAt,
    })
    .returning();
  if (!row) throw new Error("invite insert returned nothing");
  return toInvite(row, input.now);
}

/** The workspace's invites, newest first, each with its status at `now`. */
export async function listInvites(db: Database, workspaceId: string, now: Date): Promise<Invite[]> {
  const rows = await db
    .select()
    .from(invites)
    .where(eq(invites.workspaceId, workspaceId))
    .orderBy(desc(invites.createdAt));
  return rows.map((r) => toInvite(r, now));
}

/** Revokes a pending invite of this workspace; false when there is none. */
export async function revokeInvite(
  db: Database,
  workspaceId: string,
  inviteId: string,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(invites)
    .set({ revokedAt: now })
    .where(and(eq(invites.workspaceId, workspaceId), eq(invites.id, inviteId), isOpen(now)))
    .returning({ id: invites.id });
  return rows.length > 0;
}

/** Invitations waiting for this email address: not answered, revoked or expired. */
export async function listPendingInvitations(
  db: Database,
  email: string,
  now: Date,
): Promise<PendingInvitation[]> {
  const rows = await db
    .select({
      id: invites.id,
      workspaceId: invites.workspaceId,
      workspaceName: workspaces.name,
      invitedBy: users.name,
      role: invites.role,
      expiresAt: invites.expiresAt,
    })
    .from(invites)
    .innerJoin(workspaces, eq(workspaces.id, invites.workspaceId))
    .innerJoin(users, eq(users.id, invites.invitedBy))
    .where(and(eq(invites.email, email.toLowerCase()), isOpen(now)))
    .orderBy(desc(invites.createdAt));
  return rows.map((r) => ({ ...r, expiresAt: r.expiresAt.toISOString() }));
}

export interface InviteForResponse {
  id: string;
  workspaceId: string;
  email: string;
  role: Role;
  tokenHash: string;
  status: InviteStatus;
}

/** One invite by id, for the invitee answering it. */
export async function getInviteForResponse(
  db: Database,
  inviteId: string,
  now: Date,
): Promise<InviteForResponse | null> {
  const [row] = await db.select().from(invites).where(eq(invites.id, inviteId));
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.email,
    role: row.role,
    tokenHash: row.tokenHash,
    status: inviteStatus(row, now),
  };
}

/**
 * Accepts a pending invite: marks it accepted and makes the user a member with the invite's role
 * (someone already a member keeps their role). Null when the invite is no longer pending.
 */
export async function acceptInvite(
  db: Database,
  inviteId: string,
  input: { userId: string; now: Date },
): Promise<WorkspaceSummary | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(invites)
      .set({ acceptedAt: input.now })
      .where(and(eq(invites.id, inviteId), isOpen(input.now)))
      .returning({ workspaceId: invites.workspaceId, role: invites.role });
    if (!row) return null;
    await tx
      .insert(memberships)
      .values({ workspaceId: row.workspaceId, userId: input.userId, role: row.role })
      .onConflictDoNothing();
    return getMembership(tx, row.workspaceId, input.userId);
  });
}

/** Declines a pending invite; false when it is no longer pending. */
export async function declineInvite(db: Database, inviteId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(invites)
    .set({ declinedAt: now })
    .where(and(eq(invites.id, inviteId), isOpen(now)))
    .returning({ id: invites.id });
  return rows.length > 0;
}
