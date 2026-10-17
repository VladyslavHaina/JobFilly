import { createHash, randomBytes } from "node:crypto";
import {
  createMailbox,
  getLatestScan,
  getMailboxConnection,
  getMembership,
  reconnectMailbox,
  recordActivity,
  saveOAuthState,
  takeOAuthState,
} from "@jobfilly/db";
import {
  OAuthCallbackQuerySchema,
  type OAuthOutcome,
  type OAuthProviders,
  type OAuthStart,
  OAuthStartInputSchema,
  type OAuthTokens,
  roleAtLeast,
} from "@jobfilly/schema";
import { Hono } from "hono";
import {
  NOT_FOUND,
  requireFullAccess,
  requireRole,
  type SignedInEnv,
  validJson,
  validQuery,
  type WorkspaceEnv,
} from "../access";
import { requireUser } from "../auth/session";
import { MINUTE } from "../clock";
import type { GoogleConfig } from "../config";
import type { AppDeps } from "../deps";
import { open, seal } from "../secrets";
import { publishMailboxChange, testFailedFields } from "./mailboxes";

// Sign in with Google (MVP 3, F3.2), Google only: the authorization-code flow with PKCE
// (S256). POST /google/start (an admin of the workspace who sees everything) keeps a sign-in waiting for its callback:
// the state's SHA-256 and the PKCE verifier sealed, for one use within ten minutes, and answers
// Google's consent page to send the browser to. GET /api/oauth/google/callback takes the waiting
// sign-in by the state's hash and refuses (400, logged as oauth.callback_refused with a reason
// code) a state that is wrong, used or expired, or that another user started; then it exchanges
// the code with the verifier, signs in to Gmail's IMAP with the access token (XOAUTH2) to check it
// works and find the Sent folder, and stores the mailbox with its tokens sealed
// (mailbox.oauth_connected), or a reconnect's new tokens on the mailbox it named. The browser goes
// back to the mailbox page with the outcome (OAuthOutcomeSchema). Tokens, the code and the
// verifier are never returned and never logged.

/** How long a sign-in waits for its callback. */
const STATE_TTL_MS = 10 * MINUTE;

/** Gmail over IMAP and SMTP, and the account's address. */
const SCOPE = "https://mail.google.com/ openid email";

const NOT_SET_UP = {
  error: "not_found",
  message: "Sign in with Google isn't set up on this server",
};

const REFUSED = {
  error: "oauth_refused",
  message: "This sign-in isn't valid any more. Start Sign in with Google again.",
};

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** The PKCE S256 challenge of a verifier (RFC 7636 section 4.2). */
const challengeOf = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

/** Google's registered redirect URI: fixed, so a callback can't name a workspace. */
const redirectUriOf = (deps: AppDeps) =>
  new URL("/api/oauth/google/callback", deps.config.publicUrl).toString();

