import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type CvFixture,
  type DeliveryEntry,
  fixturesDir,
  PERSONA_ADDRESSES,
  type Persona,
  personaPathsMvp2,
  readJson,
} from "../fixtures/format.ts";
import { ACCOUNTS } from "./accounts.ts";
import {
  deliver,
  type FetchedMessage,
  inspectDrafts,
  inspectSmtp,
  type MailboxImap,
  resetUidValidity,
} from "./commands.ts";
import type { GreenMailApi } from "./greenmail.ts";
import { SeedError } from "./load.ts";
import { main, type SeedDeps } from "./main.ts";

// MVP 2's seed commands against doubles: an in-memory mail server with accounts, folders, UIDs
// and UIDVALIDITY, reachable through an imapflow-shaped client and a GreenMail-shaped API.

const FIXTURES = fixturesDir();
const NOW = new Date("2026-10-15T09:00:00.000Z");
const MARIA = PERSONA_ADDRESSES.maria;

interface StoredMessage {
  uid: number;
  flags: Set<string>;
  internalDate: Date;
  source: Buffer;
}
interface Folder {
  uidValidity: bigint;
  nextUid: number;
  specialUse?: string;
  messages: StoredMessage[];
}

const headerOf = (source: Buffer, name: string) =>
  new RegExp(`^${name}: *(.*)$`, "im").exec(
    source.toString("latin1").split(/\r?\n\r?\n/)[0] ?? "",
  )?.[1] ?? null;

/** A mail server in memory: accounts of folders; a new folder takes the next UIDVALIDITY. */
function fakeMailServer(options: { keepUidValidity?: boolean } = {}) {
  const accounts = new Map<string, Map<string, Folder>>();
  let validity = 1000n;
  const folder = (specialUse?: string): Folder => {
    if (!options.keepUidValidity) validity += 1n;
    return {
      uidValidity: options.keepUidValidity ? 1000n : validity,
      nextUid: 1,
      messages: [],
      ...(specialUse ? { specialUse } : {}),
    };
  };
  const createAccount = (user: string) => accounts.set(user, new Map([["INBOX", folder()]]));
  const add = (user: string, path: string, source: Buffer, flags: string[], date: Date) => {
    const f = accounts.get(user)?.get(path);
    if (!f) throw new Error(`NO [TRYCREATE] no such mailbox ${path}`);
    f.messages.push({ uid: f.nextUid++, flags: new Set(flags), internalDate: date, source });
  };
  const calls: string[] = [];

  const client = (user: string): MailboxImap => {
    const folders = () => {
      const a = accounts.get(user);
      if (!a) throw new Error("NO [AUTHENTICATIONFAILED] no such user");
      return a;
    };
    let selected: Folder | null = null;
    return {
      async logout() {
        calls.push(`${user} logout`);
      },
      async list() {
        return [...folders()].map(([path, f]) => ({ path, specialUse: f.specialUse }));
      },
      async status(path) {
        const f = folders().get(path);
        return f ? { messages: f.messages.length } : false;
      },
      async mailboxCreate(path) {
        calls.push(`${user} create ${path}`);
        folders().set(path, folder(path === "Drafts" ? "\\Drafts" : undefined));
        return { path };
      },
      async append(path, content, flags, idate) {
        calls.push(`${user} append ${path}`);
        add(user, path, content, flags, idate);
        return {};
      },
      async mailboxOpen(path) {
        const f = folders().get(path);
        if (!f) throw new Error(`NO no such mailbox ${path}`);
        selected = f;
        return { uidValidity: f.uidValidity, exists: f.messages.length };
      },
      async fetchAll(): Promise<FetchedMessage[]> {
        return (selected?.messages ?? []).map((m) => ({
          uid: m.uid,
          flags: new Set([...m.flags, "\\Recent"]),
          internalDate: m.internalDate,
          source: m.source,
        }));
      },
      async search(query) {
        const id = query.header["message-id"];
        return (selected?.messages ?? [])
          .filter((m) => headerOf(m.source, "Message-ID") === id)
          .map((m) => m.uid);
      },
    };
  };

  const api: GreenMailApi = {
    async users() {
      return [...accounts.keys()].map((email) => ({ email, login: email }));
    },
    async inbox(email) {
      return (accounts.get(email)?.get("INBOX")?.messages ?? []).map((m) => ({
        messageId: headerOf(m.source, "Message-ID"),
        subject: headerOf(m.source, "Subject"),
      }));
    },
    async deleteUser(email) {
      calls.push(`api delete ${email}`);
      accounts.delete(email);
    },
    async createUser(user) {
      calls.push(`api create ${user.email} ${user.login} ${user.password}`);
      createAccount(user.email);
    },
  };

  return { accounts, createAccount, add, client, api, calls };
}

