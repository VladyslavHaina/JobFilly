import {
  CreatedInviteSchema,
  InviteListSchema,
  MemberListSchema,
  WorkspaceListSchema,
} from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import {
  createTestDeps,
  type SeededUser,
  seedUser,
  seedWorkspace,
  signedIn,
  type TestClient,
  type TestDeps,
} from "../testing";

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

const members = (ws: string) => `/api/workspaces/${ws}/members`;
const invites = (ws: string) => `/api/workspaces/${ws}/invites`;

describe("several workspaces (F1.7)", () => {
  it("lists every workspace the user belongs to, with their role, and no others", async () => {
    const shared = await seedWorkspace(deps, {
      name: "Shared",
      members: [{ user: maria, role: "viewer" }],
    });
    const res = await mariaApi.get("/api/workspaces");
    const { items } = WorkspaceListSchema.parse(await res.json());
    expect(items.map((w) => [w.name, w.role, w.isOwner])).toEqual([
      ["Maria Santos's workspace", "admin", true],
      ["Shared", "viewer", false],
    ]);
    expect(items.map((w) => w.id)).not.toContain(tom.workspaceId);
    expect(items.map((w) => w.id)).toContain(shared.workspaceId);
  });

  it("needs a session", async () => {
    const res = await app.request("/api/workspaces");
    expect(res.status).toBe(401);
  });
});

describe("members (F1.8, F1.9)", () => {
  it("answers 404 with no data to someone who isn't a member", async () => {
    for (const path of [members(maria.workspaceId), invites(maria.workspaceId)]) {
      const res = await tomApi.get(path);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
    const patch = await tomApi.patch(`${members(maria.workspaceId)}/${tom.id}`, { role: "admin" });
    expect(patch.status).toBe(404);
    // An unknown or malformed workspace id looks exactly the same.
    expect((await tomApi.get(members("8f0e1c62-0000-4000-8000-000000000000"))).status).toBe(404);
    expect((await tomApi.get(members("not-a-uuid"))).status).toBe(404);
  });

  it("lets members read the list, and only admins change roles", async () => {
    const ws = await seedWorkspace(deps, {
      owner: maria,
      members: [{ user: tom, role: "viewer" }],
    });
    const list = MemberListSchema.parse(await (await tomApi.get(members(ws.workspaceId))).json());
    expect(list.items.map((m) => [m.name, m.role, m.isOwner])).toEqual([
      ["Maria Santos", "admin", true],
      ["Tom Okafor", "viewer", false],
    ]);
    const refused = await tomApi.patch(`${members(ws.workspaceId)}/${tom.id}`, { role: "admin" });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({
      error: "forbidden",
      message: "Your role in this workspace doesn't allow this",
    });

    const changed = await mariaApi.patch(`${members(ws.workspaceId)}/${tom.id}`, {
      role: "editor",
    });
    expect(changed.status).toBe(200);
    expect(MemberListSchema.parse(await changed.json()).items[1]?.role).toBe("editor");
    expect(deps.logs.find((l) => l.event === "workspace.role_changed")).toMatchObject({
      workspaceId: ws.workspaceId,
      userId: maria.id,
      memberId: tom.id,
      role: "editor",
    });
  });

  it("never changes or removes the owner, and removes other members", async () => {
    const ws = await seedWorkspace(deps, { owner: maria, members: [{ user: tom, role: "admin" }] });
    expect(
      (await tomApi.patch(`${members(ws.workspaceId)}/${maria.id}`, { role: "viewer" })).status,
    ).toBe(409);
    expect((await tomApi.delete(`${members(ws.workspaceId)}/${maria.id}`)).status).toBe(409);
    expect((await mariaApi.delete(`${members(ws.workspaceId)}/${tom.id}`)).status).toBe(204);
    expect((await tomApi.get(members(ws.workspaceId))).status).toBe(404);
  });

  it("answers 404, not 500, to an id that isn't a UUID", async () => {
    const ws = maria.workspaceId;
    const bad = ["xyz", "%3Ca%40b.example%3E"];
    for (const id of bad) {
      expect((await mariaApi.patch(`${members(ws)}/${id}`, { role: "viewer" })).status).toBe(404);
      expect((await mariaApi.delete(`${members(ws)}/${id}`)).status).toBe(404);
      expect((await mariaApi.delete(`${invites(ws)}/${id}`)).status).toBe(404);
    }
    expect(deps.logs.filter((l) => l.event === "http.error")).toEqual([]);
  });
});

describe("invites (F1.6)", () => {
  it("an admin invites by email with a role and gets a link to copy", async () => {
    const res = await mariaApi.post(invites(maria.workspaceId), {
      email: "Tom.Okafor@Inbox.Example",
      role: "viewer",
    });
    expect(res.status).toBe(201);
    const created = CreatedInviteSchema.parse(await res.json());
    expect(created.invite).toMatchObject({
      email: "tom.okafor@inbox.example",
      role: "viewer",
      status: "pending",
    });
    expect(created.invite.expiresAt).toBe("2026-10-08T10:00:00.000Z");
    expect(created.link).toMatch(
      new RegExp(`^http://jobfilly\\.test/invites/${created.invite.id}\\?token=[\\w-]{43}$`),
    );
    const list = InviteListSchema.parse(
      await (await mariaApi.get(invites(maria.workspaceId))).json(),
    );
    expect(list.items.map((i) => i.id)).toEqual([created.invite.id]);
    expect(JSON.stringify(list)).not.toContain("token");
    expect(deps.logs.find((l) => l.event === "workspace.invite_created")).toMatchObject({
      inviteId: created.invite.id,
      role: "viewer",
    });
  });

  it("only admins see, create and revoke invites", async () => {
    const ws = await seedWorkspace(deps, {
      owner: maria,
      members: [{ user: tom, role: "editor" }],
    });
    expect((await tomApi.get(invites(ws.workspaceId))).status).toBe(403);
    expect(
      (await tomApi.post(invites(ws.workspaceId), { email: "x@y.example", role: "viewer" })).status,
    ).toBe(403);
    const created = CreatedInviteSchema.parse(
      await (
        await mariaApi.post(invites(ws.workspaceId), { email: "x@y.example", role: "viewer" })
      ).json(),
    );
    expect((await tomApi.delete(`${invites(ws.workspaceId)}/${created.invite.id}`)).status).toBe(
      403,
    );
    expect((await mariaApi.delete(`${invites(ws.workspaceId)}/${created.invite.id}`)).status).toBe(
      204,
    );
    const list = InviteListSchema.parse(await (await mariaApi.get(invites(ws.workspaceId))).json());
    expect(list.items[0]?.status).toBe("revoked");
  });

  it("refuses to invite someone who is already a member", async () => {
    const res = await mariaApi.post(invites(maria.workspaceId), {
      email: maria.email,
      role: "viewer",
    });
    expect(res.status).toBe(409);
  });
});
