import net from "node:net";
import tls from "node:tls";
import type { DraftMailInput, MailConnection, OriginalMessage } from "@jobfilly/schema";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MailUnavailableError, mailClientWith } from "./client";
import { buildDraftMime, threadReferences } from "./drafts/index";
import { type FakeMailbox, fakeServer } from "./fake-session";

// Drafts in the mailbox (F6.3, F6.4, F6.6), against the hand-written double of the IMAP session:
// the MIME message as MailComposer builds it, the Drafts folder found or created, a draft saved
// with \Draft, replaced leaving one copy, and deleted, also after the folder was rebuilt. Nothing
// is ever sent.

const conn: MailConnection = {
  host: "imap.example",
  port: 993,
  tlsMode: "tls",
  username: "maria.santos@inbox.example",
  password: "E2E-SECRET-maria-imap",
};
const secure = { allowInsecure: false };

const original: OriginalMessage = {
  messageId: "<berlin-1@agency.example>",
  references: ["<first@agency.example>", "<maria-1@inbox.example>"],
  inReplyTo: "<maria-1@inbox.example>",
  subject: "Backend Engineer (Go) - Berlin",
  from: { address: "lena.vogel@agency.example", name: "Lena Vogel" },
  date: "2026-10-12T08:15:00.000Z",
  text: "Hallo Maria,\n\nbitte schicken Sie mir Ihren Lebenslauf.\n\nBODYSENTINEL-7",
};

const CV = new Uint8Array(Buffer.from("%PDF-1.4 a CV"));

const input = (overrides: Partial<DraftMailInput> = {}): DraftMailInput => ({
  original,
  reply: { subject: "Re: Backend Engineer (Go) - Berlin", body: "Hallo Lena,\n\ngerne." },
  attachment: { fileName: "Backend (DE).pdf", contentType: "application/pdf", bytes: CV },
  ...overrides,
});

function mailbox(extra: Partial<FakeMailbox> = {}): FakeMailbox {
  return {
    folders: [
      { path: "INBOX", name: "INBOX", specialUse: "\\Inbox" },
      { path: "[Gmail]/Entwürfe", name: "Entwürfe", specialUse: "\\Drafts" },
      { path: "Drafts", name: "Drafts", specialUse: null },
    ],
    contents: {
      INBOX: { uidValidity: 7, messages: [] },
      "[Gmail]/Entwürfe": { uidValidity: 30, messages: [] },
      Drafts: { uidValidity: 31, messages: [] },
    },
    ...extra,
  };
}

const parse = (source: string | Buffer) => simpleParser(source);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildDraftMime (F6.3)", () => {
  it("threads the reply to the original, quotes it and attaches the CV", async () => {
    const mime = await buildDraftMime({
      ...input(),
      from: { address: "maria.santos@inbox.example", name: null },
      messageId: "<draft-1@inbox.example>",
      date: new Date("2026-10-15T09:00:00Z"),
    });
    const text = mime.toString();
    expect(text).toMatch(/\r\n\r\n/);
    expect(text).not.toMatch(/[^\r]\n/);
    const mail = await parse(mime);
    expect(mail.messageId).toBe("<draft-1@inbox.example>");
    expect(mail.inReplyTo).toBe("<berlin-1@agency.example>");
    expect(mail.references).toEqual([
      "<first@agency.example>",
      "<maria-1@inbox.example>",
      "<berlin-1@agency.example>",
    ]);
    expect(mail.subject).toBe("Re: Backend Engineer (Go) - Berlin");
    expect(mail.from?.value).toEqual([{ address: "maria.santos@inbox.example", name: "" }]);
    expect(mail.to).toMatchObject({ value: [{ address: "lena.vogel@agency.example" }] });
    expect(mail.date?.toISOString()).toBe("2026-10-15T09:00:00.000Z");
    expect(mail.text).toBe(
      [
        "Hallo Lena,",
        "",
        "gerne.",
        "",
        "2026-10-12 08:15 UTC, Lena Vogel <lena.vogel@agency.example>:",
        "> Hallo Maria,",
        ">",
        "> bitte schicken Sie mir Ihren Lebenslauf.",
        ">",
        "> BODYSENTINEL-7",
        "",
      ].join("\n"),
    );
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments[0]).toMatchObject({
      filename: "Backend (DE).pdf",
      contentType: "application/pdf",
    });
    expect(Buffer.from(mail.attachments[0]?.content ?? []).equals(Buffer.from(CV))).toBe(true);
    expect(text).not.toMatch(/X-Mailer/i);
  });

  it("has no attachment when none is given, and its own subject when the reply has none", async () => {
    const mail = await parse(
      await buildDraftMime({
        ...input({ attachment: null, reply: { subject: "", body: "Hi" } }),
        from: null,
        messageId: "<d@x.example>",
        date: new Date(),
      }),
    );
    expect(mail.attachments).toEqual([]);
    expect(mail.subject).toBe("Re: Backend Engineer (Go) - Berlin");
    expect(mail.from).toBeUndefined();
  });

  it("doesn't thread to a Message-ID packages/mail made up", () => {
    expect(
      threadReferences({ ...original, messageId: "<inbox.7.3@jobfilly.invalid>", references: [] }),
    ).toEqual([]);
    expect(threadReferences({ ...original, references: [original.messageId] })).toEqual([
      original.messageId,
    ]);
  });
});

