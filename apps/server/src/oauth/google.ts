import {
  GoogleIdClaimsSchema,
  type GoogleTokenAnswer,
  GoogleTokenAnswerSchema,
  type OAuthTokens,
} from "@jobfilly/schema";
import type { GoogleConfig } from "../config";
import type { OAuthPort } from "../deps";

// Google's token endpoint (MVP 3, F3.2), the only OAuth provider: exchanging an
// authorization code with its PKCE verifier, and refreshing an access token. The foundation pins
// the port (deps.ts OAuthPort) and its errors. Tokens are never logged; the client secret only
// ever goes to the token endpoint. The account's address is the id_token's email claim: the
// id_token comes straight from the token endpoint over TLS, so its signature isn't checked
// (OpenID Connect Core 3.1.3.7).

/** Google refused the refresh token (revoked or expired): the mailbox needs reconnecting. */
export class OAuthRefusedError extends Error {
  constructor() {
    super("the provider refused the token; sign in again");
    this.name = "OAuthRefusedError";
  }
}

/** How long the server waits for the token endpoint. */
const TOKEN_TIMEOUT_MS = 15_000;

/** The id_token's claims (its middle part), or null when it isn't a JWT. */
function claimsOf(idToken: string): unknown {
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

const expiresAt = (answer: GoogleTokenAnswer) =>
  new Date(Date.now() + answer.expires_in * 1000).toISOString();

/** The port for a server with Google client settings, or one that refuses without them. */
export function googleOAuthPort(config: GoogleConfig | null): OAuthPort {
  if (!config) {
    const refuse = async (): Promise<never> => {
      throw new Error("Sign in with Google is not set up on this server");
    };
    return { exchange: refuse, refresh: refuse };
  }

  const google = config;

  /** POSTs the grant; the answer when Google gave one, `refused` for invalid_grant. */
  async function token(form: Record<string, string>): Promise<GoogleTokenAnswer | "refused"> {
    const res = await fetch(google.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        ...form,
        client_id: google.clientId,
        client_secret: google.clientSecret,
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const error = (body as { error?: unknown } | null)?.error;
      if (res.status === 400 && error === "invalid_grant") return "refused";
      // The client's settings or Google itself: never the answer's words, which could echo input.
      throw new Error(`the token endpoint answered ${res.status}`);
    }
    const parsed = GoogleTokenAnswerSchema.safeParse(body);
    if (!parsed.success) throw new Error("the token endpoint's answer isn't a token answer");
    return parsed.data;
  }

  return {
    async exchange(input): Promise<OAuthTokens> {
      const answer = await token({
        grant_type: "authorization_code",
        code: input.code,
        code_verifier: input.verifier,
        redirect_uri: input.redirectUri,
      });
      if (answer === "refused") throw new OAuthRefusedError();
      const claims = GoogleIdClaimsSchema.safeParse(claimsOf(answer.id_token ?? ""));
      if (!answer.refresh_token || !claims.success) {
        throw new Error("the token answer has no refresh token or no email claim");
      }
      return {
        accessToken: answer.access_token,
        refreshToken: answer.refresh_token,
        expiresAt: expiresAt(answer),
        email: claims.data.email.toLowerCase(),
      };
    },
    async refresh(refreshToken) {
      const answer = await token({ grant_type: "refresh_token", refresh_token: refreshToken });
      if (answer === "refused") throw new OAuthRefusedError();
      return { accessToken: answer.access_token, expiresAt: expiresAt(answer) };
    },
  };
}
