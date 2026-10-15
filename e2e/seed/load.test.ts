import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { PERSONAS } from "../fixtures/format.ts";
import { COMPOSE_FILE } from "../stack.ts";
import { connectWithRetry } from "./connect.ts";
import { dateFor, loadPersona, rfc5322Date, SeedError, type SeedImap } from "./load.ts";

// The sample persona in testdata/sample: two Inbox messages and one Sent message. inbox/0001 has
// LF line ends, a folded Subject and an old Date header; inbox/0002 has CRLF and no Date header.

const FIXTURES = join(import.meta.dirname, "testdata");
const NOW = new Date("2026-10-14T21:30:45.678Z");

interface Appended {
  path: string;
  content: string;
  flags: string[];
  idate: Date;
}

/** An imapflow double: a mail server holding folders of messages in memory. */
function fakeImap(start: Record<string, number> = { INBOX: 0 }) {
  const folders = new Map(Object.entries(start));
  const appended: Appended[] = [];
  const calls: string[] = [];
  let open = false;
  const client: SeedImap = {
    async logout() {
      calls.push("logout");
      open = false;
    },
    async list() {
      calls.push("list");
      return [...folders.keys()].map((path) => ({ path }));
    },
    async status(path) {
      calls.push(`status ${path}`);
      const messages = folders.get(path);
      if (messages === undefined) throw new Error(`NO no such mailbox ${path}`);
      return { messages };
    },
    async mailboxCreate(path) {
      calls.push(`create ${path}`);
      folders.set(path, 0);
      return { path, created: true };
    },
    async append(path, content, flags, idate) {
      calls.push(`append ${path}`);
      const n = folders.get(path);
      if (n === undefined) throw new Error(`NO [TRYCREATE] no such mailbox ${path}`);
      folders.set(path, n + 1);
      appended.push({ path, content: content.toString("latin1"), flags, idate });
      return { destination: path, uid: n + 1 };
    },
  };
  return {
    open: async () => {
      calls.push("connect");
      open = true;
      return client;
    },
    appended,
    calls,
    folders,
    isOpen: () => open,
  };
}

function header(content: string, name: string): string[] {
  const head = content.slice(0, content.indexOf("\r\n\r\n"));
  return head
    .split(/\r\n(?![ \t])/)
    .filter((line) => line.toLowerCase().startsWith(`${name.toLowerCase()}:`))
    .map((line) => line.slice(name.length + 1).trim());
}

