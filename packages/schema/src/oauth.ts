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

/**
 * POST /api/workspaces/:workspaceId/oauth/google/start's body: the Google mailbox to sign in to
 * again after "Reconnect needed", or none to connect a new one.
 */
export const OAuthStartInputSchema = z.object({ mailboxId: z.uuid().optional() });
export type OAuthStartInput = z.infer<typeof OAuthStartInputSchema>;

/**
 * Where the callback sends the browser back (the `oauth` query parameter of the mailbox page):
 * connected; denied on the consent page; failed (the token exchange or the IMAP login didn't
 * work); exists (the workspace already has a mailbox at that address); wrong_account (a
 * reconnect signed in to another account than the mailbox's).
 */
export const OAuthOutcomeSchema = z.enum([
  "connected",
  "denied",
  "failed",
  "exists",
  "wrong_account",
]);
export type OAuthOutcome = z.infer<typeof OAuthOutcomeSchema>;

/**
 * Google's token endpoint answer as the server reads it (RFC 6749 section 5.1, with OpenID
 * Connect's id_token): an exchange carries the refresh token and the id_token, a refresh only a
 * new access token.
 */
export const GoogleTokenAnswerSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(),
});
export type GoogleTokenAnswer = z.infer<typeof GoogleTokenAnswerSchema>;

/** The id_token's claims the server reads: the account's address. */
export const GoogleIdClaimsSchema = z.object({ email: z.email() });
