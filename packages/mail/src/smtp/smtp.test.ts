import { createServer, type Server, type Socket } from "node:net";
import type { OriginalMessage, SmtpLogin } from "@jobfilly/schema";
import { afterEach, describe, expect, it } from "vitest";
import {
  composeOutgoing,
  SMTP_TIMEOUTS_MS,
  SmtpError,
  sendSmtp,
  smtpTransportOptions,
  testSmtp,
} from "./index";

// SMTP sending (MVP 3, F4): the real nodemailer transport driven against a scripted SMTP
// responder on node:net (plain text, a random local port), just enough of RFC 5321 for one
// message: it proves the login (password or XOAUTH2), the envelope and that the exact bytes are
// what the server receives, and the failure mapping, without a mail server.

const PASSWORD = "E2E-SECRET-maria-smtp";
const TOKEN = "E2E-SECRET-oauth-access";
/** What the server says in its banner and its refusals: never shown or logged. */
const SERVER_WORDS = "SERVER-SAYS-visit-evil.example";

interface Received {
  commands: string[];
  auth: string[];
  mailFrom: string[];
  rcptTo: string[];
  data: string[];
}

let server: Server | null = null;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

const b64 = (s: string) => Buffer.from(s, "base64").toString("utf8");

/** A responder that takes `password` (AUTH PLAIN) or the access token (AUTH XOAUTH2). */
async function smtpServer(options: { password?: string } = {}): Promise<{
  port: number;
  received: Received;
}> {
  const received: Received = { commands: [], auth: [], mailFrom: [], rcptTo: [], data: [] };
  const password = options.password ?? PASSWORD;
  server = createServer((socket: Socket) => {
    let buffer = "";
    let inData = false;
    let data = "";
    const say = (line: string) => socket.write(`${line}\r\n`);
    say(`220 smtp.test ESMTP ${SERVER_WORDS}`);
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) return;
          data += buffer.slice(0, end + 2);
          buffer = buffer.slice(end + 5);
          inData = false;
          // Undo the dot-stuffing (RFC 5321 4.5.2).
          received.data.push(data.replace(/^\.\./gm, "."));
          data = "";
          say("250 2.0.0 queued");
          continue;
        }
        const eol = buffer.indexOf("\r\n");
        if (eol < 0) return;
        const line = buffer.slice(0, eol);
        buffer = buffer.slice(eol + 2);
        const [verb = "", ...rest] = line.split(" ");
        received.commands.push(verb.toUpperCase());
        switch (verb.toUpperCase()) {
          case "EHLO":
            say("250-smtp.test");
            say("250-AUTH PLAIN XOAUTH2");
            say("250 8BITMIME");
            break;
          case "AUTH": {
            const [mechanism = "", payload = ""] = rest;
            const decoded = b64(payload);
            received.auth.push(`${mechanism} ${decoded}`);
            const ok =
              mechanism === "PLAIN"
                ? decoded.split("\0")[2] === password
                : decoded.includes(`auth=Bearer ${TOKEN}`);
            say(ok ? "235 2.7.0 Accepted" : `535 5.7.8 ${SERVER_WORDS}`);
            break;
          }
          case "MAIL":
            received.mailFrom.push(line);
            say("250 2.1.0 OK");
            break;
          case "RCPT":
            received.rcptTo.push(line);
            say("250 2.1.5 OK");
            break;
          case "DATA":
            inData = true;
            say("354 Go ahead");
            break;
          case "QUIT":
            say("221 2.0.0 Bye");
            socket.end();
            return;
          default:
            say("250 OK");
        }
      }
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || !address) throw new Error("no port");
  return { port: address.port, received };
}

const login = (port: number): SmtpLogin => ({
  host: "127.0.0.1",
  port,
  tlsMode: "none",
  username: "maria",
  password: PASSWORD,
});
const insecure = { allowInsecure: true };

const ORIGINAL: OriginalMessage = {
  messageId: "<berlin@agency.example>",
  references: ["<earlier@agency.example>"],
  inReplyTo: null,
  subject: "Backend-Rolle in Berlin",
  from: { address: "jonas.weber@agency.example", name: "Jonas Weber" },
  date: "2026-10-14T09:12:00.000Z",
  text: "Hallo Maria,\n\n.eine Rolle für Sie.",
};

async function outgoing(attach = false) {
  return composeOutgoing({
    original: ORIGINAL,
    reply: { subject: "Re: Backend-Rolle in Berlin", body: "Hallo Herr Weber,\n\ngern.\n\nMaria" },
    attachment: attach
      ? {
          fileName: "Maria Santos CV.pdf",
          contentType: "application/pdf",
          bytes: new TextEncoder().encode("%PDF-1.4 cv"),
        }
      : null,
    from: { address: "maria.santos@inbox.example", name: null },
    messageId: "<out-1@inbox.example>",
    date: new Date("2026-10-16T10:00:00Z"),
  });
}

describe("the outgoing message (F4.1)", () => {
  it("is the reply to the original's sender, with the quote, threading and the CV", async () => {
    const message = await outgoing(true);
    expect(message.envelope).toEqual({
      from: "maria.santos@inbox.example",
      to: ["jonas.weber@agency.example"],
    });
    expect(message.preview).toEqual({
      from: { address: "maria.santos@inbox.example", name: null },
      to: [{ address: "jonas.weber@agency.example", name: "Jonas Weber" }],
      cc: [],
      subject: "Re: Backend-Rolle in Berlin",
      text:
        "Hallo Herr Weber,\n\ngern.\n\nMaria\n\n2026-10-14 09:12 UTC, Jonas Weber <jonas.weber@agency.example>:\n" +
        "> Hallo Maria,\n>\n> .eine Rolle für Sie.\n",
      attachments: [{ fileName: "Maria Santos CV.pdf", sizeBytes: 11 }],
    });
    const raw = new TextDecoder().decode(message.raw);
    expect(raw).toContain("Message-ID: <out-1@inbox.example>");
    expect(raw).toContain("In-Reply-To: <berlin@agency.example>");
    expect(raw).toContain("References: <earlier@agency.example> <berlin@agency.example>");
  });
});