function authorizeUrl(
  google: GoogleConfig,
  input: { redirectUri: string; state: string; verifier: string; loginHint?: string },
): string {
  const url = new URL(google.authorizeUrl);
  const params: Record<string, string> = {
    response_type: "code",
    client_id: google.clientId,
    redirect_uri: input.redirectUri,
    scope: SCOPE,
    state: input.state,
    code_challenge: challengeOf(input.verifier),
    code_challenge_method: "S256",
    // A refresh token, every time: the mailbox signs in for months without the user.
    access_type: "offline",
    prompt: "consent",
    ...(input.loginHint ? { login_hint: input.loginHint } : {}),
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export function oauthRoutes(deps: AppDeps) {
  return new Hono<WorkspaceEnv>().post(
    "/google/start",
    requireRole("admin"),
    requireFullAccess(),
    validJson(OAuthStartInputSchema),
    async (c) => {
      const google = deps.config.google;
      if (!google) return c.json(NOT_SET_UP, 404);
      const workspaceId = c.get("workspaceId");
      const { mailboxId } = c.req.valid("json");
      // A reconnect names one of the workspace's Google mailboxes.
      const mailbox = mailboxId
        ? await getMailboxConnection(deps.db, workspaceId, mailboxId)
        : null;
      if (mailboxId && mailbox?.authKind !== "google") return c.json(NOT_FOUND, 404);
      const state = randomBytes(32).toString("base64url");
      const verifier = randomBytes(32).toString("base64url");
      const now = deps.clock.now();
      await saveOAuthState(deps.db, workspaceId, {
        userId: c.get("user").id,
        stateHash: sha256(state),
        verifierCiphertext: seal(deps.config.secretKey, verifier),
        mailboxId: mailbox?.mailboxId ?? null,
        createdAt: now,
        expiresAt: new Date(now.getTime() + STATE_TTL_MS),
      });
      const body: OAuthStart = {
        url: authorizeUrl(google, {
          redirectUri: redirectUriOf(deps),
          state,
          verifier,
          loginHint: mailbox?.address,
        }),
      };
      return c.json(body);
    },
  );
}

/**
 * GET /api/oauth/providers (OAuthProvidersSchema: whether to show "Sign in with Google") and GET
 * /api/oauth/google/callback (OAuthCallbackQuerySchema; a wrong or used state is refused). The
 * callback's URL is fixed, so Google's registered redirect URI is
 * `${PUBLIC_URL}/api/oauth/google/callback`.
 */
export function oauthPublicRoutes(deps: AppDeps) {
  /**
   * The mailbox page with the outcome: onboarding's first step until the workspace's first scan
   * has started, Settings › Mailbox after it (the web app's paths.onboarding and paths.settings).
   */
  async function backTo(workspaceId: string, outcome: OAuthOutcome): Promise<string> {
    const started = await getLatestScan(deps.db, workspaceId, "first");
    const page = started ? "settings/mailbox" : "setup/mailbox";
    const url = new URL(`/w/${encodeURIComponent(workspaceId)}/${page}`, deps.config.publicUrl);
    url.searchParams.set("oauth", outcome);
    return url.toString();
  }

  return new Hono<SignedInEnv>()
    .use(requireUser)
    .get("/providers", (c) => {
      const body: OAuthProviders = { google: deps.config.google !== null };
      return c.json(body);
    })
    .get("/google/callback", validQuery(OAuthCallbackQuerySchema), async (c) => {
      const google = deps.config.google;
      if (!google) return c.json(NOT_SET_UP, 404);
      const query = c.req.valid("query");
      const user = c.get("user");
      const refuse = (reason: string) => {
        c.get("log").warn("oauth.callback_refused", { reason });
        return c.json(REFUSED, 400);
      };

      // One use: taken (and so gone) whatever happens next.
      const waiting = await takeOAuthState(deps.db, sha256(query.state), deps.clock.now());
      if (!waiting) return refuse("unknown_state");
      if (waiting.userId !== user.id) return refuse("other_user");
      const { workspaceId } = waiting;
      const member = await getMembership(deps.db, workspaceId, user.id);
      if (!member || !roleAtLeast(member.role, "admin")) return refuse("not_admin");
      const log = c.get("log").child({ workspaceId });
      const back = async (outcome: OAuthOutcome) => c.redirect(await backTo(workspaceId, outcome));
      if (query.error) return back("denied");
      if (!query.code) return refuse("no_code");

      let tokens: OAuthTokens;
      try {
        tokens = await deps.oauth.exchange({
          code: query.code,
          verifier: open(deps.config.secretKey, waiting.verifierCiphertext),
          redirectUri: redirectUriOf(deps),
        });
      } catch (error) {
        log.warn("oauth.callback_refused", {
          reason: "exchange_failed",
          error: error instanceof Error ? error.name : "unknown",
        });
        return back("failed");
      }
      const address = tokens.email.toLowerCase();

      // Signs in to Gmail with the token before keeping it: only a mailbox that works is stored.
      const server = {
        host: google.imap.host,
        port: google.imap.port,
        tlsMode: google.imap.tlsMode,
        username: address,
      };
      const client = deps.mail.connect(
        { ...server, accessToken: tokens.accessToken },
        { allowInsecure: deps.config.allowInsecureMail, address },
      );
      const tested = await client.test().finally(() => client.close().catch(() => undefined));
      if (!tested.ok) {
        log.warn("mailbox.test_failed", testFailedFields(tested));
        return back("failed");
      }

      const secretCiphertext = seal(
        deps.config.secretKey,
        JSON.stringify({ ...tokens, email: address }),
      );
      let mailboxId: string;
      if (waiting.mailboxId) {
        const mailbox = await getMailboxConnection(deps.db, workspaceId, waiting.mailboxId);
        if (!mailbox) return back("failed");
        if (mailbox.address !== address) return back("wrong_account");
        await reconnectMailbox(deps.db, workspaceId, mailbox.mailboxId, {
          ...server,
          secretCiphertext,
          sentFolderPath: tested.sentPath,
        });
        mailboxId = mailbox.mailboxId;
      } else {
        const created = await createMailbox(deps.db, workspaceId, {
          ...server,
          address,
          secretCiphertext,
          sentFolderPath: tested.sentPath,
          authKind: "google",
        });
        if (!created.ok) return back("exists");
        mailboxId = created.mailboxId;
        await recordActivity(
          deps.db,
          workspaceId,
          {
            kind: "mailbox.connected",
            actor: { kind: "user", userId: user.id },
            targetUserId: null,
            refs: { mailboxId },
          },
          deps.clock.now(),
        );
      }
      log.info("mailbox.oauth_connected", {
        mailboxId,
        reconnected: waiting.mailboxId !== null,
      });
      await publishMailboxChange(deps, workspaceId);
      return back("connected");
    });
}
