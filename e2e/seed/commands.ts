import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type DeliveryEntry,
  type EnvelopeEntry,
  isPersona,
  PERSONAS,
  type Persona,
  personaPaths,
  personaPathsMvp2,
} from "../fixtures/format.ts";
import { sentDeliveryPaths } from "../fixtures/format-mvp3.ts";
import type { MailboxName } from "./accounts.ts";
import type { GreenMailApi } from "./greenmail.ts";
import { dateFor, prepareMessage, SeedError, type SeedImap } from "./load.ts";
import { header, parseMime } from "./mime.ts";

// MVP 2's seed commands (MVP-2 › Fixtures added):
//   deliver <id|step>…           appends delivered mail to a persona's Inbox over IMAP, dated now
//                                minus the entry's minutesAgo (never over SMTP)
//   inspect drafts <persona>     the persona's Drafts folder: threading, flags, text, attachments
//   inspect smtp                 everything the mail server received over SMTP
//   reset-uidvalidity <persona>  gives the persona's folders a new UIDVALIDITY, mail kept
// and MVP 3's (MVP-3 › Fixtures added):
//   deliver S1                   also appends Maria's replies to her Sent folder
//                                (deliveries-sent.json), read like her own mail
//   inspect sent <mailbox>       what the app put in a mailbox's Sent folder: everything there
//                                the seed didn't load or deliver
// The verification steps print JSON, so a walkthrough or a spec reads them the same way.

/** A fetched message, as imapflow's fetchAll gives it. */
export interface FetchedMessage {
  uid: number;
  flags?: Set<string>;
  internalDate?: Date | string;
  source?: Buffer;
}

/** The part of imapflow's client these commands use, beyond what `seed load` needs. */
export interface MailboxImap extends SeedImap {
  list(): Promise<Array<{ path: string; specialUse?: string | undefined; flags?: Set<string> }>>;
  mailboxOpen(
    path: string,
    options: { readOnly: boolean },
  ): Promise<{ uidValidity: bigint; exists: number }>;
  fetchAll(
    range: string,
    query: { uid: true; flags: true; internalDate: true; source: true },
    options: { uid: true },
  ): Promise<FetchedMessage[]>;
  search(
    query: { header: Record<string, string> },
    options: { uid: true },
  ): Promise<number[] | false | undefined>;
}

const INBOX = "INBOX";
const SENT = "Sent";

async function readJsonFile<T>(path: string, missing: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    throw new SeedError(`${missing} (${path})`);
  }
}

/** A list file that only some mailboxes have: [] when it isn't there. */
async function readListIfAny<T>(path: string): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return [];
  }
  try {
    return JSON.parse(text) as T[];
  } catch {
    throw new SeedError(`${path} is not valid JSON`);
  }
}

// --- deliver ---------------------------------------------------------------------------------

export interface Delivered {
  persona: Persona;
  id: string;
  messageId: string;
  /** The folder it went to: the Inbox, or Sent for the persona's own replies (MVP 3). */
  folder: "Inbox" | "Sent";
}

interface Target {
  persona: Persona;
  entry: DeliveryEntry;
  /** The IMAP folder, and the fixture directory its .eml files are in. */
  folder: typeof INBOX | typeof SENT;
  dir: string;
}

/**
 * Every delivery `targets` names, by id or by step ("S2" delivers the whole batch), in
 * deliveries.json order, then deliveries-sent.json's; an unknown target is an error naming the
 * known ones.
 */
async function findDeliveries(fixturesDir: string, targets: readonly string[]): Promise<Target[]> {
  const all: Target[] = [];
  for (const persona of PERSONAS) {
    const path = join(fixturesDir, personaPathsMvp2(persona).deliveries);
    const entries = await readJsonFile<DeliveryEntry[]>(path, `No deliveries for "${persona}"`);
    const dir = personaPathsMvp2(persona).deliver;
    for (const entry of entries) all.push({ persona, entry, folder: INBOX, dir });
    const sent = sentDeliveryPaths(persona);
    for (const entry of await readListIfAny<DeliveryEntry>(join(fixturesDir, sent.deliveries))) {
      all.push({ persona, entry, folder: SENT, dir: sent.deliver });
    }
  }
  const picked = new Set<Target>();
  for (const target of targets) {
    const matches = all.filter(
      ({ entry }) => entry.id === target || entry.step.toLowerCase() === target.toLowerCase(),
    );
    if (matches.length === 0) {
      const steps = [...new Set(all.map((d) => d.entry.step))];
      throw new SeedError(
        `Nothing to deliver for "${target}". Ids: ${all.map((d) => d.entry.id).join(", ")}; steps: ${steps.join(", ")}`,
      );
    }
    for (const m of matches) picked.add(m);
  }
  return all.filter((d) => picked.has(d));
}

