import { type MailClient, MailUnavailableError } from "@jobfilly/mail";
import type {
  Address,
  DraftMailInput,
  DraftRef,
  Envelope,
  MailConnection,
  MailFolder,
  MessageRef,
  OriginalMessage,
} from "@jobfilly/schema";
import type { MailPort } from "../deps";

// A fake mailbox behind the MailPort, behaving as packages/mail's MailClient promises (tests
// only). INBOX and Sent hold messages under a UIDVALIDITY with increasing UIDs; deliver() appends
// new mail the way `seed deliver` does. The Drafts folder records each saved draft: the original
// it replies to, the reply, the attachment and the \Draft flag. Switches let tests provoke what
// the real server does:
//
//   pause() / resume()        every operation throws MailUnavailableError, like
//                             `docker compose pause imap`
//   failNext(op, error?)      the next `op` fails once (connect fails every operation of the
//                             next client, as a connection that never came up)
//   setUidValidity(folder, n) the folder is rebuilt: new UIDVALIDITY, UIDs renumbered, the
//                             Message-IDs kept (F1.3)
//   expunge(messageId)        the message is deleted from its folder (the user deleted it)
//   calls                     how often each operation ran, so a test can show no body was
//                             fetched
//
// Nothing here sends mail: there is no send operation at all.

const FAKE_MAIL_OPS = [
  "connect",
  "test",
  "fetchEnvelopes",
  "fetchBody",
  "fetchSince",
  "fetchOriginal",
  "ensureDraftsFolder",
  "saveDraft",
  "replaceDraft",
  "deleteDraft",
] as const;
type FakeMailOp = (typeof FAKE_MAIL_OPS)[number];

interface FakeMessage {
  uid: number;
  envelope: Envelope;
  /** When it arrived in the folder (the server's INTERNALDATE). */
  receivedAt: string;
  /** The plain-text body. */
  text: string;
}

interface FakeDraft {
  uid: number;
  draftMessageId: string;
  flags: string[];
  /** The original it replies to (In-Reply-To and References come from it). */
  original: OriginalMessage;
  reply: DraftMailInput["reply"];
  attachment: DraftMailInput["attachment"];
}

interface Folder {
  path: string;
  uidValidity: number;
  nextUid: number;
}

interface DeliverInput {
  messageId: string;
  from?: Address;
  subject?: string;
  /** The sender's Date header. */
  date?: string;
  /** When it arrived (INTERNALDATE); by default the Date header's time. */
  receivedAt?: string;
  text?: string;
  inReplyTo?: string | null;
  references?: string[];
}

export interface FakeMailbox {
  port: MailPort;
  /** The connections opened, in order. */
  connections: MailConnection[];
  /** The mailbox address each connection was opened with (the drafts' From), in order. */
  addresses: string[];
  calls: Record<FakeMailOp, number>;
  /** The messages of a folder, in UID order. */
  messages(folder: MailFolder): FakeMessage[];
  /** The saved drafts, in UID order. */
  drafts(): FakeDraft[];
  /** Appends a message to INBOX (or Sent) with the next UID; returns its envelope. */
  deliver(input: DeliverInput, folder?: MailFolder): Envelope;
  pause(): void;
  resume(): void;
  failNext(
    op: Exclude<FakeMailOp, "test" | "fetchEnvelopes" | "fetchBody" | "ensureDraftsFolder">,
    error?: Error,
  ): void;
  setUidValidity(folder: MailFolder | "drafts", uidValidity: number): void;
  uidValidity(folder: MailFolder | "drafts"): number;
  /** Deletes the message from INBOX or Sent, as a user deleting it would. */
  expunge(messageId: string): void;
}

const PATHS: Record<MailFolder | "drafts", string> = {
  inbox: "INBOX",
  sent: "Sent",
  drafts: "Drafts",
};

