import { getMembership } from "@jobfilly/db";
import {
  AcceptedInviteSchema,
  CreatedInviteSchema,
  PendingInvitationListSchema,
} from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { DAY } from "../clock";
import {
  cookieFrom,
  createTestDeps,
  type SeededUser,
  seedUser,
  signedIn,
  type TestClient,
  type TestDeps,
  testClient,
} from "../testing";

let deps: TestDeps;
let app: ReturnType<typeof createApp>;
let maria: SeededUser;
let mariaApi: TestClient;

beforeEach(async () => {
  deps = await createTestDeps();
  app = createApp(deps);
  maria = await seedUser(deps, { name: "Maria Santos", email: "maria.santos@inbox.example" });
  mariaApi = await signedIn(app, deps, maria);
});
afterEach(() => deps.close());

async function invite(email: string, role: "viewer" | "editor" | "admin" = "viewer") {
  const res = await mariaApi.post(`/api/workspaces/${maria.workspaceId}/invites`, { email, role });
  return CreatedInviteSchema.parse(await res.json());
}

const tokenOf = (link: string) => new URL(link).searchParams.get("token") ?? "";

describe("the invitee (F1.6)", () => {
  it("sees the invitation after registering with that email, and accepts it", async () => {
    const created = await invite("tom.okafor@inbox.example", "viewer");
    const reg = await testClient(app, deps).post("/api/auth/register", {
      name: "Tom Okafor",
      email: "tom.okafor@inbox.example",
      password: "E2E-SECRET-tom-login",
    });
    const tomApi = testClient(app, deps, cookieFrom(reg));
    const pending = PendingInvitationListSchema.parse(
      await (await tomApi.get("/api/invites")).json(),
    );
    expect(pending.items).toEqual([
      {
        id: created.invite.id,
        workspaceId: maria.workspaceId,
        workspaceName: "Maria's workspace",
        invitedBy: "Maria Santos",
        role: "viewer",
        expiresAt: created.invite.expiresAt,
      },
    ]);
    const accepted = await tomApi.post(`/api/invites/${created.invite.id}/accept`);
    expect(accepted.status).toBe(200);
    expect(AcceptedInviteSchema.parse(await accepted.json()).workspace).toMatchObject({
      id: maria.workspaceId,
      name: "Maria's workspace",
      role: "viewer",
    });
    expect((await tomApi.get("/api/invites")).status).toBe(200);
    expect(
      PendingInvitationListSchema.parse(await (await tomApi.get("/api/invites")).json()).items,
    ).toEqual([]);
    expect((await tomApi.get(`/api/workspaces/${maria.workspaceId}/members`)).status).toBe(200);
    expect(deps.logs.find((l) => l.event === "workspace.invite_accepted")).toMatchObject({
      inviteId: created.invite.id,
      workspaceId: maria.workspaceId,
    });
  });

  it("sees it after signing in, and can decline it", async () => {
    const tom = await seedUser(deps, { email: "tom.okafor@inbox.example" });
    const created = await invite(tom.email);
    const tomApi = await signedIn(app, deps, tom);
    expect((await tomApi.post(`/api/invites/${created.invite.id}/decline`)).status).toBe(204);
    expect((await tomApi.post(`/api/invites/${created.invite.id}/accept`)).status).toBe(409);
    expect(await getMembership(deps.db, maria.workspaceId, tom.id)).toBeNull();
  });

  it("someone else can't see or accept it without the link's token", async () => {
    const created = await invite("tom.okafor@inbox.example");
    const eve = await seedUser(deps, { email: "eve@evil.example" });
    const eveApi = await signedIn(app, deps, eve);
    expect(
      PendingInvitationListSchema.parse(await (await eveApi.get("/api/invites")).json()).items,
    ).toEqual([]);
    expect((await eveApi.get(`/api/invites/${created.invite.id}`)).status).toBe(404);
    expect((await eveApi.post(`/api/invites/${created.invite.id}/accept`)).status).toBe(404);
    expect(
      (await eveApi.post(`/api/invites/${created.invite.id}/accept`, { token: "guess" })).status,
    ).toBe(404);
    expect(await getMembership(deps.db, maria.workspaceId, eve.id)).toBeNull();
  });

  it("the copied link lets the person it was given to accept", async () => {
    const created = await invite("tom.okafor@inbox.example", "editor");
    const tomOther = await seedUser(deps, { email: "tom@another.example" });
    const api = await signedIn(app, deps, tomOther);
    const token = tokenOf(created.link);
    const shown = await api.get(`/api/invites/${created.invite.id}?token=${token}`);
    expect(shown.status).toBe(200);
    expect(await shown.json()).toMatchObject({
      workspaceName: "Maria's workspace",
      role: "editor",
    });
    expect((await api.post(`/api/invites/${created.invite.id}/accept`, { token })).status).toBe(
      200,
    );
    expect((await getMembership(deps.db, maria.workspaceId, tomOther.id))?.role).toBe("editor");
  });

  it("expires after 7 days, and a revoked invite can't be accepted", async () => {
    const tom = await seedUser(deps, { email: "tom.okafor@inbox.example" });
    const tomApi = await signedIn(app, deps, tom);
    const late = await invite(tom.email);
    const revoked = await invite(tom.email);
    await mariaApi.delete(`/api/workspaces/${maria.workspaceId}/invites/${revoked.invite.id}`);
    expect((await tomApi.post(`/api/invites/${revoked.invite.id}/accept`)).status).toBe(409);
    deps.clock.advance(7 * DAY);
    const later = await signedIn(app, deps, tom);
    expect(
      PendingInvitationListSchema.parse(await (await later.get("/api/invites")).json()).items,
    ).toEqual([]);
    const res = await later.post(`/api/invites/${late.invite.id}/accept`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "not_pending",
      message: "This invitation is no longer valid",
    });
  });

  it("answers 404, not 500, to an id that isn't a UUID", async () => {
    expect((await mariaApi.get("/api/invites/xyz?token=t")).status).toBe(404);
    expect((await mariaApi.post("/api/invites/xyz/accept", {})).status).toBe(404);
    expect((await mariaApi.post("/api/invites/xyz/decline", {})).status).toBe(404);
    expect(deps.logs.filter((l) => l.event === "http.error")).toEqual([]);
  });

  it("needs a session", async () => {
    expect((await testClient(app, deps).get("/api/invites")).status).toBe(401);
  });
});
