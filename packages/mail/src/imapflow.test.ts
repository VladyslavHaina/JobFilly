import { createServer, type Server, type Socket } from "node:net";
import type { MailConnection } from "@jobfilly/schema";
import { afterEach, describe, expect, it } from "vitest";
import { createMailClient } from "./client";

// The real imapflow, driven against a scripted IMAP responder on node:net: just enough of
// RFC 3501 for the client's commands, plain text only, on a random local port. It proves the
// adapter's wiring (options, folder listing, fetch of UIDs with their source) and the failure
// mapping on real sockets, without a mail server or any extra dependency.

const PASSWORD = "E2E-SECRET-maria-imap";

const MESSAGE = [
  "Message-ID: <wired-1@agency.example>",
  "Date: Mon, 28 Sep 2026 08:15:00 +0000",
  "From: Lena Vogel <lena.vogel@agency.example>",
  "To: maria.santos@inbox.example",
  "Subject: Backend Engineer",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Hi Maria, would you have time for a call?",
  "",
].join("\r\n");

function respond(socket: Socket, line: string, state: { selected: boolean }) {
  const [tag, rawCommand = "", ...rest] = line.split(" ");
  const command = rawCommand.toUpperCase();
  const args = rest.join(" ");
  const send = (...lines: string[]) => socket.write(lines.map((l) => `${l}\r\n`).join(""));
  switch (command) {
    case "CAPABILITY":
      return send("* CAPABILITY IMAP4rev1", `${tag} OK done`);
    case "LOGIN": {
      const [, user, pass] = /^"?([^" ]+)"? "?([^"]+)"?$/.exec(args) ?? [];
      if (user === "maria" && pass === PASSWORD) return send(`${tag} OK Logged in`);
      return send(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials`);
    }
    case "LIST":
      // LIST "" "" asks only for the hierarchy delimiter.
      if (args === '"" ""') return send('* LIST (\\Noselect) "/" ""', `${tag} OK done`);
      return send(
        '* LIST (\\HasNoChildren) "/" INBOX',
        '* LIST (\\HasNoChildren \\Sent) "/" "Sent Mail"',
        '* LIST (\\HasNoChildren \\Trash) "/" Trash',
        `${tag} OK done`,
      );
    case "LSUB":
      return send('* LSUB () "/" INBOX', `${tag} OK done`);
    case "EXAMINE":
    case "SELECT":
      state.selected = true;
      return send(
        "* FLAGS (\\Seen)",
        "* 1 EXISTS",
        "* OK [UIDVALIDITY 42] ok",
        "* OK [UIDNEXT 8] ok",
        `${tag} OK [READ-ONLY] done`,
      );
    case "UID": {
      const sub = rest[0]?.toUpperCase();
      if (sub === "SEARCH") return send("* SEARCH 7", `${tag} OK done`);
      if (sub === "FETCH") {
        const body = Buffer.from(MESSAGE);
        const section = /BODY\.PEEK\[\]<0\.\d+>/.test(args) ? "BODY[]<0>" : "BODY[]";
        socket.write(
          `* 1 FETCH (UID 7 INTERNALDATE "28-Sep-2026 08:15:05 +0000" ${section} {${body.length}}\r\n`,
        );
        socket.write(body);
        return send(")", `${tag} OK done`);
      }
      return send(`${tag} BAD unknown`);
    }
    case "LOGOUT":
      send("* BYE bye", `${tag} OK done`);
      return socket.end();
    default:
      return send(`${tag} OK done`);
  }
}

const servers: Server[] = [];

async function scriptedImap(): Promise<number> {
  const server = createServer((socket) => {
    const state = { selected: false };
    let buffer = "";
    socket.on("error", () => {});
    socket.write("* OK [CAPABILITY IMAP4rev1] scripted responder ready\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      for (let i = buffer.indexOf("\r\n"); i >= 0; i = buffer.indexOf("\r\n")) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (line) respond(socket, line, state);
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return address.port;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

const connection = (port: number, extra: Partial<MailConnection> = {}): MailConnection => ({
  host: "127.0.0.1",
  port,
  tlsMode: "none",
  username: "maria",
  password: PASSWORD,
  ...extra,
});

describe("the imapflow session", () => {
  it("connects, lists Inbox and Sent, and reads envelopes and bodies", async () => {
    const port = await scriptedImap();
    const client = createMailClient(connection(port), { allowInsecure: true });
    try {
      expect(await client.test()).toEqual({
        ok: true,
        folders: ["INBOX", "Sent Mail"],
        sentPath: "Sent Mail",
      });
      const envelopes = await client.fetchEnvelopes({
        folder: "inbox",
        since: new Date("2026-09-01T00:00:00Z"),
      });
      expect(envelopes).toMatchObject([
        {
          messageId: "<wired-1@agency.example>",
          folderPath: "INBOX",
          uidValidity: 42,
          uid: 7,
          subject: "Backend Engineer",
          snippet: "Hi Maria, would you have time for a call?",
        },
      ]);
      expect(await client.fetchBody({ folderPath: "INBOX", uidValidity: 42, uid: 7 })).toEqual({
        text: "Hi Maria, would you have time for a call?",
      });
      expect(await client.fetchBody({ folderPath: "INBOX", uidValidity: 41, uid: 7 })).toBeNull();
    } finally {
      await client.close();
    }
  });

  it("maps a refused login to wrong_password without the password", async () => {
    const port = await scriptedImap();
    const client = createMailClient(connection(port, { password: "E2E-SECRET-wrong" }), {
      allowInsecure: true,
    });
    const result = await client.test();
    await client.close();
    expect(result).toMatchObject({ ok: false, reason: "wrong_password" });
    expect(JSON.stringify(result)).not.toContain("E2E-SECRET");
  });

  it("maps a TLS client talking to a plain-text server to tls", async () => {
    const port = await scriptedImap();
    const client = createMailClient(connection(port, { tlsMode: "tls" }), { allowInsecure: false });
    const result = await client.test();
    await client.close();
    expect(result).toMatchObject({ ok: false, reason: "tls" });
  });

  it("maps a closed port to unreachable", async () => {
    const port = await scriptedImap();
    await new Promise((r) => servers.pop()?.close(r));
    const client = createMailClient(connection(port, { tlsMode: "tls" }), { allowInsecure: false });
    const result = await client.test();
    await client.close();
    expect(result).toMatchObject({ ok: false, reason: "unreachable" });
  });
});
