import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type CvFixture,
  type DeliveryEntry,
  fixturesDir,
  PERSONA_ADDRESSES,
  personaPathsMvp2,
  readJson,
} from "../fixtures/format.ts";
import { MARIA_HOME_ADDRESS, MVP3_PATHS } from "../fixtures/format-mvp3.ts";
import { soakAnswers } from "../fixtures/soak.ts";
import { ACCOUNTS, EXTRA_ACCOUNTS, MAILBOX_ACCOUNTS, type MailboxName } from "./accounts.ts";
import {
  deliver,
  type FetchedMessage,
  inspectDrafts,
  inspectSent,
  inspectSmtp,
  type MailboxImap,
  resetUidValidity,
} from "./commands.ts";
import { generate } from "./generate.ts";
import type { GreenMailApi } from "./greenmail.ts";
import { SeedError } from "./load.ts";
import { main, type SeedDeps } from "./main.ts";

// MVP 2's and MVP 3's seed commands against doubles: an in-memory mail server with accounts,
// folders, UIDs and UIDVALIDITY, reachable through an imapflow-shaped client and a GreenMail-shaped
// API.

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

const sentDeliveries = readJson<DeliveryEntry[]>(join(FIXTURES, MVP3_PATHS.sentDeliveries));

function setup(options?: { keepUidValidity?: boolean }) {
  const server = fakeMailServer(options);
  for (const account of Object.values(MAILBOX_ACCOUNTS)) server.createAccount(account.user);
  const open = async (mailbox: MailboxName) => server.client(MAILBOX_ACCOUNTS[mailbox].user);
  return { server, open };
}

const idsIn = (server: ReturnType<typeof fakeMailServer>, user: string, folder: string) =>
  (server.accounts.get(user)?.get(folder)?.messages ?? []).map((m) =>
    headerOf(m.source, "Message-ID"),
  );

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

  it("delivers S1's mail to the Inbox and Maria's replies to Sent, read, creating Sent", async () => {
    const { server, open } = setup();
    const delivered = await deliver({ fixturesDir: FIXTURES, targets: ["S1"], now: NOW, open });
    const inbox = deliveries.filter((d) => d.step === "S1");
    expect(sentDeliveries.length).toBeGreaterThan(0);
    expect(delivered).toEqual([
      ...inbox.map((d) => ({
        persona: "maria",
        id: d.id,
        messageId: d.messageId,
        folder: "Inbox",
      })),
      ...sentDeliveries.map((d) => ({
        persona: "maria",
        id: d.id,
        messageId: d.messageId,
        folder: "Sent",
      })),
    ]);
    expect(idsIn(server, MARIA, "INBOX")).toEqual(inbox.map((d) => d.messageId));
    expect(idsIn(server, MARIA, "Sent")).toEqual(sentDeliveries.map((d) => d.messageId));
    expect(server.calls).toContain(`${MARIA} create Sent`);
    const sent = server.accounts.get(MARIA)?.get("Sent")?.messages ?? [];
    for (const m of sent) expect([...m.flags]).toEqual(["\\Seen"]);
  });

  it("delivers S6's threads to the Inbox, and refuses a reply already in Sent", async () => {
    const { server, open } = setup();
    await deliver({ fixturesDir: FIXTURES, targets: ["S6"], now: NOW, open });
    expect(idsIn(server, MARIA, "INBOX")).toEqual(
      deliveries.filter((d) => d.step === "S6").map((d) => d.messageId),
    );
    const reply = sentDeliveries[0] as DeliveryEntry;
    await deliver({ fixturesDir: FIXTURES, targets: [reply.id], now: NOW, open });
    await expect(
      deliver({ fixturesDir: FIXTURES, targets: [reply.id], now: NOW, open }),
    ).rejects.toThrow(/already in maria's Sent/);
    expect(idsIn(server, MARIA, "Sent")).toEqual([reply.messageId]);
  });
});

