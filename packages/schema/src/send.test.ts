import { describe, expect, it } from "vitest";
import { DraftSchema } from "./drafts";
import {
  SendPreviewSchema,
  SmtpLoginSchema,
  SmtpSettingsInputSchema,
  SmtpSettingsViewSchema,
} from "./send";

// The send slice's shapes (MVP 3, F4): the confirmation shows the outgoing message as it leaves,
// a draft carries its latest send, and Settings › Sending never holds a password.

const ID = "6f1c2f4e-8d3a-4b5c-9e7f-0a1b2c3d4e5f";

describe("sending (F4)", () => {
  it("shows the recipients, subject, attachments and exact text with the token", () => {
    const preview = {
      draftId: ID,
      mailboxId: ID,
      from: { address: "maria@inbox.example", name: null },
      to: [{ address: "jonas@agency.example", name: "Jonas" }],
      cc: [],
      subject: "Re: A role",
      text: "Hello\n\n> quoted\n",
      attachments: [{ fileName: "CV.pdf", sizeBytes: 12 }],
      token: "t",
      expiresAt: "2026-10-16T10:15:00.000Z",
    };
    expect(SendPreviewSchema.parse(preview)).toEqual(preview);
    expect(SendPreviewSchema.safeParse({ ...preview, token: "" }).success).toBe(false);
  });

  it("gives a draft its latest send, and reads a draft without one", () => {
    const draft = {
      id: ID,
      messageId: "<m@agency.example>",
      position: 0,
      status: "sent",
      failureKind: null,
      failureReason: null,
      subject: "Re: A role",
      body: "Hello",
      language: "en",
      cvId: null,
      auto: true,
      updatedAt: "2026-10-16T10:00:00.000Z",
    };
    expect(DraftSchema.safeParse(draft).success).toBe(true);
    const send = {
      id: ID,
      draftId: ID,
      status: "sent",
      sendAt: "2026-10-16T10:00:10.000Z",
      sentAt: "2026-10-16T10:00:11.000Z",
      failureReason: null,
    };
    expect(DraftSchema.parse({ ...draft, send }).send).toEqual(send);
    expect(DraftSchema.safeParse({ ...draft, send: null }).success).toBe(true);
  });

  it("takes a host name or IP address only, and any port 1–65535, as for IMAP", () => {
    const settings = { host: "smtp.example.com", port: 587, tlsMode: "starttls", username: "m" };
    for (const host of ["smtp.example.com", "localhost", "10.0.0.5", "[::1]", " mail.x.de "]) {
      expect(SmtpSettingsInputSchema.safeParse({ ...settings, host }).success, host).toBe(true);
    }
    for (const host of [
      "smtps://smtp.example.com",
      "smtp.example.com:25",
      "user@smtp.example.com",
      "smtp.example.com/path",
      "smtp.example.com?x=1",
      "smtp example.com",
      "smtp.example.com\r\nRCPT",
      "-bad.example",
      "",
    ]) {
      expect(SmtpSettingsInputSchema.safeParse({ ...settings, host }).success, host).toBe(false);
    }
    for (const port of [0, 65536, 2.5]) {
      expect(SmtpSettingsInputSchema.safeParse({ ...settings, port }).success).toBe(false);
    }
    const login = { ...settings, host: "smtp://evil.example", password: "p" };
    expect(SmtpLoginSchema.safeParse(login).success).toBe(false);
  });

  it("shows a mailbox's SMTP settings without a password", () => {
    const view = SmtpSettingsViewSchema.parse({
      smtp: { host: "smtp.x", port: 465, tlsMode: "tls", username: "m", password: "p" },
      savesSentCopy: false,
    });
    expect(view.smtp).not.toHaveProperty("password");
    expect(SmtpSettingsViewSchema.safeParse({ smtp: null, savesSentCopy: true }).success).toBe(
      true,
    );
  });
});
