import { createHash } from "node:crypto";
import {
  addMember,
  getMailboxConnection,
  listMailboxes,
  markMailboxReconnectNeeded,
  setMemberScope,
  takeOAuthState,
} from "@jobfilly/db";
import {
  type MailLogin,
  type MailTestResult,
  OAuthProvidersSchema,
  OAuthStartSchema,
  OAuthTokensSchema,
} from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { MINUTE } from "../clock";
import type { GoogleConfig } from "../config";
import { open } from "../secrets";
import {
  createFakeOAuth,
  createTestDeps,
  type FakeOAuth,
  fakeMailClient,
  type SeededUser,
  seedGoogleMailbox,
  seedMailbox,
  seedScan,
  seedUser,
  signedIn,
  type TestClient,
  type TestDeps,
  testClient,
} from "../testing";

// Sign in with Google (MVP 3, F3.2) on PGlite, with the fake token endpoint (createFakeOAuth)
// and a fake mail port: the start, the callback with its state checks, the stored mailbox with
// its sealed tokens, and the reconnect. The same flow against the test stack's fake
// authorisation server over HTTP is in oauth/google.test.ts.

const GOOGLE: GoogleConfig = {
  clientId: "jobfilly-test",
  clientSecret: "E2E-SECRET-google-client",
  authorizeUrl: "https://accounts.google.test/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.google.test/token",
  imap: { host: "imap.gmail.example", port: 993, tlsMode: "tls" },
  smtp: { host: "smtp.gmail.example", port: 465, tlsMode: "tls" },
};
const CALLBACK = "/api/oauth/google/callback";

let deps: TestDeps;
let oauth: FakeOAuth;
let owner: SeededUser;
let workspaceId: string;
let admin: TestClient;
let start: string;
let logins: MailLogin[];
let imapResult: MailTestResult;

async function setup(google: GoogleConfig | null = GOOGLE) {
  logins = [];
  imapResult = { ok: true, folders: ["INBOX", "[Gmail]/Sent Mail"], sentPath: "[Gmail]/Sent Mail" };
  deps = await createTestDeps({ config: { google } });
  oauth = createFakeOAuth({ now: () => deps.clock.now() });
  deps.oauth = oauth.port;
  deps.mail = {
    connect(conn) {
      logins.push(conn);
      return fakeMailClient({ test: async () => imapResult });
    },
  };
  owner = await seedUser(deps, { name: "Maria Santos" });
  workspaceId = owner.workspaceId;
  admin = await signedIn(createApp(deps), deps, owner);
  start = `/api/workspaces/${workspaceId}/oauth/google/start`;
}

beforeEach(() => setup());
afterEach(() => deps.close());

/** Starts a sign-in; the authorize URL's parameters. */
async function started(client = admin, body: unknown = {}) {
  const res = await client.post(start, body);
  expect(res.status).toBe(200);
  const { url } = OAuthStartSchema.parse(await res.json());
  return new URL(url).searchParams;
}

/** Google sending the browser back with a code (or an error) and the state. */
const callback = (client: TestClient, params: Record<string, string>) =>
  client.get(`${CALLBACK}?${new URLSearchParams(params)}`);

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** The sign-in waiting under the state's hash (taken, so it can't be used after). */
const waitingFor = (state: string) => takeOAuthState(deps.db, sha256(state), deps.clock.now());

const logged = (event: string) => deps.logs.filter((l) => l.event === event);

describe("which sign-in buttons to show", () => {
  it("offers Google only with its client settings, to a signed-in user", async () => {
    const res = await admin.get("/api/oauth/providers");
    expect(OAuthProvidersSchema.parse(await res.json())).toEqual({ google: true });
    expect((await testClient(createApp(deps), deps).get("/api/oauth/providers")).status).toBe(401);
    await deps.close();
    await setup(null);
    expect(await (await admin.get("/api/oauth/providers")).json()).toEqual({ google: false });
    expect((await admin.post(start, {})).status).toBe(404);
  });
});

