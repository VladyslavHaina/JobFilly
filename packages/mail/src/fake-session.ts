import type { ImapFolder, ImapSession, SessionFactory } from "./session";

// A hand-written double of the IMAP session, for the client's tests: folders and messages held
// in memory, plus the calls it saw. Appends land in the folder with the next UID; a folder that
// doesn't exist can't be opened.

interface FakeMessage {
  uid: number;
  internalDate: Date | null;
  source: string;
  flags?: string[];
}

export interface FakeMailbox {
  folders: ImapFolder[];
  contents: Record<string, { uidValidity: number; messages: FakeMessage[] }>;
  /** Thrown by connect(). */
  connectError?: unknown;
  /** Thrown by append(); `false` makes append answer false, as a refusing server can. */
  appendError?: unknown;
  /** The server has no UIDPLUS: append tells no UID. */
  noUidPlus?: boolean;
}

export interface FakeServer {
  factory: SessionFactory;
  calls: string[];
  sessions: number;
}

/** Messages whose header `name` contains `value` (case-insensitive name, as IMAP SEARCH). */
function headerContains(source: string, name: string, value: string): boolean {
  const head = source.split(/\r?\n\r?\n/)[0] ?? "";
  const prefix = `${name.toLowerCase()}:`;
  return head
    .split(/\r?\n/)
    .some((line) => line.toLowerCase().startsWith(prefix) && line.includes(value));
}

export function fakeServer(mailbox: FakeMailbox): FakeServer {
  const server: FakeServer = { factory: () => session(), calls: [], sessions: 0 };
  let open: string | null = null;
  // As a real server, a UID is never given out twice in a folder, also after a delete.
  const uidNext = new Map<string, number>();
  const nextUid = (path: string) => {
    const highest = Math.max(0, ...(mailbox.contents[path]?.messages ?? []).map((m) => m.uid));
    const uid = Math.max(uidNext.get(path) ?? 1, highest + 1);
    uidNext.set(path, uid + 1);
    return uid;
  };
  const opened = (path: string) => {
    const folder = mailbox.contents[path];
    if (!folder) throw Object.assign(new Error("no such folder"), { code: "NotFound" });
    open = path;
    return { uidValidity: folder.uidValidity };
  };
  const current = () => mailbox.contents[open ?? ""]?.messages ?? [];

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
        return opened(path);
      },
      async openWritable(path) {
        server.calls.push(`open-rw ${path}`);
        return opened(path);
      },
      async searchSince(since) {
        server.calls.push(`search ${since.toISOString().slice(0, 10)}`);
        const day = new Date(since.toISOString().slice(0, 10));
        return current()
          .filter((m) => !m.internalDate || m.internalDate >= day)
          .map((m) => m.uid);
      },
      async searchFromUid(fromUid) {
        server.calls.push(`search uid ${fromUid}:*`);
        const uids = current().map((m) => m.uid);
        const matching = uids.filter((uid) => uid >= fromUid);
        // As IMAP: n:* always matches the newest message, even when n is past it.
        const newest = Math.max(...uids);
        return matching.length > 0 || uids.length === 0 ? matching : [newest];
      },
      async searchHeader(name, value) {
        server.calls.push(`search header ${name}`);
        return current()
          .filter((m) => headerContains(m.source, name, value))
          .map((m) => m.uid);
      },
      async *fetch(uids, options) {
        server.calls.push(
          `fetch ${uids.join(",")}${options.maxBytes ? ` max ${options.maxBytes}` : ""}`,
        );
        for (const m of current()) {
          if (!uids.includes(m.uid)) continue;
          const source = Buffer.from(m.source.replace(/\r?\n/g, "\r\n"));
          yield {
            uid: m.uid,
            internalDate: m.internalDate,
            source: options.maxBytes ? source.subarray(0, options.maxBytes) : source,
          };
        }
      },
      async append(path, content, flags, date) {
        server.calls.push(`append ${path} ${flags.join(" ")}`);
        if (mailbox.appendError === false) return false;
        if (mailbox.appendError) throw mailbox.appendError;
        const folder = mailbox.contents[path];
        if (!folder) throw Object.assign(new Error("no such folder"), { code: "NotFound" });
        const uid = nextUid(path);
        folder.messages.push({ uid, internalDate: date, source: content.toString(), flags });
        return mailbox.noUidPlus
          ? { uid: null, uidValidity: null }
          : { uid, uidValidity: folder.uidValidity };
      },
      async deleteUids(uids) {
        server.calls.push(`delete ${uids.join(",")}`);
        const folder = mailbox.contents[open ?? ""];
        if (folder) folder.messages = folder.messages.filter((m) => !uids.includes(m.uid));
      },
      async create(path) {
        server.calls.push(`create ${path}`);
        mailbox.folders.push({ path, name: path, specialUse: null });
        mailbox.contents[path] = { uidValidity: 1, messages: [] };
        return { path };
      },
      async logout() {
        server.calls.push("logout");
      },
    };
  };
  return server;
}