export interface DeliverOptions {
  fixturesDir: string;
  targets: readonly string[];
  now: Date;
  open: (persona: Persona) => Promise<MailboxImap>;
}

const FOLDER_NAMES = { [INBOX]: "Inbox", [SENT]: "Sent" } as const;

/**
 * `seed deliver`: appends each target to its persona's Inbox, unread, or (the persona's own
 * replies) to Sent, read; refuses a duplicate before appending anything.
 */
export async function deliver(options: DeliverOptions): Promise<Delivered[]> {
  const deliveries = await findDeliveries(options.fixturesDir, options.targets);
  const prepared = await Promise.all(
    deliveries.map(async (target) => {
      const { persona, entry } = target;
      const path = join(options.fixturesDir, target.dir, entry.file);
      const raw = await readFile(path).catch(() => {
        throw new SeedError(`${persona}: ${entry.file} is listed in deliveries but missing`);
      });
      const date = dateFor(options.now, entry.minutesAgo);
      return { ...target, date, content: prepareMessage(raw, entry, date, persona) };
    }),
  );
  const out: Delivered[] = [];
  for (const persona of PERSONAS) {
    const mine = prepared.filter((p) => p.persona === persona);
    if (mine.length === 0) continue;
    const client = await options.open(persona);
    try {
      const folders = new Set((await client.list()).map((f) => f.path));
      for (const folder of [INBOX, SENT] as const) {
        const here = mine.filter((p) => p.folder === folder);
        if (here.length === 0 || !folders.has(folder)) continue;
        await client.mailboxOpen(folder, { readOnly: true });
        for (const { entry } of here) {
          const found = await client.search(
            { header: { "message-id": entry.messageId } },
            { uid: true },
          );
          if (found && found.length > 0) {
            throw new SeedError(
              `${entry.id} is already in ${persona}'s ${FOLDER_NAMES[folder]}: deliver it only once`,
            );
          }
        }
      }
      if (mine.some((p) => p.folder === SENT) && !folders.has(SENT)) {
        await client.mailboxCreate(SENT);
      }
      for (const { entry, date, content, folder } of mine) {
        await client.append(folder, content, folder === SENT ? ["\\Seen"] : [], date);
        out.push({
          persona,
          id: entry.id,
          messageId: entry.messageId,
          folder: FOLDER_NAMES[folder],
        });
      }
    } finally {
      await client.logout();
    }
  }
  return out;
}

// --- inspect drafts --------------------------------------------------------------------------

interface MessageInfo {
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  subject: string | null;
  from: string | null;
  to: string | null;
  flags: string[];
  /** Whether the \Draft flag is set (F6.3). */
  draft: boolean;
  /** The reply text: the first text/plain part that isn't an attachment. */
  text: string | null;
  attachments: { filename: string | null; contentType: string; size: number; sha256: string }[];
}

export interface DraftsReport {
  persona: string;
  /** The Drafts folder's path, or null when the mailbox has none yet. */
  folder: string | null;
  drafts: MessageInfo[];
}

/** The Drafts folder: the one marked \Drafts (RFC 6154), else one named Drafts. */
function draftsFolder(folders: { path: string; specialUse?: string | undefined }[]) {
  return (
    folders.find((f) => f.specialUse === "\\Drafts")?.path ??
    folders.find((f) => /(^|[./])drafts$/i.test(f.path))?.path ??
    null
  );
}

function describeMessage(m: FetchedMessage): MessageInfo {
  const mime = parseMime(m.source ?? Buffer.alloc(0));
  const flags = [...(m.flags ?? [])].sort();
  const isAttachment = (p: { disposition: string | null; params: Record<string, string> }) =>
    p.disposition === "attachment" ||
    p.params.filename !== undefined ||
    p.params.name !== undefined;
  const text = mime.parts.find((p) => p.type === "text/plain" && !isAttachment(p));
  return {
    uid: m.uid,
    messageId: header(mime, "message-id"),
    inReplyTo: header(mime, "in-reply-to"),
    references: (header(mime, "references") ?? "").split(/\s+/).filter(Boolean),
    subject: header(mime, "subject"),
    from: header(mime, "from"),
    to: header(mime, "to"),
    flags,
    draft: flags.includes("\\Draft"),
    text: text ? text.content.toString("utf8") : null,
    attachments: mime.parts.filter(isAttachment).map((p) => ({
      filename: p.params.filename ?? p.params.name ?? null,
      contentType: p.type,
      size: p.content.length,
      sha256: createHash("sha256").update(p.content).digest("hex"),
    })),
  };
}

