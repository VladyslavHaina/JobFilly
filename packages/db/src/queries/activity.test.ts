import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import { listActivity, recordActivity } from "./activity";
import { createInvite } from "./invites";
import { addMember } from "./workspaces";

// Reading the activity log (MVP 3, F9.1): newest first, in pages that never split entries sharing
// one instant, with the names of the people while their accounts exist and what each was about.

let conn: DatabaseConnection;
let maria: { userId: string; workspaceId: string };
let tom: { userId: string; workspaceId: string };
const at = new Date("2026-10-16T10:00:00.000Z");

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
  maria = await register("Maria Santos", "maria@inbox.example");
  tom = await register("Tom Okafor", "tom@inbox.example");
  await addMember(conn.db, maria.workspaceId, tom.userId, "editor");
});
afterEach(() => conn.close());

describe("listActivity", () => {
  it("pages newest first by entry, never splitting entries of one instant", async () => {
    for (let i = 0; i < 5; i++) {
      await recordActivity(
        conn.db,
        maria.workspaceId,
        {
          kind: "member.role_changed",
          actor: { kind: "user", userId: maria.userId },
          targetUserId: tom.userId,
          refs: { role: "editor" },
        },
        // Two instants: three entries share the later one.
        i < 2 ? at : new Date(at.getTime() + 1000),
      );
    }
    await recordActivity(
      conn.db,
      tom.workspaceId,
      {
        kind: "export.downloaded",
        actor: { kind: "user", userId: tom.userId },
        targetUserId: null,
        refs: {},
      },
      at,
    );
    const ids: string[] = [];
    let before: string | undefined;
    let pages = 0;
    do {
      const page = await listActivity(conn.db, maria.workspaceId, { before, limit: 2 });
      ids.push(...page.items.map((e) => e.id));
      before = page.nextBefore ?? undefined;
      pages += 1;
    } while (before);
    expect(pages).toBe(3);
    expect(new Set(ids).size).toBe(5);
    const all = await listActivity(conn.db, maria.workspaceId, { limit: 10 });
    expect(all.items.map((e) => e.id)).toEqual(ids);
    expect(all.nextBefore).toBeNull();
    expect(all.items[0]).toMatchObject({
      actorName: "Maria Santos",
      targetName: "Tom Okafor",
      refs: { role: "editor" },
    });
  });

  it("reads the email of an invite, and an automatic draft has no actor", async () => {
    const invite = await createInvite(conn.db, maria.workspaceId, {
      email: "anna@inbox.example",
      role: "viewer",
      tokenHash: "t",
      invitedBy: maria.userId,
      now: at,
      expiresAt: new Date(at.getTime() + 60_000),
    });
    await recordActivity(
      conn.db,
      maria.workspaceId,
      {
        kind: "member.invited",
        actor: { kind: "user", userId: maria.userId },
        targetUserId: null,
        refs: { inviteId: invite.id, role: "viewer" },
      },
      at,
    );
    await recordActivity(
      conn.db,
      maria.workspaceId,
      {
        kind: "draft.saved",
        actor: { kind: "system" },
        targetUserId: null,
        refs: { messageId: "<gone@agency.example>", position: 0 },
      },
      at,
    );
    const { items } = await listActivity(conn.db, maria.workspaceId, { limit: 10 });
    const invited = items.find((e) => e.kind === "member.invited");
    expect(invited).toMatchObject({ inviteEmail: "anna@inbox.example", actorName: "Maria Santos" });
    const draft = items.find((e) => e.kind === "draft.saved");
    expect(draft).toMatchObject({ actorKind: "system", actorName: null, roleTitle: null });
  });
});
