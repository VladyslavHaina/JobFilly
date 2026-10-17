import { randomUUID } from "node:crypto";
import {
  type Address,
  type DraftAttachment,
  type DraftMailInput,
  type DraftRef,
  DraftRefSchema,
  type Envelope,
  type FetchSinceResult,
  FetchSinceResultSchema,
  type MailFolder,
  type MailLogin,
  type MailTestFailureReason,
  type MailTestResult,
  type MessageRef,
  type OriginalMessage,
  OriginalMessageSchema,
  type SyncedEnvelope,
  SyncedEnvelopeSchema,
} from "@jobfilly/schema";
import { usableDate } from "./dates";
import { buildDraftMime } from "./drafts/index";
import {
  FAILURE_MESSAGES,
  failureReason,
  isConnectionDropped,
  isMailFailure,
  MailError,
  mailErrorCode,
} from "./errors";
import {
  attachmentFromSource,
  bodyText,
  conformed,
  ENVELOPE_SOURCE_BYTES,
  envelopeFromSource,
  fallbackEnvelope,
  MESSAGE_SOURCE_BYTES,
  originalFromSource,
  type SourceInfo,
} from "./parse";
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
 * Every MVP 2 operation (fetchSince, fetchOriginal and the Drafts-folder ones) fails with it when
 * the connection, the IMAP session or TLS fails (isMailFailure); any other error, such as the
 * folder's UIDVALIDITY failing its schema or a bug, is passed on as it is, so the sync records
 * reason `error` rather than an unreachable server. One message that fails its schema fails
 * nothing: it is checked on its own (envelopesOf).
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
   * before the first sync), in UID order, each with its arrival time (`receivedAt`). When the
   * folder's UIDVALIDITY changed, every message comes back with `changed` set
   * (FetchSinceResult). Reads only; never changes a flag.
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
   * (In-Reply-To, References), quoting it, with the attachment if any. The copy's Message-ID is
   * `input.draftMessageId` when the caller chose one, else a new one on the mailbox's domain; the
   * ref returned carries it. A retry of draft.create relies on it to find the copy an earlier
   * attempt left. Throws MailUnavailableError when the server can't be reached or refuses the
   * append.
   */
  saveDraft(input: DraftMailInput): Promise<DraftRef>;
  /**
   * Replaces a saved draft so exactly one copy remains (F6.4): the new one's ref, with its
   * Message-ID chosen as for saveDraft.
   */
  replaceDraft(ref: DraftRef, input: DraftMailInput): Promise<DraftRef>;
  /**
   * The file attached to a saved draft (its CV), read from the copy in the Drafts folder, found
   * by its Message-ID when the folder's UIDVALIDITY changed; null when the copy is gone or has
   * none. An edit made after the CV was deleted (F2.5) attaches the file again from here, so the
   * attachment the draft was made with stays.
   */
  draftAttachment(ref: DraftRef): Promise<DraftAttachment | null>;
  /**
   * Deletes a saved draft (discard, F6.4), found by its Message-ID when the Drafts folder's
   * UIDVALIDITY changed; a draft already gone is not an error.
   */
  deleteDraft(ref: DraftRef): Promise<void>;
  /**
   * MVP 3 (F4.4): files a message the app sent (its exact bytes) in the Sent folder, read, unless
   * one with its Message-ID is there already (the provider filed it, or an earlier attempt did),
   * so it is there exactly once. The Sent folder's path and whether this call appended it; null
   * when the server has no Sent folder. Throws MailUnavailableError when the server can't be
   * reached or refuses the append.
   */
  appendSent(input: {
    raw: Uint8Array;
    messageId: string;
    date: Date;
  }): Promise<{ path: string; appended: boolean } | null>;
  close(): Promise<void>;
}

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

const ADDRESS_DOMAIN = /^[^\s@<>]+@([^\s@<>]+\.[^\s@<>]+)$/;