describe("ensureDraftsFolder", () => {
  it("finds the Drafts folder by its special use first", async () => {
    const client = mailClientWith(conn, secure, fakeServer(mailbox()).factory);
    expect(await client.ensureDraftsFolder()).toEqual({ path: "[Gmail]/Entwürfe" });
  });

  it("finds it by name when no folder is marked", async () => {
    const box = mailbox({
      folders: [
        { path: "INBOX", name: "INBOX", specialUse: "\\Inbox" },
        { path: "INBOX.Drafts", name: "Drafts", specialUse: null },
      ],
    });
    const server = fakeServer(box);
    expect(await mailClientWith(conn, secure, server.factory).ensureDraftsFolder()).toEqual({
      path: "INBOX.Drafts",
    });
    expect(server.calls.some((c) => c.startsWith("create"))).toBe(false);
  });

  it("creates it when the mailbox has none, and saves into it", async () => {
    const box = mailbox({
      folders: [{ path: "INBOX", name: "INBOX", specialUse: "\\Inbox" }],
      contents: { INBOX: { uidValidity: 7, messages: [] } },
    });
    const server = fakeServer(box);
    const client = mailClientWith(conn, secure, server.factory);
    expect(await client.ensureDraftsFolder()).toEqual({ path: "Drafts" });
    await client.saveDraft(input());
    expect(server.calls.filter((c) => c.startsWith("create"))).toEqual(["create Drafts"]);
    expect(box.contents.Drafts?.messages).toHaveLength(1);
  });
});

describe("saveDraft (F6.3)", () => {
  it("appends the MIME message to Drafts with the \\Draft flag and returns where it is", async () => {
    const box = mailbox();
    const server = fakeServer(box);
    const ref = await mailClientWith(conn, secure, server.factory).saveDraft(input());
    expect(ref).toEqual({
      path: "[Gmail]/Entwürfe",
      uid: 1,
      uidValidity: 30,
      draftMessageId: expect.stringMatching(/^<[0-9a-f-]{36}@inbox\.example>$/),
    });
    const [saved] = box.contents["[Gmail]/Entwürfe"]?.messages ?? [];
    expect(saved?.flags).toEqual(["\\Draft"]);
    const mail = await parse(saved?.source ?? "");
    expect(mail.messageId).toBe(ref.draftMessageId);
    expect(mail.inReplyTo).toBe(original.messageId);
    expect(mail.references).toEqual([...original.references, original.messageId]);
    expect(mail.attachments.map((a) => a.filename)).toEqual(["Backend (DE).pdf"]);
    expect(mail.text).toContain("> bitte schicken Sie mir Ihren Lebenslauf.");
    // Only appended: no folder is opened for changes to save a draft.
    expect(server.calls.some((c) => c.startsWith("open-rw"))).toBe(false);
  });

  it("finds the UID by the draft's Message-ID when the server has no UIDPLUS", async () => {
    const box = mailbox({ noUidPlus: true });
    box.contents["[Gmail]/Entwürfe"]?.messages.push({
      uid: 4,
      internalDate: null,
      source: "Message-ID: <older@inbox.example>\n\nolder draft\n",
    });
    const ref = await mailClientWith(conn, secure, fakeServer(box).factory).saveDraft(input());
    expect(ref).toMatchObject({ uid: 5, uidValidity: 30 });
  });

  it("fails with MailUnavailableError when the server refuses the append or can't be reached", async () => {
    for (const box of [
      mailbox({ appendError: false }),
      mailbox({ appendError: Object.assign(new Error("NO [OVERQUOTA]"), { code: "NO" }) }),
      mailbox({ connectError: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }) }),
    ]) {
      const client = mailClientWith(conn, secure, fakeServer(box).factory);
      await expect(client.saveDraft(input())).rejects.toBeInstanceOf(MailUnavailableError);
      expect(box.contents["[Gmail]/Entwürfe"]?.messages).toEqual([]);
    }
  });
});

