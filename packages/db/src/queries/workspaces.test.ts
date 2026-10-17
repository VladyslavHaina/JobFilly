import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import { acceptInvite, createInvite } from "./invites";
import {
  addMember,
  createWorkspace,
  getMembership,
  listMembers,
  listWorkspacesForUser,
  removeMember,
  setMemberRole,
  setMemberScope,
  transferOwnership,
} from "./workspaces";

let conn: DatabaseConnection;
let maria: { userId: string; workspaceId: string };
let tom: { userId: string; workspaceId: string };

async function register(name: string, email: string) {
  const r = await registerAccount(conn.db, {
    name,
    email,
    passwordHash: "h",
    workspaceName: `${name}'s workspace`,
  });
  if (!r.ok) throw new Error("expected ok");
  return { userId: r.user.id, workspaceId: r.workspaceId };
}

beforeEach(async () => {
  conn = await openTestDatabase();
  maria = await register("Maria", "maria@inbox.example");
  tom = await register("Tom", "tom@inbox.example");
  const now = new Date();
  const invite = await createInvite(conn.db, maria.workspaceId, {
    email: "tom@inbox.example",
    role: "viewer",
    tokenHash: "t1",
    invitedBy: maria.userId,
    now,
    expiresAt: new Date(now.getTime() + 60_000),
  });
  await acceptInvite(conn.db, invite.id, { userId: tom.userId, now });
});
afterEach(() => conn.close());

describe("memberships", () => {
  it("resolves a member's role and nothing for a non-member", async () => {
    expect(await getMembership(conn.db, maria.workspaceId, tom.userId)).toMatchObject({
      id: maria.workspaceId,
      name: "Maria's workspace",
      role: "viewer",
      isOwner: false,
    });
    expect(await getMembership(conn.db, tom.workspaceId, maria.userId)).toBeNull();
  });

  it("changes a member's role but never the owner's", async () => {
    expect(await setMemberRole(conn.db, maria.workspaceId, tom.userId, "editor")).toBe("ok");
    expect((await getMembership(conn.db, maria.workspaceId, tom.userId))?.role).toBe("editor");
    expect(await setMemberRole(conn.db, maria.workspaceId, maria.userId, "viewer")).toBe("owner");
    expect(await setMemberRole(conn.db, tom.workspaceId, maria.userId, "viewer")).toBe("not_found");
  });

  it("removes a member but never the owner", async () => {
    expect(await removeMember(conn.db, maria.workspaceId, maria.userId)).toBe("owner");
    expect(await removeMember(conn.db, maria.workspaceId, tom.userId)).toBe("ok");
    expect(await removeMember(conn.db, maria.workspaceId, tom.userId)).toBe("not_found");
    expect((await listMembers(conn.db, maria.workspaceId)).map((m) => m.userId)).toEqual([
      maria.userId,
    ]);
  });

  it("lists only the workspace's own members", async () => {
    expect((await listMembers(conn.db, tom.workspaceId)).map((m) => m.name)).toEqual(["Tom"]);
    expect((await listMembers(conn.db, maria.workspaceId)).map((m) => m.name)).toEqual([
      "Maria",
      "Tom",
    ]);
  });
});

describe("more workspaces", () => {
  it("creates a workspace owned by its admin and adds members to it", async () => {
    const { id } = await createWorkspace(conn.db, { name: "Job hunt", ownerId: tom.userId });
    expect(await getMembership(conn.db, id, tom.userId)).toMatchObject({
      name: "Job hunt",
      role: "admin",
      isOwner: true,
    });
    expect(await addMember(conn.db, id, maria.userId, "viewer")).toBe("ok");
    expect(await addMember(conn.db, id, maria.userId, "editor")).toBe("ok");
    expect(await addMember(conn.db, id, tom.userId, "viewer")).toBe("owner");
    expect((await getMembership(conn.db, id, maria.userId))?.role).toBe("editor");
    expect((await listWorkspacesForUser(conn.db, maria.userId)).map((w) => w.name)).toEqual([
      "Maria's workspace",
      "Job hunt",
    ]);
  });
});

describe("handing over ownership (MVP 3, F6.3)", () => {
  it("only the owner hands the workspace to an admin, who then sees everything", async () => {
    const ws = maria.workspaceId;
    expect(await transferOwnership(conn.db, ws, maria.userId, tom.userId)).toBe("not_admin");
    expect(await setMemberRole(conn.db, ws, tom.userId, "admin")).toBe("ok");
    expect(await setMemberScope(conn.db, ws, tom.userId, "pipeline")).toBe("ok");
    expect(await transferOwnership(conn.db, ws, tom.userId, maria.userId)).toBe("not_owner");
    expect(await transferOwnership(conn.db, ws, maria.userId, maria.userId)).toBe("not_admin");
    expect(await transferOwnership(conn.db, tom.workspaceId, maria.userId, tom.userId)).toBe(
      "not_owner",
    );

    expect(await transferOwnership(conn.db, ws, maria.userId, tom.userId)).toBe("ok");
    expect(await getMembership(conn.db, ws, tom.userId)).toMatchObject({
      role: "admin",
      isOwner: true,
      scope: "everything",
    });
    expect(await getMembership(conn.db, ws, maria.userId)).toMatchObject({
      role: "admin",
      isOwner: false,
    });
    // Now Maria can be removed, and Tom can't.
    expect(await removeMember(conn.db, ws, tom.userId)).toBe("owner");
    expect(await transferOwnership(conn.db, ws, tom.userId, maria.userId)).toBe("ok");
    expect((await getMembership(conn.db, ws, maria.userId))?.isOwner).toBe(true);
  });
});
