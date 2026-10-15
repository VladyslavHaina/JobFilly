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
        const date = message.internalDate ? new Date(message.internalDate) : null;
        yield { uid: message.uid, internalDate: date, source: message.source };
      }
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
