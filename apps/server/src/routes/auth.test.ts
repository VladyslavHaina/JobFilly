import { findSession, findUserByEmail, listWorkspacesForUser } from "@jobfilly/db";
import { SessionInfoSchema } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { hashToken } from "../auth/session";
import { DAY } from "../clock";
import { createDeps } from "../deps";
import { createLogger } from "../log";
import { cookieFrom, createTestDeps, seedUser, type TestDeps, testClient } from "../testing";
import { personalWorkspaceName } from "./auth";

let deps: TestDeps;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  deps = await createTestDeps();
  app = createApp(deps);
});
afterEach(() => deps.close());

const maria = {
  name: "Maria Santos",
  email: "maria.santos@inbox.example",
  password: "E2E-SECRET-maria-login",
};

async function register(input = maria) {
  return testClient(app, deps).post("/api/auth/register", input);
}

describe("registration (F1.1)", () => {
  it("creates the user, their workspace as owner and admin, and signs them in", async () => {
    const res = await register();
    expect(res.status).toBe(201);
    const { user } = SessionInfoSchema.parse(await res.json());
    expect(user).toMatchObject({ name: "Maria Santos", email: maria.email });
    const [ws] = await listWorkspacesForUser(deps.db, user.id);
    expect(ws).toMatchObject({ name: "Maria Santos's workspace", role: "admin", isOwner: true });
    const me = await testClient(app, deps, cookieFrom(res)).get("/api/auth/me");
    expect(me.status).toBe(200);
    const session = await testClient(app, deps, cookieFrom(res)).get("/api/auth/session");
    expect(await session.json()).toEqual({ user });
    expect(deps.logs.map((l) => l.event)).toEqual(
      expect.arrayContaining(["auth.registered", "auth.signed_in"]),
    );
  });

  it("needs a password of at least 12 characters", async () => {
    const res = await register({ ...maria, password: "short pass1" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", message: "Use at least 12 characters" });
  });

  it("refuses an email that already has an account", async () => {
    await register();
    const res = await register({ ...maria, email: "Maria.Santos@Inbox.Example" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "email_taken" });
  });

  it("names the workspace after the full name", () => {
    expect(personalWorkspaceName("Maria Santos")).toBe("Maria Santos's workspace");
    expect(personalWorkspaceName("  Tom  ")).toBe("Tom's workspace");
  });
});

describe("the session cookie (F1.2)", () => {
  it("is HttpOnly, SameSite=Lax, Path=/, random, stored only as a hash", async () => {
    const res = await register();
    const header = res.headers.getSetCookie().find((c) => c.startsWith("jf_session="));
    expect(header).toBeDefined();
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/SameSite=Lax/);
    expect(header).toMatch(/Path=\//);
    expect(header).not.toMatch(/Secure/);
    const value = cookieFrom(res)?.split("=")[1] ?? "";
    expect(Buffer.from(value, "base64url")).toHaveLength(32);
    expect(await findSession(deps.db, hashToken(value))).not.toBeNull();
    expect(await findSession(deps.db, value)).toBeNull();
    expect(hashToken(value)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is Secure when PUBLIC_URL is https", async () => {
    await deps.close();
    deps = await createTestDeps({ config: { publicUrl: new URL("https://jobfilly.home.lan") } });
    app = createApp(deps);
    const res = await register();
    expect(res.headers.getSetCookie().find((c) => c.startsWith("jf_session="))).toMatch(/Secure/);
  });

  it("gets a new id at every sign-in, and the old session ends", async () => {
    await register();
    const client = testClient(app, deps);
    const first = cookieFrom(await client.post("/api/auth/sign-in", maria));
    client.cookie = first;
    const second = cookieFrom(await client.post("/api/auth/sign-in", maria));
    expect(first).toBeDefined();
    expect(second).not.toBe(first);
    expect((await testClient(app, deps, first).get("/api/auth/me")).status).toBe(401);
    expect((await testClient(app, deps, second).get("/api/auth/me")).status).toBe(200);
  });
});

describe("sign-in (F1.5)", () => {
  it("stores an scrypt hash and gives one generic message for wrong credentials", async () => {
    await register();
    const stored = await findUserByEmail(deps.db, maria.email);
    expect(stored?.passwordHash).toMatch(/^scrypt\$/);
    expect(stored?.passwordHash).not.toContain(maria.password);
    const wrong = await testClient(app, deps).post("/api/auth/sign-in", {
      ...maria,
      password: "wrong password!",
    });
    const unknown = await testClient(app, deps).post("/api/auth/sign-in", {
      email: "nobody@inbox.example",
      password: "whatever password",
    });
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: "invalid_credentials",
        message: "Email or password is incorrect",
      });
      expect(res.headers.getSetCookie()).toEqual([]);
    }
    const failures = deps.logs.filter((l) => l.event === "auth.sign_in_failed");
    expect(failures).toHaveLength(2);
    expect(failures[0]?.level).toBe("warn");
    expect(deps.rawLogs.join("\n")).not.toContain("inbox.example");
    expect(deps.rawLogs.join("\n")).not.toContain("E2E-SECRET");
  });
});

