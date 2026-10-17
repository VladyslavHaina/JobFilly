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

describe("no one raises their own access (security review)", () => {
  const invites = () => `/api/workspaces/${maria.workspaceId}/invites`;
  let anna: SeededUser;
  let annaApi: TestClient;
  beforeEach(async () => {
    anna = await seedUser(deps, { name: "Anna Berg", email: "anna.berg@inbox.example" });
    annaApi = await signedIn(app, deps, anna);
  });

  it("only admins change roles or scopes, remove members or invite: 403, 404 for strangers", async () => {
    await addMember(deps.db, maria.workspaceId, anna.id, "viewer");
    for (const role of ["viewer", "editor"] as const) {
      await addMember(deps.db, maria.workspaceId, tom.id, role);
      for (const target of [tom.id, anna.id]) {
        expect((await tomApi.patch(member(target), { role: "admin" })).status).toBe(403);
        expect((await tomApi.patch(member(target), { scope: "everything" })).status).toBe(403);
      }
      expect((await tomApi.delete(member(anna.id))).status).toBe(403);
      expect((await tomApi.post(invites(), { email: "x@y.example", role: "viewer" })).status).toBe(
        403,
      );
      expect((await tomApi.post(`${member(tom.id)}/ownership`, { confirm: true })).status).toBe(
        403,
      );
    }
    // Someone who isn't a member gets 404 for all of it, before anything else.
    const stranger = await signedIn(app, deps, await seedUser(deps));
    expect((await stranger.patch(member(anna.id), { role: "admin" })).status).toBe(404);
    expect((await stranger.delete(member(anna.id))).status).toBe(404);
    expect((await stranger.post(invites(), { email: "x@y.example", role: "viewer" })).status).toBe(
      404,
    );
    expect((await stranger.post(`${member(maria.id)}/ownership`, { confirm: true })).status).toBe(
      404,
    );
    expect((await getMembership(deps.db, maria.workspaceId, anna.id))?.role).toBe("viewer");
  });

  it("an admin changes neither their own role nor scope, and becomes owner only by hand-over", async () => {
    await addMember(deps.db, maria.workspaceId, tom.id, "admin");
    await mariaApi.patch(member(tom.id), { scope: "pipeline" });
    const own = await tomApi.patch(member(tom.id), { scope: "everything" });
    expect(own.status).toBe(403);
    expect(await own.json()).toMatchObject({ error: "own_membership" });
    expect((await tomApi.patch(member(tom.id), { role: "editor" })).status).toBe(403);
    expect((await tomApi.post(`${member(tom.id)}/ownership`, { confirm: true })).status).toBe(403);
    expect(await getMembership(deps.db, maria.workspaceId, tom.id)).toMatchObject({
      scope: "pipeline",
      isOwner: false,
    });
  });

  it("an admin who sees the pipeline only grants nothing wider, by change or invite", async () => {
    await addMember(deps.db, maria.workspaceId, tom.id, "admin");
    await addMember(deps.db, maria.workspaceId, anna.id, "editor");
    await mariaApi.patch(member(tom.id), { scope: "pipeline" });
    await mariaApi.patch(member(anna.id), { scope: "pipeline" });
    const widen = await tomApi.patch(member(anna.id), { scope: "everything" });
    expect(widen.status).toBe(403);
    expect(await widen.json()).toMatchObject({ error: "wider_scope" });
    expect((await tomApi.post(invites(), { email: "x@y.example", role: "viewer" })).status).toBe(
      403,
    );
    expect(
      (await tomApi.post(invites(), { email: "x@y.example", role: "viewer", scope: "everything" }))
        .status,
    ).toBe(403);
    const ok = await tomApi.post(invites(), {
      email: "x@y.example",
      role: "viewer",
      scope: "pipeline",
    });
    expect(ok.status).toBe(201);
    expect((await getMembership(deps.db, maria.workspaceId, anna.id))?.scope).toBe("pipeline");
  });

  it("nobody else removes, demotes or re-scopes the owner, and the owner can't leave", async () => {
    await addMember(deps.db, maria.workspaceId, tom.id, "admin");
    expect((await tomApi.delete(member(maria.id))).status).toBe(409);
    expect((await tomApi.patch(member(maria.id), { role: "editor" })).status).toBe(409);
    expect((await tomApi.patch(member(maria.id), { scope: "pipeline" })).status).toBe(409);
    expect((await mariaApi.delete(member(maria.id))).status).toBe(409);
    expect(await getMembership(deps.db, maria.workspaceId, maria.id)).toMatchObject({
      role: "admin",
      scope: "everything",
      isOwner: true,
    });
  });

  it("hands ownership only to an admin of this workspace; the old owner stays an admin", async () => {
    // Anna is an admin of her own workspace, not of Maria's.
    expect((await mariaApi.post(`${member(anna.id)}/ownership`, { confirm: true })).status).toBe(
      404,
    );
    await addMember(deps.db, maria.workspaceId, anna.id, "editor");
    expect((await mariaApi.post(`${member(anna.id)}/ownership`, { confirm: true })).status).toBe(
      409,
    );
    await addMember(deps.db, maria.workspaceId, anna.id, "admin");
    expect((await mariaApi.post(`${member(anna.id)}/ownership`, { confirm: true })).status).toBe(
      200,
    );
    expect(await getMembership(deps.db, maria.workspaceId, maria.id)).toMatchObject({
      role: "admin",
      isOwner: false,
    });
  });

  it("refuses ids from another workspace", async () => {
    // Tom belongs to Anna's workspace only; Maria can't touch him through hers.
    await addMember(deps.db, anna.workspaceId, tom.id, "viewer");
    expect((await mariaApi.patch(member(tom.id), { role: "admin" })).status).toBe(404);
    expect((await mariaApi.delete(member(tom.id))).status).toBe(404);
    expect((await getMembership(deps.db, anna.workspaceId, tom.id))?.role).toBe("viewer");
    // An invite of Anna's workspace can't be revoked through Maria's.
    const created = await annaApi.post(`/api/workspaces/${anna.workspaceId}/invites`, {
      email: "x@y.example",
      role: "viewer",
    });
    const { invite } = CreatedInviteSchema.parse(await created.json());
    expect((await mariaApi.delete(`${invites()}/${invite.id}`)).status).toBe(404);
  });

  it("applies a change on the member's next request, and closes their open streams", async () => {
    await addMember(deps.db, maria.workspaceId, tom.id, "editor");
    const drafts = `/api/workspaces/${maria.workspaceId}/drafts`;
    expect((await tomApi.get(drafts)).status).toBe(200);
    let closed = 0;
    deps.live.subscribe(
      { workspaceId: maria.workspaceId, userId: tom.id, sessionId: crypto.randomUUID() },
      () => {},
      () => {
        closed += 1;
      },
    );
    await mariaApi.patch(member(tom.id), { scope: "pipeline" });
    expect(closed).toBe(1);
    expect((await tomApi.get(drafts)).status).toBe(404);
    await mariaApi.patch(member(tom.id), { role: "viewer" });
    expect((await tomApi.patch(member(anna.id), { role: "viewer" })).status).toBe(403);
  });
});
