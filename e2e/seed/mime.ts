// Just enough MIME (RFC 2045–2047) for `seed inspect drafts` to read the drafts the app saves: the
// header fields, unfolded and with encoded words decoded, and the leaf parts of a multipart tree
// with their transfer encoding undone. e2e has no mail parser of its own (it imports no package
// code), and a draft is a plain multipart/mixed message: a text part and maybe a CV.

interface MimePart {
  /** The media type, lower case ("text/plain"). */
  type: string;
  /** The Content-Type and Content-Disposition parameters, names lower case. */
  params: Record<string, string>;
  disposition: string | null;
  content: Buffer;
}

export interface MimeMessage {
  /** Every header field by lower-case name, in order. */
  headers: [string, string][];
  /** The leaf parts, depth first. */
  parts: MimePart[];
}

/** Decodes RFC 2047 encoded words (B and Q) of any charset Node knows, UTF-8 by default. */
function decodeWords(value: string): string {
  return value
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, "$1")
    .replace(
      /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
      (_, charset: string, enc: string, text: string) => {
        const bytes =
          enc.toUpperCase() === "B"
            ? Buffer.from(text, "base64")
            : quotedPrintable(text.replace(/_/g, " "));
        return new TextDecoder(charset.toLowerCase()).decode(bytes);
      },
    );
}

function quotedPrintable(text: string): Buffer {
  const bytes: number[] = [];
  const s = text.replace(/=\r?\n/g, "");
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      bytes.push(Number.parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(s.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/** "text/plain; charset=utf-8; name=\"cv.pdf\"" → type and parameters (RFC 2231 '*' kept simple). */
function parseParams(value: string): { value: string; params: Record<string, string> } {
  const [head = "", ...rest] = value.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const params: Record<string, string> = {};
  for (const item of rest) {
    const eq = item.indexOf("=");
    if (eq < 0) continue;
    let name = item.slice(0, eq).trim().toLowerCase();
    let v = item.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\(.)/g, "$1");
    if (name.endsWith("*")) {
      name = name.slice(0, -1);
      const m = /^([^']*)'[^']*'(.*)$/.exec(v);
      if (m) v = decodeURIComponent(m[2] as string);
    }
    params[name] = decodeWords(v);
  }
  return { value: head.trim().toLowerCase(), params };
}

function splitHead(raw: Buffer): { headers: [string, string][]; body: Buffer } {
  const text = raw.toString("latin1");
  const match = /\r?\n\r?\n/.exec(text);
  const end = match ? match.index : text.length;
  const bodyStart = match ? match.index + match[0].length : text.length;
  const headers: [string, string][] = [];
  for (const line of text.slice(0, end).split(/\r?\n(?![ \t])/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const value = Buffer.from(line.slice(colon + 1).replace(/\r?\n[ \t]+/g, " "), "latin1")
      .toString("utf8")
      .trim();
    headers.push([line.slice(0, colon).trim().toLowerCase(), decodeWords(value)]);
  }
  return { headers, body: raw.subarray(Buffer.byteLength(text.slice(0, bodyStart), "latin1")) };
}

const headerOf = (headers: [string, string][], name: string) =>
  headers.find(([n]) => n === name)?.[1] ?? null;

function decodeBody(body: Buffer, encoding: string | null): Buffer {
  switch ((encoding ?? "7bit").toLowerCase()) {
    case "base64":
      return Buffer.from(body.toString("latin1").replace(/\s+/g, ""), "base64");
    case "quoted-printable":
      return quotedPrintable(body.toString("latin1"));
    default:
      return body;
  }
}

function leafParts(raw: Buffer): MimePart[] {
  const { headers, body } = splitHead(raw);
  const type = parseParams(headerOf(headers, "content-type") ?? "text/plain");
  if (type.value.startsWith("multipart/") && type.params.boundary) {
    const text = body.toString("latin1");
    const delimiter = `--${type.params.boundary}`;
    const pieces = text.split(new RegExp(`(?:^|\\r?\\n)${escapeRegExp(delimiter)}`));
    // pieces[0] is the preamble; the last starts with "--" (the close delimiter).
    return pieces
      .slice(1)
      .filter((p) => !p.startsWith("--"))
      .flatMap((p) => leafParts(Buffer.from(p.replace(/^[ \t]*\r?\n/, ""), "latin1")));
  }
  const disposition = headerOf(headers, "content-disposition");
  const parsedDisposition = disposition ? parseParams(disposition) : null;
  return [
    {
      type: type.value,
      params: { ...type.params, ...(parsedDisposition?.params ?? {}) },
      disposition: parsedDisposition?.value ?? null,
      content: decodeBody(body, headerOf(headers, "content-transfer-encoding")),
    },
  ];
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function parseMime(raw: Buffer): MimeMessage {
  return { headers: splitHead(raw).headers, parts: leafParts(raw) };
}

/** The value of the first header field called `name` (lower case), or null. */
export function header(message: MimeMessage, name: string): string | null {
  return headerOf(message.headers, name);
}
