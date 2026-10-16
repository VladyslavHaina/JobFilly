import {
  type Address,
  type DraftMailInput,
  isSyntheticMessageId,
  type OriginalMessage,
} from "@jobfilly/schema";
import MailComposer from "nodemailer/lib/mail-composer";

// Building a draft's MIME message (F6.3) with nodemailer's MailComposer, which only composes:
// nothing here, or anywhere in this package, creates a transport or opens an SMTP connection
// (F6.6). The message holds the reply text, the quote of the original (added here, at build time,
// so the database never stores a mail body), In-Reply-To and References to thread it, and the
// chosen CV as an attachment.

export interface DraftMimeInput extends DraftMailInput {
  /** The mailbox's own address: the draft's From. */
  from: Address;
  /** The draft's own Message-ID header, "<...>". */
  messageId: string;
  date: Date;
}

/** The original's References plus its own Message-ID, each once, in order (RFC 5322 3.6.4). */
export function threadReferences(original: OriginalMessage): string[] {
  const ids = [...original.references, original.messageId].filter(
    (id) => !isSyntheticMessageId(id),
  );
  return [...new Set(ids)];
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-14 09:12 UTC": the same in every language the reply may be written in. */
function quoteDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())} UTC`;
}

function author(from: Address): string {
  return from.name ? `${from.name} <${from.address}>` : `<${from.address}>`;
}

/**
 * The reply followed by the original, quoted line by line. The attribution line names only the
 * date and the author, with no words, so it reads the same under a reply in any language.
 */
function replyText(reply: string, original: OriginalMessage): string {
  const quoted = original.text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
  return `${reply.trimEnd()}\n\n${quoteDate(original.date)}, ${author(original.from)}:\n${quoted}\n`;
}

/** The subject of a reply: the draft's own, else "Re: " and the original's. */
function replySubject(subject: string, original: OriginalMessage): string {
  if (subject.trim() !== "") return subject;
  return /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`;
}

/** The draft as an RFC 5322 message with CRLF line ends, ready to append to the Drafts folder. */
export async function buildDraftMime(input: DraftMimeInput): Promise<Buffer> {
  const { original } = input;
  const thread = isSyntheticMessageId(original.messageId) ? null : original.messageId;
  const address = (a: Address) => ({ address: a.address, name: a.name ?? "" });
  const composer = new MailComposer({
    from: address(input.from),
    to: [address(original.from)],
    subject: replySubject(input.reply.subject, original),
    messageId: input.messageId,
    date: input.date,
    ...(thread ? { inReplyTo: thread, references: threadReferences(original) } : {}),
    text: replyText(input.reply.body, original),
    attachments: input.attachment
      ? [
          {
            filename: input.attachment.fileName,
            contentType: input.attachment.contentType,
            content: Buffer.from(input.attachment.bytes),
          },
        ]
      : [],
    // The content is given in full: the composer must never read a file or fetch a URL.
    disableFileAccess: true,
    disableUrlAccess: true,
    xMailer: false,
    // IMAP APPEND takes the message with CRLF line ends throughout, the text part's included.
    newline: "\r\n",
  });
  return composer.compile().build();
}