describe("replaceDraft and deleteDraft (F6.4)", () => {
  const drafts = (box: FakeMailbox) => box.contents["[Gmail]/Entwürfe"]?.messages ?? [];

  it("replaces a draft leaving exactly one copy, with the new text", async () => {
    const box = mailbox();
    const client = mailClientWith(conn, secure, fakeServer(box).factory);
    const first = await client.saveDraft(input());
    const second = await client.replaceDraft(
      first,
      input({ reply: { subject: "Re: Berlin", body: "Hallo Lena, neuer Text." } }),
    );
    expect(drafts(box)).toHaveLength(1);
    expect(second.uid).not.toBe(first.uid);
    expect(second.draftMessageId).not.toBe(first.draftMessageId);
    const mail = await parse(drafts(box)[0]?.source ?? "");
    expect(mail.text).toContain("neuer Text.");
    expect(mail.messageId).toBe(second.draftMessageId);
  });

  it("leaves one copy when a replace is retried after the append failed", async () => {
    const box = mailbox();
    const client = mailClientWith(conn, secure, fakeServer(box).factory);
    const first = await client.saveDraft(input());
    box.appendError = Object.assign(new Error("NO"), { code: "NO" });
    await expect(client.replaceDraft(first, input())).rejects.toBeInstanceOf(MailUnavailableError);
    box.appendError = undefined;
    await client.replaceDraft(first, input());
    expect(drafts(box)).toHaveLength(1);
  });

  it("deletes a draft, and a draft already gone is no error", async () => {
    const box = mailbox();
    const server = fakeServer(box);
    const client = mailClientWith(conn, secure, server.factory);
    const keep = await client.saveDraft(input());
    const ref = await client.saveDraft(input());
    await client.deleteDraft(ref);
    expect(drafts(box).map((m) => m.uid)).toEqual([keep.uid]);
    await client.deleteDraft(ref);
    expect(drafts(box).map((m) => m.uid)).toEqual([keep.uid]);
    expect(server.calls).toContain("open-rw [Gmail]/Entwürfe");
  });

  it("finds the draft by its Message-ID when the Drafts UIDVALIDITY changed", async () => {
    const box = mailbox();
    const client = mailClientWith(conn, secure, fakeServer(box).factory);
    const keep = await client.saveDraft(input());
    const ref = await client.saveDraft(input());
    // The folder is rebuilt: new UIDVALIDITY, UIDs renumbered, a third message whose header
    // merely contains the id.
    const folder = box.contents["[Gmail]/Entwürfe"];
    if (!folder) throw new Error("no drafts folder");
    folder.uidValidity = 99;
    folder.messages = folder.messages.map((m, i) => ({ ...m, uid: i + 10 }));
    folder.messages.push({
      uid: 20,
      internalDate: null,
      source: `Message-ID: <x${ref.draftMessageId.slice(1, -1)}x>\n\nnot it\n`,
    });
    await client.deleteDraft(ref);
    const left = await Promise.all(
      folder.messages.map(async (m) => (await parse(m.source)).messageId),
    );
    expect(left).toEqual([keep.draftMessageId, `<x${ref.draftMessageId.slice(1, -1)}x>`]);
  });

  it("fails with MailUnavailableError when the server can't be reached", async () => {
    const box = mailbox();
    const client = mailClientWith(conn, secure, fakeServer(box).factory);
    const ref = await client.saveDraft(input());
    const down = mailbox({ connectError: Object.assign(new Error("x"), { code: "ETIMEDOUT" }) });
    const other = mailClientWith(conn, secure, fakeServer(down).factory);
    await expect(other.deleteDraft(ref)).rejects.toBeInstanceOf(MailUnavailableError);
    await expect(other.replaceDraft(ref, input())).rejects.toBeInstanceOf(MailUnavailableError);
    await expect(other.ensureDraftsFolder()).rejects.toBeInstanceOf(MailUnavailableError);
  });
});

describe("nothing is sent (F6.6)", () => {
  it("never creates a transport or opens a socket while drafts are built, saved and replaced", async () => {
    const transports = vi.spyOn(nodemailer, "createTransport");
    const sockets = [
      vi.spyOn(net, "connect"),
      vi.spyOn(net, "createConnection"),
      vi.spyOn(tls, "connect"),
    ];
    const box = mailbox();
    const client = mailClientWith(conn, secure, fakeServer(box).factory);
    const ref = await client.saveDraft(input());
    await client.deleteDraft(await client.replaceDraft(ref, input()));
    await client.close();
    expect(transports).not.toHaveBeenCalled();
    for (const spy of sockets) expect(spy).not.toHaveBeenCalled();
  });
});