describe("seed inspect sent", () => {
  it("shows what the app filed in Sent, never what the seed put there", async () => {
    const { server, open } = setup();
    expect(await inspectSent(FIXTURES, "maria", await open("maria"))).toEqual({
      mailbox: "maria",
      folder: null,
      messages: [],
    });
    await deliver({ fixturesDir: FIXTURES, targets: ["S1"], now: NOW, open });
    expect((await inspectSent(FIXTURES, "maria", await open("maria"))).messages).toEqual([]);
    const berlin = byId("berlin-de").messageId;
    server.add(MARIA, "Sent", draftSource(berlin, Buffer.from("cv"), "cv.pdf"), ["\\Seen"], NOW);
    const report = await inspectSent(FIXTURES, "maria", await open("maria"));
    expect(report.folder).toBe("Sent");
    expect(report.messages).toEqual([
      expect.objectContaining({
        messageId: "<draft-1@jobfilly.example>",
        inReplyTo: berlin,
        text: "Hallo Frau Hoffmann,\n\nvielen Dank für Ihre Nachricht.",
        attachments: [expect.objectContaining({ filename: "cv.pdf" })],
      }),
    ]);
  });

  it("looks in the folder marked \\Sent of Maria's other mailboxes too", async () => {
    const { server, open } = setup();
    const home = EXTRA_ACCOUNTS["maria-home"].user;
    server.accounts.get(home)?.set("Gesendet", {
      uidValidity: 7n,
      nextUid: 1,
      specialUse: "\\Sent",
      messages: [],
    });
    const copy = Buffer.from("Message-ID: <sent-1@post.example>\r\nSubject: Re: Hi\r\n\r\nHi\r\n");
    server.add(home, "Gesendet", copy, ["\\Seen"], NOW);
    const report = await inspectSent(FIXTURES, "maria-home", await open("maria-home"));
    expect(report.folder).toBe("Gesendet");
    expect(report.messages.map((m) => m.messageId)).toEqual(["<sent-1@post.example>"]);
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

  it("leaves out the mail the seed loads into Maria's other mailboxes, and shows what came over SMTP", async () => {
    const { server } = setup();
    const home = readJson<{ messageId: string }[]>(join(FIXTURES, MVP3_PATHS.homeEnvelopes));
    for (const e of home) {
      server.add(
        MARIA_HOME_ADDRESS,
        "INBOX",
        Buffer.from(`Message-ID: ${e.messageId}\r\n\r\nx\r\n`),
        [],
        NOW,
      );
    }
    const gmail = EXTRA_ACCOUNTS["maria-gmail"].user;
    const sent = Buffer.from("Message-ID: <sent-3@x.example>\r\nSubject: Hi\r\n\r\nHi\r\n");
    server.add(gmail, "INBOX", sent, [], NOW);
    const all = Object.fromEntries(
      Object.entries(MAILBOX_ACCOUNTS).map(([name, account]) => [name, account.user]),
    );
    expect(await inspectSmtp(FIXTURES, all, server.api)).toEqual({
      messages: [{ account: gmail, messageId: "<sent-3@x.example>", subject: "Hi" }],
    });
  });

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

describe("seed generate", () => {
  function run(options: { perMinute: number; minutes: number | null; stopAfter?: number }) {
    const { server, open } = setup();
    let clock = NOW.getTime();
    const waits: number[] = [];
    const out: string[] = [];
    const result = generate({
      perMinute: options.perMinute,
      minutes: options.minutes,
      now: () => new Date(clock),
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
      stopped: () => options.stopAfter !== undefined && waits.length >= options.stopAfter,
      open,
      print: (t) => out.push(t),
    });
    return { result, server, waits, out };
  }

  it("appends n messages a minute to each persona's Inbox for m minutes, dated now", async () => {
    const { result, server, waits, out } = run({ perMinute: 2, minutes: 1.5 });
    expect(await result).toBe(3);
    expect(waits).toEqual([30_000, 30_000]);
    for (const user of [MARIA, PERSONA_ADDRESSES.tom]) {
      const inbox = server.accounts.get(user)?.get("INBOX")?.messages ?? [];
      expect(inbox).toHaveLength(3);
      expect(inbox.map((m) => m.internalDate.getTime())).toEqual(
        [0, 1, 2].map((i) => NOW.getTime() + i * 30_000),
      );
      for (const m of inbox) expect([...m.flags]).toEqual([]);
    }
    expect(out).toHaveLength(6);
    expect(out[0]).toMatch(/^Generated <soak-maria-[a-z0-9]+-1@isarwerk\.example> for maria$/);
  });

  it("names every message once, with a body sentinel, answered by the fake AI's templates", async () => {
    const { result, server } = run({ perMinute: 1, minutes: 2 });
    await result;
    const ids = [MARIA, PERSONA_ADDRESSES.tom].flatMap((u) => idsIn(server, u, "INBOX"));
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(soakAnswers(id as string), id as string).not.toBeNull();
    const [first] = server.accounts.get(MARIA)?.get("INBOX")?.messages ?? [];
    const text = first?.source.toString("utf8") ?? "";
    expect(text).toContain("BODYSENTINEL-soak-maria-");
    expect(text.indexOf("BODYSENTINEL-")).toBeGreaterThan(1000);
  });

  it("runs until stopped when no minutes are given", async () => {
    const { result, waits } = run({ perMinute: 6, minutes: null, stopAfter: 4 });
    expect(await result).toBe(4);
    expect(waits).toEqual([10_000, 10_000, 10_000, 10_000]);
  });
});

describe("the seed's commands", () => {
  function deps() {
    const { server, open } = setup();
    const out: string[] = [];
    const err: string[] = [];
    let stop = false;
    const d: SeedDeps = {
      fixturesDir: FIXTURES,
      now: () => NOW,
      open,
      api: server.api,
      print: (t) => out.push(t),
      error: (t) => err.push(t),
      sleep: async () => {
        stop = true;
      },
      stopped: () => stop,
    };
    return { d, out, err, server };
  }

  it("load maria-home loads Maria's personal mailbox into its own account", async () => {
    const { d, out, server } = deps();
    expect(await main(["load", "maria-home"], d)).toBe(0);
    const home = readJson<{ messageId: string }[]>(join(FIXTURES, MVP3_PATHS.homeEnvelopes));
    expect(out).toEqual([`Loaded maria-home: ${home.length} in Inbox, 0 in Sent`]);
    expect(idsIn(server, MARIA_HOME_ADDRESS, "INBOX").sort()).toEqual(
      home.map((e) => e.messageId).sort(),
    );
    expect(idsIn(server, MARIA, "INBOX")).toEqual([]);
  });

  it("deliver says which folder each message went to", async () => {
    const { d, out } = deps();
    const reply = sentDeliveries[0] as DeliveryEntry;
    expect(await main(["deliver", "munich-1", reply.id], d)).toBe(0);
    expect(out).toEqual([
      `Delivered munich-1 to maria's Inbox: ${byId("munich-1").messageId}`,
      `Delivered ${reply.id} to maria's Sent: ${reply.messageId}`,
    ]);
  });

  it("inspect sent prints JSON, and generate runs until it is stopped", async () => {
    const { d, out } = deps();
    expect(await main(["inspect", "sent", "maria-home"], d)).toBe(0);
    expect(JSON.parse(out[0] as string)).toEqual({
      mailbox: "maria-home",
      folder: null,
      messages: [],
    });
    expect(await main(["generate", "--per-minute", "1"], d)).toBe(0);
    expect(out.at(-1)).toBe("Generated 1 messages for each of maria, tom");
  });

  it.each([
    [["generate"]],
    [["generate", "--per-minute", "0"]],
    [["generate", "--per-minute", "2", "--minutes", "-1"]],
    [["generate", "--every", "2"]],
  ])("refuses generate %j with the usage", async (args) => {
    const { d, err } = deps();
    expect(await main(args, d)).toBe(2);
    expect(err[0]).toMatch(/seed generate --per-minute <n> \[--minutes <m>\]/);
  });

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
    expect(err[0]).toMatch(/^Usage:\n {2}seed load <mailbox>\n {2}seed deliver/);
  });

  it("names the known personas for an unknown one", async () => {
    const { d, err } = deps();
    expect(await main(["inspect", "drafts", "nobody"], d)).toBe(2);
    expect(err).toEqual(['Unknown persona "nobody". Known: maria, tom']);
  });

  it("names the known mailboxes for an unknown one", async () => {
    const { d, err } = deps();
    expect(await main(["inspect", "sent", "nobody"], d)).toBe(2);
    expect(err).toEqual(['Unknown mailbox "nobody". Known: maria, tom, maria-home, maria-gmail']);
  });
});
