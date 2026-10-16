import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type DeliveryEntry,
  type EnvelopeEntry,
  PERSONAS,
  type Persona,
  personaPaths,
  personaPathsMvp2,
} from "../fixtures/format.ts";
import type { GreenMailApi } from "./greenmail.ts";
import { dateFor, prepareMessage, SeedError, type SeedImap } from "./load.ts";
import { header, parseMime } from "./mime.ts";

// MVP 2's seed commands (MVP-2 › Fixtures added):
//   deliver <id|step>…           appends delivered mail to a persona's Inbox over IMAP, dated now
//                                minus the entry's minutesAgo (never over SMTP)
//   inspect drafts <persona>     the persona's Drafts folder: threading, flags, text, attachments
//   inspect smtp                 everything the mail server received over SMTP
//   reset-uidvalidity <persona>  gives the persona's folders a new UIDVALIDITY, mail kept
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

async function readJsonFile<T>(path: string, missing: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    throw new SeedError(`${missing} (${path})`);
  }
}

// --- deliver ---------------------------------------------------------------------------------

export interface Delivered {
  persona: Persona;
  id: string;
  messageId: string;
}

/**
 * Every delivery `targets` names, by id or by step ("S2" delivers the whole batch), in
 * deliveries.json order; an unknown target is an error naming the known ones.
 */
async function findDeliveries(
  fixturesDir: string,
  targets: readonly string[],
): Promise<{ persona: Persona; entry: DeliveryEntry }[]> {
  const all: { persona: Persona; entry: DeliveryEntry }[] = [];
  for (const persona of PERSONAS) {
    const path = join(fixturesDir, personaPathsMvp2(persona).deliveries);
    const entries = await readJsonFile<DeliveryEntry[]>(path, `No deliveries for "${persona}"`);
    for (const entry of entries) all.push({ persona, entry });
  }
  const picked = new Set<DeliveryEntry>();
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
    for (const m of matches) picked.add(m.entry);
  }
  return all.filter((d) => picked.has(d.entry));
}

export interface DeliverOptions {
  fixturesDir: string;
  targets: readonly string[];
  now: Date;
  open: (persona: Persona) => Promise<MailboxImap>;
}

/** `seed deliver`: appends each target to its persona's Inbox, unread, refusing a duplicate. */
export async function deliver(options: DeliverOptions): Promise<Delivered[]> {
  const deliveries = await findDeliveries(options.fixturesDir, options.targets);
  const prepared = await Promise.all(
    deliveries.map(async ({ persona, entry }) => {
      const path = join(options.fixturesDir, personaPathsMvp2(persona).deliver, entry.file);
      const raw = await readFile(path).catch(() => {
        throw new SeedError(`${persona}: ${entry.file} is listed in deliveries.json but missing`);
      });
      const date = dateFor(options.now, entry.minutesAgo);
      return { persona, entry, date, content: prepareMessage(raw, entry, date, persona) };
    }),
  );
  const out: Delivered[] = [];
  for (const persona of PERSONAS) {
    const mine = prepared.filter((p) => p.persona === persona);
    if (mine.length === 0) continue;
    const client = await options.open(persona);
    try {
      await client.mailboxOpen(INBOX, { readOnly: true });
      for (const { entry } of mine) {
        const found = await client.search(
          { header: { "message-id": entry.messageId } },
          { uid: true },
        );
        if (found && found.length > 0) {
          throw new SeedError(`${entry.id} is already in ${persona}'s Inbox: deliver it only once`);
        }
      }
      for (const { entry, date, content } of mine) {
        await client.append(INBOX, content, [], date);
        out.push({ persona, id: entry.id, messageId: entry.messageId });
      }
    } finally {
      await client.logout();
    }
  }
  return out;
}

// --- inspect drafts --------------------------------------------------------------------------

interface DraftInfo {
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
  drafts: DraftInfo[];
}

/** The Drafts folder: the one marked \Drafts (RFC 6154), else one named Drafts. */
function draftsFolder(folders: { path: string; specialUse?: string | undefined }[]) {
  return (
    folders.find((f) => f.specialUse === "\\Drafts")?.path ??
    folders.find((f) => /(^|[./])drafts$/i.test(f.path))?.path ??
    null
  );
}

function describeDraft(m: FetchedMessage): DraftInfo {
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
    return { persona, folder, drafts: messages.sort((a, b) => a.uid - b.uid).map(describeDraft) };
  } finally {
    await client.logout();
  }
}

// --- inspect smtp ----------------------------------------------------------------------------

export interface SmtpReport {
  /** Every message that reached the mail server over SMTP, by the account it was delivered to. */
  messages: { account: string; messageId: string | null; subject: string | null }[];
}

/** The Message-IDs the seed itself puts in each persona's Inbox: the mailbox and the deliveries. */
async function seededInbox(fixturesDir: string, persona: Persona): Promise<Set<string>> {
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
 * `seed inspect smtp` (F6.6): the seed loads and delivers over IMAP only, so whatever else is in
 * an Inbox came over SMTP. GreenMail delivers SMTP mail to the recipients' Inboxes, creating an
 * account for any recipient it doesn't know: every message of an account that is no persona's,
 * and every message in a persona's Inbox the seed didn't put there.
 */
export async function inspectSmtp(
  fixturesDir: string,
  personaAccounts: Record<Persona, string>,
  api: GreenMailApi,
): Promise<SmtpReport> {
  const seeded = new Map<string, Set<string>>();
  for (const persona of PERSONAS) {
    seeded.set(personaAccounts[persona].toLowerCase(), await seededInbox(fixturesDir, persona));
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
