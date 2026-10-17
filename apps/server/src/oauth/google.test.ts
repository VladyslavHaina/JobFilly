import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { getMailboxConnection, listMailboxes } from "@jobfilly/db";
import { type MailLogin, OAuthStartSchema } from "@jobfilly/schema";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { MINUTE } from "../clock";
import type { GoogleConfig } from "../config";
import { connectMailbox, ReconnectNeededError } from "../mailbox";
import {
  createTestDeps,
  fakeMailClient,
  type SeededUser,
  seedUser,
  signedIn,
  type TestClient,
  type TestDeps,
} from "../testing";
import { googleOAuthPort, OAuthRefusedError } from "./google";

// F3.3: the OAuth flow against the test stack's fake Google authorisation server (e2e/oauth),
// started here as its own process on a free local port, as compose starts it: the real token
// client (googleOAuthPort) over HTTP, and the whole sign-in through the app, from Start to the
// consent page's Allow to the callback, then a revoked refresh token turning the mailbox to
// "Reconnect needed". Nothing leaves the machine. The mail server is the fake mail port; the
// XOAUTH2 login itself is proven against a fake IMAP server in packages/mail
// (imapflow.test.ts), as whether the test stack's mail server takes XOAUTH2 is unverified.

const SERVER = fileURLToPath(new URL("../../../../e2e/oauth/main.ts", import.meta.url));
const CLIENT_ID = "jobfilly-e2e";
const CLIENT_SECRET = "E2E-SECRET-google-client";
const EMAIL = "maria.gmail@gmail.example";
/** The fake server's access token, which the test stack's mail server takes as the password. */
const ACCESS_TOKEN = "E2E-SECRET-maria-gmail-imap";

let child: ChildProcess;
let base: string;
const serverLines: string[] = [];

