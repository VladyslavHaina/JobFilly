import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadFreeMailDomains, loadMessageSignals } from "./index";

// The sender check's data files against the test stack's fixtures (e2e/fixtures): the two scams
// must trip a fee and a passport phrase of message-signals.json, and the free-mail "recruiter"
// must write from a domain of free-mail-domains.json (F5.5, S6), while no other job mail trips
// either. The direction is from here to the fixtures, as in packages/schema/src/wire.test.ts:
// e2e imports no app or package code, so a change to these lists that breaks the fixtures fails
// here. The tests read the fixtures with node:fs, so tsconfig.test.json typechecks them with Node
// types; packages/core itself does no I/O and has none.

interface Address {
  address: string;
}
interface Envelope {
  file: string;
  messageId: string;
  folder: string;
  from: Address;
}
interface Delivery {
  file: string;
  messageId: string;
}
interface Truth {
  /** Set on every job message the app analyses (not own replies, not the always-invalid one). */
  sender?: { verdict: string };
}
interface Expected {
  messages: Record<string, Truth>;
  deliveries: Record<string, Truth>;
}

const FIXTURES = fileURLToPath(new URL("../../../../e2e/fixtures/", import.meta.url));
const readText = (path: string): string => readFileSync(`${FIXTURES}${path}`, "utf8");
const readJson = <T>(path: string): T => JSON.parse(readText(path)) as T;

// Every persona has a mailbox with ground truth (<persona>/expected.json); deliveries.json is
// optional.
const PERSONAS = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(`${FIXTURES}${d.name}/expected.json`))
  .map((d) => d.name)
  .sort();

/** Decodes quoted-printable text (ASCII on the wire) to UTF-8, by way of percent-encoding. */
function decodeQp(data: string): string {
  return decodeURIComponent(
    data
      .replace(/=\r?\n/g, "")
      .replace(/%/g, "%25")
      .replace(/=([0-9A-F]{2})/g, "%$1"),
  );
}

/** The text/plain part of a fixture .eml (multipart/alternative, quoted-printable). */
function plainText(raw: string): string {
  for (const part of raw.split(/\r\n--[^\r\n]+\r\n/)) {
    const end = part.indexOf("\r\n\r\n");
    if (/^Content-Type: text\/plain/im.test(part.slice(0, end)))
      return decodeQp(part.slice(end + 4));
  }
  throw new Error("no text/plain part");
}

/** The address of a From header: `"Name" <a@b>` or `a@b`. */
function fromAddress(raw: string): string {
  const header = /^From: (.*)$/m.exec(raw.slice(0, raw.indexOf("\r\n\r\n")))?.[1] ?? "";
  return /<([^>]+)>/.exec(header)?.[1] ?? header.trim();
}

interface JobMail {
  id: string;
  verdict: string;
  text: string;
  domain: string;
}

const domainOf = (address: string) => address.slice(address.indexOf("@") + 1).toLowerCase();

/** Every analysed job message of every persona, backlog and delivered, with its ground truth. */
function jobMail(): JobMail[] {
  const out: JobMail[] = [];
  for (const persona of PERSONAS) {
    const expected = readJson<Expected>(`${persona}/expected.json`);
    for (const e of readJson<Envelope[]>(`${persona}/envelopes.json`)) {
      const verdict = expected.messages[e.messageId]?.sender?.verdict;
      if (verdict === undefined) continue;
      out.push({
        id: e.messageId,
        verdict,
        text: plainText(readText(`${persona}/mail/${e.file}`)),
        domain: domainOf(e.from.address),
      });
    }
    const deliveries = existsSync(`${FIXTURES}${persona}/deliveries.json`)
      ? readJson<Delivery[]>(`${persona}/deliveries.json`)
      : [];
    for (const d of deliveries) {
      const verdict = expected.deliveries[d.messageId]?.sender?.verdict;
      if (verdict === undefined) throw new Error(`${persona}: no sender verdict for ${d.file}`);
      const raw = readText(`${persona}/deliver/${d.file}`);
      out.push({
        id: d.messageId,
        verdict,
        text: plainText(raw),
        domain: domainOf(fromAddress(raw)),
      });
    }
  }
  return out;
}

/** The signal phrases of message-signals.json (every language) in a text, as "<signal>: <phrase>". */
function signalsIn(text: string): string[] {
  const lower = text.toLowerCase();
  return Object.values(loadMessageSignals().languages).flatMap((bySignal) =>
    Object.entries(bySignal).flatMap(([signal, phrases]) =>
      phrases.filter((p) => lower.includes(p)).map((p) => `${signal}: ${p}`),
    ),
  );
}

const mail = jobMail();

describe("the sender data against the e2e fixtures", () => {
  const scams = mail.filter((m) => m.verdict === "high_risk");

  it("reads both personas' analysed job mail, the delivered mail included", () => {
    expect(PERSONAS).toEqual(["maria", "tom"]);
    expect(mail.length).toBeGreaterThan(150);
    expect(mail.some((m) => m.id.startsWith("<maria-deliver-"))).toBe(true);
  });

  it("finds a fee phrase and a passport phrase in both scams, the backlog's and the delivered", () => {
    expect(scams.map((m) => m.id.startsWith("<maria-deliver-")).sort()).toEqual([false, true]);
    for (const { id, text } of scams) {
      const found = signalsIn(text);
      expect(
        found.some((s) => s.startsWith("asks_for_fee: ")),
        id,
      ).toBe(true);
      expect(
        found.some((s) => s.startsWith("asks_for_id: ") && s.includes("passport")),
        id,
      ).toBe(true);
    }
  });

  it("finds no signal phrase in any other job mail", () => {
    for (const { id, text } of mail.filter((m) => m.verdict !== "high_risk")) {
      expect(signalsIn(text), id).toEqual([]);
    }
  });

  it("finds a free-mail domain only for the free-mail recruiter, the one sender called caution", () => {
    const freeMail = new Set(loadFreeMailDomains().domains);
    const fromFreeMail = mail.filter((m) => freeMail.has(m.domain)).map((m) => m.id);
    expect(fromFreeMail).toEqual(mail.filter((m) => m.verdict === "caution").map((m) => m.id));
    expect(fromFreeMail).toHaveLength(1);
  });
});
