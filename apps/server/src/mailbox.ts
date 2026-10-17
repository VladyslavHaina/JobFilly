import {
  getMailboxConnection,
  markMailboxReconnectNeeded,
  type StoredMailbox,
  updateMailboxSecret,
} from "@jobfilly/db";
import { type MailClient, MailUnavailableError } from "@jobfilly/mail";
import { type MailLogin, type OAuthTokens, OAuthTokensSchema } from "@jobfilly/schema";
import { MINUTE } from "./clock";
import type { AppDeps } from "./deps";
import { OAuthRefusedError } from "./oauth/google";
import { open, seal } from "./secrets";

// The one way the server opens a workspace's stored mailbox (ARCHITECTURE › AI, next to
// aiClientFor): open its sealed secret with JOBFILLY_SECRET_KEY and connect through deps.mail
// with JOBFILLY_ALLOW_INSECURE_MAIL, so the secret is opened in one place and never leaves the
// mail client.
//
//   connectMailbox        reads the stored connection of one mailbox (MVP 3: a message's own,
//                         F3.1; none named is the workspace's first, where mail stored before
//                         MVP 3 lives); null when there is none. The body route
//                         (routes/messages.ts), the pipeline (pipeline/evaluate.ts) and the
//                         drafts (drafts/) use it.
//   connectStoredMailbox  opens a row the caller already read: the scan (jobs/scan) and the sync
//                         (sync/run.ts).
//   mailboxLogin          the login itself, for SMTP (the send job, MVP 3 F4) as for IMAP.
//
// MVP 3 (F3.2): a Google mailbox's secret is its OAuth tokens as JSON. Its access token is
// refreshed on use when it expires within REFRESH_MARGIN_MS, and the new one is stored sealed. A
// refresh Google refuses (revoked) turns the mailbox to "Reconnect needed" (logged once as
// mailbox.reconnect_needed) and fails the use with ReconnectNeededError; nothing stored is lost,
// and signing in again (routes/oauth.ts) puts it back.

/**
 * The stored secret won't open: it was sealed under another JOBFILLY_SECRET_KEY, a problem of
 * the server's configuration rather than the user's settings. The message names nothing secret.
 */
export class MailboxSecretError extends Error {
  constructor() {
    super("the stored mail password can't be opened with this JOBFILLY_SECRET_KEY");
    this.name = "MailboxSecretError";
  }
}

/**
 * Google refused the mailbox's refresh token: the user signs in again. A MailUnavailableError,
 * so every caller treats it as a mailbox it can't reach now (drafts wait, scans stop) and loses
 * nothing.
 */
export class ReconnectNeededError extends MailUnavailableError {
  constructor() {
    super(
      "wrong_password",
      "Google no longer accepts this mailbox's sign-in. Reconnect it in Settings › Mailbox.",
    );
    this.name = "ReconnectNeededError";
  }
}

/** An access token expiring within this is refreshed before use. */
const REFRESH_MARGIN_MS = 5 * MINUTE;

/**
 * A client for one of the workspace's mailboxes (its first when `mailboxId` is null or left
 * out), or null when that one isn't connected. Throws MailboxSecretError when the secret won't
 * open (connectStoredMailbox).
 */
export async function connectMailbox(
  deps: AppDeps,
  workspaceId: string,
  mailboxId?: string | null,
): Promise<MailClient | null> {
  const mailbox = await getMailboxConnection(deps.db, workspaceId, mailboxId);
  return mailbox ? connectStoredMailbox(deps, mailbox) : null;
}

function openSecret(deps: AppDeps, mailbox: StoredMailbox): string {
  try {
    return open(deps.config.secretKey, mailbox.secretCiphertext);
  } catch {
    throw new MailboxSecretError();
  }
}

/** A Google mailbox's stored tokens; MailboxSecretError when they won't open or don't read. */
function storedTokens(deps: AppDeps, mailbox: StoredMailbox): OAuthTokens {
  const json = openSecret(deps, mailbox);
  try {
    return OAuthTokensSchema.parse(JSON.parse(json));
  } catch {
    throw new MailboxSecretError();
  }
}