describe("session expiry and sign-out (F1.4)", () => {
  it("ends after 7 days without use", async () => {
    const user = await seedUser(deps);
    const client = testClient(app, deps);
    client.cookie = cookieFrom(await client.post("/api/auth/sign-in", user));
    deps.clock.advance(7 * DAY - 60_000);
    expect((await client.get("/api/auth/me")).status).toBe(200);
    deps.clock.advance(7 * DAY - 60_000);
    expect((await client.get("/api/auth/me")).status).toBe(200);
    deps.clock.advance(7 * DAY);
    expect((await client.get("/api/auth/me")).status).toBe(401);
  });

  it("ends 30 days after sign-in even when used every day", async () => {
    const user = await seedUser(deps);
    const client = testClient(app, deps);
    client.cookie = cookieFrom(await client.post("/api/auth/sign-in", user));
    for (let day = 1; day < 30; day++) {
      deps.clock.advance(DAY);
      expect((await client.get("/api/auth/me")).status).toBe(200);
    }
    deps.clock.advance(DAY);
    expect((await client.get("/api/auth/me")).status).toBe(401);
  });

  it("signing out deletes the session; the old cookie stops working at once", async () => {
    const user = await seedUser(deps);
    const client = testClient(app, deps);
    const cookie = cookieFrom(await client.post("/api/auth/sign-in", user));
    client.cookie = cookie;
    const out = await client.post("/api/auth/sign-out");
    expect(out.status).toBe(204);
    expect(out.headers.getSetCookie().join()).toMatch(/jf_session=;/);
    expect((await testClient(app, deps, cookie).get("/api/auth/me")).status).toBe(401);
    expect((await testClient(app, deps, cookie).get("/api/workspaces")).status).toBe(401);
    const session = await testClient(app, deps, cookie).get("/api/auth/session");
    expect(session.status).toBe(200);
    expect(await session.json()).toEqual({ user: null });
    expect(await findSession(deps.db, hashToken(cookie?.split("=")[1] ?? ""))).toBeNull();
    expect(deps.logs.some((l) => l.event === "auth.signed_out")).toBe(true);
  });
});

describe("sessions on any replica (F1.3)", () => {
  it("a session made on one replica works on another sharing the database", async () => {
    const replicaB = createApp(
      createDeps({
        config: { ...deps.config, instance: "app-b" },
        connection: deps.connection,
        clock: deps.clock,
        log: createLogger({ level: "error", instance: "app-b", write: () => {} }),
      }),
    );
    const cookie = cookieFrom(await register());
    const viaA = testClient(app, deps, cookie);
    const viaB = testClient(replicaB, deps, cookie);
    for (let i = 0; i < 20; i++) {
      const res = await (i % 2 === 0 ? viaA : viaB).get("/api/workspaces");
      expect(res.status).toBe(200);
    }
  });
});
