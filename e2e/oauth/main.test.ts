import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authorizeDecision,
  authorizePage,
  challengeOf,
  createOAuthServer,
  createState,
  type OAuthOptions,
  token,
} from "./main.ts";

// The fake Google authorisation server (e2e/oauth/main.ts, MVP 3 F3.3), unit-tested on its
// answers and once over HTTP on a free port: the authorization-code flow with PKCE, one-use
// codes, refresh, revocation, and nothing secret in its logs.

const lines: Record<string, unknown>[] = [];
const options: OAuthOptions = {
  clientId: "jobfilly-e2e",
  clientSecret: "E2E-SECRET-google-client",
  email: "maria.gmail@gmail.example",
  accessToken: "E2E-SECRET-maria-gmail-imap",
  log: (l) => lines.push(l),
  now: () => new Date("2026-10-16T10:00:00Z"),
};
const verifier = randomBytes(32).toString("base64url");
const redirectUri = "http://127.0.0.1:8080/api/oauth/google/callback";

const authorizeQuery = (overrides: Record<string, string> = {}) =>
  new URLSearchParams({
    response_type: "code",
    client_id: options.clientId,
    redirect_uri: redirectUri,
    scope: "https://mail.google.com/ openid email",
    state: "s-123",
    code_challenge: challengeOf(verifier),
    code_challenge_method: "S256",
    ...overrides,
  });

/** Allow on the consent page: the code the redirect carries. */
function allow(state = createState()) {
  const reply = authorizeDecision(
    new URLSearchParams({ ...Object.fromEntries(authorizeQuery()), decision: "allow" }),
    options,
    state,
  );
  const location = new URL(reply.headers.location ?? "");
  return { state, reply, location, code: location.searchParams.get("code") ?? "" };
}

const exchange = (state: ReturnType<typeof createState>, code: string, extra = {}) =>
  token(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      client_id: options.clientId,
      client_secret: options.clientSecret,
      ...extra,
    }),
    undefined,
    options,
    state,
  );

describe("the consent page", () => {
  it("shows the account with Allow and Deny for a valid PKCE request", () => {
    const reply = authorizePage(authorizeQuery(), options);
    expect(reply.status).toBe(200);
    expect(reply.body).toContain("maria.gmail@gmail.example");
    expect(reply.body).toContain('value="allow"');
    expect(reply.body).toContain('value="deny"');
  });

  it("refuses an unknown client, a missing state and a plain challenge", () => {
    const bads: Record<string, string>[] = [
      { client_id: "other" },
      { state: "" },
      { code_challenge_method: "plain" },
    ];
    for (const bad of bads) {
      expect(authorizePage(authorizeQuery(bad), options).status).toBe(400);
    }
  });

  it("goes back with the state and a code on Allow, or access_denied on Deny", () => {
    const { reply, location } = allow();
    expect(reply.status).toBe(302);
    expect(location.origin + location.pathname).toBe(redirectUri);
    expect(location.searchParams.get("state")).toBe("s-123");
    const denied = authorizeDecision(
      new URLSearchParams({ ...Object.fromEntries(authorizeQuery()), decision: "deny" }),
      options,
      createState(),
    );
    const back = new URL(denied.headers.location ?? "");
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("code")).toBeNull();
  });
});

describe("the token endpoint", () => {
  it("exchanges a code once, with the right verifier, for tokens and the account's email", () => {
    const { state, code } = allow();
    const reply = exchange(state, code);
    expect(reply.status).toBe(200);
    const body = JSON.parse(reply.body);
    expect(body).toMatchObject({
      access_token: options.accessToken,
      token_type: "Bearer",
      expires_in: 3600,
    });
    const claims = JSON.parse(Buffer.from(body.id_token.split(".")[1], "base64url").toString());
    expect(claims).toMatchObject({ email: options.email, aud: options.clientId });
    expect(JSON.parse(exchange(state, code).body)).toMatchObject({ error: "invalid_grant" });
  });

  it("refuses a wrong verifier, a wrong redirect and a wrong client", () => {
    const wrongVerifier = allow();
    expect(exchange(wrongVerifier.state, wrongVerifier.code, { code_verifier: "x" }).status).toBe(
      400,
    );
    const wrongRedirect = allow();
    expect(
      exchange(wrongRedirect.state, wrongRedirect.code, { redirect_uri: "http://evil.example/" })
        .status,
    ).toBe(400);
    const wrongClient = allow();
    expect(exchange(wrongClient.state, wrongClient.code, { client_secret: "no" }).status).toBe(401);
  });

  it("refreshes until every refresh token is revoked", () => {
    const { state, code } = allow();
    const refresh = JSON.parse(exchange(state, code).body).refresh_token as string;
    const again = () =>
      token(
        new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
        `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}`,
        options,
        state,
      );
    expect(again().status).toBe(200);
    state.refreshTokens.clear();
    expect(JSON.parse(again().body)).toMatchObject({ error: "invalid_grant" });
  });

  it("logs no code, token, secret or verifier", () => {
    expect(JSON.stringify(lines)).not.toMatch(/E2E-SECRET|maria\.gmail/);
    expect(JSON.stringify(lines)).not.toContain(verifier);
  });
});

describe("over HTTP", () => {
  const server = createOAuthServer(options);
  let base = "";
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("runs the whole flow and revokes on the control endpoint", async () => {
    expect((await fetch(`${base}/authorize?${authorizeQuery()}`)).status).toBe(200);
    const decided = await fetch(`${base}/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...Object.fromEntries(authorizeQuery()), decision: "allow" }),
    });
    expect(decided.status).toBe(302);
    const code = new URL(decided.headers.get("location") ?? "").searchParams.get("code") ?? "";
    const tokenAt = (body: Record<string, string>) =>
      fetch(`${base}/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          ...body,
        }),
      });
    const tokens = (await (
      await tokenAt({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      })
    ).json()) as { access_token: string; refresh_token: string };
    expect(tokens.access_token).toBe(options.accessToken);
    expect((await fetch(`${base}/control/revoke`, { method: "POST" })).status).toBe(200);
    const refused = await tokenAt({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    });
    expect(refused.status).toBe(400);
  });
});
