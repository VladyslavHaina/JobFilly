import { addMember, setMemberScope } from "@jobfilly/db";
import { MAIL_SEND_JOB } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { jobRegistry } from "./jobs/registry";
import { createLogger } from "./log";
import { googleOAuthPort } from "./oauth/google";
import {
  createFakeOAuth,
  createFakeSmtp,
  createTestDeps,
  type SeededUser,
  seedUser,
  signedIn,
  type TestClient,
  type TestDeps,
} from "./testing";

// The MVP 3 foundation registers every new route, job type and port ahead of the slice that
// builds it (the plan): each route sits behind the membership check (404 for anyone else) and
// its role (403), is closed or open to a member who sees the pipeline only as F6.1 says, and
// answers 501 until its slice replaces the stub.

const DRAFT = "6f1c2f4e-8d3a-4b5c-9e7f-0a1b2c3d4e5f";
const enc = encodeURIComponent;

let deps: TestDeps;
let maria: SeededUser;
let tom: SeededUser;
let viewer: SeededUser;
let stranger: SeededUser;
const clients: Record<string, TestClient> = {};

beforeEach(async () => {
  deps = await createTestDeps();
  maria = await seedUser(deps);
  tom = await seedUser(deps);
  viewer = await seedUser(deps);
  stranger = await seedUser(deps);
  await addMember(deps.db, maria.workspaceId, tom.id, "admin");
  await addMember(deps.db, maria.workspaceId, viewer.id, "viewer");
  const app = createApp(deps);
  for (const [name, user] of Object.entries({ maria, tom, viewer, stranger })) {
    clients[name] = await signedIn(app, deps, user);
  }
});
afterEach(() => deps.close());

type Method = "get" | "post" | "put" | "delete";
interface Route {
  method: Method;
  path: string;
  /** The least role it takes. */
  role: "viewer" | "editor" | "admin";
  /** Open to a member who sees the job pipeline only. */
  pipeline: boolean;
  /** Built by its slice: it no longer answers 501. */
  built?: boolean;
}

const ws = () => `/api/workspaces/${maria.workspaceId}`;
const ROUTES = (): Route[] => [
  { method: "get", path: `${ws()}/pipeline`, role: "viewer", pipeline: true },
  { method: "put", path: `${ws()}/pipeline/stage`, role: "editor", pipeline: true },
  { method: "get", path: `${ws()}/drafts/${DRAFT}/send`, role: "editor", pipeline: false },
  { method: "post", path: `${ws()}/drafts/${DRAFT}/send`, role: "editor", pipeline: false },
  { method: "delete", path: `${ws()}/drafts/${DRAFT}/send`, role: "editor", pipeline: false },
  { method: "put", path: `${ws()}/mailboxes/${DRAFT}/smtp`, role: "admin", pipeline: true },
  { method: "post", path: `${ws()}/mailboxes/${DRAFT}/smtp/test`, role: "admin", pipeline: true },
  { method: "post", path: `${ws()}/oauth/google/start`, role: "admin", pipeline: true },
  { method: "get", path: `${ws()}/export`, role: "admin", pipeline: false, built: true },
  { method: "get", path: `${ws()}/activity`, role: "admin", pipeline: true, built: true },
  { method: "delete", path: ws(), role: "admin", pipeline: true, built: true },
];

const call = (client: TestClient | undefined, r: { method: Method; path: string }) => {
  if (!client) throw new Error("no client");
  return r.method === "get" || r.method === "delete"
    ? client[r.method](r.path)
    : client[r.method](r.path, {});
};

