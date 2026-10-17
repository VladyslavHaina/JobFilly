import { readFile } from "node:fs/promises";
import { join } from "node:path";

// `seed load <persona>`: puts e2e/fixtures/<persona>/mail into the persona's IMAP Inbox and Sent.
// Fixture dates are relative: every message's Date header and IMAP internal date are set to the
// run's current time minus the envelope's `minutesAgo`, so the 90-day window and the other
// date rules behave the same on every run.
//
// The only fixture fields read are the .eml files and, in envelopes.json, each entry's `file`
// (relative to mail/), `folder` (inbox | sent), `messageId` and `minutesAgo` (ARCHITECTURE ›
// Testing).

/** The part of an IMAP client the loader uses; imapflow's ImapFlow fits it as it is. */
export interface SeedImap {
  logout(): Promise<void>;
  list(): Promise<Array<{ path: string; specialUse?: string | undefined }>>;
  status(
    path: string,
    query: { messages: true },
  ): Promise<{ messages?: number | undefined } | false>;
  mailboxCreate(path: string): Promise<unknown>;
  append(path: string, content: Buffer, flags: string[], idate: Date): Promise<unknown>;
}

/** A problem the person running the seed has to fix; printed as is, without a stack trace. */
export class SeedError extends Error {}

type Folder = "inbox" | "sent";

interface Envelope {
  file: string;
  folder: Folder;
  messageId: string;
  minutesAgo: number;
}

const INBOX = "INBOX";
const SENT = "Sent";

/** Inbox mail arrives unread; the persona's own replies are read. */
const FLAGS: Record<Folder, string[]> = { inbox: [], sent: ["\\Seen"] };

export interface LoadOptions {
  /** Connects to the persona's account; called once every fixture file has been read. */
  open: () => Promise<SeedImap>;
  /** The folder holding one directory per persona (e2e/fixtures). */
  fixturesDir: string;
  persona: string;
  /** The run's current time. */
  now: Date;
}

export interface LoadResult {
  inbox: number;
  sent: number;
}

export async function loadPersona(options: LoadOptions): Promise<LoadResult> {
  const { persona } = options;
  const personaDir = join(options.fixturesDir, persona);
  const envelopes = parseEnvelopes(
    await readText(join(personaDir, "envelopes.json"), `No fixtures for persona "${persona}"`),
    persona,
  );
  // Every file is read and checked before the mailbox is touched, so a broken fixture never
  // leaves a half-loaded mailbox behind.
  const messages = await Promise.all(
    envelopes.map(async (envelope) => {
      const raw = await readFile(join(personaDir, "mail", envelope.file)).catch(() => {
        throw new SeedError(`${persona}: ${envelope.file} is listed in envelopes.json but missing`);
      });
      const date = dateFor(options.now, envelope.minutesAgo);
      return { envelope, date, content: prepareMessage(raw, envelope, date, persona) };
    }),
  );
  // Oldest first, so UIDs grow with the date as they do in a real mailbox.
  messages.sort((a, b) => a.date.getTime() - b.date.getTime());

  const client = await options.open();
  try {
    const folders = await client.list();
    const hasSent = folders.some((f) => f.path === SENT);
    const counts = {
      inbox: await count(client, INBOX),
      sent: hasSent ? await count(client, SENT) : 0,
    };
    if (counts.inbox > 0 || counts.sent > 0) {
      throw new SeedError(
        `${persona}'s mailbox is not empty (Inbox ${counts.inbox}, Sent ${counts.sent}): ` +
          "seed load runs once, on a fresh test stack. Take the stack down and start a fresh one.",
      );
    }
    if (!hasSent) await client.mailboxCreate(SENT);
    for (const { envelope, date, content } of messages) {
      const path = envelope.folder === "sent" ? SENT : INBOX;
      await client.append(path, content, [...FLAGS[envelope.folder]], date);
    }
  } finally {
    await client.logout();
  }
  return {
    inbox: envelopes.filter((e) => e.folder === "inbox").length,
    sent: envelopes.filter((e) => e.folder === "sent").length,
  };
}

