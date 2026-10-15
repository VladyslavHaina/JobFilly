import type {
  Envelope,
  MailConnection,
  MailFolder,
  MailTestResult,
  MessageRef,
} from "@jobfilly/schema";
import { FAILURE_MESSAGES, failureReason, MailError } from "./errors";
import { bodyText, envelopeFromSource } from "./parse";
import { type ImapFolder, type ImapSession, imapflowSession, type SessionFactory } from "./session";

// Mail access over IMAP. Nothing in this package sends mail on its own; sending is one explicit
// call per message, made only after the user pressed send. Reading never changes the mailbox:
// folders are opened read-only.

export interface MailClientOptions {
  /** Plain-text IMAP is refused unless JOBFILLY_ALLOW_INSECURE_MAIL=true (F2.4). */
  allowInsecure: boolean;
}

export interface MailClient {
  /** Connects and lists the folders, finding Sent; never reports the password. */
  test(): Promise<MailTestResult>;
  /** Envelopes of one folder since `since`, newest first, with a snippet of the plain text. */
  fetchEnvelopes(query: { folder: MailFolder; since: Date }): Promise<Envelope[]>;
  /** The sanitised plain text, or null when the folder's UIDVALIDITY no longer matches. */
  fetchBody(ref: MessageRef): Promise<{ text: string } | null>;
  close(): Promise<void>;
}

/** Only the start of each message is read for its envelope: the headers and the snippet. */
const ENVELOPE_SOURCE_BYTES = 64 * 1024;

const SENT_NAME = /^sent( items| messages| mail)?$/i;

/** The Inbox and Sent folder paths: by special use first, then by name. */
function locateFolders(folders: ImapFolder[]): { inbox: string; sent: string | null } {
  const inbox =
    folders.find((f) => f.specialUse === "\\Inbox")?.path ??
    folders.find((f) => f.path.toUpperCase() === "INBOX")?.path ??
    "INBOX";
  const sent =
    folders.find((f) => f.specialUse === "\\Sent")?.path ??
    folders.find((f) => SENT_NAME.test(f.name))?.path ??
    null;
  return { inbox, sent };
}

export function mailClientWith(
  conn: MailConnection,
  options: MailClientOptions,
  factory: SessionFactory,
): MailClient {
  let connecting: Promise<ImapSession> | null = null;
  let located: { inbox: string; sent: string | null } | null = null;
  // One operation at a time: opening a folder and reading it must not interleave with another.
  let queue: Promise<unknown> = Promise.resolve();

  function session(): Promise<ImapSession> {
    if (conn.tlsMode === "none" && !options.allowInsecure) {
      return Promise.reject(new MailError("insecure_refused"));
    }
    if (!connecting) {
      const s = factory(conn);
      connecting = s.connect().then(() => s);
      connecting.catch(() => {
        connecting = null;
      });
    }
    return connecting;
  }

  /** Runs `work` alone; any failure becomes a MailError with a plain reason, never raw text. */
  function exclusive<T>(work: (s: ImapSession) => Promise<T>): Promise<T> {
    const run = queue.then(async () => {
      try {
        return await work(await session());
      } catch (error) {
        throw error instanceof MailError ? error : new MailError(failureReason(error));
      }
    });
    queue = run.catch(() => undefined);
    return run;
  }

  async function folders(s: ImapSession) {
    located ??= locateFolders(await s.list());
    return located;
  }

  return {
    async test() {
      try {
        const { inbox, sent } = await exclusive(folders);
        return { ok: true, folders: sent ? [inbox, sent] : [inbox], sentPath: sent };
      } catch (error) {
        const reason = failureReason(error);
        return { ok: false, reason, message: FAILURE_MESSAGES[reason] };
      }
    },

    fetchEnvelopes: ({ folder, since }) =>
      exclusive(async (s) => {
        const { inbox, sent } = await folders(s);
        const path = folder === "inbox" ? inbox : sent;
        if (!path) return [];
        const { uidValidity } = await s.open(path);
        const uids = await s.searchSince(since);
        const envelopes: Envelope[] = [];
        for await (const message of s.fetch(uids, { maxBytes: ENVELOPE_SOURCE_BYTES })) {
          const envelope = await envelopeFromSource(message.source, {
            folder,
            folderPath: path,
            uidValidity,
            uid: message.uid,
            internalDate: message.internalDate,
          });
          // IMAP's SINCE works in whole days; the window itself is exact.
          const received = message.internalDate ?? new Date(envelope.date);
          if (received >= since) envelopes.push(envelope);
        }
        return envelopes.sort((a, b) => b.date.localeCompare(a.date) || b.uid - a.uid);
      }),

    fetchBody: (ref) =>
      exclusive(async (s) => {
        const { uidValidity } = await s.open(ref.folderPath);
        // The folder was rebuilt: its UIDs now name other messages, or none.
        if (uidValidity !== ref.uidValidity) return null;
        for await (const message of s.fetch([ref.uid], {})) {
          if (message.uid === ref.uid) return { text: await bodyText(message.source) };
        }
        return null;
      }),

    async close() {
      const pending = connecting;
      connecting = null;
      located = null;
      const s = await pending?.catch(() => null);
      await s?.logout();
    },
  };
}

export function createMailClient(conn: MailConnection, options: MailClientOptions): MailClient {
  return mailClientWith(conn, options, imapflowSession);
}