describe("seed load", () => {
  const temp: string[] = [];
  afterEach(() => {
    for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("appends every message to its folder with its flags, Date header and internal date", async () => {
    const imap = fakeImap();
    const result = await loadPersona({
      open: imap.open,
      fixturesDir: FIXTURES,
      persona: "sample",
      now: NOW,
    });

    expect(result).toEqual({ inbox: 2, sent: 1 });
    // Sent did not exist, so it is created before anything is appended; oldest message first.
    expect(imap.calls).toEqual([
      "connect",
      "list",
      "status INBOX",
      "create Sent",
      "append INBOX",
      "append Sent",
      "append INBOX",
      "logout",
    ]);
    expect(imap.isOpen()).toBe(false);

    const twelveDaysAgo = new Date("2026-10-02T21:30:45.000Z");
    const oneDayAgo = new Date("2026-10-13T21:30:45.000Z");
    const ninetyMinutesAgo = new Date("2026-10-14T20:00:45.000Z");
    expect(imap.appended.map(({ path, flags, idate }) => ({ path, flags, idate }))).toEqual([
      { path: "INBOX", flags: [], idate: twelveDaysAgo },
      { path: "Sent", flags: ["\\Seen"], idate: oneDayAgo },
      { path: "INBOX", flags: [], idate: ninetyMinutesAgo },
    ]);
    expect(imap.appended.map((m) => header(m.content, "Date"))).toEqual([
      ["Fri, 2 Oct 2026 21:30:45 +0000"],
      ["Tue, 13 Oct 2026 21:30:45 +0000"],
      ["Wed, 14 Oct 2026 20:00:45 +0000"],
    ]);
    expect(imap.appended.map((m) => header(m.content, "Message-ID"))).toEqual([
      ["<inbox-1@sample.example>"],
      ["<sent-1@sample.example>"],
      ["<inbox-2@sample.example>"],
    ]);
  });

  it("keeps the rest of the message and sends it with CRLF line ends", async () => {
    const imap = fakeImap();
    await loadPersona({ open: imap.open, fixturesDir: FIXTURES, persona: "sample", now: NOW });
    const first = imap.appended[0]?.content ?? "";
    expect(first).toBe(
      [
        "Date: Fri, 2 Oct 2026 21:30:45 +0000",
        "From: Recruiter <recruiter@agency.example>",
        "To: sample@inbox.example",
        "Subject: A backend role",
        " that is folded",
        "Message-ID: <inbox-1@sample.example>",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Hello,",
        "there is a role for you.",
        "",
      ].join("\r\n"),
    );
    for (const m of imap.appended) expect(m.content).not.toMatch(/[^\r]\n/);
  });

  it("takes the folder names in any case", async () => {
    const dir = mkdtempSync(join(tmpdir(), "seed-"));
    temp.push(dir);
    cpSync(join(FIXTURES, "sample"), join(dir, "sample"), { recursive: true });
    writeFileSync(
      join(dir, "sample", "envelopes.json"),
      JSON.stringify([
        {
          file: "inbox/0001.eml",
          folder: "INBOX",
          messageId: "<inbox-1@sample.example>",
          minutesAgo: 5,
        },
        {
          file: "sent/0001.eml",
          folder: "Sent",
          messageId: "<sent-1@sample.example>",
          minutesAgo: 1,
        },
      ]),
    );
    const imap = fakeImap();
    const result = await loadPersona({
      open: imap.open,
      fixturesDir: dir,
      persona: "sample",
      now: NOW,
    });
    expect(result).toEqual({ inbox: 1, sent: 1 });
    expect(imap.appended.map((m) => [m.path, m.flags])).toEqual([
      ["INBOX", []],
      ["Sent", ["\\Seen"]],
    ]);
  });

  it("uses an existing Sent folder", async () => {
    const imap = fakeImap({ INBOX: 0, Sent: 0 });
    await loadPersona({ open: imap.open, fixturesDir: FIXTURES, persona: "sample", now: NOW });
    expect(imap.calls).not.toContain("create Sent");
    expect(imap.folders.get("Sent")).toBe(1);
  });

  it("refuses a second load into a mailbox that already has mail", async () => {
    const imap = fakeImap();
    const load = () =>
      loadPersona({ open: imap.open, fixturesDir: FIXTURES, persona: "sample", now: NOW });
    await load();
    const before = imap.appended.length;

    const second = load();
    await expect(second).rejects.toBeInstanceOf(SeedError);
    await expect(second).rejects.toThrow(
      "sample's mailbox is not empty (Inbox 2, Sent 1): seed load runs once, on a fresh test " +
        "stack. Take the stack down and start a fresh one.",
    );
    expect(imap.appended).toHaveLength(before);
    expect(imap.isOpen()).toBe(false);
  });

  it("refuses when only Sent has mail", async () => {
    const imap = fakeImap({ INBOX: 0, Sent: 4 });
    await expect(
      loadPersona({ open: imap.open, fixturesDir: FIXTURES, persona: "sample", now: NOW }),
    ).rejects.toThrow("(Inbox 0, Sent 4)");
    expect(imap.appended).toHaveLength(0);
  });

  it("checks every fixture before touching the mailbox", async () => {
    const dir = mkdtempSync(join(tmpdir(), "seed-"));
    temp.push(dir);
    cpSync(join(FIXTURES, "sample"), join(dir, "sample"), { recursive: true });
    const envelopes = join(dir, "sample", "envelopes.json");
    const imap = fakeImap();
    const load = () =>
      loadPersona({ open: imap.open, fixturesDir: dir, persona: "sample", now: NOW });

    writeFileSync(
      envelopes,
      JSON.stringify([
        { file: "inbox/0001.eml", folder: "inbox", messageId: "<other@x>", minutesAgo: 1 },
      ]),
    );
    await expect(load()).rejects.toThrow(
      "sample: inbox/0001.eml has Message-ID <inbox-1@sample.example>, but envelopes.json says <other@x>",
    );

    writeFileSync(
      envelopes,
      JSON.stringify([
        { file: "inbox/9999.eml", folder: "inbox", messageId: "<a@x>", minutesAgo: 1 },
      ]),
    );
    await expect(load()).rejects.toThrow("inbox/9999.eml is listed in envelopes.json but missing");

    writeFileSync(
      envelopes,
      JSON.stringify([
        { file: "inbox/0001.eml", folder: "Drafts", messageId: "<a@x>", minutesAgo: 1 },
      ]),
    );
    await expect(load()).rejects.toThrow('folder must be "inbox" or "sent"');

    writeFileSync(
      envelopes,
      JSON.stringify([{ file: "inbox/0001.eml", folder: "inbox", messageId: "<a@x>" }]),
    );
    await expect(load()).rejects.toThrow("minutesAgo must be a number of minutes");

    expect(imap.calls).toEqual([]);
  });

  it("names a persona without fixtures", async () => {
    const imap = fakeImap();
    await expect(
      loadPersona({ open: imap.open, fixturesDir: FIXTURES, persona: "nobody", now: NOW }),
    ).rejects.toThrow('No fixtures for persona "nobody"');
  });
});

// The real persona fixtures, loaded the way `pnpm e2e:stack up` loads them: `seed load <persona>`
// for every persona of fixtures/format.ts, with the FIXTURES_DIR compose gives the seed service,
// read from the repository root as the e2e image does (its /repo holds e2e/ where the repository
// does). seed/main.test.ts runs the entry point itself with the arguments stack.ts passes.
describe("seed load over the persona fixtures", () => {
  const ROOT = join(import.meta.dirname, "..", "..");
  const compose = parse(readFileSync(join(ROOT, COMPOSE_FILE), "utf8"), { merge: true }) as {
    services: { seed: { environment: { FIXTURES_DIR: string } } };
  };
  const fixturesDir = join(ROOT, compose.services.seed.environment.FIXTURES_DIR);
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60_000;

  it.each(PERSONAS)(
    "appends every message of %s to its folder, in the 90-day window",
    async (persona) => {
      const envelopes = JSON.parse(
        readFileSync(join(fixturesDir, persona, "envelopes.json"), "utf8"),
      ) as { file: string; folder: string; messageId: string }[];
      const emls = ["inbox", "sent"].flatMap((folder) =>
        readdirSync(join(fixturesDir, persona, "mail", folder))
          .filter((name) => name.endsWith(".eml"))
          .map((name) => `${folder}/${name}`),
      );
      // envelopes.json lists exactly the .eml files there are.
      expect(envelopes.map((e) => e.file).sort()).toEqual(emls.sort());

      const imap = fakeImap();
      const result = await loadPersona({ open: imap.open, fixturesDir, persona, now: NOW });

      const inbox = envelopes.filter((e) => e.folder === "inbox").length;
      expect(result).toEqual({ inbox, sent: envelopes.length - inbox });
      expect(result.inbox).toBeGreaterThan(0);
      expect(result.sent).toBeGreaterThan(0);
      expect(imap.appended).toHaveLength(envelopes.length);
      const appended = new Map(imap.appended.map((m) => [header(m.content, "Message-ID")[0], m]));
      for (const e of envelopes) {
        const m = appended.get(e.messageId);
        expect(m?.path, e.file).toBe(e.folder === "sent" ? "Sent" : "INBOX");
        expect(NOW.getTime() - (m?.idate.getTime() ?? 0), e.file).toBeLessThan(NINETY_DAYS_MS);
      }
      expect(imap.isOpen()).toBe(false);
    },
  );
});

describe("dates", () => {
  it("counts minutes back from now, to the whole second", () => {
    expect(dateFor(NOW, 0).toISOString()).toBe("2026-10-14T21:30:45.000Z");
    expect(dateFor(NOW, 90 * 24 * 60).toISOString()).toBe("2026-07-16T21:30:45.000Z");
  });

  it("writes RFC 5322 dates in UTC", () => {
    expect(rfc5322Date(new Date("2026-03-01T04:05:06Z"))).toBe("Sun, 1 Mar 2026 04:05:06 +0000");
  });
});

describe("connectWithRetry", () => {
  function clock() {
    let t = 0;
    return {
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
    };
  }

  it("retries until the mail server answers, with a fresh client each time", async () => {
    const attempts: number[] = [];
    const time = clock();
    const client = await connectWithRetry(
      () => {
        const n = attempts.length + 1;
        attempts.push(n);
        return {
          n,
          connect: async () => {
            if (n < 3)
              throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
          },
        };
      },
      { timeoutMs: 10_000, retryMs: 1_000, ...time },
    );
    expect(client.n).toBe(3);
    expect(time.now()).toBe(2_000);
  });

  it("gives up after the timeout with the reason", async () => {
    const time = clock();
    const failing = () => ({
      connect: async () => {
        throw Object.assign(new Error("getaddrinfo ENOTFOUND imap"), { code: "ENOTFOUND" });
      },
    });
    await expect(
      connectWithRetry(failing, { timeoutMs: 5_000, retryMs: 1_000, ...time }),
    ).rejects.toThrow(
      "Can't reach the mail server after 5 s: ENOTFOUND getaddrinfo ENOTFOUND imap",
    );
  });

  it("stops at once when the login is refused", async () => {
    let attempts = 0;
    const refused = () => ({
      connect: async () => {
        attempts++;
        throw Object.assign(new Error("Authentication failed"), { authenticationFailed: true });
      },
    });
    await expect(
      connectWithRetry(refused, { timeoutMs: 5_000, retryMs: 1_000, ...clock() }),
    ).rejects.toThrow("The mail server refused the login");
    expect(attempts).toBe(1);
  });
});