describe("starting a sign-in", () => {
  it("sends the browser to Google with PKCE S256 and a state kept only as its hash", async () => {
    const params = await started();
    expect(Object.fromEntries(params)).toEqual({
      response_type: "code",
      client_id: "jobfilly-test",
      redirect_uri: "http://jobfilly.test/api/oauth/google/callback",
      scope: "https://mail.google.com/ openid email",
      state: expect.stringMatching(/^[\w-]{43}$/),
      code_challenge: expect.stringMatching(/^[\w-]{43}$/),
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
    });
    const state = params.get("state") ?? "";
    // Kept under the state's hash (packages/db stores nothing else of it), for this user.
    const waiting = await waitingFor(state);
    expect(waiting).toMatchObject({ workspaceId, userId: owner.id, mailboxId: null });
    // The verifier is sealed, and its S256 challenge is what Google got.
    expect(waiting?.verifierCiphertext).not.toMatch(/^[\w-]{43}$/);
    const verifier = open(deps.config.secretKey, waiting?.verifierCiphertext ?? "");
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
      params.get("code_challenge"),
    );
    expect(deps.rawLogs.join("\n")).not.toContain(state);
    expect(deps.rawLogs.join("\n")).not.toContain(verifier);
  });

  it("is for admins of the workspace only", async () => {
    const app = createApp(deps);
    for (const role of ["viewer", "editor"] as const) {
      const user = await seedUser(deps);
      await addMember(deps.db, workspaceId, user.id, role);
      expect((await (await signedIn(app, deps, user)).post(start, {})).status).toBe(403);
    }
    const outsider = await signedIn(app, deps, await seedUser(deps));
    expect((await outsider.post(start, {})).status).toBe(404);
    // Open to an admin who sees the job pipeline only (F6.1): a mailbox isn't mail content.
    const pipelineAdmin = await seedUser(deps);
    await addMember(deps.db, workspaceId, pipelineAdmin.id, "admin");
    await setMemberScope(deps.db, workspaceId, pipelineAdmin.id, "pipeline");
    expect((await (await signedIn(app, deps, pipelineAdmin)).post(start, {})).status).toBe(200);
  });

  it("reconnects only a Google mailbox of the workspace, hinting its account", async () => {
    const password = await seedMailbox(deps, workspaceId, {
      address: "maria.santos@inbox.example",
      conn: { host: "imap", port: 993, tlsMode: "tls", username: "m", password: "E2E-SECRET-p" },
      sentFolderPath: null,
    });
    expect((await admin.post(start, { mailboxId: password })).status).toBe(404);
    const { mailboxId } = await seedGoogleMailbox(deps, workspaceId);
    const params = await started(admin, { mailboxId });
    expect(params.get("login_hint")).toBe("maria.gmail@gmail.example");
  });
});

