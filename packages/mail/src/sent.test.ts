import type { MailConnection } from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { MailUnavailableError, mailClientWith } from "./client";
import { type FakeMailbox, fakeServer } from "./fake-session";

// appendSent (MVP 3, F4.4): a message the app sent is in the Sent folder exactly once, whether
// the provider filed it itself or an earlier attempt already appended it.

const conn: MailConnection = {
  host: "imap.inbox.example",
  port: 993,
  tlsMode: "tls",
  username: "maria",
  password: "E2E-SECRET-maria-imap",
};
const options = { allowInsecure: false, address: "maria.santos@inbox.example" };
const MESSAGE_ID = "<sent-1@inbox.example>";
const RAW = new TextEncoder().encode(
  `Message-ID: ${MESSAGE_ID}\r\nFrom: maria.santos@inbox.example\r\nSubject: Re: Backend\r\n\r\nHello\r\n`,
);
const date = new Date("2026-10-16T10:00:00Z");

function mailbox(extra: Partial<FakeMailbox> = {}): FakeMailbox {
  return {
    folders: [
      { path: "INBOX", name: "INBOX", specialUse: "\\Inbox" },
      { path: "Sent Items", name: "Sent Items", specialUse: "\\Sent" },
    ],
    contents: {
      INBOX: { uidValidity: 7, messages: [] },
      "Sent Items": { uidValidity: 9, messages: [] },
    },
    ...extra,
  };
}

describe("appendSent (F4.4)", () => {
  it("files the exact bytes in the Sent folder, read", async () => {
    const box = mailbox();
    const client = mailClientWith(conn, options, fakeServer(box).factory);
    expect(await client.appendSent({ raw: RAW, messageId: MESSAGE_ID, date })).toEqual({
      path: "Sent Items",
      appended: true,
    });
    const [copy] = box.contents["Sent Items"]?.messages ?? [];
    expect(copy?.source).toBe(new TextDecoder().decode(RAW));
    expect(copy?.flags).toEqual(["\\Seen"]);
  });

  it("appends nothing when a message with its Message-ID is there already", async () => {
    const box = mailbox();
    const client = mailClientWith(conn, options, fakeServer(box).factory);
    await client.appendSent({ raw: RAW, messageId: MESSAGE_ID, date });
    expect(await client.appendSent({ raw: RAW, messageId: MESSAGE_ID, date })).toEqual({
      path: "Sent Items",
      appended: false,
    });
    expect(box.contents["Sent Items"]?.messages).toHaveLength(1);
  });

  it("says when there is no Sent folder, and when the server refuses the append", async () => {
    const noSent = mailbox({
      folders: [{ path: "INBOX", name: "INBOX", specialUse: "\\Inbox" }],
      contents: { INBOX: { uidValidity: 7, messages: [] } },
    });
    expect(
      await mailClientWith(conn, options, fakeServer(noSent).factory).appendSent({
        raw: RAW,
        messageId: MESSAGE_ID,
        date,
      }),
    ).toBeNull();
    const refusing = mailbox({ appendError: false });
    await expect(
      mailClientWith(conn, options, fakeServer(refusing).factory).appendSent({
        raw: RAW,
        messageId: MESSAGE_ID,
        date,
      }),
    ).rejects.toBeInstanceOf(MailUnavailableError);
  });
});
