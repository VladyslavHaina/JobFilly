import type { MailConnection } from "@jobfilly/schema";
import { ImapFlow } from "imapflow";

// The few IMAP operations the mail client needs, behind a small interface: the client's tests
// use a hand-written double of it, and imapflowSession is the real one.

export interface ImapFolder {
  path: string;
  name: string;
  /** "\\Sent", "\\Inbox", ... when the server (or the library, by name) marks it. */
  specialUse: string | null;
}

interface ImapMessage {
  uid: number;
  /** The server's INTERNALDATE; null when it sent none or one that isn't a date. */
  internalDate: Date | null;
  source: Buffer;
}

export interface ImapSession {
  connect(): Promise<void>;
  list(): Promise<ImapFolder[]>;
  /** Opens a folder read-only; never changes flags. */
  open(path: string): Promise<{ uidValidity: number }>;
  /** The UIDs of the open folder's messages received on or after `since`'s day. */
  searchSince(since: Date): Promise<number[]>;
  /** The messages' sources, at most `maxBytes` each when given. */
  fetch(uids: number[], options: { maxBytes?: number }): AsyncIterable<ImapMessage>;
  /** The UIDs of the open folder from `fromUid` on (UID fromUid:*). */
  searchFromUid(fromUid: number): Promise<number[]>;
  /** The UIDs of the open folder whose header `name` contains `value`. */
  searchHeader(name: string, value: string): Promise<number[]>;
  /**
   * Opens a folder for changes (the Drafts folder only): appending is done without it, deleting
   * a draft needs it.
   */
  openWritable(path: string): Promise<{ uidValidity: number }>;
  /**
   * Appends a message with the flags. The UID and UIDVALIDITY when the server tells them
   * (UIDPLUS), else null; false when the server refused it.
   */
  append(
    path: string,
    content: Buffer,
    flags: string[],
    date: Date,
  ): Promise<{ uid: number | null; uidValidity: number | null } | false>;
  /** Deletes messages of the folder opened for changes, by UID (\Deleted, then expunged). */
  deleteUids(uids: number[]): Promise<void>;
  /** Creates a folder; returns its full path (the server may add its namespace prefix). */
  create(path: string): Promise<{ path: string }>;
  logout(): Promise<void>;
}

export type SessionFactory = (conn: MailConnection) => ImapSession;

const SECONDS = 1000;

export const imapflowSession: SessionFactory = (conn) => {
  const client = new ImapFlow({
    host: conn.host,
    port: conn.port,
    secure: conn.tlsMode === "tls",
    // STARTTLS is required when chosen, so a server (or anything in between) can't strip it.
    doSTARTTLS: conn.tlsMode === "starttls" ? true : conn.tlsMode === "none" ? false : undefined,
    auth: { user: conn.username, pass: conn.password },
    // imapflow logs to the console by default, with the commands it sends; the app logs alone.
    logger: false,
    emitLogs: false,
    disableAutoIdle: true,
    connectionTimeout: 15 * SECONDS,
    greetingTimeout: 10 * SECONDS,
    socketTimeout: 60 * SECONDS,
  });
  // A dropped connection is reported through the failing command; without a listener the
  // 'error' event would crash the process.
  client.on("error", () => {});
  return {
    connect: () => client.connect(),
    async list() {
      const folders = await client.list();
      return folders.map((f) => ({ path: f.path, name: f.name, specialUse: f.specialUse ?? null }));
    },
    async open(path) {
      const mailbox = await client.mailboxOpen(path, { readOnly: true });
      return { uidValidity: Number(mailbox.uidValidity) };
    },
    async searchSince(since) {
      const uids = await client.search({ since }, { uid: true });
      return Array.isArray(uids) ? uids : [];
    },
    async *fetch(uids, options) {
      if (uids.length === 0) return;
      const query = {
        uid: true,
        internalDate: true,
        source: options.maxBytes ? { maxLength: options.maxBytes } : true,
      };
      for await (const message of client.fetch(uids, query, { uid: true })) {
        if (!message.source) continue;
        // imapflow hands over the raw text of an INTERNALDATE it couldn't read: no date then.
        const date = message.internalDate ? new Date(message.internalDate) : null;
        const internalDate = date && !Number.isNaN(date.getTime()) ? date : null;
        yield { uid: message.uid, internalDate, source: message.source };
      }
    },
    async searchFromUid(fromUid) {
      const uids = await client.search({ uid: `${fromUid}:*` }, { uid: true });
      return Array.isArray(uids) ? uids : [];
    },
    async searchHeader(name, value) {
      const uids = await client.search({ header: { [name]: value } }, { uid: true });
      return Array.isArray(uids) ? uids : [];
    },
    async openWritable(path) {
      const mailbox = await client.mailboxOpen(path, { readOnly: false });
      return { uidValidity: Number(mailbox.uidValidity) };
    },
    async append(path, content, flags, date) {
      const result = await client.append(path, content, flags, date);
      if (!result) return false;
      return {
        uid: result.uid ?? null,
        uidValidity: result.uidValidity === undefined ? null : Number(result.uidValidity),
      };
    },
    async deleteUids(uids) {
      if (uids.length === 0) return;
      await client.messageDelete(uids, { uid: true });
    },
    async create(path) {
      const created = await client.mailboxCreate(path);
      return { path: created.path };
    },
    async logout() {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    },
  };
};