describe("the callback", () => {
  it("stores the Google mailbox with its tokens sealed, and goes back to the mailbox page", async () => {
    const params = await started();
    const res = await callback(admin, {
      code: "E2E-SECRET-code",
      state: params.get("state") ?? "",
    });
    expect(res.status).toBe(302);
    // Before the first scan the mailbox page is onboarding's first step.
    expect(res.headers.get("location")).toBe(
      `http://jobfilly.test/w/${workspaceId}/setup/mailbox?oauth=connected`,
    );

    // The code was exchanged with the verifier whose challenge Google got.
    const [exchange] = oauth.exchanges;
    expect(exchange).toMatchObject({
      code: "E2E-SECRET-code",
      redirectUri: "http://jobfilly.test/api/oauth/google/callback",
    });
    expect(
      createHash("sha256")
        .update(exchange?.verifier ?? "")
        .digest("base64url"),
    ).toBe(params.get("code_challenge"));
    // Gmail's IMAP accepted the access token before anything was stored.
    expect(logins).toEqual([
      {
        host: "imap.gmail.example",
        port: 993,
        tlsMode: "tls",
        username: "maria.gmail@gmail.example",
        accessToken: "E2E-SECRET-access-1",
      },
    ]);
    const [mailbox] = await listMailboxes(deps.db, workspaceId);
    expect(mailbox).toMatchObject({
      address: "maria.gmail@gmail.example",
      host: "imap.gmail.example",
      username: "maria.gmail@gmail.example",
      sentFolderPath: "[Gmail]/Sent Mail",
      status: "connected",
      authKind: "google",
    });
    expect(mailbox?.secretCiphertext).not.toContain("E2E-SECRET");
    expect(
      OAuthTokensSchema.parse(
        JSON.parse(open(deps.config.secretKey, mailbox?.secretCiphertext ?? "")),
      ),
    ).toEqual({
      accessToken: "E2E-SECRET-access-1",
      refreshToken: "E2E-SECRET-refresh",
      expiresAt: new Date(deps.clock.now().getTime() + 60 * MINUTE).toISOString(),
      email: "maria.gmail@gmail.example",
    });
    expect(logged("mailbox.oauth_connected")).toEqual([
      expect.objectContaining({
        level: "info",
        workspaceId,
        mailboxId: mailbox?.mailboxId,
        reconnected: false,
      }),
    ]);
    // The state was used up.
    expect(await waitingFor(params.get("state") ?? "")).toBeNull();
    const list = await (await admin.get(`/api/workspaces/${workspaceId}/mailboxes`)).text();
    expect(list).toContain('"auth":"google"');
    for (const text of [list, deps.rawLogs.join("\n")]) {
      expect(text).not.toContain("E2E-SECRET");
      expect(text).not.toContain(exchange?.verifier ?? "-");
    }
    expect(deps.rawLogs.join("\n")).not.toContain("gmail.example");
  });

  it("goes back to Settings › Mailbox once the first scan has started", async () => {
    await seedScan(deps, workspaceId, { kind: "first", status: "stopped" });
    const params = await started();
    const res = await callback(admin, { code: "c", state: params.get("state") ?? "" });
    expect(res.headers.get("location")).toBe(
      `http://jobfilly.test/w/${workspaceId}/settings/mailbox?oauth=connected`,
    );
  });

  it("refuses a wrong state, and stores nothing", async () => {
    await started();
    const res = await callback(admin, { code: "c", state: "not-the-state" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "oauth_refused",
      message: "This sign-in isn't valid any more. Start Sign in with Google again.",
    });
    expect(logged("oauth.callback_refused")).toEqual([
      expect.objectContaining({ level: "warn", reason: "unknown_state" }),
    ]);
    expect(oauth.exchanges).toEqual([]);
    expect(await listMailboxes(deps.db, workspaceId)).toEqual([]);
    expect(deps.rawLogs.join("\n")).not.toContain("not-the-state");
  });

  it("refuses a state used before, or expired after ten minutes", async () => {
    const used = (await started()).get("state") ?? "";
    expect((await callback(admin, { code: "c", state: used })).status).toBe(302);
    expect((await callback(admin, { code: "c", state: used })).status).toBe(400);

    const late = (await started()).get("state") ?? "";
    deps.clock.advance(10 * MINUTE);
    expect((await callback(admin, { code: "c", state: late })).status).toBe(400);
    expect(oauth.exchanges).toHaveLength(1);
    expect(logged("oauth.callback_refused").map((l) => l.reason)).toEqual([
      "unknown_state",
      "unknown_state",
    ]);
  });

  it("refuses a state another user started, and one whose user is no longer an admin", async () => {
    const app = createApp(deps);
    const tom = await seedUser(deps, { name: "Tom Okafor" });
    await addMember(deps.db, workspaceId, tom.id, "admin");
    const asTom = await signedIn(app, deps, tom);
    const marias = (await started()).get("state") ?? "";
    expect((await callback(asTom, { code: "c", state: marias })).status).toBe(400);

    const toms = (await started(asTom)).get("state") ?? "";
    await addMember(deps.db, workspaceId, tom.id, "editor");
    expect((await callback(asTom, { code: "c", state: toms })).status).toBe(400);
    expect(logged("oauth.callback_refused").map((l) => l.reason)).toEqual([
      "other_user",
      "not_admin",
    ]);
    expect(oauth.exchanges).toEqual([]);
    expect((await testClient(app, deps).get(`${CALLBACK}?code=c&state=${toms}`)).status).toBe(401);
  });

  it("goes back with denied when the user said no on Google's page", async () => {
    const state = (await started()).get("state") ?? "";
    const res = await callback(admin, { error: "access_denied", state });
    expect(res.headers.get("location")).toMatch(/\?oauth=denied$/);
    expect(oauth.exchanges).toEqual([]);
    expect(await listMailboxes(deps.db, workspaceId)).toEqual([]);
  });

  it("goes back with failed when the exchange or Gmail's IMAP refuses, and stores nothing", async () => {
    deps.oauth = {
      ...oauth.port,
      exchange: async () => {
        throw new Error("the token endpoint answered 400");
      },
    };
    let res = await callback(admin, { code: "c", state: (await started()).get("state") ?? "" });
    expect(res.headers.get("location")).toMatch(/\?oauth=failed$/);
    expect(logged("oauth.callback_refused")).toEqual([
      expect.objectContaining({ reason: "exchange_failed", error: "Error" }),
    ]);

    deps.oauth = oauth.port;
    imapResult = { ok: false, reason: "wrong_password", message: "x" };
    res = await callback(admin, { code: "c", state: (await started()).get("state") ?? "" });
    expect(res.headers.get("location")).toMatch(/\?oauth=failed$/);
    expect(logged("mailbox.test_failed")).toEqual([
      expect.objectContaining({ level: "warn", reason: "wrong_password" }),
    ]);
    expect(await listMailboxes(deps.db, workspaceId)).toEqual([]);
  });

  it("says when the workspace already has that mailbox", async () => {
    await seedGoogleMailbox(deps, workspaceId);
    const res = await callback(admin, { code: "c", state: (await started()).get("state") ?? "" });
    expect(res.headers.get("location")).toMatch(/\?oauth=exists$/);
    expect(await listMailboxes(deps.db, workspaceId)).toHaveLength(1);
  });
});

