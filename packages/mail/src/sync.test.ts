import {
  FetchSinceResultSchema,
  type MailConnection,
  OriginalMessageSchema,
} from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { MailUnavailableError, mailClientWith } from "./client";
import { type FakeMailbox, fakeServer } from "./fake-session";

// Continuous sync's reads (F1.1, F1.3) and the original a draft replies to (F6.3), against the
// hand-written double of the IMAP session: no mailbox is reached.

const PASSWORD = "E2E-SECRET-maria-imap";
const conn: MailConnection = {
  host: "imap.example",
  port: 993,
  tlsMode: "tls",
  username: "maria.santos@inbox.example",
  password: PASSWORD,
};
const secure = { allowInsecure: false, address: "maria.santos@inbox.example" };

const message = (id: number, extra = "") => `Message-ID: <role-${id}@agency.example>
Date: Mon, 12 Oct 2026 08:0${id}:00 +0000
From: Lena Vogel <lena.vogel@agency.example>
To: maria.santos@inbox.example
Subject: Role ${id}
${extra}Content-Type: text/plain; charset=utf-8

Hi Maria,

role ${id} is a backend role in Berlin.
BODYSENTINEL-${id}
`;

function mailbox(uids: number[], uidValidity = 7): FakeMailbox {
  return {
    folders: [
      { path: "INBOX", name: "INBOX", specialUse: "\\Inbox" },
      { path: "Sent", name: "Sent", specialUse: "\\Sent" },
    ],
    contents: {
      INBOX: {
        uidValidity,
        messages: uids.map((uid) => ({
          uid,
          internalDate: new Date("2026-10-12T08:00:05Z"),
          source: message(uid),
        })),
      },
      Sent: { uidValidity: 3, messages: [] },
    },
  };
}