describe("sendSmtp (F4.4)", () => {
  it("signs in with the password and sends exactly the message's bytes once", async () => {
    const { port, received } = await smtpServer();
    const message = await outgoing();
    const result = await sendSmtp(login(port), message.envelope, message.raw, insecure);
    expect(result).toEqual({ accepted: ["jonas.weber@agency.example"] });
    expect(received.auth).toEqual([`PLAIN \0maria\0${PASSWORD}`]);
    expect(received.mailFrom).toEqual([expect.stringContaining("<maria.santos@inbox.example>")]);
    expect(received.rcptTo).toEqual([expect.stringContaining("<jonas.weber@agency.example>")]);
    expect(received.data).toEqual([new TextDecoder().decode(message.raw)]);
  });

  it("signs in with an OAuth access token (XOAUTH2)", async () => {
    const { port, received } = await smtpServer();
    const message = await outgoing();
    const oauth: SmtpLogin = {
      host: "127.0.0.1",
      port,
      tlsMode: "none",
      username: "maria",
      accessToken: TOKEN,
    };
    await sendSmtp(oauth, message.envelope, message.raw, insecure);
    expect(received.auth).toEqual([
      expect.stringMatching(new RegExp(`^XOAUTH2 user=maria\\x01auth=Bearer ${TOKEN}`)),
    ]);
    expect(received.data).toHaveLength(1);
  });

  it("says why it couldn't send in fixed words: never the password or the server's own", async () => {
    const { port, received } = await smtpServer({ password: "another" });
    const message = await outgoing();
    const failure = await sendSmtp(login(port), message.envelope, message.raw, insecure).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(SmtpError);
    expect(failure).toMatchObject({ reason: "wrong_password", code: "EAUTH" });
    // Everything the error carries: its message, code and any other field.
    const carried = JSON.stringify({ ...(failure as object), message: (failure as Error).message });
    expect(carried).not.toContain(PASSWORD);
    expect(carried).not.toContain(SERVER_WORDS);
    expect(received.data).toEqual([]);
  });

  it("connects to a plain host name or IP address only, never to a URL", async () => {
    const { port, received } = await smtpServer();
    const message = await outgoing();
    for (const host of ["smtp://127.0.0.1", "127.0.0.1:25", "user@127.0.0.1", "127.0.0.1/x"]) {
      await expect(
        sendSmtp({ ...login(port), host }, message.envelope, message.raw, insecure),
      ).rejects.toMatchObject({ reason: "unreachable", code: "EBADHOST" });
      expect(await testSmtp({ ...login(port), host }, insecure)).toMatchObject({ ok: false });
    }
    await expect(
      sendSmtp({ ...login(port), port: 70000 }, message.envelope, message.raw, insecure),
    ).rejects.toMatchObject({ code: "EBADHOST" });
    expect(received.commands).toEqual([]);
  });

  it("goes to that one host and port, with bounded timeouts and nothing else", () => {
    const options = smtpTransportOptions(
      { host: "smtp.inbox.example", port: 587, tlsMode: "starttls", username: "m", password: "p" },
      { allowInsecure: false },
    );
    expect(options).toMatchObject({
      host: "smtp.inbox.example",
      port: 587,
      secure: false,
      requireTLS: true,
      ignoreTLS: false,
      pool: false,
      logger: false,
      ...SMTP_TIMEOUTS_MS,
    });
    expect(options).not.toHaveProperty("proxy");
    expect(options).not.toHaveProperty("service");
    for (const ms of Object.values(SMTP_TIMEOUTS_MS)) expect(ms).toBeLessThanOrEqual(30_000);
  });

  it("refuses plain-text SMTP unless the server allows it", async () => {
    const { port, received } = await smtpServer();
    const message = await outgoing();
    await expect(
      sendSmtp(login(port), message.envelope, message.raw, { allowInsecure: false }),
    ).rejects.toMatchObject({ reason: "insecure_refused" });
    expect(received.commands).toEqual([]);
  });
});

describe("testSmtp (Settings › Sending's Test)", () => {
  it("signs in without sending anything", async () => {
    const { port, received } = await smtpServer();
    expect(await testSmtp(login(port), insecure)).toEqual({ ok: true });
    expect(received.auth).toHaveLength(1);
    expect(received.commands).not.toContain("DATA");
    expect(received.commands).not.toContain("MAIL");
  });

  it("tells a wrong password, an unreachable server and plain text refused apart", async () => {
    const { port } = await smtpServer({ password: "another" });
    expect(await testSmtp(login(port), insecure)).toMatchObject({
      ok: false,
      reason: "wrong_password",
    });
    // Nothing listens on the closed server's port.
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
    expect(await testSmtp(login(port), insecure)).toMatchObject({
      ok: false,
      reason: "unreachable",
    });
    expect(await testSmtp(login(port), { allowInsecure: false })).toMatchObject({
      ok: false,
      reason: "insecure_refused",
    });
  });
});
