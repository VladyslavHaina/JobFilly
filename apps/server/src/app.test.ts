import { ReadinessSchema } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import {
  createTestDeps,
  type SeededUser,
  seedUser,
  seedWorkspace,
  signedIn,
  type TestDeps,
} from "./testing";

let deps: TestDeps;
beforeEach(async () => {
  deps = await createTestDeps();
});
afterEach(() => deps.close());

describe("health", () => {
  it("is live while the process runs", async () => {
    const res = await createApp(deps).request("/api/health/live");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("is ready when the database is reachable and migrated", async () => {
    const res = await createApp(deps).request("/api/health/ready");
    expect(res.status).toBe(200);
    expect(ReadinessSchema.parse(await res.json())).toEqual({ status: "ready" });
  });

  it("answers 503 once shutdown has begun", async () => {
    deps.health.beginShutdown();
    const res = await createApp(deps).request("/api/health/ready");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "not_ready", reason: "shutting_down" });
  });
});

describe("every API request", () => {
  it("logs http.request with the route pattern, never the path", async () => {
    const app = createApp(deps);
    const res = await app.request("/api/health/live");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const requestId = res.headers.get("x-request-id");
    const line = deps.logs.find((l) => l.event === "http.request");
    expect(line).toMatchObject({
      level: "info",
      instance: "test-instance",
      method: "GET",
      route: "/api/health/live",
      status: 200,
      requestId,
    });
    expect(typeof line?.durationMs).toBe("number");
  });

  it("answers unknown API paths with a JSON 404", async () => {
    const res = await createApp(deps).request("/api/nope/%3Csecret%40mail.example%3E");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(deps.rawLogs.join("\n")).not.toContain("mail.example");
  });

  it("turns an unexpected error into a plain 500 and an error line without a stack", async () => {
    deps.health.check = async () => {
      throw new Error("db said no for maria@inbox.example");
    };
    const res = await createApp(deps).request("/api/health/ready");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal", message: "Something went wrong" });
    const line = deps.logs.find((l) => l.event === "http.error");
    expect(line).toMatchObject({ level: "error", error: { name: "Error" } });
    expect(JSON.stringify(line)).not.toContain("inbox.example");
    expect(JSON.stringify(line)).not.toContain("stack");
  });
});

describe("the workspace route modules", () => {
  // Every slice-owned module is mounted once, behind workspaceMember, with its own role checks.
  const messageId = encodeURIComponent("<a+b/c%d@mail.example>");
  const routes: [method: string, path: string, role: "viewer" | "editor" | "admin"][] = [
    ["GET", "mailboxes", "viewer"],
    ["GET", "mailboxes/presets", "viewer"],
    ["POST", "mailboxes/test", "admin"],
    ["POST", "mailboxes", "admin"],
    ["DELETE", "mailboxes/8f0e1c62-0000-4000-8000-000000000000", "admin"],
    ["GET", "ai", "viewer"],
    ["PUT", "ai", "admin"],
    ["POST", "ai/test", "admin"],
    ["GET", "scans/current", "viewer"],
    ["POST", "scans", "admin"],
    ["POST", "scans/8f0e1c62-0000-4000-8000-000000000000/cancel", "admin"],
    ["POST", "scans/analyze-rest", "admin"],
    ["GET", "messages", "viewer"],
    ["GET", `messages/${messageId}`, "viewer"],
    ["GET", `messages/${messageId}/body`, "viewer"],
    ["PUT", `messages/${messageId}/category`, "editor"],
    ["GET", "intake", "viewer"],
    ["PUT", "intake/answers/min_pay", "editor"],
    ["POST", "intake/confirm", "editor"],
    ["GET", "profiles", "viewer"],
    ["PATCH", "profiles/8f0e1c62-0000-4000-8000-000000000000", "editor"],
  ];
  const below = { viewer: null, editor: "viewer", admin: "editor" } as const;

  it("reaches each handler with the needed role, 403 below it, 404 for outsiders", async () => {
    const app = createApp(deps);
    const owner = await seedUser(deps);
    const viewer = await seedUser(deps);
    const editor = await seedUser(deps);
    const outsider = await seedUser(deps);
    const ws = await seedWorkspace(deps, {
      owner,
      members: [
        { user: viewer, role: "viewer" },
        { user: editor, role: "editor" },
      ],
    });
    const as: Record<string, SeededUser> = { viewer, editor, admin: owner, outsider };
    const clients = Object.fromEntries(
      await Promise.all(
        Object.entries(as).map(async ([k, u]) => [k, await signedIn(app, deps, u)] as const),
      ),
    );
    for (const [method, path, role] of routes) {
      const url = `/api/workspaces/${ws.workspaceId}/${path}`;
      const send = (who: string) =>
        clients[who]?.request(method, url, method === "GET" ? undefined : {});
      expect((await send(role))?.status, `${method} ${path} as ${role}`).toBe(501);
      const lower = below[role];
      if (lower) expect((await send(lower))?.status, `${method} ${path} as ${lower}`).toBe(403);
      expect((await send("outsider"))?.status, `${method} ${path} as outsider`).toBe(404);
    }
  });
});