describe("the MVP 3 workspace routes", () => {
  it("answer 404 to anyone who isn't a member", async () => {
    for (const r of ROUTES()) {
      expect([r.method, r.path, (await call(clients.stranger, r)).status]).toEqual([
        r.method,
        r.path,
        404,
      ]);
    }
  });

  it("answer 403 below their role, and 501 until their slice builds them", async () => {
    for (const r of ROUTES()) {
      const asViewer = (await call(clients.viewer, r)).status;
      expect([r.method, r.path, asViewer]).toEqual([
        r.method,
        r.path,
        r.role === "viewer" ? 501 : 403,
      ]);
      const res = await call(clients.maria, r);
      if (r.built) {
        expect([r.method, r.path, res.status]).not.toEqual([r.method, r.path, 501]);
        continue;
      }
      expect([r.method, r.path, res.status]).toEqual([r.method, r.path, 501]);
      expect(await res.json()).toMatchObject({ error: "not_implemented" });
    }
  });

  it("are closed or open to a member who sees the pipeline only, as F6.1 says", async () => {
    await setMemberScope(deps.db, maria.workspaceId, tom.id, "pipeline");
    for (const r of ROUTES()) {
      const status = (await call(clients.tom, r)).status;
      if (r.built) {
        expect([r.method, r.path, status === 404]).toEqual([r.method, r.path, !r.pipeline]);
        continue;
      }
      expect([r.method, r.path, status]).toEqual([r.method, r.path, r.pipeline ? 501 : 404]);
    }
  });

  it("reassign a role's profile only on job mail for such a member", async () => {
    const r = {
      method: "put" as const,
      path: `${ws()}/messages/${enc("<m@agency.example>")}/roles/0/profile`,
    };
    // An unknown message is no job mail: 404 for a pipeline-only member, the stub for the rest.
    expect((await call(clients.tom, r)).status).toBe(501);
    await setMemberScope(deps.db, maria.workspaceId, tom.id, "pipeline");
    expect((await call(clients.tom, r)).status).toBe(404);
  });
});

describe("the MVP 3 routes outside a workspace", () => {
  it("need a signed-in user, then answer 501 until built", async () => {
    const app = createApp(deps);
    for (const path of ["/api/account/deletion", "/api/oauth/providers"]) {
      expect((await app.request(path)).status).toBe(401);
    }
    expect((await clients.maria?.get("/api/oauth/providers"))?.status).toBe(501);
    // Built (workspace-admin): what deleting the account takes; deleting it needs the password.
    expect((await clients.maria?.get("/api/account/deletion"))?.status).toBe(200);
    expect((await clients.maria?.delete("/api/account"))?.status).toBe(400);
    expect((await clients.maria?.get("/api/oauth/google/callback?state=s"))?.status).toBe(501);
  });
});

describe("the MVP 3 job types and ports", () => {
  it("registers mail.send", () => {
    expect(Object.keys(jobRegistry)).toContain(MAIL_SEND_JOB);
  });

  it("refuses Google sign-in on a server without client settings", async () => {
    await expect(
      googleOAuthPort(null).exchange({ code: "c", verifier: "v", redirectUri: "http://x" }),
    ).rejects.toThrow("Sign in with Google is not set up on this server");
  });

  it("has fakes for SMTP and Google's token endpoint", async () => {
    const smtp = createFakeSmtp();
    const login = {
      host: "smtp.x",
      port: 465,
      tlsMode: "tls" as const,
      username: "m",
      password: "p",
    };
    await smtp.port.send(
      login,
      { from: "m@x.example", to: ["r@y.example"] },
      new Uint8Array([72, 105]),
      {
        allowInsecure: false,
      },
    );
    expect(smtp.sent).toEqual([
      { login, envelope: { from: "m@x.example", to: ["r@y.example"] }, raw: "Hi" },
    ]);
    const oauth = createFakeOAuth();
    const tokens = await oauth.port.exchange({ code: "c", verifier: "v", redirectUri: "http://x" });
    expect(tokens.email).toBe("maria.gmail@gmail.example");
    oauth.revoke();
    await expect(oauth.port.refresh(tokens.refreshToken)).rejects.toThrow(/refused/);
  });

  it("never logs OAuth tokens, a re-run's hint or the assistant's search words", () => {
    const lines: string[] = [];
    const log = createLogger({ level: "info", instance: "i", write: (l) => lines.push(l) });
    log.info("mailbox.oauth_connected", {
      accessToken: "E2E-SECRET-a",
      refreshToken: "E2E-SECRET-r",
      code_verifier: "E2E-SECRET-v",
      hint: "I've moved to Germany",
      words: "Singapore",
    });
    expect(lines.join("\n")).not.toMatch(/E2E-SECRET|Germany|Singapore/);
  });
});