/** Refreshes and stores the access token, or marks the mailbox "Reconnect needed". */
async function refreshTokens(
  deps: AppDeps,
  mailbox: StoredMailbox,
  tokens: OAuthTokens,
): Promise<OAuthTokens> {
  let fresh: { accessToken: string; expiresAt: string };
  try {
    fresh = await deps.oauth.refresh(tokens.refreshToken);
  } catch (error) {
    if (!(error instanceof OAuthRefusedError)) {
      // Google can't be reached now: as a mail server that can't, tried again later.
      throw new MailUnavailableError("unreachable", "Couldn't reach Google to sign in");
    }
    const { workspaceId, mailboxId } = mailbox;
    if (await markMailboxReconnectNeeded(deps.db, workspaceId, mailboxId)) {
      deps.log.warn("mailbox.reconnect_needed", { workspaceId, mailboxId });
      await Promise.all(
        (["workspace.updated", "mailbox.updated"] as const).map((type) =>
          deps.live.publish(workspaceId, { type, data: {} }).catch(() => {}),
        ),
      );
    }
    throw new ReconnectNeededError();
  }
  const next: OAuthTokens = { ...tokens, ...fresh };
  const sealed = seal(deps.config.secretKey, JSON.stringify(next));
  await updateMailboxSecret(deps.db, mailbox.workspaceId, mailbox.mailboxId, sealed);
  return next;
}

/**
 * How to sign in to the mailbox: its password, or a Google mailbox's access token, refreshed
 * first when it is about to expire. Throws MailboxSecretError when the secret won't open, and
 * ReconnectNeededError when Google refuses the refresh.
 */
export async function mailboxLogin(deps: AppDeps, mailbox: StoredMailbox): Promise<MailLogin> {
  const server = {
    host: mailbox.host,
    port: mailbox.port,
    tlsMode: mailbox.tlsMode,
    username: mailbox.username,
  };
  if (mailbox.authKind !== "google") return { ...server, password: openSecret(deps, mailbox) };
  let tokens = storedTokens(deps, mailbox);
  if (Date.parse(tokens.expiresAt) - deps.clock.now().getTime() <= REFRESH_MARGIN_MS) {
    tokens = await refreshTokens(deps, mailbox, tokens);
  }
  return { ...server, accessToken: tokens.accessToken };
}

/**
 * A client whose login is worked out on first use (a Google mailbox's refresh is async while
 * connecting isn't); a login that fails fails each use with its error, and test() answers it.
 */
function deferredClient(login: () => Promise<MailClient>): MailClient {
  let client: Promise<MailClient> | null = null;
  const get = () => {
    client ??= login();
    return client;
  };
  return {
    async test() {
      try {
        return await (await get()).test();
      } catch (error) {
        if (!(error instanceof MailUnavailableError)) throw error;
        return { ok: false, reason: error.reason, message: error.message };
      }
    },
    fetchEnvelopes: async (query) => (await get()).fetchEnvelopes(query),
    fetchBody: async (ref) => (await get()).fetchBody(ref),
    fetchSince: async (query) => (await get()).fetchSince(query),
    fetchOriginal: async (ref) => (await get()).fetchOriginal(ref),
    ensureDraftsFolder: async () => (await get()).ensureDraftsFolder(),
    saveDraft: async (input) => (await get()).saveDraft(input),
    replaceDraft: async (ref, input) => (await get()).replaceDraft(ref, input),
    draftAttachment: async (ref) => (await get()).draftAttachment(ref),
    deleteDraft: async (ref) => (await get()).deleteDraft(ref),
    appendSent: async (input) => (await get()).appendSent(input),
    async close() {
      const opened = await client?.catch(() => null);
      await opened?.close();
    },
  };
}

/**
 * A client for a stored mailbox the caller has already read (the scan needs its address too).
 * Throws MailboxSecretError when the secret won't open; the client itself logs in on first use,
 * a Google mailbox's after refreshing its access token if it must (ReconnectNeededError when
 * Google refuses).
 */
export function connectStoredMailbox(deps: AppDeps, mailbox: StoredMailbox): MailClient {
  const options = { allowInsecure: deps.config.allowInsecureMail, address: mailbox.address };
  if (mailbox.authKind !== "google") {
    return deps.mail.connect(
      {
        host: mailbox.host,
        port: mailbox.port,
        tlsMode: mailbox.tlsMode,
        username: mailbox.username,
        password: openSecret(deps, mailbox),
      },
      options,
    );
  }
  // Read now, so a secret that won't open fails here, as a password's does.
  storedTokens(deps, mailbox);
  return deferredClient(async () => deps.mail.connect(await mailboxLogin(deps, mailbox), options));
}
