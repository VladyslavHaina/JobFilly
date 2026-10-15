import {
  type Address,
  type Envelope,
  type MailFolder,
  SNIPPET_MAX_LENGTH,
  syntheticMessageId,
} from "@jobfilly/schema";
import { type AddressObject, type EmailAddress, type ParsedMail, simpleParser } from "mailparser";

// Turning a message's source into what the app keeps: the Envelope (headers and a short snippet)
// and, on demand, the sanitised plain text. mailparser derives the text from the HTML part when
// a message has no plain-text part, so HTML-only mail reads the same; no HTML is ever kept.

const PARSE_OPTIONS = { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true } as const;

/** A raw header value, unfolded and trimmed, exactly as the sender wrote it; null when absent. */
function rawHeader(mail: ParsedMail, name: string): string | null {
  const entry = mail.headerLines.find((h) => h.key === name);
  if (!entry) return null;
  const colon = entry.line.indexOf(":");
  const value = entry.line
    .slice(colon + 1)
    .replace(/\r?\n[ \t]+/g, " ")
    .replace(/[\r\n]/g, "")
    .trim();
  return value === "" ? null : value;
}

/** The angle-bracketed ids in a header (References, In-Reply-To), verbatim. */
function messageIds(value: string | null): string[] {
  if (!value) return [];
  const ids = value.match(/<[^<>\s]*>/g);
  return ids ?? value.split(/\s+/).filter(Boolean);
}

function addresses(field: AddressObject | AddressObject[] | undefined): Address[] {
  const objects = field === undefined ? [] : Array.isArray(field) ? field : [field];
  const flat = (list: EmailAddress[]): EmailAddress[] =>
    list.flatMap((a) => (a.group ? flat(a.group) : [a]));
  return flat(objects.flatMap((o) => o.value))
    .filter((a) => a.address)
    .map((a) => ({ address: (a.address ?? "").trim(), name: a.name.trim() || null }));
}

/**
 * Control characters other than tab and newline, and the zero-width and bidi controls, which can
 * hide or reorder text on screen.
 */
const UNSAFE_RANGES: [number, number][] = [
  [0x00, 0x08],
  [0x0b, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
];
const isSafe = (ch: string) => {
  const code = ch.codePointAt(0) ?? 0;
  return !UNSAFE_RANGES.some(([from, to]) => code >= from && code <= to);
};

/** Plain text that is safe to show and to hand to a model: no control characters, tidy lines. */
function sanitiseText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("")
    .filter(isSafe)
    .join("")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The first characters of the text, on one line, for the stored snippet. */
function snippetOf(text: string): string {
  return sanitiseText(text).replace(/\s+/g, " ").trim().slice(0, SNIPPET_MAX_LENGTH);
}

export interface SourceInfo {
  folder: MailFolder;
  folderPath: string;
  uidValidity: number;
  uid: number;
  internalDate: Date | null;
}

export async function envelopeFromSource(source: Buffer, info: SourceInfo): Promise<Envelope> {
  const mail = await simpleParser(source, PARSE_OPTIONS);
  const headerDate = mail.date && !Number.isNaN(mail.date.getTime()) ? mail.date : null;
  const date = headerDate ?? info.internalDate ?? new Date(0);
  const inReplyTo = messageIds(rawHeader(mail, "in-reply-to"))[0] ?? null;
  return {
    messageId:
      rawHeader(mail, "message-id") ?? syntheticMessageId(info.folder, info.uidValidity, info.uid),
    folder: info.folder,
    folderPath: info.folderPath,
    uidValidity: info.uidValidity,
    uid: info.uid,
    date: date.toISOString(),
    from: addresses(mail.from)[0] ?? { address: "", name: null },
    to: addresses(mail.to),
    cc: addresses(mail.cc),
    replyTo: addresses(mail.replyTo),
    inReplyTo,
    references: messageIds(rawHeader(mail, "references")),
    subject: mail.subject ?? "",
    listId: rawHeader(mail, "list-id"),
    listUnsubscribe: rawHeader(mail, "list-unsubscribe"),
    precedence: rawHeader(mail, "precedence"),
    autoSubmitted: rawHeader(mail, "auto-submitted"),
    snippet: snippetOf(mail.text ?? ""),
  };
}

/** The message as sanitised plain text (F5.2): from its text part, or derived from its HTML. */
export async function bodyText(source: Buffer): Promise<string> {
  const mail = await simpleParser(source, PARSE_OPTIONS);
  return sanitiseText(mail.text ?? "");
}
