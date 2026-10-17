import { and, eq, lt } from "drizzle-orm";
import type { Database } from "../client";
import { oauthStates } from "../tables";

// Google sign-ins waiting for their callback (MVP 3, F3.2): the oauth_states table. Only the
// state's hash is stored, with the PKCE verifier sealed, so a database read can't complete a
// sign-in. A state is good for one callback within its expiry.
//
// takeOAuthState is an exception to "every query takes a workspace id" (ARCHITECTURE ›
// Workspaces): the callback's URL can't name a workspace, so it finds the waiting sign-in by the
// state's hash, which names the workspace and the user, and the server then checks that user's
// session and role.

export interface OAuthStateInsert {
  userId: string;
  stateHash: string;
  verifierCiphertext: string;
  /** The Google mailbox a reconnect signs in to again; null for a new mailbox. */
  mailboxId: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface WaitingOAuthState {
  workspaceId: string;
  userId: string;
  verifierCiphertext: string;
  mailboxId: string | null;
}

/** Keeps a new sign-in, and drops the workspace's sign-ins that expired unused. */
export async function saveOAuthState(
  db: Database,
  workspaceId: string,
  input: OAuthStateInsert,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(oauthStates)
      .where(
        and(eq(oauthStates.workspaceId, workspaceId), lt(oauthStates.expiresAt, input.createdAt)),
      );
    await tx.insert(oauthStates).values({ workspaceId, provider: "google", ...input });
  });
}

/**
 * The sign-in waiting under this state's hash, removed so it is used once; null when there is
 * none, or it expired before `now` (removed all the same).
 */
export async function takeOAuthState(
  db: Database,
  stateHash: string,
  now: Date,
): Promise<WaitingOAuthState | null> {
  const [row] = await db.delete(oauthStates).where(eq(oauthStates.stateHash, stateHash)).returning({
    workspaceId: oauthStates.workspaceId,
    userId: oauthStates.userId,
    verifierCiphertext: oauthStates.verifierCiphertext,
    mailboxId: oauthStates.mailboxId,
    expiresAt: oauthStates.expiresAt,
  });
  if (!row || row.expiresAt.getTime() <= now.getTime()) return null;
  const { expiresAt: _expired, ...waiting } = row;
  return waiting;
}
