import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import { acceptInvite, createInvite } from "./invites";
import { getMembership, listMembers, removeMember, setMemberRole } from "./workspaces";

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
