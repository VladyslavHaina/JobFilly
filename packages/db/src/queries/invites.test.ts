import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import {
  acceptInvite,
  createInvite,
  declineInvite,
  getInviteForResponse,
  listInvites,
  listPendingInvitations,
  revokeInvite,
} from "./invites";
import { getMembership } from "./workspaces";

let conn: DatabaseConnection;
let maria: { userId: string; workspaceId: string };
let tomId: string;
const t0 = new Date("2026-10-01T10:00:00Z");
const week = 7 * 24 * 3600 * 1000;

beforeEach(async () => {
  conn = await openTestDatabase();
  const m = await registerAccount(conn.db, {
    name: "Maria",
    email: "maria@inbox.example",
    passwordHash: "h",
    workspaceName: "Maria's workspace",
  });
  const t = await registerAccount(conn.db, {
    name: "Tom",
    email: "tom@inbox.example",
    passwordHash: "h",
    workspaceName: "Tom's workspace",
  });
  if (!m.ok || !t.ok) throw new Error("expected ok");
  maria = { userId: m.user.id, workspaceId: m.workspaceId };
  tomId = t.user.id;
});
afterEach(() => conn.close());

function invite(email = "Tom@Inbox.Example", tokenHash = "hash") {
  return createInvite(conn.db, maria.workspaceId, {
    email,
    role: "editor",
    tokenHash,
    invitedBy: maria.userId,
    now: t0,
    expiresAt: new Date(t0.getTime() + week),
  });
}

describe("invites", () => {
  it("shows the invitee their pending invitation until it expires", async () => {
    const created = await invite();
    expect(created).toMatchObject({
      email: "tom@inbox.example",
      role: "editor",
      status: "pending",
    });
    expect(await listPendingInvitations(conn.db, "tom@inbox.example", t0)).toEqual([
      {
        id: created.id,
        workspaceId: maria.workspaceId,
        workspaceName: "Maria's workspace",
        invitedBy: "Maria",
        role: "editor",
        expiresAt: new Date(t0.getTime() + week).toISOString(),
      },
    ]);
    const expired = new Date(t0.getTime() + week);
    expect(await listPendingInvitations(conn.db, "tom@inbox.example", expired)).toEqual([]);
    expect((await listInvites(conn.db, maria.workspaceId, expired))[0]?.status).toBe("expired");
    expect(await acceptInvite(conn.db, created.id, { userId: tomId, now: expired })).toBeNull();
  });

  it("accepting makes the invitee a member with the invite's role, once", async () => {
    const created = await invite();
    const ws = await acceptInvite(conn.db, created.id, { userId: tomId, now: t0 });
    expect(ws).toMatchObject({ id: maria.workspaceId, role: "editor", isOwner: false });
    expect((await getMembership(conn.db, maria.workspaceId, tomId))?.role).toBe("editor");
    expect(await acceptInvite(conn.db, created.id, { userId: tomId, now: t0 })).toBeNull();
    expect((await getInviteForResponse(conn.db, created.id, t0))?.status).toBe("accepted");
  });

  it("declining and revoking end the invite without a membership", async () => {
    const a = await invite("tom@inbox.example", "a");
    const b = await invite("tom@inbox.example", "b");
    expect(await declineInvite(conn.db, a.id, t0)).toBe(true);
    expect(await declineInvite(conn.db, a.id, t0)).toBe(false);
    expect(await revokeInvite(conn.db, maria.workspaceId, b.id, t0)).toBe(true);
    expect(await acceptInvite(conn.db, b.id, { userId: tomId, now: t0 })).toBeNull();
    expect(await getMembership(conn.db, maria.workspaceId, tomId)).toBeNull();
    const statuses = (await listInvites(conn.db, maria.workspaceId, t0)).map((i) => i.status);
    expect(statuses.sort()).toEqual(["declined", "revoked"]);
  });

  it("revokes only within the invite's own workspace", async () => {
    const created = await invite();
    const other = await registerAccount(conn.db, {
      name: "Eve",
      email: "eve@x.example",
      passwordHash: "h",
      workspaceName: "Eve's workspace",
    });
    if (!other.ok) throw new Error("expected ok");
    expect(await revokeInvite(conn.db, other.workspaceId, created.id, t0)).toBe(false);
    expect(await listInvites(conn.db, other.workspaceId, t0)).toEqual([]);
  });
});
