import { Hono } from "hono";
import { requireRole, type SignedInEnv, type WorkspaceEnv } from "../access";
import { requireUser } from "../auth/session";
import type { AppDeps } from "../deps";
import { notImplemented } from "./not-implemented";

// Sign in with Google (MVP 3, F3.2), Google only (TBD-441): POST /google/start answers where to
// send the browser (OAuthStartSchema), keeping the state's hash and the sealed PKCE verifier.
// Built by the mailboxes slice. Mounted at /api/workspaces/:workspaceId/oauth; the callback and
// the providers list are oauthPublicRoutes, at /api/oauth.

export function oauthRoutes(_deps: AppDeps) {
  return new Hono<WorkspaceEnv>().post("/google/start", requireRole("admin"), notImplemented);
}

/**
 * GET /api/oauth/providers (OAuthProvidersSchema: whether to show "Sign in with Google") and GET
 * /api/oauth/google/callback (OAuthCallbackQuerySchema; a wrong or used state is refused). The
 * callback's URL is fixed, so Google's registered redirect URI is
 * `${PUBLIC_URL}/api/oauth/google/callback`.
 */
export function oauthPublicRoutes(_deps: AppDeps) {
  return new Hono<SignedInEnv>()
    .use(requireUser)
    .get("/providers", notImplemented)
    .get("/google/callback", notImplemented);
}
