import { addMember, deleteSession, findSession, removeMember } from "@jobfilly/db";
import type { LiveEvent } from "@jobfilly/schema";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AppEnv, workspaceMember } from "../access";
import { createApp } from "../app";
import { hashToken, requireUser, SESSION_COOKIE, sessionMiddleware } from "../auth/session";
import { DAY } from "../clock";
import type { AppDeps } from "../deps";
import { createLogger } from "../log";
import {
  createTestDeps,
  type SeededUser,
  seedUser,
  signedIn,
  type TestClient,
  type TestDeps,
} from "../testing";
import { createLiveHub, type LiveHub } from "./hub";
import { eventsRoutes } from "./routes";

let deps: TestDeps;
let maria: SeededUser;
let other: LiveHub | undefined;
beforeEach(async () => {
  deps = await createTestDeps();
  maria = await seedUser(deps);
});
afterEach(async () => {
  other?.closeAll();
  await other?.stop();
  other = undefined;
  await deps.close();
});

type Reader = ReadableStreamDefaultReader<Uint8Array>;

async function readUntil(reader: Reader, needle: string) {
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes(needle)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  return text;
}

/** Everything the stream sends until it ends (the test times out if it never does). */
async function readToEnd(reader: Reader) {
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return text;
    text += decoder.decode(value);
  }
}

async function openStream(api: TestClient, workspaceId: string): Promise<Reader> {
  const res = await api.get(`/api/workspaces/${workspaceId}/events`);
  expect(res.status).toBe(200);
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  await readUntil(reader, ": connected");
  return reader;
}

/** A second app on the same database with its own live hub plays the other replica. */
async function otherReplica(): Promise<ReturnType<typeof createApp>> {
  other = createLiveHub(
    deps.connection.notifier,
    createLogger({ level: "error", instance: "app-b", write: () => {} }),
  );
  await other.start();
  return createApp({ ...deps, live: other } satisfies AppDeps);
}

const secret: LiveEvent = {
  type: "messages.updated",
  data: { messageIds: ["<offer-42@hr.example>"] },
};