const deliveries = readJson<DeliveryEntry[]>(join(FIXTURES, personaPathsMvp2("maria").deliveries));
const byId = (id: string) => deliveries.find((d) => d.id === id) as DeliveryEntry;

function setup(options?: { keepUidValidity?: boolean }) {
  const server = fakeMailServer(options);
  server.createAccount(MARIA);
  server.createAccount(PERSONA_ADDRESSES.tom);
  const open = async (persona: Persona) => server.client(PERSONA_ADDRESSES[persona]);
  return { server, open };
}

describe("seed deliver", () => {
  it("delivers a step's batch to Maria's Inbox, unread and dated now minus minutesAgo", async () => {
    const { server, open } = setup();
    const delivered = await deliver({ fixturesDir: FIXTURES, targets: ["S2"], now: NOW, open });
    const batch = deliveries.filter((d) => d.step === "S2");
    expect(delivered.map((d) => d.id)).toEqual(batch.map((d) => d.id));
    expect(delivered.map((d) => d.id)).not.toContain("zurich-2");
    const inbox = server.accounts.get(MARIA)?.get("INBOX")?.messages ?? [];
    expect(inbox.map((m) => headerOf(m.source, "Message-ID"))).toEqual(
      batch.map((d) => d.messageId),
    );
    batch.forEach((d, i) => {
      const m = inbox[i] as StoredMessage;
      const date = new Date(Math.floor((NOW.getTime() - d.minutesAgo * 60_000) / 1000) * 1000);
      expect([...m.flags]).toEqual([]);
      expect(m.internalDate).toEqual(date);
      expect(Date.parse(headerOf(m.source, "Date") as string)).toBe(date.getTime());
      expect(m.source.toString("latin1")).toContain("\r\n\r\n");
    });
    expect(server.accounts.get(PERSONA_ADDRESSES.tom)?.get("INBOX")?.messages).toEqual([]);
    expect(server.calls.filter((c) => c.endsWith("logout"))).toEqual([`${MARIA} logout`]);
  });

  it("delivers one message by its id, and refuses to deliver it twice", async () => {
    const { server, open } = setup();
    await deliver({ fixturesDir: FIXTURES, targets: ["zurich-2"], now: NOW, open });
    const inbox = server.accounts.get(MARIA)?.get("INBOX")?.messages ?? [];
    expect(inbox.map((m) => headerOf(m.source, "Message-ID"))).toEqual([
      byId("zurich-2").messageId,
    ]);
    await expect(
      deliver({ fixturesDir: FIXTURES, targets: ["zurich-2"], now: NOW, open }),
    ).rejects.toThrow(/already in maria's Inbox/);
    expect(inbox).toHaveLength(1);
  });

  it("names the ids and steps it knows for an unknown target, touching nothing", async () => {
    const { server, open } = setup();
    const attempt = deliver({
      fixturesDir: FIXTURES,
      targets: ["berlin-de", "nope"],
      now: NOW,
      open,
    });
    await expect(attempt).rejects.toBeInstanceOf(SeedError);
    await expect(attempt).rejects.toThrow(
      /Nothing to deliver for "nope". Ids: berlin-de, .*steps: S2, S5/,
    );
    expect(server.calls).toEqual([]);
  });
});

/** A draft as packages/mail saves one: a threaded reply with a text part and a CV attached. */
function draftSource(inReplyTo: string, cv: Buffer, filename: string): Buffer {
  const b = "=_draft_boundary";
  return Buffer.from(
    [
      "Message-ID: <draft-1@jobfilly.example>",
      `From: "Maria Santos" <${MARIA}>`,
      "To: Lena Hoffmann <lena.hoffmann@kiezwerk.example>",
      "Subject: =?UTF-8?B?UmU6IFNlbmlvciBCYWNrZW5kLUVudHdpY2tsZXJpbg==?=",
      `In-Reply-To: ${inReplyTo}`,
      `References: <earlier@kiezwerk.example>\r\n ${inReplyTo}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${b}"`,
      "",
      `--${b}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Hallo Frau Hoffmann,=0A=0Avielen Dank f=C3=BCr Ihre Nachricht.",
      `--${b}`,
      `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document; name="${filename}"`,
      `Content-Disposition: attachment; filename="${filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      ...(cv.toString("base64").match(/.{1,76}/g) ?? []),
      `--${b}--`,
      "",
    ].join("\r\n"),
    "latin1",
  );
}

describe("seed inspect drafts", () => {
  const cv = readJson<CvFixture[]>(join(FIXTURES, personaPathsMvp2("maria").cvList)).find(
    (c) => c.name === "Backend (DE)",
  ) as CvFixture;
  const cvBytes = readFileSync(join(FIXTURES, personaPathsMvp2("maria").cvs, cv.file));

  it("shows each draft's threading, flags, text and attachment", async () => {
    const { server, open } = setup();
    const client = await open("maria");
    await client.mailboxCreate("Drafts");
    const berlin = byId("berlin-de").messageId;
    server.add(MARIA, "Drafts", draftSource(berlin, cvBytes, cv.file), ["\\Draft", "\\Seen"], NOW);
    const report = await inspectDrafts("maria", await open("maria"));
    expect(report.folder).toBe("Drafts");
    expect(report.drafts).toEqual([
      {
        uid: 1,
        messageId: "<draft-1@jobfilly.example>",
        inReplyTo: berlin,
        references: ["<earlier@kiezwerk.example>", berlin],
        subject: "Re: Senior Backend-Entwicklerin",
        from: `"Maria Santos" <${MARIA}>`,
        to: "Lena Hoffmann <lena.hoffmann@kiezwerk.example>",
        flags: ["\\Draft", "\\Recent", "\\Seen"],
        draft: true,
        text: "Hallo Frau Hoffmann,\n\nvielen Dank für Ihre Nachricht.",
        attachments: [
          {
            filename: cv.file,
            contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size: cvBytes.length,
            sha256: cv.contentHash,
          },
        ],
      },
    ]);
  });

  it("finds the Drafts folder by its \\Drafts mark, and reports none before it exists", async () => {
    const { server, open } = setup();
    expect(await inspectDrafts("maria", await open("maria"))).toEqual({
      persona: "maria",
      folder: null,
      drafts: [],
    });
    server.accounts.get(MARIA)?.set("Entwürfe", {
      uidValidity: 5n,
      nextUid: 1,
      specialUse: "\\Drafts",
      messages: [],
    });
    expect((await inspectDrafts("maria", await open("maria"))).folder).toBe("Entwürfe");
  });
});

describe("seed inspect smtp", () => {
  const accounts = { maria: MARIA, tom: PERSONA_ADDRESSES.tom };

  it("shows nothing while the mailboxes hold only what the seed put there", async () => {
    const { server, open } = setup();
    await deliver({ fixturesDir: FIXTURES, targets: ["S2"], now: NOW, open });
    expect(server.accounts.get(MARIA)?.get("INBOX")?.messages.length).toBeGreaterThan(5);
    expect(await inspectSmtp(FIXTURES, accounts, server.api)).toEqual({ messages: [] });
  });

  it("shows mail sent to an outside address and mail in a persona's Inbox the seed didn't add", async () => {
    const { server, open } = setup();
    await deliver({ fixturesDir: FIXTURES, targets: ["berlin-de"], now: NOW, open });
    const sent = Buffer.from("Message-ID: <sent-1@x.example>\r\nSubject: Re: Hi\r\n\r\nHello\r\n");
    server.createAccount("lena.hoffmann@kiezwerk.example");
    server.add("lena.hoffmann@kiezwerk.example", "INBOX", sent, [], NOW);
    const bcc = Buffer.from("Message-ID: <sent-2@x.example>\r\nSubject: Copy\r\n\r\nHello\r\n");
    server.add(MARIA, "INBOX", bcc, [], NOW);
    expect(await inspectSmtp(FIXTURES, accounts, server.api)).toEqual({
      messages: [
        { account: MARIA, messageId: "<sent-2@x.example>", subject: "Copy" },
        {
          account: "lena.hoffmann@kiezwerk.example",
          messageId: "<sent-1@x.example>",
          subject: "Re: Hi",
        },
      ],
    });
  });
});

describe("seed reset-uidvalidity", () => {
  it("recreates the account and appends every folder back with flags and dates", async () => {
    const { server, open } = setup();
    await deliver({ fixturesDir: FIXTURES, targets: ["S2"], now: NOW, open });
    const maria = server.accounts.get(MARIA) as Map<string, Folder>;
    const sent = Buffer.from("Message-ID: <reply@inbox.example>\r\nSubject: Re\r\n\r\nx\r\n");
    await (await open("maria")).mailboxCreate("Sent");
    await (await open("maria")).mailboxCreate("Drafts");
    server.add(MARIA, "Sent", sent, ["\\Seen"], new Date("2026-10-01T00:00:00Z"));
    server.add(
      MARIA,
      "Drafts",
      draftSource("<m@x>", Buffer.from("cv"), "cv.pdf"),
      ["\\Draft"],
      NOW,
    );
    const before = new Map(
      [...maria].map(([path, f]) => [path, { ...f, messages: [...f.messages] }] as const),
    );

    const result = await resetUidValidity({
      persona: "maria",
      account: ACCOUNTS.maria,
      open: () => open("maria"),
      api: server.api,
    });

    const after = server.accounts.get(MARIA) as Map<string, Folder>;
    expect(result.before).toBe(String(before.get("INBOX")?.uidValidity));
    expect(result.after).toBe(String(after.get("INBOX")?.uidValidity));
    expect(result.after).not.toBe(result.before);
    expect(result.folders).toEqual([
      { path: "INBOX", messages: before.get("INBOX")?.messages.length },
      { path: "Sent", messages: 1 },
      { path: "Drafts", messages: 1 },
    ]);
    for (const [path, old] of before) {
      const now = after.get(path) as Folder;
      expect(now.uidValidity, path).not.toBe(old.uidValidity);
      expect(now.messages.map((m) => [m.source, [...m.flags].sort(), m.internalDate])).toEqual(
        old.messages.map((m) => [m.source, [...m.flags].sort(), m.internalDate]),
      );
    }
    expect(server.calls).toContain(`api delete ${MARIA}`);
    expect(server.calls).toContain(`api create ${MARIA} ${MARIA} ${ACCOUNTS.maria.password}`);
    expect(server.accounts.get(PERSONA_ADDRESSES.tom)).toBeDefined();
  });

  it("fails when the server kept the Inbox's UIDVALIDITY", async () => {
    const { server, open } = setup({ keepUidValidity: true });
    await expect(
      resetUidValidity({
        persona: "maria",
        account: ACCOUNTS.maria,
        open: () => open("maria"),
        api: server.api,
      }),
    ).rejects.toThrow(/kept UIDVALIDITY 1000/);
  });
});

describe("the seed's commands", () => {
  function deps() {
    const { server, open } = setup();
    const out: string[] = [];
    const err: string[] = [];
    const d: SeedDeps = {
      fixturesDir: FIXTURES,
      now: () => NOW,
      open,
      api: server.api,
      print: (t) => out.push(t),
      error: (t) => err.push(t),
    };
    return { d, out, err, server };
  }

  it("deliver prints what it delivered", async () => {
    const { d, out } = deps();
    expect(await main(["deliver", "berlin-de", "dublin"], d)).toBe(0);
    expect(out).toEqual([
      `Delivered berlin-de to maria's Inbox: ${byId("berlin-de").messageId}`,
      `Delivered dublin to maria's Inbox: ${byId("dublin").messageId}`,
    ]);
  });

  it("inspect drafts and inspect smtp print JSON", async () => {
    const { d, out } = deps();
    expect(await main(["inspect", "drafts", "maria"], d)).toBe(0);
    expect(await main(["inspect", "smtp"], d)).toBe(0);
    expect(out.map((o) => JSON.parse(o))).toEqual([
      { persona: "maria", folder: null, drafts: [] },
      { messages: [] },
    ]);
  });

  it("reset-uidvalidity says how the Inbox's UIDVALIDITY changed", async () => {
    const { d, out } = deps();
    expect(await main(["reset-uidvalidity", "tom"], d)).toBe(0);
    expect(out[0]).toMatch(/^Reset tom's UIDVALIDITY: Inbox \d+ -> \d+$/);
  });

  it("prints a SeedError's message and exits 1", async () => {
    const { d, err } = deps();
    expect(await main(["deliver", "nope"], d)).toBe(1);
    expect(err[0]).toMatch(/^Nothing to deliver for "nope"/);
  });

  it.each([
    [[]],
    [["deliver"]],
    [["inspect", "drafts"]],
    [["inspect", "imap"]],
    [["reset-uidvalidity"]],
  ])("shows the usage for %j and exits 2", async (args) => {
    const { d, err } = deps();
    expect(await main(args, d)).toBe(2);
    expect(err[0]).toMatch(/^Usage:\n {2}seed load <persona>\n {2}seed deliver/);
  });

  it("names the known personas for an unknown one", async () => {
    const { d, err } = deps();
    expect(await main(["inspect", "drafts", "nobody"], d)).toBe(2);
    expect(err).toEqual(['Unknown persona "nobody". Known: maria, tom']);
  });
});
