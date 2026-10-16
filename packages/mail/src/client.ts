import { randomUUID } from "node:crypto";
import type {
  Address,
  DraftMailInput,
  DraftRef,
  Envelope,
  FetchSinceResult,
  MailConnection,
  MailFolder,
  MailTestFailureReason,
  MailTestResult,
  MessageRef,
  OriginalMessage,
} from "@jobfilly/schema";
import { buildDraftMime } from "./drafts/index";
import { FAILURE_MESSAGES, failureReason, MailError } from "./errors";
import { bodyText, envelopeFromSource, originalFromSource } from "./parse";
import { type ImapFolder, type ImapSession, imapflowSession, type SessionFactory } from "./session";

// Mail access over IMAP. Nothing in this package sends mail: there is no send operation at all
// (F6.6), and drafts are only appended to the Drafts folder. Reading never changes the mailbox:
// folders are opened read-only, and only the Drafts folder is ever opened for changes, to delete
// a draft the app saved there.

export interface MailClientOptions {
  /** Plain-text IMAP is refused unless JOBFILLY_ALLOW_INSECURE_MAIL=true (F2.4). */
  allowInsecure: boolean;
  /**
   * The mailbox's own email address, as the user gave it when connecting: the From of every
   * draft and the domain of its Message-ID. The IMAP user name is often not an address.
   */
  address: string;
}

/** The words of a MailUnavailableError per reason, as the mailbox status shows them (F1.4). */
export const UNAVAILABLE_MESSAGES: Record<MailTestFailureReason, string> = {
  unreachable: "Couldn't reach the mail server",
  wrong_password: FAILURE_MESSAGES.wrong_password,
  tls: FAILURE_MESSAGES.tls,
  insecure_refused: FAILURE_MESSAGES.insecure_refused,
};

/**
 * The mail server couldn't be reached, or refused to take a draft (an append or a store failed).
 * draft.create maps it to a draft failed with kind `mailbox`, which the sweep retries; the sync
 * job to a failed sync, retried with back-off, whose status keeps `reason` for the UI to branch
 * on. The message is plain words, never the server's: by default the reason's own words.
 * Every MVP 2 operation (fetchSince, fetchOriginal and the Drafts-folder ones) fails with it.
 */
export class MailUnavailableError extends Error {
  constructor(
    readonly reason: MailTestFailureReason = "unreachable",
    message: string = UNAVAILABLE_MESSAGES[reason],
  ) {
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
   * before the first sync), in UID order. When the folder's UIDVALIDITY changed, every message
   * comes back with `changed` set (FetchSinceResult). Reads only; never changes a flag.
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
  /** The Drafts folder's path (special use \Drafts, else named Drafts), created when none. */
  ensureDraftsFolder(): Promise<{ path: string }>;
  /**
   * Saves a reply to the Drafts folder with the \Draft flag (F6.3): threaded to the original
   * (In-Reply-To, References), quoting it, with the attachment if any. Throws
   * MailUnavailableError when the server can't be reached or refuses the append.
   */
  saveDraft(input: DraftMailInput): Promise<DraftRef>;
  /** Replaces a saved draft so exactly one copy remains (F6.4): the new one's ref. */
  replaceDraft(ref: DraftRef, input: DraftMailInput): Promise<DraftRef>;
  /**
   * Deletes a saved draft (discard, F6.4), found by its Message-ID when the Drafts folder's
   * UIDVALIDITY changed; a draft already gone is not an error.
   */
  deleteDraft(ref: DraftRef): Promise<void>;
  close(): Promise<void>;
}

/** Only the start of each message is read for its envelope: the headers and the snippet. */
const ENVELOPE_SOURCE_BYTES = 64 * 1024;

const SENT_NAME = /^sent( items| messages| mail)?$/i;
const DRAFTS_NAME = /^drafts?$/i;

/**
 * UIDVALIDITY 0 is never a folder's (RFC 3501): a draft saved where the server told no UID and
 * the lookup found none gets it, so replacing or deleting it finds it by its Message-ID.
 */
const UNKNOWN_UIDVALIDITY = 0;

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

/** The Drafts folder: by special use first, then by name; null when there is none. */
function locateDrafts(folders: ImapFolder[]): string | null {
  return (
    folders.find((f) => f.specialUse === "\\Drafts")?.path ??
    folders.find((f) => DRAFTS_NAME.test(f.name))?.path ??
    null
  );
}

/** A new draft's Message-ID, on the mailbox's own domain. */
function draftMessageId(from: Address): string {
  const domain = from.address.split("@").at(-1) || "jobfilly.invalid";
  return `<${randomUUID()}@${domain}>`;
}

