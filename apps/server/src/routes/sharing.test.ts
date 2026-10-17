import { addMember, getMembership } from "@jobfilly/db";
import { activityRows } from "@jobfilly/db/testing";
import { AcceptedInviteSchema, CreatedInviteSchema, MemberListSchema } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import {
  createTestDeps,
  type SeededUser,
  seedUser,
  signedIn,
  type TestClient,
  type TestDeps,
} from "../testing";

// Selective sharing and members (MVP 3, F6.1, F6.3): an admin chooses what a member sees when
// inviting and later; admins change roles and remove members; members leave; the owner can't be
// removed but hands the workspace to another admin. Each change is logged and in the activity log.

let deps: TestDeps;
let app: ReturnType<typeof createApp>;
let maria: SeededUser;
let tom: SeededUser;
let mariaApi: TestClient;
let tomApi: TestClient;

beforeEach(async () => {
  deps = await createTestDeps();
  app = createApp(deps);
  maria = await seedUser(deps, { name: "Maria Santos", email: "maria.santos@inbox.example" });
  tom = await seedUser(deps, { name: "Tom Okafor", email: "tom.okafor@inbox.example" });
  mariaApi = await signedIn(app, deps, maria);
  tomApi = await signedIn(app, deps, tom);
});
afterEach(() => deps.close());

const members = () => `/api/workspaces/${maria.workspaceId}/members`;
const member = (id: string) => `${members()}/${id}`;
const events = () => deps.logs.map((l) => l.event);
const kinds = async () => (await activityRows(deps.db, maria.workspaceId)).map((r) => r.kind);

describe("what a member sees (F6.1)", () => {
  it("is chosen when inviting, and carried into the membership", async () => {
    const res = await mariaApi.post(`/api/workspaces/${maria.workspaceId}/invites`, {
      email: tom.email,
      role: "editor",
      scope: "pipeline",
    });
    expect(res.status).toBe(201);
    const { invite } = CreatedInviteSchema.parse(await res.json());
    expect(invite.scope).toBe("pipeline");
    const accepted = await tomApi.post(`/api/invites/${invite.id}/accept`, {});
    expect(AcceptedInviteSchema.parse(await accepted.json()).workspace).toMatchObject({
      role: "editor",
      scope: "pipeline",
    });
    expect(await activityRows(deps.db, maria.workspaceId)).toEqual([
      {
        kind: "member.invited",
        actorKind: "user",
        actorId: maria.id,
        targetUserId: null,
        refs: { inviteId: invite.id, role: "editor", scope: "pipeline" },
      },
    ]);
  });

  it("is changed later by an admin, and then the server hides mail content (F6.2)", async () => {
    await addMember(deps.db, maria.workspaceId, tom.id, "editor");
    const drafts = `/api/workspaces/${maria.workspaceId}/drafts`;
    expect((await tomApi.get(drafts)).status).toBe(200);

    const res = await mariaApi.patch(member(tom.id), { scope: "pipeline" });
    expect(res.status).toBe(200);
    const list = MemberListSchema.parse(await res.json());
    expect(list.items.find((m) => m.userId === tom.id)).toMatchObject({
      role: "editor",
      scope: "pipeline",
    });
    expect((await tomApi.get(drafts)).status).toBe(404);
    expect(deps.logs.find((l) => l.event === "member.scope_changed")).toMatchObject({
      memberId: tom.id,
      scope: "pipeline",
      userId: maria.id,
    });
    // Setting what is already set changes and records nothing.
    expect((await mariaApi.patch(member(tom.id), { scope: "pipeline" })).status).toBe(200);
    expect(await activityRows(deps.db, maria.workspaceId)).toEqual([
      {
        kind: "member.scope_changed",
        actorKind: "user",
        actorId: maria.id,
        targetUserId: tom.id,
        refs: { scope: "pipeline" },
      },
    ]);

    expect((await mariaApi.patch(member(tom.id), { scope: "everything" })).status).toBe(200);
    expect((await tomApi.get(drafts)).status).toBe(200);
  });

  it("is never changed for the owner, nor by a non-admin", async () => {
    await addMember(deps.db, maria.workspaceId, tom.id, "admin");
    expect((await tomApi.patch(member(maria.id), { scope: "pipeline" })).status).toBe(409);
    await addMember(deps.db, maria.workspaceId, tom.id, "editor");
    expect((await tomApi.patch(member(tom.id), { scope: "everything" })).status).toBe(403);
    expect((await mariaApi.patch(member(tom.id), {})).status).toBe(400);
  });
});

