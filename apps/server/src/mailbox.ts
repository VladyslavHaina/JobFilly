import { getMailboxConnection, type StoredMailbox } from "@jobfilly/db";
import type { MailClient } from "@jobfilly/mail";
import type { AppDeps } from "./deps";
import { open } from "./secrets";

// The one way the server opens a workspace's mailbox (ARCHITECTURE › AI, next to aiClientFor):
// read the stored connection, open its sealed password with JOBFILLY_SECRET_KEY, and connect
// through deps.mail with JOBFILLY_ALLOW_INSECURE_MAIL. The body route, the scan, the pipeline,
// the sync and the drafts all use it, so the password is opened in one place and never leaves
// the mail client.

/**
 * The stored password won't open: it was sealed under another JOBFILLY_SECRET_KEY, a problem of
 * the server's configuration rather than the user's settings. The message names nothing secret.
 */
export class MailboxSecretError extends Error {
  constructor() {
    super("the stored mail password can't be opened with this JOBFILLY_SECRET_KEY");
    this.name = "MailboxSecretError";
  }
}

/**
 * A client for the workspace's mailbox, or null when none is connected. Throws
 * MailboxSecretError when the password won't open (connectStoredMailbox).
 */
export async function connectMailbox(
  deps: AppDeps,
  workspaceId: string,
): Promise<MailClient | null> {
  const mailbox = await getMailboxConnection(deps.db, workspaceId);
  return mailbox ? connectStoredMailbox(deps, mailbox) : null;
}

/**
 * A client for a stored mailbox the caller has already read (the scan needs its address too).
 * Throws MailboxSecretError when the password won't open; the client itself logs in on first use.
 */
export function connectStoredMailbox(deps: AppDeps, mailbox: StoredMailbox): MailClient {
  let password: string;
  try {
    password = open(deps.config.secretKey, mailbox.secretCiphertext);
  } catch {
    throw new MailboxSecretError();
  }
  return deps.mail.connect(
    {
      host: mailbox.host,
      port: mailbox.port,
      tlsMode: mailbox.tlsMode,
      username: mailbox.username,
      password,
    },
    { allowInsecure: deps.config.allowInsecureMail },
  );
}