describe("GET /events (SSE)", () => {
  it("streams the workspace's events to a member", async () => {
    const app = createApp(deps);
    const api = await signedIn(app, deps, maria);
    const res = await api.get(`/api/workspaces/${maria.workspaceId}/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    expect(await readUntil(reader, ": connected")).toContain("retry: 2000");

    await deps.live.publish(maria.workspaceId, { type: "workspace.updated", data: {} });
    const text = await readUntil(reader, "workspace.updated");
    expect(text).toContain("event: workspace.updated\ndata: {}");

    // Shutdown closes the stream; the browser reconnects elsewhere.
    deps.live.closeAll();
    await expect.poll(async () => (await reader.read()).done).toBe(true);
  });

  it("never sends another workspace's events", async () => {
    const tom = await seedUser(deps);
    const app = createApp(deps);
    const api = await signedIn(app, deps, maria);
    const res = await api.get(`/api/workspaces/${maria.workspaceId}/events`);
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    await readUntil(reader, ": connected");
    await deps.live.publish(tom.workspaceId, { type: "intake.updated", data: {} });
    await deps.live.publish(maria.workspaceId, { type: "workspace.updated", data: {} });
    const text = await readUntil(reader, "workspace.updated");
    expect(text).not.toContain("intake.updated");
    await reader.cancel();
  });
});

describe("a stream ends with the access it was opened with (F1.4, F1.9)", () => {
  let tom: SeededUser;
  beforeEach(async () => {
    tom = await seedUser(deps);
    await addMember(deps.db, maria.workspaceId, tom.id, "viewer");
  });

  for (const where of ["the same replica", "the other replica"] as const) {
    it(`closes a removed member's stream at once, removed on ${where}`, async () => {
      const app = createApp(deps);
      const adminApp = where === "the same replica" ? app : await otherReplica();
      const tomApi = await signedIn(app, deps, tom);
      const mariaStream = await openStream(await signedIn(app, deps, maria), maria.workspaceId);
      const tomStream = await openStream(tomApi, maria.workspaceId);

      const admin = await signedIn(adminApp, deps, maria);
      expect(
        (await admin.delete(`/api/workspaces/${maria.workspaceId}/members/${tom.id}`)).status,
      ).toBe(204);
      await deps.live.publish(maria.workspaceId, secret);

      const tomSaw = await readToEnd(tomStream);
      expect(tomSaw).not.toContain("messages.updated");
      expect(tomSaw).not.toContain("offer-42");
      // The members who remain still get it.
      expect(await readUntil(mariaStream, "offer-42")).toContain("event: messages.updated");
      await mariaStream.cancel();
      // And Tom can't open a new one.
      expect((await tomApi.get(`/api/workspaces/${maria.workspaceId}/events`)).status).toBe(404);
    });

    it(`closes a signed-out session's stream at once, signed out on ${where}`, async () => {
      const app = createApp(deps);
      const signOutApp = where === "the same replica" ? app : await otherReplica();
      const tomApi = await signedIn(app, deps, tom);
      const tomStream = await openStream(tomApi, maria.workspaceId);
      // Tom's session on another device stays signed in and keeps its stream.
      const tomElsewhere = await openStream(await signedIn(app, deps, tom), maria.workspaceId);

      const signOut = await signOutApp.request("/api/auth/sign-out", {
        method: "POST",
        headers: { Origin: deps.config.origin, Cookie: tomApi.cookie ?? "" },
      });
      expect(signOut.status).toBe(204);
      await deps.live.publish(maria.workspaceId, secret);

      expect(await readToEnd(tomStream)).not.toContain("messages.updated");
      expect(await readUntil(tomElsewhere, "offer-42")).toContain("event: messages.updated");
      await tomElsewhere.cancel();
    });
  }

  it("closes the old session's stream when signing in again replaces it", async () => {
    const app = createApp(deps);
    const tomApi = await signedIn(app, deps, tom);
    const tomStream = await openStream(tomApi, maria.workspaceId);
    const res = await tomApi.post("/api/auth/sign-in", {
      email: tom.email,
      password: tom.password,
    });
    expect(res.status).toBe(200);
    await deps.live.publish(maria.workspaceId, secret);
    expect(await readToEnd(tomStream)).not.toContain("messages.updated");
  });

  describe("re-checks on every heartbeat, for what ends without a notification", () => {
    /** The events route behind the app's own session and membership checks, beating every 20 ms. */
    function heartbeatApp() {
      const app = new Hono<AppEnv>();
      app.use(async (c, next) => {
        c.set("log", deps.log);
        await next();
      });
      app.use(sessionMiddleware(deps));
      app.use("/w/:workspaceId/*", requireUser, workspaceMember(deps));
      app.route("/w/:workspaceId/events", eventsRoutes(deps, { heartbeatMs: 20 }));
      return app;
    }

    async function open(cookie: string) {
      const res = await heartbeatApp().request(`/w/${maria.workspaceId}/events`, {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no body");
      await readUntil(reader, ": keep-alive");
      return reader;
    }

    const cookieOf = (api: TestClient) => api.cookie ?? "";
    const tokenHashOf = (api: TestClient) =>
      hashToken(cookieOf(api).slice(`${SESSION_COOKIE}=`.length));

    it("closes once the membership is gone", async () => {
      const tomApi = await signedIn(createApp(deps), deps, tom);
      const reader = await open(cookieOf(tomApi));
      await removeMember(deps.db, maria.workspaceId, tom.id);
      await readToEnd(reader);
      expect(deps.live.streams).toBe(0);
    });

    it("closes once the session is deleted", async () => {
      const tomApi = await signedIn(createApp(deps), deps, tom);
      const reader = await open(cookieOf(tomApi));
      const session = await findSession(deps.db, tokenHashOf(tomApi));
      if (!session) throw new Error("no session");
      await deleteSession(deps.db, session.id);
      await readToEnd(reader);
      expect(deps.live.streams).toBe(0);
    });

    it("closes once the session has been idle 7 days, and deletes it", async () => {
      const tomApi = await signedIn(createApp(deps), deps, tom);
      const reader = await open(cookieOf(tomApi));
      deps.clock.advance(7 * DAY);
      await readToEnd(reader);
      expect(deps.live.streams).toBe(0);
      expect(await findSession(deps.db, tokenHashOf(tomApi))).toBeNull();
    });

    it("keeps a member's live session open", async () => {
      const tomApi = await signedIn(createApp(deps), deps, tom);
      const reader = await open(cookieOf(tomApi));
      deps.clock.advance(7 * DAY - 60_000);
      // Several heartbeats pass and the stream still delivers.
      await new Promise((r) => setTimeout(r, 100));
      await deps.live.publish(maria.workspaceId, secret);
      expect(await readUntil(reader, "offer-42")).toContain("event: messages.updated");
      await reader.cancel();
    });
  });
});