/** `seed inspect drafts <persona>`: every message in the Drafts folder, oldest first. */
export async function inspectDrafts(persona: string, client: MailboxImap): Promise<DraftsReport> {
  try {
    const folder = draftsFolder(await client.list());
    if (folder === null) return { persona, folder, drafts: [] };
    const box = await client.mailboxOpen(folder, { readOnly: true });
    if (box.exists === 0) return { persona, folder, drafts: [] };
    const messages = await client.fetchAll(
      "1:*",
      { uid: true, flags: true, internalDate: true, source: true },
      { uid: true },
    );
    return { persona, folder, drafts: messages.sort((a, b) => a.uid - b.uid).map(describeMessage) };
  } finally {
    await client.logout();
  }
}

// --- inspect sent (MVP 3) --------------------------------------------------------------------

export interface SentReport {
  mailbox: string;
  /** The Sent folder's path, or null when the mailbox has none. */
  folder: string | null;
  /** What is in Sent but the seed didn't put there, oldest first: what the app filed. */
  messages: MessageInfo[];
}

/** The Sent folder: the one marked \Sent (RFC 6154), else one named Sent. */
function sentFolder(folders: { path: string; specialUse?: string | undefined }[]) {
  return (
    folders.find((f) => f.specialUse === "\\Sent")?.path ??
    folders.find((f) => /(^|[./])sent$/i.test(f.path))?.path ??
    null
  );
}

/** The Message-IDs the seed itself puts in a mailbox's Sent: its own mail and its deliveries. */
async function seededSent(fixturesDir: string, mailbox: MailboxName): Promise<Set<string>> {
  const envelopes = await readListIfAny<EnvelopeEntry>(
    join(fixturesDir, mailbox, "envelopes.json"),
  );
  const delivered = isPersona(mailbox)
    ? await readListIfAny<DeliveryEntry>(join(fixturesDir, sentDeliveryPaths(mailbox).deliveries))
    : [];
  return new Set([
    ...envelopes.filter((e) => e.folder === "sent").map((e) => e.messageId),
    ...delivered.map((d) => d.messageId),
  ]);
}

/**
 * `seed inspect sent <mailbox>` (F4.4): every message in the mailbox's Sent folder that the seed
 * didn't load or deliver, with its threading, text and attachments, so a send that filed its copy
 * twice shows two.
 */
export async function inspectSent(
  fixturesDir: string,
  mailbox: MailboxName,
  client: MailboxImap,
): Promise<SentReport> {
  const seeded = await seededSent(fixturesDir, mailbox);
  try {
    const folder = sentFolder(await client.list());
    if (folder === null) return { mailbox, folder, messages: [] };
    const box = await client.mailboxOpen(folder, { readOnly: true });
    if (box.exists === 0) return { mailbox, folder, messages: [] };
    const messages = await client.fetchAll(
      "1:*",
      { uid: true, flags: true, internalDate: true, source: true },
      { uid: true },
    );
    const described = messages.sort((a, b) => a.uid - b.uid).map(describeMessage);
    return {
      mailbox,
      folder,
      messages: described.filter((m) => m.messageId === null || !seeded.has(m.messageId)),
    };
  } finally {
    await client.logout();
  }
}

// --- inspect smtp ----------------------------------------------------------------------------

export interface SmtpReport {
  /** Every message that reached the mail server over SMTP, by the account it was delivered to. */
  messages: { account: string; messageId: string | null; subject: string | null }[];
}

/**
 * The Message-IDs the seed itself puts in a mailbox's Inbox: its mail and its deliveries. A
 * persona has both; Maria's other mailboxes (MVP 3) have their mail or nothing.
 */
async function seededInbox(fixturesDir: string, mailbox: MailboxName): Promise<Set<string>> {
  if (!isPersona(mailbox)) {
    const envelopes = await readListIfAny<EnvelopeEntry>(
      join(fixturesDir, mailbox, "envelopes.json"),
    );
    return new Set(envelopes.filter((e) => e.folder === "inbox").map((e) => e.messageId));
  }
  const persona = mailbox;
  const envelopes = await readJsonFile<EnvelopeEntry[]>(
    join(fixturesDir, personaPaths(persona).envelopes),
    `No fixtures for persona "${persona}"`,
  );
  const deliveries = await readJsonFile<DeliveryEntry[]>(
    join(fixturesDir, personaPathsMvp2(persona).deliveries),
    `No deliveries for "${persona}"`,
  );
  return new Set([
    ...envelopes.filter((e) => e.folder === "inbox").map((e) => e.messageId),
    ...deliveries.map((d) => d.messageId),
  ]);
}