describe("fetchSince (F1.1, F1.3)", () => {
  it("returns only the messages after afterUid, in UID order, with their envelopes", async () => {
    const server = fakeServer(mailbox([1, 2, 3, 5]));
    const client = mailClientWith(conn, secure, server.factory);
    const result = await client.fetchSince({ folder: "inbox", uidValidity: 7, afterUid: 2 });
    expect(FetchSinceResultSchema.parse(result)).toEqual(result);
    expect(result.uidValidity).toBe(7);
    expect(result.changed).toBe(false);
    expect(result.messages.map((m) => [m.uid, m.messageId])).toEqual([
      [3, "<role-3@agency.example>"],
      [5, "<role-5@agency.example>"],
    ]);
    expect(result.messages[0]).toMatchObject({
      folder: "inbox",
      folderPath: "INBOX",
      uidValidity: 7,
      subject: "Role 3",
    });
    // Envelopes only: the start of each message, opened read-only.
    expect(server.calls).toContain("search uid 3:*");
    expect(server.calls).toContain("fetch 3,5 max 65536");
    expect(server.calls.some((c) => c.startsWith("open-rw"))).toBe(false);
  });

  it("returns nothing when no message is newer, though UID n:* matches the newest", async () => {
    const server = fakeServer(mailbox([1, 2]));
    const client = mailClientWith(conn, secure, server.factory);
    const result = await client.fetchSince({ folder: "inbox", uidValidity: 7, afterUid: 2 });
    expect(result).toEqual({ uidValidity: 7, changed: false, messages: [] });
  });

  it("reads every message on the first sync, with no UIDVALIDITY known yet", async () => {
    const server = fakeServer(mailbox([4, 9]));
    const result = await mailClientWith(conn, secure, server.factory).fetchSince({
      folder: "inbox",
      uidValidity: null,
      afterUid: 0,
    });
    expect(result.changed).toBe(false);
    expect(result.messages.map((m) => m.uid)).toEqual([4, 9]);
  });

  it("reports a changed UIDVALIDITY and then returns every message of the folder", async () => {
    // The folder was rebuilt: new UIDVALIDITY, UIDs renumbered from 1.
    const server = fakeServer(mailbox([1, 2, 3], 8));
    const result = await mailClientWith(conn, secure, server.factory).fetchSince({
      folder: "inbox",
      uidValidity: 7,
      afterUid: 40,
    });
    expect(result.uidValidity).toBe(8);
    expect(result.changed).toBe(true);
    expect(result.messages.map((m) => [m.uid, m.uidValidity, m.messageId])).toEqual([
      [1, 8, "<role-1@agency.example>"],
      [2, 8, "<role-2@agency.example>"],
      [3, 8, "<role-3@agency.example>"],
    ]);
  });

  it("reads Sent from the folder the server marks as Sent", async () => {
    const box = mailbox([]);
    box.contents.Sent?.messages.push({ uid: 2, internalDate: null, source: message(2) });
    const result = await mailClientWith(conn, secure, fakeServer(box).factory).fetchSince({
      folder: "sent",
      uidValidity: 3,
      afterUid: 0,
    });
    expect(result.messages).toMatchObject([{ folder: "sent", folderPath: "Sent", uid: 2 }]);
  });

  it("fails with MailUnavailableError in plain words when the server can't be reached", async () => {
    const box = mailbox([1]);
    box.connectError = Object.assign(new Error(`connect ECONNREFUSED ${PASSWORD}`), {
      code: "ECONNREFUSED",
    });
    const error = await mailClientWith(conn, secure, fakeServer(box).factory)
      .fetchSince({ folder: "inbox", uidValidity: 7, afterUid: 0 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailUnavailableError);
    expect((error as MailUnavailableError).reason).toBe("unreachable");
    expect((error as Error).message).toBe("Couldn't reach the mail server");
    expect(String((error as Error).message)).not.toContain(PASSWORD);
  });

  it("says when the password is the problem", async () => {
    const box = mailbox([1]);
    box.connectError = Object.assign(new Error("LOGIN failed"), { authenticationFailed: true });
    await expect(
      mailClientWith(conn, secure, fakeServer(box).factory).fetchSince({
        folder: "inbox",
        uidValidity: 7,
        afterUid: 0,
      }),
    ).rejects.toMatchObject({
      reason: "wrong_password",
      message: expect.stringMatching(/didn't accept the user name or password/),
    });
  });
});

describe("fetchOriginal (F6.3)", () => {
  it("returns the text, the Message-ID and the threading headers of the message", async () => {
    const box = mailbox([]);
    box.contents.INBOX?.messages.push({
      uid: 4,
      internalDate: null,
      source: message(
        4,
        "In-Reply-To: <maria-1@inbox.example>\nReferences: <first@agency.example>\n <maria-1@inbox.example>\n",
      ),
    });
    const server = fakeServer(box);
    const original = await mailClientWith(conn, secure, server.factory).fetchOriginal({
      folderPath: "INBOX",
      uidValidity: 7,
      uid: 4,
    });
    expect(OriginalMessageSchema.parse(original)).toEqual(original);
    expect(original).toEqual({
      messageId: "<role-4@agency.example>",
      references: ["<first@agency.example>", "<maria-1@inbox.example>"],
      inReplyTo: "<maria-1@inbox.example>",
      subject: "Role 4",
      from: { address: "lena.vogel@agency.example", name: "Lena Vogel" },
      date: "2026-10-12T08:04:00.000Z",
      text: "Hi Maria,\n\nrole 4 is a backend role in Berlin.\nBODYSENTINEL-4",
    });
    // The whole message is read, not just its start.
    expect(server.calls).toContain("fetch 4");
  });

  it("returns null when the folder was rebuilt or the message is gone", async () => {
    const client = mailClientWith(conn, secure, fakeServer(mailbox([1])).factory);
    expect(await client.fetchOriginal({ folderPath: "INBOX", uidValidity: 6, uid: 1 })).toBeNull();
    expect(await client.fetchOriginal({ folderPath: "INBOX", uidValidity: 7, uid: 9 })).toBeNull();
  });

  it("fails with MailUnavailableError when the server can't be reached", async () => {
    const box = mailbox([1]);
    box.connectError = Object.assign(new Error("reset"), { code: "ECONNRESET" });
    await expect(
      mailClientWith(conn, secure, fakeServer(box).factory).fetchOriginal({
        folderPath: "INBOX",
        uidValidity: 7,
        uid: 1,
      }),
    ).rejects.toBeInstanceOf(MailUnavailableError);
  });
});