/**
 * A new draft's Message-ID, on the mailbox's own domain. An address without one gets a domain
 * under the reserved .invalid that no synthetic Message-ID uses (isSyntheticMessageId), so the
 * draft's own id is never taken for a made-up one.
 */
function draftMessageId(from: Address): string {
  const domain = ADDRESS_DOMAIN.exec(from.address.trim())?.[1] ?? "drafts.jobfilly.invalid";
  return `<${randomUUID()}@${domain}>`;
}

export function mailClientWith(
  conn: MailLogin,
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

  /**
   * Runs `work` alone, after every operation before it; its error is passed on as it is. When
   * the server dropped the connection (it closes an idle one, say while a model call takes
   * long), the cached session is let go, and `work` runs once more on a new connection.
   */
  function alone<T>(work: (s: ImapSession) => Promise<T>): Promise<T> {
    const run = queue.then(async () => {
      try {
        return await work(await session());
      } catch (error) {
        if (!isConnectionDropped(error)) throw error;
        connecting = null;
        return work(await session());
      }
    });
    queue = run.catch(() => undefined);
    return run;
  }

  /** Runs `work` alone; any failure becomes a MailError with a plain reason, never raw text. */
  function exclusive<T>(work: (s: ImapSession) => Promise<T>): Promise<T> {
    return alone(work).catch((error: unknown) => {
      throw error instanceof MailError || error instanceof MailUnavailableError
        ? error
        : new MailError(failureReason(error), mailErrorCode(error));
    });
  }

  /**
   * Runs `work` alone, for the MVP 2 operations: a failure of the connection, the IMAP session or
   * TLS (a refused append or store too) becomes a MailUnavailableError in plain words. Anything
   * else is the app's, not the server's, and is passed on as it is.
   */
  function available<T>(work: (s: ImapSession) => Promise<T>): Promise<T> {
    return alone(work).catch((error: unknown) => {
      if (error instanceof MailUnavailableError || !isMailFailure(error)) throw error;
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

  /**
   * The envelopes of these UIDs of the open folder, in UID order, each with when it arrived (its
   * INTERNALDATE, else the envelope's date). What the server sent is checked message by message
   * before anyone relies on it, so one message can't fail the folder, and with it every sync
   * after: a field that fails its schema is the fallback envelope's, a message that can't be
   * parsed at all is the fallback envelope, and only one whose UID is no UID is left out.
   */
  async function envelopesOf(
    s: ImapSession,
    uids: number[],
    folder: { folder: MailFolder; folderPath: string; uidValidity: number },
  ): Promise<SyncedEnvelope[]> {
    const envelopes: SyncedEnvelope[] = [];
    for await (const message of s.fetch(uids, { maxBytes: ENVELOPE_SOURCE_BYTES })) {
      const info: SourceInfo = {
        ...folder,
        uid: message.uid,
        internalDate: usableDate(message.internalDate),
      };
      const fallback = fallbackEnvelope(info, message.source);
      const envelope = await envelopeFromSource(message.source, info).catch(() => fallback);
      const receivedAt = info.internalDate?.toISOString() ?? envelope.date;
      const checked = conformed(
        SyncedEnvelopeSchema,
        { ...envelope, receivedAt },
        { ...fallback, receivedAt: fallback.date },
      );
      if (checked) envelopes.push(checked);
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
    const messageId = input.draftMessageId ?? draftMessageId(from);
    const mime = await buildDraftMime({ ...input, from, messageId, date });
    const appended = await s.append(path, mime, ["\\Draft"], date);
    // The server was reached but didn't take the draft: retried as when it can't be reached.
    if (!appended) {
      throw new MailUnavailableError("unreachable", "The mail server refused to save the draft");
    }
    const ref = { path, draftMessageId: messageId };
    // The path, UID and UIDVALIDITY are all the server's words (LIST or CREATE, APPENDUID or the
    // search): the ref is checked as it enters, and one that fails is passed on, not stored.
    if (appended.uid !== null && appended.uidValidity !== null) {
      return DraftRefSchema.parse({ ...ref, uid: appended.uid, uidValidity: appended.uidValidity });
    }
    // A server without UIDPLUS doesn't tell the UID: the draft is looked up by its Message-ID.
    const { uidValidity } = await s.open(path);
    const [uid] = await findByMessageId(s, path, uidValidity, messageId);
    return DraftRefSchema.parse(
      uid === undefined
        ? { ...ref, uid: 0, uidValidity: UNKNOWN_UIDVALIDITY }
        : { ...ref, uid, uidValidity },
    );
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
          const internalDate = usableDate(message.internalDate);
          const envelope = await envelopeFromSource(message.source, {
            folder,
            folderPath: path,
            uidValidity,
            uid: message.uid,
            internalDate,
          });
          // IMAP's SINCE works in whole days; the window itself is exact.
          const received = internalDate ?? new Date(envelope.date);
          if (received >= since) envelopes.push(envelope);
        }
        return envelopes.sort((a, b) => b.date.localeCompare(a.date) || b.uid - a.uid);
      }),

    fetchBody: (ref) =>
      exclusive(async (s) => {
        const { uidValidity } = await s.open(ref.folderPath);
        // The folder was rebuilt: its UIDs now name other messages, or none.
        if (uidValidity !== ref.uidValidity) return null;
        for await (const message of s.fetch([ref.uid], { maxBytes: MESSAGE_SOURCE_BYTES })) {
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
        // Each envelope is checked already; this checks what the server told of the folder.
        return FetchSinceResultSchema.parse({ uidValidity: current, changed, messages });
      }),

    fetchOriginal: (ref) =>
      available(async (s) => {
        const { uidValidity } = await s.open(ref.folderPath);
        if (uidValidity !== ref.uidValidity) return null;
        for await (const message of s.fetch([ref.uid], { maxBytes: MESSAGE_SOURCE_BYTES })) {
          if (message.uid !== ref.uid) continue;
          const info: SourceInfo = {
            folder: "inbox",
            folderPath: ref.folderPath,
            uidValidity,
            uid: message.uid,
            internalDate: usableDate(message.internalDate),
          };
          const original = await originalFromSource(message.source, info);
          // Checked on its own, as each envelope is: a field that fails its schema is the
          // fallback envelope's, and every field of that one passes, so it is never refused.
          const fallback = fallbackEnvelope(info, message.source);
          return conformed(OriginalMessageSchema, original, {
            messageId: fallback.messageId,
            references: fallback.references,
            inReplyTo: fallback.inReplyTo,
            subject: fallback.subject,
            from: fallback.from,
            date: fallback.date,
            text: "",
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

    draftAttachment: (ref) =>
      available(async (s) => {
        const { uidValidity } = await s.open(ref.path);
        const [uid] =
          uidValidity === ref.uidValidity
            ? [ref.uid]
            : await findByMessageId(s, ref.path, uidValidity, ref.draftMessageId);
        if (uid === undefined) return null;
        for await (const message of s.fetch([uid], { maxBytes: MESSAGE_SOURCE_BYTES })) {
          if (message.uid === uid) return attachmentFromSource(message.source);
        }
        return null;
      }),

    deleteDraft: (ref) => available((s) => remove(s, ref)),

    appendSent: (input) =>
      available(async (s) => {
        const { sent } = await folders(s);
        if (!sent) return null;
        const { uidValidity } = await s.open(sent);
        const there = await findByMessageId(s, sent, uidValidity, input.messageId);
        if (there.length > 0) return { path: sent, appended: false };
        const appended = await s.append(sent, Buffer.from(input.raw), ["\\Seen"], input.date);
        if (!appended) {
          throw new MailUnavailableError(
            "unreachable",
            "The mail server refused to file the sent mail",
          );
        }
        return { path: sent, appended: true };
      }),

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

export function createMailClient(conn: MailLogin, options: MailClientOptions): MailClient {
  return mailClientWith(conn, options, imapflowSession);
}