beforeAll(async () => {
  child = spawn(process.execPath, [SERVER], {
    env: {
      PATH: process.env.PATH,
      PORT: "0",
      OAUTH_CLIENT_ID: CLIENT_ID,
      OAUTH_CLIENT_SECRET: CLIENT_SECRET,
      OAUTH_EMAIL: EMAIL,
      OAUTH_ACCESS_TOKEN: ACCESS_TOKEN,
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const lines = createInterface({ input: child.stdout as NodeJS.ReadableStream });
  base = await new Promise<string>((resolve, reject) => {
    child.once("exit", (code) => reject(new Error(`the fake OAuth server exited (${code})`)));
    lines.on("line", (line) => {
      serverLines.push(line);
      const parsed = JSON.parse(line) as { event?: string; port?: number };
      if (parsed.event === "oauth.ready") resolve(`http://127.0.0.1:${parsed.port}`);
    });
  });
});
afterAll(async () => {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await exited;
});

const google = (): GoogleConfig => ({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  authorizeUrl: `${base}/authorize`,
  tokenUrl: `${base}/token`,
  imap: { host: "imap.gmail.example", port: 993, tlsMode: "tls" },
  smtp: { host: "smtp.gmail.example", port: 465, tlsMode: "tls" },
});

const revokeAll = async () =>
  expect((await fetch(`${base}/control/revoke`, { method: "POST" })).status).toBe(200);

/** The consent page and its Allow button, as the browser shows and presses them. */
async function allow(authorizeUrl: string): Promise<URL> {
  const page = await fetch(authorizeUrl);
  expect(page.status).toBe(200);
  expect(await page.text()).toContain(EMAIL);
  const form = new URLSearchParams(new URL(authorizeUrl).searchParams);
  form.set("decision", "allow");
  const decided = await fetch(`${base}/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  expect(decided.status).toBe(302);
  return new URL(decided.headers.get("location") ?? "");
}

describe("the token client against the fake authorisation server", () => {
  const redirectUri = "http://jobfilly.test/api/oauth/google/callback";
  const verifier = randomBytes(32).toString("base64url");

  async function code(): Promise<string> {
    const url = new URL(`${base}/authorize`);
    for (const [key, value] of Object.entries({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      scope: "https://mail.google.com/ openid email",
      state: "s",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    })) {
      url.searchParams.set(key, value);
    }
    return (await allow(url.toString())).searchParams.get("code") ?? "";
  }

  it("exchanges a code once with its verifier, refreshes, and is refused once revoked", async () => {
    const port = googleOAuthPort(google());
    const first = await code();
    const before = Date.now();
    const tokens = await port.exchange({ code: first, verifier, redirectUri });
    expect(tokens).toMatchObject({ accessToken: ACCESS_TOKEN, email: EMAIL });
    expect(tokens.refreshToken).toMatch(/^E2E-SECRET-refresh-/);
    const expires = Date.parse(tokens.expiresAt);
    expect(expires).toBeGreaterThanOrEqual(before + 3600_000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 3600_000);

    // A code is good once, and only with its own verifier.
    await expect(port.exchange({ code: first, verifier, redirectUri })).rejects.toBeInstanceOf(
      OAuthRefusedError,
    );
    await expect(
      port.exchange({ code: await code(), verifier: "wrong", redirectUri }),
    ).rejects.toBeInstanceOf(OAuthRefusedError);

    expect(await port.refresh(tokens.refreshToken)).toMatchObject({ accessToken: ACCESS_TOKEN });
    await revokeAll();
    await expect(port.refresh(tokens.refreshToken)).rejects.toBeInstanceOf(OAuthRefusedError);
  });

  it("tells a wrong client secret from a revoked token", async () => {
    const port = googleOAuthPort({ ...google(), clientSecret: "E2E-SECRET-wrong" });
    const error = await port.refresh("E2E-SECRET-refresh-x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(OAuthRefusedError);
    expect(String(error)).not.toContain("E2E-SECRET");
  });

  it("never logs a code, a token, the secret or the verifier on the fake server's side", () => {
    expect(serverLines.join("\n")).not.toMatch(/E2E-SECRET|maria\.gmail/);
    expect(serverLines.join("\n")).not.toContain(verifier);
  });
});

describe("Sign in with Google through the app, against the fake authorisation server", () => {
  let deps: TestDeps;
  let maria: SeededUser;
  let admin: TestClient;
  let logins: MailLogin[];

  beforeEach(async () => {
    // The token client stamps expiry with the real time; the test clock starts there.
    deps = await createTestDeps({ now: new Date(), config: { google: google() } });
    deps.oauth = googleOAuthPort(deps.config.google);
    logins = [];
    // Gmail's IMAP as the test stack's mail server: the fake server's access token signs in.
    deps.mail = {
      connect(conn) {
        logins.push(conn);
        const ok = "accessToken" in conn && conn.accessToken === ACCESS_TOKEN;
        return fakeMailClient({
          test: async () =>
            ok
              ? { ok: true, folders: ["INBOX", "[Gmail]/Sent Mail"], sentPath: "[Gmail]/Sent Mail" }
              : { ok: false, reason: "wrong_password", message: "refused" },
          fetchSince: async () => ({ uidValidity: 1, changed: false, messages: [] }),
        });
      },
    };
    maria = await seedUser(deps, { name: "Maria Santos" });
    admin = await signedIn(createApp(deps), deps, maria);
  });
  afterEach(() => deps.close());

  it("connects the Gmail mailbox, then turns it to Reconnect needed once revoked", async () => {
    const start = await admin.post(`/api/workspaces/${maria.workspaceId}/oauth/google/start`, {});
    const { url } = OAuthStartSchema.parse(await start.json());
    const back = await allow(url);
    expect(back.origin + back.pathname).toBe("http://jobfilly.test/api/oauth/google/callback");

    // A wrong state is refused, and doesn't use up the right one.
    const wrong = new URLSearchParams(back.searchParams);
    wrong.set("state", "not-the-state");
    expect((await admin.get(`${back.pathname}?${wrong}`)).status).toBe(400);

    const done = await admin.get(`${back.pathname}${back.search}`);
    expect(done.status).toBe(302);
    expect(done.headers.get("location")).toMatch(/\/setup\/mailbox\?oauth=connected$/);
    const [mailbox] = await listMailboxes(deps.db, maria.workspaceId);
    expect(mailbox).toMatchObject({ address: EMAIL, authKind: "google", status: "connected" });
    expect(logins).toEqual([
      expect.objectContaining({ username: EMAIL, accessToken: ACCESS_TOKEN }),
    ]);
    expect(deps.logs.filter((l) => l.event === "mailbox.oauth_connected")).toHaveLength(1);

    // The access token expires; Google has revoked the refresh token meanwhile.
    await revokeAll();
    deps.clock.advance(61 * MINUTE);
    const client = await connectMailbox(deps, maria.workspaceId, mailbox?.mailboxId);
    await expect(
      client?.fetchSince({ folder: "inbox", uidValidity: null, afterUid: 0 }),
    ).rejects.toBeInstanceOf(ReconnectNeededError);
    await client?.close();
    const after = await getMailboxConnection(deps.db, maria.workspaceId, mailbox?.mailboxId);
    expect(after?.status).toBe("reconnect_needed");
    expect(deps.rawLogs.join("\n")).not.toContain("E2E-SECRET");
  });
});