export function createFakeMailbox(
  options: { address?: string; uidValidity?: number } = {},
): FakeMailbox {
  const address = options.address ?? "maria.santos@inbox.example";
  const folders: Record<MailFolder | "drafts", Folder> = {
    inbox: { path: PATHS.inbox, uidValidity: options.uidValidity ?? 100, nextUid: 1 },
    sent: { path: PATHS.sent, uidValidity: options.uidValidity ?? 100, nextUid: 1 },
    drafts: { path: PATHS.drafts, uidValidity: options.uidValidity ?? 100, nextUid: 1 },
  };
  const stored: Record<MailFolder, FakeMessage[]> = { inbox: [], sent: [] };
  let drafts: FakeDraft[] = [];
  let paused = false;
  const failures = new Map<FakeMailOp, Error>();
  const calls = Object.fromEntries(FAKE_MAIL_OPS.map((op) => [op, 0])) as Record<
    FakeMailOp,
    number
  >;
  let draftCounter = 0;

  const folderOfPath = (path: string): MailFolder | null =>
    path === PATHS.inbox ? "inbox" : path === PATHS.sent ? "sent" : null;

  /** Counts the call and throws when paused or told to fail once. */
  const enter = (op: FakeMailOp, broken: boolean) => {
    calls[op] += 1;
    if (paused || broken) throw new MailUnavailableError();
    const failure = failures.get(op);
    if (failure) {
      failures.delete(op);
      throw failure;
    }
  };

  const original = (message: FakeMessage): OriginalMessage => ({
    messageId: message.envelope.messageId,
    references: message.envelope.references,
    inReplyTo: message.envelope.inReplyTo,
    subject: message.envelope.subject,
    from: message.envelope.from,
    date: message.envelope.date,
    text: message.text,
  });

  const save = (input: DraftMailInput): DraftRef => {
    const folder = folders.drafts;
    draftCounter += 1;
    const draft: FakeDraft = {
      uid: folder.nextUid++,
      draftMessageId: input.draftMessageId ?? `<draft-${draftCounter}@jobfilly.test>`,
      flags: ["\\Draft"],
      original: input.original,
      reply: input.reply,
      attachment: input.attachment,
    };
    drafts.push(draft);
    return {
      path: folder.path,
      uid: draft.uid,
      uidValidity: folder.uidValidity,
      draftMessageId: draft.draftMessageId,
    };
  };

  // By UID under the UIDVALIDITY it was saved with, else by its Message-ID (the folder was
  // rebuilt, or the ref has UIDVALIDITY 0: a copy whose UID was never known), as the client does.
  const remove = (ref: DraftRef) => {
    drafts =
      ref.uidValidity === folders.drafts.uidValidity
        ? drafts.filter((d) => d.uid !== ref.uid)
        : drafts.filter((d) => d.draftMessageId !== ref.draftMessageId);
  };

  const client = (broken: boolean): MailClient => ({
    async test() {
      enter("test", broken);
      return { ok: true, folders: [PATHS.inbox, PATHS.sent], sentPath: PATHS.sent };
    },
    async fetchEnvelopes({ folder, since }) {
      enter("fetchEnvelopes", broken);
      return stored[folder]
        .filter((m) => Date.parse(m.receivedAt) >= since.getTime())
        .map((m) => m.envelope)
        .sort((a, b) => b.date.localeCompare(a.date) || b.uid - a.uid);
    },
    async fetchBody(ref: MessageRef) {
      enter("fetchBody", broken);
      const folder = folderOfPath(ref.folderPath);
      if (!folder || folders[folder].uidValidity !== ref.uidValidity) return null;
      const message = stored[folder].find((m) => m.uid === ref.uid);
      return message ? { text: message.text } : null;
    },
    async fetchSince({ folder, uidValidity, afterUid }) {
      enter("fetchSince", broken);
      const current = folders[folder].uidValidity;
      const changed = uidValidity !== null && uidValidity !== current;
      const from = changed ? 0 : afterUid;
      return {
        uidValidity: current,
        changed,
        messages: stored[folder]
          .filter((m) => m.uid > from)
          .map((m) => ({ ...m.envelope, receivedAt: m.receivedAt })),
      };
    },
    async fetchOriginal(ref) {
      enter("fetchOriginal", broken);
      const folder = folderOfPath(ref.folderPath);
      if (!folder || folders[folder].uidValidity !== ref.uidValidity) return null;
      const message = stored[folder].find((m) => m.uid === ref.uid);
      return message ? original(message) : null;
    },
    async ensureDraftsFolder() {
      enter("ensureDraftsFolder", broken);
      return { path: PATHS.drafts };
    },
    async saveDraft(input) {
      enter("saveDraft", broken);
      return save(input);
    },
    async replaceDraft(ref, input) {
      enter("replaceDraft", broken);
      remove(ref);
      return save(input);
    },
    async deleteDraft(ref) {
      enter("deleteDraft", broken);
      remove(ref);
    },
    async close() {},
  });

  const fake: FakeMailbox = {
    connections: [],
    addresses: [],
    calls,
    port: {
      connect(conn, options) {
        fake.connections.push(conn);
        fake.addresses.push(options.address);
        calls.connect += 1;
        const failure = failures.get("connect");
        if (failure) failures.delete("connect");
        return client(failure !== undefined);
      },
    },
    messages: (folder) => [...stored[folder]],
    drafts: () => [...drafts],
    deliver(input, folder = "inbox") {
      const f = folders[folder];
      const uid = f.nextUid++;
      const envelope: Envelope = {
        messageId: input.messageId,
        folder,
        folderPath: f.path,
        uidValidity: f.uidValidity,
        uid,
        date: input.date ?? new Date().toISOString(),
        from: input.from ?? { address: "recruiter@agency.example", name: null },
        to: [{ address, name: null }],
        cc: [],
        replyTo: [],
        inReplyTo: input.inReplyTo ?? null,
        references: input.references ?? [],
        subject: input.subject ?? "A role for you",
        listId: null,
        listUnsubscribe: null,
        precedence: null,
        autoSubmitted: null,
        snippet: (input.text ?? "").slice(0, 200),
      };
      const receivedAt = input.receivedAt ?? envelope.date;
      stored[folder].push({ uid, envelope, receivedAt, text: input.text ?? "" });
      return envelope;
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    failNext(op, error = new MailUnavailableError()) {
      failures.set(op, error);
    },
    setUidValidity(folder, uidValidity) {
      const f = folders[folder];
      f.uidValidity = uidValidity;
      f.nextUid = 1;
      if (folder === "drafts") {
        drafts = drafts.map((d) => ({ ...d, uid: f.nextUid++ }));
        return;
      }
      stored[folder] = stored[folder].map((m) => {
        const uid = f.nextUid++;
        return { ...m, uid, envelope: { ...m.envelope, uid, uidValidity } };
      });
    },
    uidValidity: (folder) => folders[folder].uidValidity,
    expunge(messageId) {
      for (const folder of ["inbox", "sent"] as const) {
        stored[folder] = stored[folder].filter((m) => m.envelope.messageId !== messageId);
      }
    },
  };
  return fake;
}
