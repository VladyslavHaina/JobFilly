import { describe, expect, it } from "vitest";
import { loadFreeMailDomains, loadMessageSignals } from "./index";

// The sender check's data files against the test stack's fixtures (e2e/fixtures): the two scams
// must trip a fee and a passport phrase of message-signals.json, and the free-mail "recruiter"
// must write from a domain of free-mail-domains.json (F5.5, S6), while no other job mail trips
// either. The direction is from here to the fixtures, as in packages/schema/src/wire.test.ts:
// e2e imports no app or package code, so a change to these lists that breaks the fixtures fails
// here. Only committed files are read, through Vite's import.meta.glob: packages/core has no Node
// types (it does no I/O), and the glob needs none.

declare global {
  interface ImportMeta {
    glob<T>(pattern: string, options: { eager: true; import: "default" }): Record<string, T>;
    glob<T>(
      pattern: string,
      options: { import: "default"; query: "?raw" },
    ): Record<string, () => Promise<T>>;
  }
}

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

const FIXTURES = "../../../../e2e/fixtures/";
// import.meta.glob takes literal patterns only, so each one is spelled out.
const expectedFiles = import.meta.glob<Expected>("../../../../e2e/fixtures/*/expected.json", {
  eager: true,
  import: "default",
});
const envelopeFiles = import.meta.glob<Envelope[]>("../../../../e2e/fixtures/*/envelopes.json", {
  eager: true,
  import: "default",
});
const deliveryFiles = import.meta.glob<Delivery[]>("../../../../e2e/fixtures/*/deliveries.json", {
  eager: true,
  import: "default",
});
// The .eml files load on demand: only job mail is read.
const inboxFiles = import.meta.glob<string>("../../../../e2e/fixtures/*/mail/inbox/*.eml", {
  import: "default",
  query: "?raw",
});
const deliveredFiles = import.meta.glob<string>("../../../../e2e/fixtures/*/deliver/*.eml", {
  import: "default",
  query: "?raw",
});

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
async function jobMail(): Promise<JobMail[]> {
  const out: JobMail[] = [];
  for (const [path, expected] of Object.entries(expectedFiles)) {
    const dir = path.slice(0, path.lastIndexOf("/") + 1);
    const persona = dir.slice(FIXTURES.length, -1);
    for (const e of envelopeFiles[`${dir}envelopes.json`] ?? []) {
      const verdict = expected.messages[e.messageId]?.sender?.verdict;
      if (verdict === undefined) continue;
      const raw = await inboxFiles[`${dir}mail/${e.file}`]?.();
      if (raw === undefined) throw new Error(`${persona}: no ${e.file}`);
      out.push({
        id: e.messageId,
        verdict,
        text: plainText(raw),
        domain: domainOf(e.from.address),
      });
    }
    for (const d of deliveryFiles[`${dir}deliveries.json`] ?? []) {
      const verdict = expected.deliveries[d.messageId]?.sender?.verdict;
      const raw = await deliveredFiles[`${dir}deliver/${d.file}`]?.();
      if (verdict === undefined || raw === undefined) throw new Error(`${persona}: ${d.file}`);
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

const mail = await jobMail();

describe("the sender data against the e2e fixtures", () => {
  const scams = mail.filter((m) => m.verdict === "high_risk");

  it("reads both personas' analysed job mail, the delivered mail included", () => {
    expect(
      Object.keys(expectedFiles)
        .map((p) => p.slice(FIXTURES.length))
        .sort(),
    ).toEqual(["maria/expected.json", "tom/expected.json"]);
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