async function count(client: SeedImap, path: string): Promise<number> {
  const status = await client.status(path, { messages: true });
  return status ? (status.messages ?? 0) : 0;
}

async function readText(path: string, missing: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    throw new SeedError(`${missing} (${path})`);
  }
}

function parseEnvelopes(text: string, persona: string): Envelope[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SeedError(`${persona}: envelopes.json is not valid JSON`);
  }
  if (!Array.isArray(data)) throw new SeedError(`${persona}: envelopes.json must be an array`);
  return data.map((entry: unknown, i): Envelope => {
    const e = (entry ?? {}) as Record<string, unknown>;
    const where = `${persona}: envelopes.json entry ${i}`;
    if (typeof e.file !== "string" || e.file === "") throw new SeedError(`${where} has no file`);
    // Named like the mail/<inbox|sent> folders; "INBOX" or "Sent" are taken as the same.
    const folder = typeof e.folder === "string" ? e.folder.toLowerCase() : null;
    if (folder !== "inbox" && folder !== "sent") {
      throw new SeedError(`${where}: folder must be "inbox" or "sent"`);
    }
    if (typeof e.messageId !== "string" || e.messageId === "") {
      throw new SeedError(`${where} has no messageId`);
    }
    if (typeof e.minutesAgo !== "number" || !Number.isFinite(e.minutesAgo) || e.minutesAgo < 0) {
      throw new SeedError(`${where}: minutesAgo must be a number of minutes, 0 or more`);
    }
    return { file: e.file, folder, messageId: e.messageId, minutesAgo: e.minutesAgo };
  });
}

/** Now minus `minutesAgo`, to the whole second (an IMAP internal date has no milliseconds). */
export function dateFor(now: Date, minutesAgo: number): Date {
  return new Date(Math.floor((now.getTime() - minutesAgo * 60_000) / 1000) * 1000);
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** An RFC 5322 date in UTC, e.g. "Tue, 14 Oct 2026 09:05:03 +0000". */
export function rfc5322Date(date: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return (
    `${DAYS[date.getUTCDay()]}, ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ` +
    `${date.getUTCFullYear()} ${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:` +
    `${two(date.getUTCSeconds())} +0000`
  );
}

/**
 * The message as it is appended: CRLF line ends (IMAP wants them) and a Date header for this
 * run, replacing any Date header the file has. Checks the file's Message-ID against envelopes.json.
 */
export function prepareMessage(
  raw: Buffer,
  envelope: Pick<Envelope, "file" | "messageId">,
  date: Date,
  persona: string,
): Buffer {
  // latin1 maps every byte to one character and back, so 8-bit bodies pass through untouched.
  const text = raw.toString("latin1").replace(/\r?\n/g, "\r\n");
  const end = text.indexOf("\r\n\r\n");
  if (end < 0) throw new SeedError(`${persona}: ${envelope.file} has no header/body separator`);
  const headerLines = unfoldedHeaders(text.slice(0, end));
  const messageId = headerLines
    .find((h) => /^message-id:/i.test(h))
    ?.slice("message-id:".length)
    .replace(/\r\n[ \t]+/g, " ")
    .trim();
  if (messageId !== envelope.messageId) {
    throw new SeedError(
      `${persona}: ${envelope.file} has Message-ID ${messageId ?? "(none)"}, but envelopes.json says ${envelope.messageId}`,
    );
  }
  const headers = headerLines.filter((h) => !/^date:/i.test(h));
  headers.unshift(`Date: ${rfc5322Date(date)}`);
  return Buffer.from(`${headers.join("\r\n")}${text.slice(end)}`, "latin1");
}

/** Header fields with their folded continuation lines kept together (joined by CRLF). */
function unfoldedHeaders(block: string): string[] {
  const fields: string[] = [];
  for (const line of block.split("\r\n")) {
    if (/^[ \t]/.test(line) && fields.length > 0) fields[fields.length - 1] += `\r\n${line}`;
    else fields.push(line);
  }
  return fields;
}
