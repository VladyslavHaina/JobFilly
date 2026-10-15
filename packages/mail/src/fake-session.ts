import type { ImapFolder, ImapSession, SessionFactory } from "./session";

// A hand-written double of the IMAP session, for the client's tests: folders and messages held
// in memory, plus the calls it saw.

interface FakeMessage {
  uid: number;
  internalDate: Date | null;
  source: string;
}

export interface FakeMailbox {
  folders: ImapFolder[];
  contents: Record<string, { uidValidity: number; messages: FakeMessage[] }>;
  /** Thrown by connect(). */
  connectError?: unknown;
}

export interface FakeServer {
  factory: SessionFactory;
  calls: string[];
  sessions: number;
}

export function fakeServer(mailbox: FakeMailbox): FakeServer {
  const server: FakeServer = { factory: () => session(), calls: [], sessions: 0 };
  let open: string | null = null;
  const session = (): ImapSession => {
    server.sessions += 1;
    return {
      async connect() {
        server.calls.push("connect");
        if (mailbox.connectError) throw mailbox.connectError;
      },
      async list() {
        server.calls.push("list");
        return mailbox.folders;
      },
      async open(path) {
        server.calls.push(`open ${path}`);
        const folder = mailbox.contents[path];
        if (!folder) throw Object.assign(new Error("no such folder"), { code: "NotFound" });
        open = path;
        return { uidValidity: folder.uidValidity };
      },
      async searchSince(since) {
        server.calls.push(`search ${since.toISOString().slice(0, 10)}`);
        const day = new Date(since.toISOString().slice(0, 10));
        return (mailbox.contents[open ?? ""]?.messages ?? [])
          .filter((m) => !m.internalDate || m.internalDate >= day)
          .map((m) => m.uid);
      },
      async *fetch(uids, options) {
        server.calls.push(
          `fetch ${uids.join(",")}${options.maxBytes ? ` max ${options.maxBytes}` : ""}`,
        );
        for (const m of mailbox.contents[open ?? ""]?.messages ?? []) {
          if (!uids.includes(m.uid)) continue;
          const source = Buffer.from(m.source.replace(/\r?\n/g, "\r\n"));
          yield {
            uid: m.uid,
            internalDate: m.internalDate,
            source: options.maxBytes ? source.subarray(0, options.maxBytes) : source,
          };
        }
      },
      async logout() {
        server.calls.push("logout");
      },
    };
  };
  return server;
}
