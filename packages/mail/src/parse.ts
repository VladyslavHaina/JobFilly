import { createHash } from "node:crypto";
import {
  type Address,
  type DraftAttachment,
  DraftAttachmentSchema,
  type Envelope,
  isMsgId,
  type MailFolder,
  type OriginalMessage,
  SNIPPET_MAX_LENGTH,
  syntheticMessageId,
} from "@jobfilly/schema";
import { type AddressObject, type EmailAddress, type ParsedMail, simpleParser } from "mailparser";
import { usableDate } from "./dates";

// Turning a message's source into what the app keeps: the Envelope (headers and a short snippet)
// and, on demand, the sanitised plain text. mailparser derives the text from the HTML part when
// a message has no plain-text part, so HTML-only mail reads the same; no HTML is ever kept.

const PARSE_OPTIONS = { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true } as const;

/** Only the start of each message is read for its envelope: the headers and the snippet. */
export const ENVELOPE_SOURCE_BYTES = 64 * 1024;

/** SHA-256 of the parts, each ended by NUL, as the 32 hex digits a synthetic Message-ID takes. */
function digest(parts: readonly (string | Uint8Array)[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex").slice(0, 32);
}

/**
 * The synthetic Message-ID of a message without a usable one (F1.3), from what the message says,
 * never from where it is: its From, Date, Subject and To, and the start of its text (the
 * snippet, which the envelope and the original read alike). A folder rebuilt under a new
 * UIDVALIDITY gives the message the same id, so the sync matches it again instead of storing it
 * twice. Two copies that agree in all of these are one message, and share the id.
 */
function contentMessageId(
  folder: MailFolder,
  e: Pick<Envelope, "from" | "date" | "subject" | "to" | "snippet">,
): string {
  return syntheticMessageId(
    folder,
    digest([
      "content.v1",
      e.from.address.toLowerCase(),
      e.date,
      e.subject,
      e.to.map((a) => a.address.toLowerCase()).join(","),
      e.snippet,
    ]),
  );
}

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
  return envelopeOf(await simpleParser(source, PARSE_OPTIONS), info);
}

/**
 * The envelope of a message nothing could be read from: only where it is and when it arrived,
 * under a synthetic Message-ID from the digest of its first bytes, which a rebuilt folder gives
 * back alike. Each of its fields is one the schema accepts, so it stands in for any field of a
 * message that fails its schema (conformed).
 */
export function fallbackEnvelope(info: SourceInfo, source: Uint8Array): Envelope {
  return {
    messageId: syntheticMessageId(
      info.folder,
      digest(["source.v1", source.subarray(0, ENVELOPE_SOURCE_BYTES)]),
    ),
    folder: info.folder,
    folderPath: info.folderPath,
    uidValidity: info.uidValidity,
    uid: info.uid,
    date: (usableDate(info.internalDate) ?? new Date(0)).toISOString(),
    from: { address: "", name: null },
    to: [],
    cc: [],
    replyTo: [],
    inReplyTo: null,
    references: [],
    subject: "",
    listId: null,
    listUnsubscribe: null,
    precedence: null,
    autoSubmitted: null,
    snippet: "",
  };
}

interface ObjectSchema<T> {
  shape: Record<string, { safeParse(value: unknown): { success: boolean } }>;
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

/**
 * What one message gave, checked against its schema on its own, so one message can never fail a
 * whole folder: each field that fails its schema is replaced by the fallback's. Null when even
 * that fails (only the fields the fallback copies from the server can, such as a UID that isn't
 * a number): the message is left out.
 */
export function conformed<T extends object>(
  schema: ObjectSchema<T>,
  value: T,
  fallback: T,
): T | null {
  const given = value as Record<string, unknown>;
  const instead = fallback as Record<string, unknown>;
  const fields = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [
      key,
      field.safeParse(given[key]).success ? given[key] : instead[key],
    ]),
  );
  const checked = schema.safeParse(fields);
  return checked.success ? checked.data : null;
}

function envelopeOf(mail: ParsedMail, info: SourceInfo): Envelope {
  const date = usableDate(mail.date) ?? usableDate(info.internalDate) ?? new Date(0);
  const inReplyTo = messageIds(rawHeader(mail, "in-reply-to"))[0] ?? null;
  const said = {
    date: date.toISOString(),
    from: addresses(mail.from)[0] ?? { address: "", name: null },
    to: addresses(mail.to),
    subject: mail.subject ?? "",
    snippet: snippetOf(mail.text ?? ""),
  };
  // A Message-ID is the sender's text: one of any other shape than <...> is not kept (F3.5).
  const headerId = rawHeader(mail, "message-id");
  return {
    messageId:
      headerId !== null && isMsgId(headerId) ? headerId : contentMessageId(info.folder, said),
    folder: info.folder,
    folderPath: info.folderPath,
    uidValidity: info.uidValidity,
    uid: info.uid,
    date: said.date,
    from: said.from,
    to: said.to,
    cc: addresses(mail.cc),
    replyTo: addresses(mail.replyTo),
    inReplyTo,
    references: messageIds(rawHeader(mail, "references")),
    subject: said.subject,
    listId: rawHeader(mail, "list-id"),
    listUnsubscribe: rawHeader(mail, "list-unsubscribe"),
    precedence: rawHeader(mail, "precedence"),
    autoSubmitted: rawHeader(mail, "auto-submitted"),
    snippet: said.snippet,
  };
}

/**
 * What a draft replies to (F6.3): the threading headers and the sanitised text to quote, read in
 * one parse of the whole message. Never stored.
 */
export async function originalFromSource(
  source: Buffer,
  info: SourceInfo,
): Promise<OriginalMessage> {
  const mail = await simpleParser(source, PARSE_OPTIONS);
  const envelope = envelopeOf(mail, info);
  return {
    messageId: envelope.messageId,
    references: envelope.references,
    inReplyTo: envelope.inReplyTo,
    subject: envelope.subject,
    from: envelope.from,
    date: envelope.date,
    text: sanitiseText(mail.text ?? ""),
  };
}

/**
 * The file attached to a draft the app saved (its CV, F6.3), read back from the copy's source;
 * null when it has none. What the server sent is checked as it enters.
 */
export async function attachmentFromSource(source: Buffer): Promise<DraftAttachment | null> {
  const mail = await simpleParser(source, PARSE_OPTIONS);
  const file = mail.attachments.find((a) => !a.related);
  if (!file) return null;
  return DraftAttachmentSchema.parse({
    fileName: file.filename || "attachment",
    contentType: file.contentType || "application/octet-stream",
    bytes: new Uint8Array(file.content),
  });
}

/** The message as sanitised plain text (F5.2): from its text part, or derived from its HTML. */
export async function bodyText(source: Buffer): Promise<string> {
  const mail = await simpleParser(source, PARSE_OPTIONS);
  return sanitiseText(mail.text ?? "");
}