describe("members (F6.3)", () => {
  it("admins change roles, logged under both names", async () => {
    await addMember(deps.db, maria.workspaceId, tom.id, "editor");
    const res = await mariaApi.patch(member(tom.id), { role: "admin", scope: "everything" });
    expect(res.status).toBe(200);
    expect(events()).toEqual(
      expect.arrayContaining(["workspace.role_changed", "member.role_changed"]),
    );
    expect(events()).not.toContain("member.scope_changed");
    expect(await kinds()).toEqual(["member.role_changed"]);
  });

  it("a new admin manages members, but nobody removes the owner", async () => {
    await addMember(deps.db, maria.workspaceId, tom.id, "admin");
    const anna = await seedUser(deps, { name: "Anna Berg" });
    await addMember(deps.db, maria.workspaceId, anna.id, "viewer");
    expect((await tomApi.delete(member(maria.id))).status).toBe(409);
    expect((await tomApi.patch(member(maria.id), { role: "viewer" })).status).toBe(409);
    expect((await tomApi.delete(member(anna.id))).status).toBe(204);
    expect(await getMembership(deps.db, maria.workspaceId, anna.id)).toBeNull();
    expect(deps.logs.find((l) => l.event === "member.removed")).toMatchObject({
      memberId: anna.id,
      userId: tom.id,
    });
    expect(await activityRows(deps.db, maria.workspaceId)).toEqual([
      {
        kind: "member.removed",
        actorKind: "user",
        actorId: tom.id,
        targetUserId: anna.id,
        refs: {},
      },
    ]);
  });

  it("a member leaves on their own; only admins remove others; the owner can't leave", async () => {
    const anna = await seedUser(deps, { name: "Anna Berg" });
    await addMember(deps.db, maria.workspaceId, tom.id, "viewer");
    await addMember(deps.db, maria.workspaceId, anna.id, "viewer");
    expect((await tomApi.delete(member(anna.id))).status).toBe(403);
    expect((await tomApi.delete(member(tom.id))).status).toBe(204);
    expect((await tomApi.get(members())).status).toBe(404);
    expect(events()).toContain("member.left");
    expect(await kinds()).toEqual(["member.left"]);
    expect((await mariaApi.delete(member(maria.id))).status).toBe(409);
  });

  it("the owner hands ownership to another admin and back", async () => {
    await addMember(deps.db, maria.workspaceId, tom.id, "editor");
    // Each action a second after the last, so the log's order is theirs.
    const handOver = (api: TestClient, to: string) => {
      deps.clock.advance(1000);
      return api.post(`${member(to)}/ownership`, { confirm: true });
    };

    const notAdmin = await handOver(mariaApi, tom.id);
    expect(notAdmin.status).toBe(409);
    expect(await notAdmin.json()).toMatchObject({ error: "not_admin" });
    await mariaApi.patch(member(tom.id), { role: "admin" });
    expect((await handOver(tomApi, tom.id)).status).toBe(403);
    expect((await mariaApi.post(`${member(tom.id)}/ownership`, {})).status).toBe(400);

    const res = await handOver(mariaApi, tom.id);
    expect(res.status).toBe(200);
    const list = MemberListSchema.parse(await res.json()).items;
    expect(list.find((m) => m.isOwner)?.userId).toBe(tom.id);
    // Now Maria can be removed by Tom, and is not: he hands it back.
    expect((await mariaApi.post(`${member(maria.id)}/ownership`, { confirm: true })).status).toBe(
      403,
    );
    expect((await handOver(tomApi, maria.id)).status).toBe(200);
    expect((await getMembership(deps.db, maria.workspaceId, maria.id))?.isOwner).toBe(true);
    expect(events().filter((e) => e === "workspace.ownership_transferred")).toHaveLength(2);
    expect(await kinds()).toEqual([
      "member.role_changed",
      "workspace.ownership_transferred",
      "workspace.ownership_transferred",
    ]);
    // Back to editor, as S8 ends.
    expect((await mariaApi.patch(member(tom.id), { role: "editor" })).status).toBe(200);
  });

  it("a pipeline-only admin still manages members (no mail content there)", async () => {
    await addMember(deps.db, maria.workspaceId, tom.id, "admin");
    await mariaApi.patch(member(tom.id), { scope: "pipeline" });
    expect((await tomApi.get(members())).status).toBe(200);
    expect((await tomApi.get(`/api/workspaces/${maria.workspaceId}/invites`)).status).toBe(200);
  });
});
