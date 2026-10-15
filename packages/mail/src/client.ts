import type {
  DraftMailInput,
  DraftRef,
  Envelope,
  FetchSinceResult,
  MailConnection,
  MailFolder,
  MailTestResult,
  MessageRef,
  OriginalMessage,
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

/**
 * The mail server couldn't be reached, or refused to take a draft (an append or a store failed).
 * draft.create maps it to a draft failed with kind `mailbox`, which the sweep retries; the sync
 * job to a failed sync, retried with back-off. The message is plain words, never the server's.
 */
export class MailUnavailableError extends Error {
  constructor(message = "Couldn't reach the mail server") {
    super(message);
    this.name = "MailUnavailableError";
  }
}

export interface MailClient {
  /** Connects and lists the folders, finding Sent; never reports the password. */
  test(): Promise<MailTestResult>;
  /** Envelopes of one folder since `since`, newest first, with a snippet of the plain text. */
  fetchEnvelopes(query: { folder: MailFolder; since: Date }): Promise<Envelope[]>;
  /** The sanitised plain text, or null when the folder's UIDVALIDITY no longer matches. */
  fetchBody(ref: MessageRef): Promise<{ text: string } | null>;
  /**
   * Continuous sync (F1): the envelopes of one folder after `afterUid` under `uidValidity` (null
   * before the first sync). When the folder's UIDVALIDITY changed, every message comes back with
   * `changed` set (FetchSinceResult). Reads only; never changes a flag.
   */
  fetchSince(query: {
    folder: MailFolder;
    uidValidity: number | null;
    afterUid: number;
  }): Promise<FetchSinceResult>;
  /**
   * The original a draft replies to (threading headers and the text to quote), for drafts on the
   * backlog and after a decision; null when the message is gone. Never stored.
   */
  fetchOriginal(ref: MessageRef): Promise<OriginalMessage | null>;
  /** The Drafts folder's path, created when the mailbox has none. */
  ensureDraftsFolder(): Promise<{ path: string }>;
  /**
   * Saves a reply to the Drafts folder with the \Draft flag (F6.3): threaded to the original
   * (In-Reply-To, References), quoting it, with the attachment if any. Throws
   * MailUnavailableError when the server can't be reached or refuses the append.
   */
  saveDraft(input: DraftMailInput): Promise<DraftRef>;
  /** Replaces a saved draft so exactly one copy remains (F6.4): the new one's ref. */
  replaceDraft(ref: DraftRef, input: DraftMailInput): Promise<DraftRef>;
  /** Deletes a saved draft (discard, F6.4); a draft already gone is not an error. */
  deleteDraft(ref: DraftRef): Promise<void>;
  close(): Promise<void>;
}

/** The MVP 2 operations, until the mailbox slice writes them over the IMAP session. */
const notYet = (operation: string) => () =>
  Promise.reject(new Error(`MailClient.${operation} is written by the mailbox slice`));

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

    fetchSince: notYet("fetchSince"),
    fetchOriginal: notYet("fetchOriginal"),
    ensureDraftsFolder: notYet("ensureDraftsFolder"),
    saveDraft: notYet("saveDraft"),
    replaceDraft: notYet("replaceDraft"),
    deleteDraft: notYet("deleteDraft"),

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
