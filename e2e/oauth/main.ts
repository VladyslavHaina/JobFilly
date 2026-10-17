import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// The fake Google authorisation server of the test stack (MVP 3, F3.2, F3.3; Google only):
// node e2e/oauth/main.ts
//   PORT                 listen port (8080; 0 takes any free port)
//   OAUTH_CLIENT_ID      the one client it knows, and OAUTH_CLIENT_SECRET its secret
//   OAUTH_EMAIL          the account a sign-in is for (the id_token's email claim)
//   OAUTH_ACCESS_TOKEN   the access token it hands out: the test mail server's password for that
//                        account, so the IMAP and SMTP login with XOAUTH2 works there
// The browser reaches it through the proxy (http://127.0.0.1:8084, JOBFILLY_GOOGLE_AUTHORIZE_URL),
// the app inside the stack (http://oauth:8080/token, JOBFILLY_GOOGLE_TOKEN_URL):
//   GET  /authorize        the consent page (Allow, Deny), as Google's, for the authorization-code
//                          flow with PKCE (S256 only)
//   POST /authorize        the button: back to redirect_uri with code and state, or
//                          error=access_denied
//   POST /token            grant_type authorization_code (with client_secret and code_verifier) or
//                          refresh_token; a used or unknown code, or a revoked refresh token, is
//                          invalid_grant, as Google answers
//   POST /control/revoke   revokes every refresh token (an infrastructure step: "Reconnect
//                          needed" in the app, F3.2)
//   GET  /health
// It logs JSON lines without codes, tokens or the verifier.

export interface OAuthOptions {
  clientId: string;
  clientSecret: string;
  email: string;
  accessToken: string;
  log: (line: Record<string, unknown>) => void;
  now?: () => Date;
}

interface Pending {
  clientId: string;
  redirectUri: string;
  challenge: string;
  scope: string;
}

export interface OAuthState {
  codes: Map<string, Pending>;
  refreshTokens: Set<string>;
}

