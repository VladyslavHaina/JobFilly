import type { Address } from "../format.ts";

// Writes one fixture message as RFC 5322 text: CRLF line ends, non-ASCII header words as RFC 2047
// encoded words, and a multipart/alternative body whose text and HTML parts are quoted-printable
// UTF-8, so every file is 7-bit and readable in a diff.

export interface EmlInput {
  messageId: string;
  date: Date;
  from: Address;
  to: Address[];
  cc: Address[];
  replyTo: Address[];
  subject: string;
  inReplyTo: string | null;
  references: string[];
  listId: string | null;
  listUnsubscribe: string | null;
  precedence: string | null;
  text: string;
  html: string;
  boundary: string;
}

const CRLF = "\r\n";
const NON_ASCII = /[^\x20-\x7e]/;

/** RFC 2047 B-encoded words of at most 75 characters each, split on whole characters. */
function encodedWords(value: string): string[] {
  const words: string[] = [];
  let chunk = "";
  for (const char of value) {
    if (Buffer.byteLength(chunk + char) > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`);
}

/** A header text: as is when printable ASCII, otherwise encoded words folded onto lines. */
function headerText(value: string): string {
  return NON_ASCII.test(value) ? encodedWords(value).join(`${CRLF} `) : value;
}

function formatAddress(a: Address): string {
  if (a.name === null) return a.address;
  const name = NON_ASCII.test(a.name)
    ? encodedWords(a.name).join(" ")
    : `"${a.name.replace(/["\\]/g, "\\$&")}"`;
  return `${name} <${a.address}>`;
}

function addressList(list: Address[]): string {
  return list.map(formatAddress).join(`,${CRLF} `);
}

/** RFC 5322 date, e.g. "Thu, 01 Oct 2026 12:00:00 +0000". */
function rfc5322Date(date: Date): string {
  return date.toUTCString().replace("GMT", "+0000");
}

/** Quoted-printable (RFC 2045) of UTF-8 text, CRLF line ends, lines of at most 76 characters. */
function quotedPrintable(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const bytes = Buffer.from(line, "utf8");
      const tokens: string[] = [];
      bytes.forEach((b, i) => {
        const last = i === bytes.length - 1;
        const literal = (b >= 33 && b <= 126 && b !== 61) || ((b === 32 || b === 9) && !last);
        tokens.push(
          literal ? String.fromCharCode(b) : `=${b.toString(16).toUpperCase().padStart(2, "0")}`,
        );
      });
      const out: string[] = [];
      let current = "";
      for (const token of tokens) {
        if (current.length + token.length > 75) {
          out.push(`${current}=`);
          current = "";
        }
        current += token;
      }
      out.push(current);
      return out.join(CRLF);
    })
    .join(CRLF);
}

export function buildEml(m: EmlInput): string {
  const headers: string[] = [
    `Message-ID: ${m.messageId}`,
    `Date: ${rfc5322Date(m.date)}`,
    `From: ${formatAddress(m.from)}`,
    `To: ${addressList(m.to)}`,
  ];
  if (m.cc.length > 0) headers.push(`Cc: ${addressList(m.cc)}`);
  if (m.replyTo.length > 0) headers.push(`Reply-To: ${addressList(m.replyTo)}`);
  headers.push(`Subject: ${headerText(m.subject)}`);
  if (m.inReplyTo !== null) headers.push(`In-Reply-To: ${m.inReplyTo}`);
  if (m.references.length > 0) headers.push(`References: ${m.references.join(`${CRLF} `)}`);
  if (m.listId !== null) headers.push(`List-Id: ${m.listId}`);
  if (m.listUnsubscribe !== null) headers.push(`List-Unsubscribe: ${m.listUnsubscribe}`);
  if (m.precedence !== null) headers.push(`Precedence: ${m.precedence}`);
  headers.push(
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${m.boundary}"`,
  );
  const part = (type: string, body: string) =>
    [
      `--${m.boundary}`,
      `Content-Type: ${type}; charset=utf-8`,
      "Content-Transfer-Encoding: quoted-printable",
      "",
      quotedPrintable(body),
    ].join(CRLF);
  return [
    ...headers,
    "",
    part("text/plain", m.text),
    part("text/html", m.html),
    `--${m.boundary}--`,
    "",
  ].join(CRLF);
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

/** The HTML part: one paragraph per blank-line-separated block, line breaks kept. */
export function toHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c).replace(/\n/g, "<br>\n")}</p>`);
  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8"></head>',
    '<body style="font-family: sans-serif">',
    ...paragraphs,
    "</body></html>",
  ].join("\n");
}
