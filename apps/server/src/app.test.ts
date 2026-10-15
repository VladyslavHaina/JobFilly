import { ReadinessSchema } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import {
  createTestDeps,
  type SeededUser,
  seedMailbox,
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
  // Each row names the status the handler gives with the needed role: a GET reads, an empty body is
  // a 400, the seeded mailbox is deleted, a message not in the workspace is a 404, and the routes
  // whose slice isn't here yet answer 501. A 404 for a route that should read, or a 500, would mean
  // broken workspace scoping or a crash, so the status is exact.
  const messageId = encodeURIComponent("<a+b/c%d@mail.example>");
  const ID = "8f0e1c62-0000-4000-8000-000000000001";
  const MAILBOX = ":mailboxId";
  const routes: [
    method: string,
    path: string,
    role: "viewer" | "editor" | "admin",
    status: number,
  ][] = [
    ["GET", "mailboxes", "viewer", 200],
    ["GET", "mailboxes/presets", "viewer", 200],
    ["POST", "mailboxes/test", "admin", 400],
    ["POST", "mailboxes", "admin", 400],
    ["DELETE", `mailboxes/${MAILBOX}`, "admin", 204],
    ["GET", "ai", "viewer", 200],
    ["GET", "ai/providers", "viewer", 200],
    ["PUT", "ai", "admin", 400],
    ["POST", "ai/test", "admin", 400],
    ["GET", "scans/current", "viewer", 200],
    // The mailbox is deleted above, there is no such scan, and no first scan yet.
    ["POST", "scans", "admin", 409],
    ["POST", "scans/8f0e1c62-0000-4000-8000-000000000000/cancel", "admin", 404],
    ["POST", "scans/analyze-rest", "admin", 409],
    ["GET", "messages", "viewer", 200],
    // No such message in the workspace, and an empty correction.
    ["GET", `messages/${messageId}`, "viewer", 404],
    ["GET", `messages/${messageId}/body`, "viewer", 404],
    ["PUT", `messages/${messageId}/category`, "editor", 400],
    // No first scan has stopped yet, an empty answer, and no such profile.
    ["GET", "intake", "viewer", 409],
    ["PUT", "intake/answers/min_pay", "editor", 400],
    ["POST", "intake/confirm", "editor", 409],
    ["GET", "profiles", "viewer", 200],
    ["PATCH", "profiles/8f0e1c62-0000-4000-8000-000000000000", "editor", 404],
    // MVP 2: the pinned routes, their guards in place before the slices write the handlers. The
    // CV choice of a role takes an editor and checks its body first.
    ["PUT", `messages/${messageId}/roles/0/cv`, "editor", 400],
    ["GET", "cvs", "viewer", 501],
    ["POST", "cvs", "editor", 501],
    ["PATCH", `cvs/${ID}`, "editor", 501],
    ["DELETE", `cvs/${ID}`, "editor", 501],
    ["GET", `cvs/${ID}/file`, "viewer", 501],
    ["PUT", "senders/marks", "editor", 501],
    ["GET", `profiles/${ID}/rules`, "viewer", 501],
    ["PATCH", `profiles/${ID}/rules/${ID}`, "editor", 501],
    ["DELETE", `profiles/${ID}/rules/${ID}`, "editor", 501],
    ["GET", `profiles/${ID}/history`, "viewer", 501],
    ["POST", `profiles/${ID}/history/${ID}/undo`, "editor", 501],
    // Drafts and decisions: an empty body is a 400, and there is no such draft or decision.
    ["GET", "drafts", "viewer", 200],
    ["POST", "drafts", "editor", 400],
    ["GET", `drafts/${ID}`, "viewer", 404],
    ["PATCH", `drafts/${ID}`, "editor", 400],
    ["POST", `drafts/${ID}/discard`, "editor", 404],
    ["GET", "decisions", "viewer", 200],
    ["GET", "decisions/count", "viewer", 200],
    ["POST", `decisions/${ID}/answer`, "editor", 400],
    ["POST", `decisions/${ID}/not-now`, "editor", 404],
    ["POST", `decisions/${ID}/dismiss`, "editor", 400],
    // Viewers chat and discard; applying and editing a proposal take an editor (F8.8).
    ["GET", "assistant", "viewer", 501],
    ["POST", "assistant", "viewer", 501],
    ["PATCH", `assistant/proposals/${ID}`, "editor", 501],
    ["POST", `assistant/proposals/${ID}/apply`, "editor", 501],
    ["POST", `assistant/proposals/${ID}/discard`, "viewer", 501],
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
    const mailboxId = await seedMailbox(deps, ws.workspaceId, {
      address: "me@mail.example",
      conn: {
        host: "imap.mail.example",
        port: 993,
        tlsMode: "tls",
        username: "me@mail.example",
        password: "E2E-SECRET-mailbox",
      },
      sentFolderPath: null,
    });
    const as: Record<string, SeededUser> = { viewer, editor, admin: owner, outsider };
    const clients = Object.fromEntries(
      await Promise.all(
        Object.entries(as).map(async ([k, u]) => [k, await signedIn(app, deps, u)] as const),
      ),
    );
    for (const [method, path, role, status] of routes) {
      const url = `/api/workspaces/${ws.workspaceId}/${path.replace(MAILBOX, mailboxId)}`;
      const send = (who: string) =>
        clients[who]?.request(method, url, method === "GET" ? undefined : {});
      // The lower role and the outsider go first, so the mailbox is still there for them.
      const lower = below[role];
      if (lower) expect((await send(lower))?.status, `${method} ${path} as ${lower}`).toBe(403);
      expect((await send("outsider"))?.status, `${method} ${path} as outsider`).toBe(404);
      expect((await send(role))?.status, `${method} ${path} as ${role}`).toBe(status);
    }
  });
});