export interface Reply {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const json = (status: number, body: unknown): Reply => ({
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
  body: JSON.stringify(body),
});

const html = (status: number, body: string): Reply => ({
  status,
  headers: { "content-type": "text/html; charset=utf-8" },
  body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign in – Google (test)</title></head><body>${body}</body></html>`,
});

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const base64url = (bytes: Buffer) => bytes.toString("base64url");

/** The S256 challenge of a PKCE verifier (RFC 7636). */
export function challengeOf(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

/** An unsigned id_token with the account's email: the app reads it from the token answer. */
function idToken(options: OAuthOptions, clientId: string): string {
  const now = Math.floor((options.now?.() ?? new Date()).getTime() / 1000);
  const part = (value: unknown) => base64url(Buffer.from(JSON.stringify(value)));
  return `${part({ alg: "none", typ: "JWT" })}.${part({
    iss: "https://accounts.google.com",
    aud: clientId,
    sub: "e2e-google-account",
    email: options.email,
    email_verified: true,
    iat: now,
    exp: now + 3600,
  })}.`;
}

export function createState(): OAuthState {
  return { codes: new Map(), refreshTokens: new Set() };
}

/** GET /authorize: the consent page, or why the request is refused. */
export function authorizePage(query: URLSearchParams, options: OAuthOptions): Reply {
  const p = (name: string) => query.get(name) ?? "";
  const problems = [
    p("response_type") !== "code" && "response_type must be code",
    p("client_id") !== options.clientId && "unknown client_id",
    !/^https?:\/\//.test(p("redirect_uri")) && "redirect_uri must be an http(s) URL",
    !p("state") && "state is required",
    !p("code_challenge") && "code_challenge is required",
    p("code_challenge_method") !== "S256" && "code_challenge_method must be S256",
  ].filter(Boolean);
  if (problems.length > 0) {
    options.log({ level: "warn", event: "oauth.authorize_refused", problems });
    return html(
      400,
      `<h1>Error 400: invalid_request</h1><p>${escapeHtml(problems.join("; "))}</p>`,
    );
  }
  const hidden = ["client_id", "redirect_uri", "state", "code_challenge", "scope"]
    .map((name) => `<input type="hidden" name="${name}" value="${escapeHtml(p(name))}">`)
    .join("");
  return html(
    200,
    `<main><h1>Sign in with Google</h1><p>JobFilly wants to read, compose and send mail for <strong>${escapeHtml(options.email)}</strong>.</p><form method="post" action="/authorize">${hidden}<button type="submit" name="decision" value="allow">Allow</button> <button type="submit" name="decision" value="deny">Deny</button></form></main>`,
  );
}

/** POST /authorize: back to the app with a one-use code, or with access_denied. */
export function authorizeDecision(
  form: URLSearchParams,
  options: OAuthOptions,
  state: OAuthState,
): Reply {
  const redirectUri = form.get("redirect_uri") ?? "";
  if (form.get("client_id") !== options.clientId || !/^https?:\/\//.test(redirectUri)) {
    return html(400, "<h1>Error 400: invalid_request</h1>");
  }
  const target = new URL(redirectUri);
  target.searchParams.set("state", form.get("state") ?? "");
  if (form.get("decision") === "allow") {
    const code = base64url(randomBytes(24));
    state.codes.set(code, {
      clientId: options.clientId,
      redirectUri,
      challenge: form.get("code_challenge") ?? "",
      scope: form.get("scope") ?? "",
    });
    target.searchParams.set("code", code);
    options.log({ level: "info", event: "oauth.authorized" });
  } else {
    target.searchParams.set("error", "access_denied");
    options.log({ level: "info", event: "oauth.denied" });
  }
  return { status: 302, headers: { location: target.toString() }, body: "" };
}

/** The client's credentials, from the form or HTTP Basic, as Google takes either. */
function clientOf(form: URLSearchParams, authorization: string | undefined) {
  const basic = /^Basic (.+)$/i.exec(authorization ?? "")?.[1];
  if (basic) {
    const [id, secret] = Buffer.from(basic, "base64").toString().split(/:(.*)/s);
    return { id: decodeURIComponent(id ?? ""), secret: decodeURIComponent(secret ?? "") };
  }
  return { id: form.get("client_id") ?? "", secret: form.get("client_secret") ?? "" };
}

/** POST /token. */
export function token(
  form: URLSearchParams,
  authorization: string | undefined,
  options: OAuthOptions,
  state: OAuthState,
): Reply {
  const client = clientOf(form, authorization);
  if (client.id !== options.clientId || client.secret !== options.clientSecret) {
    options.log({ level: "warn", event: "oauth.token_refused", reason: "invalid_client" });
    return json(401, { error: "invalid_client" });
  }
  const invalidGrant = (reason: string) => {
    options.log({ level: "warn", event: "oauth.token_refused", reason });
    return json(400, { error: "invalid_grant", error_description: reason });
  };
  const grant = form.get("grant_type");
  if (grant === "authorization_code") {
    const code = form.get("code") ?? "";
    const pending = state.codes.get(code);
    // A code is good for one exchange.
    state.codes.delete(code);
    if (!pending) return invalidGrant("unknown or used code");
    if (pending.redirectUri !== form.get("redirect_uri")) return invalidGrant("redirect_uri");
    if (challengeOf(form.get("code_verifier") ?? "") !== pending.challenge) {
      return invalidGrant("code_verifier");
    }
    const refreshToken = `E2E-SECRET-refresh-${base64url(randomBytes(12))}`;
    state.refreshTokens.add(refreshToken);
    options.log({ level: "info", event: "oauth.token_issued", grant });
    return json(200, {
      access_token: options.accessToken,
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: pending.scope,
      token_type: "Bearer",
      id_token: idToken(options, pending.clientId),
    });
  }
  if (grant === "refresh_token") {
    if (!state.refreshTokens.has(form.get("refresh_token") ?? "")) {
      return invalidGrant("unknown or revoked refresh token");
    }
    options.log({ level: "info", event: "oauth.token_issued", grant });
    return json(200, { access_token: options.accessToken, expires_in: 3600, token_type: "Bearer" });
  }
  return json(400, { error: "unsupported_grant_type" });
}

async function formOf(req: IncomingMessage): Promise<URLSearchParams> {
  let text = "";
  for await (const chunk of req) text += chunk;
  return new URLSearchParams(text);
}

export function createOAuthServer(options: OAuthOptions, state = createState()): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://oauth.invalid");
    let reply: Reply;
    if (req.method === "GET" && url.pathname === "/health") reply = json(200, { ok: true });
    else if (req.method === "GET" && url.pathname === "/authorize") {
      reply = authorizePage(url.searchParams, options);
    } else if (req.method === "POST" && url.pathname === "/authorize") {
      reply = authorizeDecision(await formOf(req), options, state);
    } else if (req.method === "POST" && url.pathname === "/token") {
      reply = token(await formOf(req), req.headers.authorization, options, state);
    } else if (req.method === "POST" && url.pathname === "/control/revoke") {
      state.refreshTokens.clear();
      options.log({ level: "info", event: "oauth.revoked" });
      reply = json(200, { revoked: true });
    } else reply = json(404, { error: "not_found" });
    res.writeHead(reply.status, reply.headers);
    res.end(reply.body);
  });
}

if (import.meta.main) {
  const log = (line: Record<string, unknown>) =>
    console.log(JSON.stringify({ time: new Date().toISOString(), ...line }));
  const env = (name: string) => {
    const value = process.env[name];
    if (!value) {
      log({ level: "fatal", event: "oauth.config", reason: `${name} is required` });
      process.exit(1);
    }
    return value;
  };
  const port = Number(process.env.PORT ?? "8080");
  const server = createOAuthServer({
    clientId: env("OAUTH_CLIENT_ID"),
    clientSecret: env("OAUTH_CLIENT_SECRET"),
    email: env("OAUTH_EMAIL"),
    accessToken: env("OAUTH_ACCESS_TOKEN"),
    log,
  });
  server.listen(port, "0.0.0.0", () =>
    log({ level: "info", event: "oauth.ready", port: (server.address() as AddressInfo).port }),
  );
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
      server.closeAllConnections();
    });
  }
}
