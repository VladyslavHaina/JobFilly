import { createMailbox } from "@jobfilly/db";
import type { OAuthTokens } from "@jobfilly/schema";
import type { AppDeps, OAuthPort } from "../deps";
import { OAuthRefusedError } from "../oauth/google";
import { seal } from "../secrets";

// A fake Google token endpoint behind the OAuthPort (tests only, MVP 3 F3.2): an exchange gives
// the account's tokens (a new access token each time, expiring an hour after `now`), a refresh a
// new access token, until revoke() makes every refresh fail with OAuthRefusedError. It records
// what it was asked. Owned by the mailboxes slice once it builds on it.

export interface FakeOAuth {
  port: OAuthPort;
  email: string;
  exchanges: { code: string; verifier: string; redirectUri: string }[];
  refreshes: string[];
  revoke(): void;
}

export function createFakeOAuth(options: { email?: string; now?: () => Date } = {}): FakeOAuth {
  const now = options.now ?? (() => new Date());
  let revoked = false;
  let issued = 0;
  const expiresAt = () => new Date(now().getTime() + 60 * 60 * 1000).toISOString();
  const fake: FakeOAuth = {
    email: options.email ?? "maria.gmail@gmail.example",
    exchanges: [],
    refreshes: [],
    port: {
      async exchange(input) {
        fake.exchanges.push(input);
        issued += 1;
        return {
          accessToken: `E2E-SECRET-access-${issued}`,
          refreshToken: "E2E-SECRET-refresh",
          expiresAt: expiresAt(),
          email: fake.email,
        };
      },
      async refresh(refreshToken) {
        fake.refreshes.push(refreshToken);
        if (revoked) throw new OAuthRefusedError();
        issued += 1;
        return { accessToken: `E2E-SECRET-access-${issued}`, expiresAt: expiresAt() };
      },
    },
    revoke() {
      revoked = true;
    },
  };
  return fake;
}

/**
 * A Google mailbox (F3.2) with its tokens sealed as the callback stores them, the account's
 * address as the user name. By default its access token is good for another hour of the test
 * clock.
 */
export async function seedGoogleMailbox(
  deps: AppDeps,
  workspaceId: string,
  input: { address?: string; tokens?: Partial<OAuthTokens> } = {},
): Promise<{ mailboxId: string; tokens: OAuthTokens }> {
  const address = input.address ?? "maria.gmail@gmail.example";
  const tokens: OAuthTokens = {
    accessToken: "E2E-SECRET-access-0",
    refreshToken: "E2E-SECRET-refresh",
    expiresAt: new Date(deps.clock.now().getTime() + 60 * 60 * 1000).toISOString(),
    email: address,
    ...input.tokens,
  };
  const created = await createMailbox(deps.db, workspaceId, {
    address,
    host: "imap.gmail.example",
    port: 993,
    tlsMode: "tls",
    username: address,
    secretCiphertext: seal(deps.config.secretKey, JSON.stringify(tokens)),
    sentFolderPath: "[Gmail]/Sent Mail",
    authKind: "google",
  });
  if (!created.ok) throw new Error("seedGoogleMailbox: a mailbox at that address exists");
  return { mailboxId: created.mailboxId, tokens };
}
