import { describe, expect, it } from "vitest";
import {
  GoogleIdClaimsSchema,
  GoogleTokenAnswerSchema,
  OAuthOutcomeSchema,
  OAuthStartInputSchema,
} from "./oauth";

// Sign in with Google (MVP 3, F3.2): what the start takes, what the callback tells the page, and
// what the server reads from Google's token endpoint.

describe("Google sign-in", () => {
  it("starts a new sign-in, or one for a mailbox to reconnect", () => {
    expect(OAuthStartInputSchema.parse({})).toEqual({});
    const mailboxId = "8f0e1c62-0000-4000-8000-000000000001";
    expect(OAuthStartInputSchema.parse({ mailboxId })).toEqual({ mailboxId });
    expect(OAuthStartInputSchema.safeParse({ mailboxId: "first" }).success).toBe(false);
  });

  it("names every outcome the mailbox page shows", () => {
    expect(OAuthOutcomeSchema.options).toEqual([
      "connected",
      "denied",
      "failed",
      "exists",
      "wrong_account",
    ]);
  });

  it("reads an exchange with its refresh and id tokens, and a refresh without them", () => {
    const exchange = {
      access_token: "a",
      expires_in: 3599,
      refresh_token: "r",
      id_token: "h.p.s",
      scope: "https://mail.google.com/ openid email",
      token_type: "Bearer",
    };
    expect(GoogleTokenAnswerSchema.parse(exchange)).toEqual({
      access_token: "a",
      expires_in: 3599,
      refresh_token: "r",
      id_token: "h.p.s",
    });
    expect(GoogleTokenAnswerSchema.parse({ access_token: "a", expires_in: 3600 })).toEqual({
      access_token: "a",
      expires_in: 3600,
    });
    expect(GoogleTokenAnswerSchema.safeParse({ access_token: "", expires_in: 1 }).success).toBe(
      false,
    );
    expect(GoogleIdClaimsSchema.safeParse({ email: "no address" }).success).toBe(false);
  });
});