/**
 * `seed inspect smtp` (F6.6, F4.4): the seed loads and delivers over IMAP only, so whatever else
 * is in an Inbox came over SMTP. GreenMail delivers SMTP mail to the recipients' Inboxes, creating
 * an account for any recipient it doesn't know: every message of an account that is none of the
 * test mailboxes', and every message in a test mailbox's Inbox the seed didn't put there.
 */
export async function inspectSmtp(
  fixturesDir: string,
  accounts: Partial<Record<MailboxName, string>>,
  api: GreenMailApi,
): Promise<SmtpReport> {
  const seeded = new Map<string, Set<string>>();
  for (const [mailbox, address] of Object.entries(accounts) as [MailboxName, string][]) {
    seeded.set(address.toLowerCase(), await seededInbox(fixturesDir, mailbox));
  }
  const messages: SmtpReport["messages"] = [];
  for (const user of await api.users()) {
    const known = seeded.get(user.email.toLowerCase());
    for (const m of await api.inbox(user.email)) {
      if (known && m.messageId !== null && known.has(m.messageId)) continue;
      messages.push({ account: user.email, messageId: m.messageId, subject: m.subject });
    }
  }
  return { messages };
}

// --- reset-uidvalidity -----------------------------------------------------------------------

export interface ResetOptions {
  persona: Persona;
  account: { user: string; password: string };
  open: () => Promise<MailboxImap>;
  api: GreenMailApi;
}

export interface ResetResult {
  before: string;
  after: string;
  folders: { path: string; messages: number }[];
}

interface SavedFolder {
  path: string;
  messages: FetchedMessage[];
}

/**
 * `seed reset-uidvalidity <persona>` (F1.3, S11): GreenMail gives a folder a new UIDVALIDITY only
 * when it is created, and never deletes an Inbox, so the seed reads every folder (flags and
 * dates included), recreates the account through the API and appends everything back, oldest UID
 * first. The mail and its Message-IDs stay; every folder gets a new UIDVALIDITY and new UIDs.
 */
export async function resetUidValidity(options: ResetOptions): Promise<ResetResult> {
  const saved: SavedFolder[] = [];
  let before = "";
  const reader = await options.open();
  try {
    for (const folder of await reader.list()) {
      if (folder.flags?.has("\\Noselect")) continue;
      const box = await reader.mailboxOpen(folder.path, { readOnly: true });
      if (folder.path === INBOX) before = String(box.uidValidity);
      const messages =
        box.exists === 0
          ? []
          : await reader.fetchAll(
              "1:*",
              { uid: true, flags: true, internalDate: true, source: true },
              { uid: true },
            );
      saved.push({ path: folder.path, messages: messages.sort((a, b) => a.uid - b.uid) });
    }
  } finally {
    await reader.logout();
  }
  for (const folder of saved) {
    for (const m of folder.messages) {
      if (!m.source) throw new SeedError(`${folder.path} UID ${m.uid}: the server sent no source`);
    }
  }

  const { user, password } = options.account;
  await options.api.deleteUser(user);
  await options.api.createUser({ email: user, login: user, password });

  let after = "";
  const writer = await options.open();
  try {
    const existing = new Set((await writer.list()).map((f) => f.path));
    for (const folder of saved) {
      if (!existing.has(folder.path)) await writer.mailboxCreate(folder.path);
      for (const m of folder.messages) {
        const flags = [...(m.flags ?? [])].filter((f) => f !== "\\Recent");
        const date = m.internalDate === undefined ? new Date() : new Date(m.internalDate);
        await writer.append(folder.path, m.source as Buffer, flags, date);
      }
    }
    after = String((await writer.mailboxOpen(INBOX, { readOnly: true })).uidValidity);
  } finally {
    await writer.logout();
  }
  if (after === before) {
    throw new SeedError(`${options.persona}'s Inbox kept UIDVALIDITY ${before}: nothing changed`);
  }
  return {
    before,
    after,
    folders: saved.map((f) => ({ path: f.path, messages: f.messages.length })),
  };
}
