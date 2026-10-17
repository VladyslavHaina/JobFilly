import { EnvelopeSchema, type MailConnection } from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { mailClientWith } from "./client";
import { type FakeMailbox, fakeServer } from "./fake-session";
import { MESSAGE_SOURCE_BYTES } from "./parse";
import { MAIL_PRESETS } from "./presets";

// The mail client against a hand-written double of the IMAP session: no mailbox is reached.

const PASSWORD = "E2E-SECRET-maria-imap";
const conn: MailConnection = {
  host: "imap.example",
  port: 993,
  tlsMode: "tls",
  username: "maria",
  password: PASSWORD,
};
const secure = { allowInsecure: false, address: "maria.santos@inbox.example" };

const full = `Message-ID: <recruiter-1@agency.example>
Date: Mon, 28 Sep 2026 08:15:00 +0000
From: Lena Vogel <lena.vogel@agency.example>
To: Maria Santos <maria.santos@inbox.example>, team@inbox.example
Cc: "Boss, The" <boss@agency.example>
Reply-To: jobs@agency.example
In-Reply-To: <earlier@inbox.example>
References: <first@inbox.example>
 <earlier@inbox.example>
Subject: Backend Engineer (Go) - Berlin
List-Id: Agency jobs <jobs.agency.example>
List-Unsubscribe: <mailto:unsubscribe@agency.example>
Precedence: bulk
Auto-Submitted: auto-generated
Content-Type: text/plain; charset=utf-8

Hi Maria,

${"I'm hiring a backend engineer for a client in Berlin. ".repeat(10)}
BODYSENTINEL-1
`;

const htmlOnly = `Message-ID: <alert-1@jobs.example>
Date: Tue, 29 Sep 2026 09:00:00 +0000
From: alerts@jobs.example
To: maria.santos@inbox.example
Subject: 3 new jobs
Content-Type: text/html; charset=utf-8

<html><body><h1>New jobs</h1><p>Go developer &amp; <b>Berlin</b></p><script>alert(1)</script></body></html>
`;

const noId = `Date: Wed, 30 Sep 2026 10:00:00 +0000
From: someone@else.example
Subject: no id

hello\u0007 there\u200b
`;

function mailbox(extra: Partial<FakeMailbox> = {}): FakeMailbox {
  return {
    folders: [
      { path: "INBOX", name: "INBOX", specialUse: "\\Inbox" },
      { path: "Archive/Gesendet", name: "Gesendet", specialUse: "\\Sent" },
      { path: "Drafts", name: "Drafts", specialUse: "\\Drafts" },
    ],
    contents: {
      INBOX: {
        uidValidity: 7,
        messages: [
          { uid: 1, internalDate: new Date("2026-09-28T08:15:05Z"), source: full },
          { uid: 2, internalDate: new Date("2026-09-29T09:00:05Z"), source: htmlOnly },
          { uid: 3, internalDate: new Date("2026-09-30T10:00:05Z"), source: noId },
          { uid: 4, internalDate: new Date("2026-06-01T10:00:00Z"), source: noId },
        ],
      },
      "Archive/Gesendet": { uidValidity: 9, messages: [] },
    },
    ...extra,
  };
}

