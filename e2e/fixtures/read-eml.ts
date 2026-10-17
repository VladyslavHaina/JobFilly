// Reads the fixtures' .eml files for the consistency tests (consistency.test.ts, mvp3.test.ts)
// without a mail library: the headers unfolded, the text and HTML parts decoded from
// quoted-printable, and address lists with RFC 2047 names.

export interface ParsedEml {
  headers: Map<string, string>;
  text: string;
  html: string;
}

export function decodeWords(value: string): string {
  return value
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, "$1")
    .replace(/=\?UTF-8\?([BbQq])\?([^?]*)\?=/gi, (_, enc: string, data: string) =>
      enc.toUpperCase() === "B"
        ? Buffer.from(data, "base64").toString("utf8")
        : decodeQp(data.replace(/_/g, " ")),
    );
}

function decodeQp(data: string): string {
  const bytes: number[] = [];
  const s = data.replace(/=\r?\n/g, "");
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "=" && /^[0-9A-F]{2}$/.test(s.slice(i + 1, i + 3))) {
      bytes.push(Number.parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(s[i] as string, "utf8"));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

export function parseEml(raw: string): ParsedEml {
  const split = raw.indexOf("\r\n\r\n");
  const headers = new Map<string, string>();
  for (const line of raw
    .slice(0, split)
    .replace(/\r\n(?=[ \t])/g, "")
    .split("\r\n")) {
    const colon = line.indexOf(":");
    headers.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim());
  }
  const boundary = /boundary="([^"]+)"/.exec(headers.get("content-type") ?? "")?.[1];
  const parts: Record<string, string> = {};
  for (const part of raw.slice(split + 4).split(`--${boundary}`)) {
    const end = part.indexOf("\r\n\r\n");
    const type = /Content-Type: (text\/\w+)/.exec(part.slice(0, end))?.[1];
    if (type)
      parts[type] = decodeQp(part.slice(end + 4).replace(/\r\n$/, "")).replace(/\r\n/g, "\n");
  }
  return { headers, text: parts["text/plain"] ?? "", html: parts["text/html"] ?? "" };
}

export function parseAddresses(
  value: string | undefined,
): { address: string; name: string | null }[] {
  if (!value) return [];
  const out: { address: string; name: string | null }[] = [];
  for (const item of value.match(/(?:"(?:[^"\\]|\\.)*"|[^,])+/g) ?? []) {
    const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(item);
    if (!m) {
      out.push({ address: item.trim(), name: null });
      continue;
    }
    const rawName = m[1] as string;
    const name = rawName.startsWith('"')
      ? rawName.slice(1, -1).replace(/\\(.)/g, "$1")
      : decodeWords(rawName);
    out.push({ address: m[2] as string, name: name || null });
  }
  return out;
}