export function mailClientWith(
  conn: MailConnection,
  options: MailClientOptions,
  factory: SessionFactory,
): MailClient {
  let connecting: Promise<ImapSession> | null = null;
  let listing: ImapFolder[] | null = null;
  let located: { inbox: string; sent: string | null } | null = null;
  let drafts: string | null = null;
  const from: Address = { address: options.address, name: null };
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
        throw error instanceof MailError || error instanceof MailUnavailableError
          ? error
          : new MailError(failureReason(error));
      }
    });
    queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Like exclusive, for the MVP 2 operations: any failure (the connection, a refused append or
   * store) becomes a MailUnavailableError in plain words.
   */
  function available<T>(work: (s: ImapSession) => Promise<T>): Promise<T> {
    return exclusive(work).catch((error: unknown) => {
      if (error instanceof MailUnavailableError) throw error;
      throw new MailUnavailableError(failureReason(error));
    });
  }

  async function list(s: ImapSession) {
    listing ??= await s.list();
    return listing;
  }

  async function folders(s: ImapSession) {
    located ??= locateFolders(await list(s));
    return located;
  }

  async function draftsFolder(s: ImapSession): Promise<string> {
    drafts ??= locateDrafts(await list(s)) ?? (await s.create("Drafts")).path;
    return drafts;
  }

  /** The envelopes of these UIDs of the open folder, in UID order. */
  async function envelopesOf(
    s: ImapSession,
    uids: number[],
    info: { folder: MailFolder; folderPath: string; uidValidity: number },
  ): Promise<Envelope[]> {
    const envelopes: Envelope[] = [];
    for await (const message of s.fetch(uids, { maxBytes: ENVELOPE_SOURCE_BYTES })) {
      envelopes.push(
        await envelopeFromSource(message.source, {
          ...info,
          uid: message.uid,
          internalDate: message.internalDate,
        }),
      );
    }
    return envelopes.sort((a, b) => a.uid - b.uid);
  }

  /** The UIDs in the open folder of the message whose Message-ID is exactly `messageId`. */
  async function findByMessageId(
    s: ImapSession,
    path: string,
    uidValidity: number,
    messageId: string,
  ): Promise<number[]> {
    const candidates = await s.searchHeader("Message-ID", messageId);
    if (candidates.length === 0) return [];
    // The server's header search matches substrings; the id must be the whole header.
    const found = await envelopesOf(s, candidates, {
      folder: "inbox",
      folderPath: path,
      uidValidity,
    });
    return found.filter((e) => e.messageId === messageId).map((e) => e.uid);
  }

  /** Appends the draft to the Drafts folder with the \Draft flag; returns where it is. */
  async function append(s: ImapSession, input: DraftMailInput): Promise<DraftRef> {
    const path = await draftsFolder(s);
    const date = new Date();
    const messageId = draftMessageId(from);
    const mime = await buildDraftMime({ ...input, from, messageId, date });
    const appended = await s.append(path, mime, ["\\Draft"], date);
    // The server was reached but didn't take the draft: retried as when it can't be reached.
    if (!appended) {
      throw new MailUnavailableError("unreachable", "The mail server refused to save the draft");
    }
    const ref = { path, draftMessageId: messageId };
    if (appended.uid !== null && appended.uidValidity !== null) {
      return { ...ref, uid: appended.uid, uidValidity: appended.uidValidity };
    }
    // A server without UIDPLUS doesn't tell the UID: the draft is looked up by its Message-ID.
    const { uidValidity } = await s.open(path);
    const [uid] = await findByMessageId(s, path, uidValidity, messageId);
    return uid === undefined
      ? { ...ref, uid: 0, uidValidity: UNKNOWN_UIDVALIDITY }
      : { ...ref, uid, uidValidity };
  }

  /**
   * Removes a saved draft: by its UID while the folder's UIDVALIDITY is the one it was saved
   * under, else by its Message-ID (the folder was rebuilt). One already gone is no error.
   */
  async function remove(s: ImapSession, ref: DraftRef): Promise<void> {
    const { uidValidity } = await s.openWritable(ref.path);
    const uids =
      uidValidity === ref.uidValidity
        ? [ref.uid]
        : await findByMessageId(s, ref.path, uidValidity, ref.draftMessageId);
    await s.deleteUids(uids);
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

    fetchSince: ({ folder, uidValidity, afterUid }) =>
      available(async (s) => {
        const { inbox, sent } = await folders(s);
        const path = folder === "inbox" ? inbox : sent;
        if (!path) return { uidValidity: uidValidity ?? 0, changed: false, messages: [] };
        const current = (await s.open(path)).uidValidity;
        const changed = uidValidity !== null && uidValidity !== current;
        // A rebuilt folder's UIDs name other messages: every one of them comes back.
        const after = changed ? 0 : afterUid;
        // UID n:* also matches the newest message when n is past it, so the range is re-checked.
        const uids = (await s.searchFromUid(after + 1)).filter((uid) => uid > after);
        const messages = await envelopesOf(s, uids, {
          folder,
          folderPath: path,
          uidValidity: current,
        });
        // Arrival by the envelope's date until the INTERNALDATE is read here.
        const received = messages.map((m) => ({ ...m, receivedAt: m.date }));
        return { uidValidity: current, changed, messages: received };
      }),

    fetchOriginal: (ref) =>
      available(async (s) => {
        const { uidValidity } = await s.open(ref.folderPath);
        if (uidValidity !== ref.uidValidity) return null;
        for await (const message of s.fetch([ref.uid], {})) {
          if (message.uid !== ref.uid) continue;
          return originalFromSource(message.source, {
            folder: "inbox",
            folderPath: ref.folderPath,
            uidValidity,
            uid: message.uid,
            internalDate: message.internalDate,
          });
        }
        return null;
      }),

    ensureDraftsFolder: () => available(async (s) => ({ path: await draftsFolder(s) })),

    saveDraft: (input) => available((s) => append(s, input)),

    replaceDraft: (ref, input) =>
      available(async (s) => {
        // The old copy goes first: a failure in between leaves none, and the retry (whose
        // delete then finds nothing) leaves exactly one, never two.
        await remove(s, ref);
        return append(s, input);
      }),

    deleteDraft: (ref) => available((s) => remove(s, ref)),

    async close() {
      const pending = connecting;
      connecting = null;
      listing = null;
      located = null;
      drafts = null;
      const s = await pending?.catch(() => null);
      await s?.logout();
    },
  };
}

export function createMailClient(conn: MailConnection, options: MailClientOptions): MailClient {
  return mailClientWith(conn, options, imapflowSession);
}