describe("presets (F2.1, F2.2)", () => {
  it("fill host, port and TLS for each provider, and leave them to the user for Other IMAP", () => {
    const byId = Object.fromEntries(MAIL_PRESETS.map((p) => [p.id, p]));
    expect(byId.gmail).toMatchObject({ host: "imap.gmail.com", port: 993, tlsMode: "tls" });
    expect(byId.icloud).toMatchObject({ host: "imap.mail.me.com", port: 993, tlsMode: "tls" });
    expect(byId.other).toMatchObject({ host: "", needsAppPassword: false, helpUrl: null });
    expect(MAIL_PRESETS.map((p) => p.id)).toEqual([
      "gmail",
      "icloud",
      "yahoo",
      "fastmail",
      "gmx",
      "webde",
      "other",
    ]);
  });

  it("say which providers need an app password, and link to each provider's help", () => {
    const appPassword = MAIL_PRESETS.filter((p) => p.needsAppPassword).map((p) => p.id);
    expect(appPassword).toEqual(["gmail", "icloud", "yahoo", "fastmail"]);
    for (const p of MAIL_PRESETS.filter((p) => p.id !== "other")) {
      expect(p.host, p.id).not.toBe("");
      expect(p.helpUrl, p.id).toMatch(/^https:\/\//);
    }
  });
});

describe("test (F2.1)", () => {
  it("lists Inbox and the Sent folder found by its special-use flag", async () => {
    const server = fakeServer(mailbox());
    const client = mailClientWith(conn, secure, server.factory);
    expect(await client.test()).toEqual({
      ok: true,
      folders: ["INBOX", "Archive/Gesendet"],
      sentPath: "Archive/Gesendet",
    });
    await client.close();
    expect(server.calls).toEqual(["connect", "list", "logout"]);
  });

  it("finds Sent by name when no folder is marked", async () => {
    const server = fakeServer(
      mailbox({
        folders: [
          { path: "INBOX", name: "INBOX", specialUse: null },
          { path: "INBOX.Sent Items", name: "Sent Items", specialUse: null },
        ],
      }),
    );
    expect(await mailClientWith(conn, secure, server.factory).test()).toMatchObject({
      ok: true,
      sentPath: "INBOX.Sent Items",
    });
  });

  it("reports no Sent folder when there is none", async () => {
    const server = fakeServer(
      mailbox({ folders: [{ path: "INBOX", name: "INBOX", specialUse: null }] }),
    );
    expect(await mailClientWith(conn, secure, server.factory).test()).toEqual({
      ok: true,
      folders: ["INBOX"],
      sentPath: null,
    });
  });

  it.each([
    [
      "wrong_password",
      Object.assign(new Error(`LOGIN maria ${PASSWORD} failed`), { authenticationFailed: true }),
    ],
    [
      "unreachable",
      Object.assign(new Error(`connect ECONNREFUSED for ${PASSWORD}`), { code: "ECONNREFUSED" }),
    ],
    ["unreachable", Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" })],
    [
      // imapflow's words for a server that never greets; its code says what happened.
      "unreachable",
      Object.assign(
        new Error("Failed to receive greeting from server in required time. Maybe should use TLS?"),
        { code: "GREETING_TIMEOUT" },
      ),
    ],
    [
      "tls",
      Object.assign(new Error("wrong version number"), { code: "ERR_SSL_WRONG_VERSION_NUMBER" }),
    ],
    ["tls", Object.assign(new Error("self-signed"), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" })],
    ["tls", new Error("Server does not support STARTTLS")],
  ])("fails as %s with a plain reason that never holds the password", async (reason, error) => {
    const server = fakeServer(mailbox({ connectError: error }));
    const result = await mailClientWith(conn, secure, server.factory).test();
    // The error's own code comes along for the server's log; a failure without one has none.
    const code = (error as { code?: string }).code;
    expect(result).toEqual({
      ok: false,
      reason,
      message: expect.any(String),
      ...(code ? { code } : {}),
    });
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
    expect(JSON.stringify(result)).not.toContain("LOGIN");
  });
});

describe("plain-text IMAP (F2.4)", () => {
  const plain = { ...conn, tlsMode: "none" as const, port: 143 };

  it("is refused without allowInsecure, before any connection is made", async () => {
    const server = fakeServer(mailbox());
    const client = mailClientWith(plain, { ...secure, allowInsecure: false }, server.factory);
    expect(await client.test()).toEqual({
      ok: false,
      reason: "insecure_refused",
      message: expect.stringContaining("Plain-text IMAP is turned off"),
    });
    await expect(
      client.fetchEnvelopes({ folder: "inbox", since: new Date("2026-07-01T00:00:00Z") }),
    ).rejects.toMatchObject({ reason: "insecure_refused" });
    expect(server.sessions).toBe(0);
  });

  it("is allowed with allowInsecure", async () => {
    const server = fakeServer(mailbox());
    const result = await mailClientWith(
      plain,
      { ...secure, allowInsecure: true },
      server.factory,
    ).test();
    expect(result.ok).toBe(true);
  });
});

describe("fetchEnvelopes", () => {
  const since = new Date("2026-07-02T00:00:00Z");

  it("returns every Envelope field, newest first, within the date window", async () => {
    const server = fakeServer(mailbox());
    const client = mailClientWith(conn, secure, server.factory);
    const envelopes = await client.fetchEnvelopes({ folder: "inbox", since });
    for (const e of envelopes) expect(EnvelopeSchema.parse(e)).toEqual(e);
    expect(envelopes.map((e) => e.uid)).toEqual([3, 2, 1]);
    expect(envelopes[2]).toEqual({
      messageId: "<recruiter-1@agency.example>",
      folder: "inbox",
      folderPath: "INBOX",
      uidValidity: 7,
      uid: 1,
      date: "2026-09-28T08:15:00.000Z",
      from: { address: "lena.vogel@agency.example", name: "Lena Vogel" },
      to: [
        { address: "maria.santos@inbox.example", name: "Maria Santos" },
        { address: "team@inbox.example", name: null },
      ],
      cc: [{ address: "boss@agency.example", name: "Boss, The" }],
      replyTo: [{ address: "jobs@agency.example", name: null }],
      inReplyTo: "<earlier@inbox.example>",
      references: ["<first@inbox.example>", "<earlier@inbox.example>"],
      subject: "Backend Engineer (Go) - Berlin",
      listId: "Agency jobs <jobs.agency.example>",
      listUnsubscribe: "<mailto:unsubscribe@agency.example>",
      precedence: "bulk",
      autoSubmitted: "auto-generated",
      snippet: expect.stringMatching(/^Hi Maria, I'm hiring a backend engineer/),
    });
    expect(envelopes[2]?.snippet.length).toBe(200);
    expect(envelopes.map((e) => e.snippet).join(" ")).not.toContain("BODYSENTINEL");
    // Only the start of each message is fetched for its envelope.
    expect(server.calls).toContain("fetch 1,2,3 max 65536");
  });

  it("derives the snippet of an HTML-only message from its text, without markup", async () => {
    const server = fakeServer(mailbox());
    const [, alert] = await mailClientWith(conn, secure, server.factory).fetchEnvelopes({
      folder: "inbox",
      since,
    });
    expect(alert?.messageId).toBe("<alert-1@jobs.example>");
    expect(alert?.snippet).toContain("Go developer & Berlin");
    expect(alert?.snippet).not.toMatch(/<|alert\(1\)/);
  });

  it("gives a message without a Message-ID the stable synthetic one", async () => {
    const server = fakeServer(mailbox());
    const [newest] = await mailClientWith(conn, secure, server.factory).fetchEnvelopes({
      folder: "inbox",
      since,
    });
    expect(newest?.messageId).toMatch(/^<inbox\.[0-9a-f]{32}@jobfilly\.invalid>$/);
    expect(newest?.snippet).toBe("hello there");
  });

  it("reads Sent from the folder the server marks as Sent", async () => {
    const box = mailbox();
    box.contents["Archive/Gesendet"]?.messages.push({
      uid: 5,
      internalDate: new Date("2026-09-20T10:00:00Z"),
      source: full.replace("<recruiter-1@agency.example>", "<reply-1@inbox.example>"),
    });
    const server = fakeServer(box);
    const sent = await mailClientWith(conn, secure, server.factory).fetchEnvelopes({
      folder: "sent",
      since,
    });
    expect(sent).toMatchObject([
      {
        messageId: "<reply-1@inbox.example>",
        folder: "sent",
        folderPath: "Archive/Gesendet",
        uidValidity: 9,
      },
    ]);
  });

  it("fails with a plain reason when the server drops the connection", async () => {
    const server = fakeServer(
      mailbox({ connectError: Object.assign(new Error(PASSWORD), { code: "ECONNRESET" }) }),
    );
    const error = await mailClientWith(conn, secure, server.factory)
      .fetchEnvelopes({ folder: "inbox", since })
      .catch((e: Error) => e);
    expect(error).toMatchObject({ name: "MailError", reason: "unreachable", code: "ECONNRESET" });
    expect(String((error as Error).message)).not.toContain(PASSWORD);
  });
});

describe("fetchBody", () => {
  it("returns the plain text of a text message", async () => {
    const server = fakeServer(mailbox());
    const body = await mailClientWith(conn, secure, server.factory).fetchBody({
      folderPath: "INBOX",
      uidValidity: 7,
      uid: 1,
    });
    expect(body?.text).toMatch(/^Hi Maria,\n\nI'm hiring/);
    expect(body?.text).toContain("BODYSENTINEL-1");
    // Bounded, so one huge message can't exhaust the memory.
    expect(server.calls).toContain(`fetch 1 max ${MESSAGE_SOURCE_BYTES}`);
  });

  it("returns sanitised text derived from an HTML-only message", async () => {
    const server = fakeServer(mailbox());
    const body = await mailClientWith(conn, secure, server.factory).fetchBody({
      folderPath: "INBOX",
      uidValidity: 7,
      uid: 2,
    });
    expect(body?.text).toContain("Go developer & Berlin");
    expect(body?.text).not.toMatch(/<\/?[a-z]+|alert\(1\)/i);
  });

  it("removes control and invisible characters", async () => {
    const server = fakeServer(mailbox());
    const body = await mailClientWith(conn, secure, server.factory).fetchBody({
      folderPath: "INBOX",
      uidValidity: 7,
      uid: 3,
    });
    expect(body).toEqual({ text: "hello there" });
  });

  it("returns null when the folder's UIDVALIDITY changed", async () => {
    const server = fakeServer(mailbox());
    const client = mailClientWith(conn, secure, server.factory);
    expect(await client.fetchBody({ folderPath: "INBOX", uidValidity: 6, uid: 1 })).toBeNull();
    expect(server.calls.some((c) => c.startsWith("fetch"))).toBe(false);
  });

  it("connects again once when the server dropped the connection, and reads on", async () => {
    const server = fakeServer(mailbox());
    const client = mailClientWith(conn, secure, server.factory);
    await client.fetchBody({ folderPath: "INBOX", uidValidity: 7, uid: 1 });
    // The server closed the idle connection (GreenMail does after about 30 s).
    server.drop();
    const body = await client.fetchBody({ folderPath: "INBOX", uidValidity: 7, uid: 2 });
    expect(body?.text).toContain("Go developer & Berlin");
    expect(server.sessions).toBe(2);
    expect(server.calls.filter((c) => c === "connect")).toHaveLength(2);
  });

  it("returns null when the message is gone", async () => {
    const server = fakeServer(mailbox());
    const client = mailClientWith(conn, secure, server.factory);
    expect(await client.fetchBody({ folderPath: "INBOX", uidValidity: 7, uid: 99 })).toBeNull();
  });
});
