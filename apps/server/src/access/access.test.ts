import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { requireUser, sessionMiddleware } from "../auth/session";
import {
  createTestDeps,
  type SeededUser,
  seedUser,
  seedWorkspace,
  sessionCookie,
  signedIn,
  type TestDeps,
  testClient,
} from "../testing";
import type { AppEnv, WorkspaceEnv } from "./env";
import { requireRole, workspaceMember } from "./membership";
import { originCheck } from "./origin";

let deps: TestDeps;
beforeEach(async () => {
  deps = await createTestDeps();
});
afterEach(() => deps.close());

describe("the Origin check (F1.10)", () => {
  it("rejects state-changing requests from another origin or with none", async () => {
    const app = createApp(deps);
    const user = await seedUser(deps);
    const body = JSON.stringify({ email: user.email, password: user.password });
    const send = (method: string, origin?: string) =>
      app.request("/api/auth/sign-in", {
        method,
        headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
        body,
      });
    for (const origin of [
      "http://evil.test",
      undefined,
      "http://jobfilly.test.evil.test",
      "null",
    ]) {
      const res = await send("POST", origin);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "bad_origin",
        message: "This request must come from JobFilly itself",
      });
      expect(res.headers.getSetCookie()).toEqual([]);
    }
    expect((await send("POST", "http://jobfilly.test")).status).toBe(200);
  });

  it("checks POST, PUT, PATCH and DELETE but lets reads through", async () => {
    const app = new Hono<AppEnv>()
      .use(originCheck("http://jobfilly.test"))
      .all("/", (c) => c.text("ok"));
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect((await app.request("/", { method })).status).toBe(403);
      expect(
        (await app.request("/", { method, headers: { Origin: "http://jobfilly.test" } })).status,
      ).toBe(200);
    }
    expect((await app.request("/", { method: "GET" })).status).toBe(200);
  });

  it("refuses a cross-origin write even with a valid session", async () => {
    const app = createApp(deps);
    const user = await seedUser(deps);
    const cookie = await sessionCookie(deps, user);
    const res = await app.request(`/api/workspaces/${user.workspaceId}/invites`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: "http://evil.test", "Content-Type": "application/json" },
      body: JSON.stringify({ email: "x@y.example", role: "admin" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("workspace access (F1.8, F1.9)", () => {
  let owner: SeededUser;
  let workspaceId: string;
  let probe: Hono<AppEnv>;
  const users: Record<string, SeededUser> = {};

  beforeEach(async () => {
    owner = await seedUser(deps, { name: "Maria" });
    for (const role of ["viewer", "editor", "admin", "outsider"] as const) {
      users[role] = await seedUser(deps, { name: role });
    }
    const ws = await seedWorkspace(deps, {
      owner,
      members: [
        { user: users.viewer as SeededUser, role: "viewer" },
        { user: users.editor as SeededUser, role: "editor" },
        { user: users.admin as SeededUser, role: "admin" },
      ],
    });
    workspaceId = ws.workspaceId;
    const routes = new Hono<WorkspaceEnv>()
      .get("/read", requireRole("viewer"), (c) =>
        c.json({ secret: "data", role: c.get("membership").role }),
      )
      .get("/edit", requireRole("editor"), (c) => c.json({ secret: "data" }))
      .get("/admin", requireRole("admin"), (c) => c.json({ secret: "data" }));
    probe = new Hono<AppEnv>();
    probe.use(async (c, next) => {
      c.set("log", deps.log);
      await next();
    });
    probe.use(sessionMiddleware(deps));
    probe.use("/w/:workspaceId/*", requireUser, workspaceMember(deps));
    probe.route("/w/:workspaceId", routes);
  });

  async function status(who: string, path: string) {
    const user = users[who] as SeededUser;
    const res = await probe.request(`/w/${workspaceId}${path}`, {
      headers: { Cookie: await sessionCookie(deps, user) },
    });
    const text = await res.text();
    if (res.status !== 200) expect(text).not.toContain("data");
    return res.status;
  }

  it("orders roles viewer < editor < admin, answering 403 without data", async () => {
    expect(await status("viewer", "/read")).toBe(200);
    expect(await status("viewer", "/edit")).toBe(403);
    expect(await status("viewer", "/admin")).toBe(403);
    expect(await status("editor", "/edit")).toBe(200);
    expect(await status("editor", "/admin")).toBe(403);
    expect(await status("admin", "/admin")).toBe(200);
  });

  it("answers 404 without data to a non-member, whatever the route", async () => {
    expect(await status("outsider", "/read")).toBe(404);
    expect(await status("outsider", "/admin")).toBe(404);
  });

  it("answers 401 without a session", async () => {
    const res = await probe.request(`/w/${workspaceId}/read`);
    expect(res.status).toBe(401);
  });

  it("guards every workspace route of the app the same way", async () => {
    const app = createApp(deps);
    const outsider = await signedIn(app, deps, users.outsider as SeededUser);
    for (const path of ["members", "invites", "events", "anything/else"]) {
      const res = await outsider.get(`/api/workspaces/${workspaceId}/${path}`);
      expect(res.status).toBe(404);
    }
    expect((await testClient(app, deps).get(`/api/workspaces/${workspaceId}/members`)).status).toBe(
      401,
    );
  });
});
