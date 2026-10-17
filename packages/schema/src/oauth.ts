import { z } from "zod";

// OAuth mail sign-in (MVP 3, F3.2): the authorization-code flow with PKCE, for Google (Gmail)
// only (TBD-441). It is offered only when the server has JOBFILLY_GOOGLE_CLIENT_ID and
// JOBFILLY_GOOGLE_CLIENT_SECRET. Tokens are sealed with JOBFILLY_SECRET_KEY, refreshed
// automatically, never returned by the API and never logged.

export const OAuthProviderIdSchema = z.enum(["google"]);
export type OAuthProviderId = z.infer<typeof OAuthProviderIdSchema>;

/** GET /api/oauth/providers: which sign-in buttons to show ("Sign in with Google"). */
export const OAuthProvidersSchema = z.object({ google: z.boolean() });
export type OAuthProviders = z.infer<typeof OAuthProvidersSchema>;

/**
 * POST /api/workspaces/:workspaceId/oauth/google/start: where to send the browser. The server
 * keeps the state's hash and the PKCE verifier (sealed) for one use within a few minutes.
 */
export const OAuthStartSchema = z.object({ url: z.url() });
export type OAuthStart = z.infer<typeof OAuthStartSchema>;

/**
 * GET /api/oauth/google/callback: what the provider sends back. A callback whose state doesn't
 * name a waiting sign-in of the signed-in user is refused.
 */
export const OAuthCallbackQuerySchema = z.object({
  state: z.string().min(1).max(512),
  code: z.string().min(1).max(4096).optional(),
  error: z.string().max(200).optional(),
});
export type OAuthCallbackQuery = z.infer<typeof OAuthCallbackQuerySchema>;

/**
 * The provider's token answer as the server keeps it (sealed): the access token and when it
 * expires, the refresh token, and the account's address from the id_token's email claim.
 */
export const OAuthTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.iso.datetime({ offset: true }),
  email: z.email(),
});
export type OAuthTokens = z.infer<typeof OAuthTokensSchema>;
