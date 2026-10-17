import type { OAuthTokens } from "@jobfilly/schema";
import type { GoogleConfig } from "../config";
import type { OAuthPort } from "../deps";

// Google's token endpoint (MVP 3, F3.2), the only OAuth provider (TBD-441): exchanging an
// authorization code with its PKCE verifier, and refreshing an access token. Built by the
// mailboxes slice; the foundation pins the port (deps.ts OAuthPort) and its errors. Tokens are
// never logged; the client secret only ever goes to the token endpoint.

/** Google refused the refresh token (revoked or expired): the mailbox needs reconnecting. */
export class OAuthRefusedError extends Error {
  constructor() {
    super("the provider refused the token; sign in again");
    this.name = "OAuthRefusedError";
  }
}

const NOT_BUILT = "Google sign-in is not built yet (MVP 3, mailboxes slice)";

/** The port for a server with Google client settings, or one that refuses without them. */
export function googleOAuthPort(config: GoogleConfig | null): OAuthPort {
  const refuse = async (): Promise<never> => {
    throw new Error(config ? NOT_BUILT : "Sign in with Google is not set up on this server");
  };
  return {
    exchange: (): Promise<OAuthTokens> => refuse(),
    refresh: (): Promise<{ accessToken: string; expiresAt: string }> => refuse(),
  };
}