describe("reconnecting after Reconnect needed", () => {
  it("keeps the mailbox and its mail, with the new tokens, connected again", async () => {
    const { mailboxId } = await seedGoogleMailbox(deps, workspaceId);
    await markMailboxReconnectNeeded(deps.db, workspaceId, mailboxId);
    const state = (await started(admin, { mailboxId })).get("state") ?? "";
    const res = await callback(admin, { code: "c", state });
    expect(res.headers.get("location")).toMatch(/\?oauth=connected$/);
    const mailbox = await getMailboxConnection(deps.db, workspaceId, mailboxId);
    expect(mailbox?.status).toBe("connected");
    expect(
      OAuthTokensSchema.parse(
        JSON.parse(open(deps.config.secretKey, mailbox?.secretCiphertext ?? "")),
      ).accessToken,
    ).toBe("E2E-SECRET-access-1");
    expect(await listMailboxes(deps.db, workspaceId)).toHaveLength(1);
    expect(logged("mailbox.oauth_connected")).toEqual([
      expect.objectContaining({ mailboxId, reconnected: true }),
    ]);
  });

  it("refuses another Google account than the mailbox's", async () => {
    const { mailboxId } = await seedGoogleMailbox(deps, workspaceId);
    await markMailboxReconnectNeeded(deps.db, workspaceId, mailboxId);
    oauth.email = "someone.else@gmail.example";
    const state = (await started(admin, { mailboxId })).get("state") ?? "";
    const res = await callback(admin, { code: "c", state });
    expect(res.headers.get("location")).toMatch(/\?oauth=wrong_account$/);
    expect((await getMailboxConnection(deps.db, workspaceId, mailboxId))?.status).toBe(
      "reconnect_needed",
    );
  });
});
