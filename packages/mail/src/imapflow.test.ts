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

interface ResponderState {
  selected: boolean;
  /** Every command line received, the literals' bytes left out. */
  commands: string[];
  /** The bytes of an APPEND literal still to come, and the tag to answer once it is in. */
  literal: number;
  appendTag: string | null;
  appended: string[];
  /** The INTERNALDATE the responder sends for its message. */
  internalDate: string;
}

function respond(socket: Socket, line: string, state: ResponderState) {
  const [tag, rawCommand = "", ...rest] = line.split(" ");
  const command = rawCommand.toUpperCase();
  const args = rest.join(" ");
  const send = (...lines: string[]) => socket.write(lines.map((l) => `${l}\r\n`).join(""));
  state.commands.push(line);
  switch (command) {
    case "APPEND": {
      // A synchronizing literal: the server says go ahead, then the message's bytes follow.
      state.literal = Number(/\{(\d+)\}$/.exec(line)?.[1] ?? 0);
      state.appendTag = tag ?? null;
      return send("+ go ahead");
    }
    case "CREATE":
      return send(`${tag} OK created`);
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
        `${tag} OK [${command === "EXAMINE" ? "READ-ONLY" : "READ-WRITE"}] done`,
      );
    case "UID": {
      const sub = rest[0]?.toUpperCase();
      if (sub === "SEARCH") return send("* SEARCH 7", `${tag} OK done`);
      if (sub === "STORE" || sub === "EXPUNGE") return send(`${tag} OK done`);
      if (sub === "FETCH") {
        const body = Buffer.from(MESSAGE);
        const section = /BODY\.PEEK\[\]<0\.\d+>/.test(args) ? "BODY[]<0>" : "BODY[]";
        socket.write(
          `* 1 FETCH (UID 7 INTERNALDATE "${state.internalDate}" ${section} {${body.length}}\r\n`,
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

const sessions: ResponderState[] = [];

async function scriptedImap({
  internalDate = "28-Sep-2026 08:15:05 +0000",
}: {
  internalDate?: string;
} = {}): Promise<number> {
  const server = createServer((socket) => {
    const state: ResponderState = {
      selected: false,
      commands: [],
      literal: 0,
      appendTag: null,
      appended: [],
      internalDate,
    };
    sessions.push(state);
    let buffer = "";
    socket.on("error", () => {});
    socket.write("* OK [CAPABILITY IMAP4rev1] scripted responder ready\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      for (;;) {
        if (state.literal > 0) {
          if (buffer.length < state.literal) return;
          state.appended.push(buffer.slice(0, state.literal));
          buffer = buffer.slice(state.literal);
          state.literal = 0;
        }
        const i = buffer.indexOf("\r\n");
        if (i < 0) return;
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (state.appendTag !== null) {
          // The line the literal ended: the append is complete.
          socket.write(`${state.appendTag} OK [APPENDUID 42 9] appended\r\n`);
          state.appendTag = null;
        } else if (line) respond(socket, line, state);
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
  sessions.splice(0);
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

/** The mailbox's own address, the drafts' From; the IMAP user name is "maria". */
const ADDRESS = "maria.santos@inbox.example";

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
    const client = createMailClient(connection(port), { allowInsecure: true, address: ADDRESS });
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

  it("syncs by UID, and creates Drafts, appends a draft with \\Draft and deletes it", async () => {
    const port = await scriptedImap();
    const client = createMailClient(connection(port), { allowInsecure: true, address: ADDRESS });
    try {
      const synced = await client.fetchSince({ folder: "inbox", uidValidity: 42, afterUid: 6 });
      expect(synced).toMatchObject({ uidValidity: 42, changed: false, messages: [{ uid: 7 }] });
      // The responder answers UID 8:* with the newest message, 7, as a server does.
      expect(
        await client.fetchSince({ folder: "inbox", uidValidity: 42, afterUid: 7 }),
      ).toMatchObject({ messages: [] });

      const ref = await client.saveDraft({
        original: {
          messageId: "<wired-1@agency.example>",
          references: [],
          inReplyTo: null,
          subject: "Backend Engineer",
          from: { address: "lena.vogel@agency.example", name: "Lena Vogel" },
          date: "2026-09-28T08:15:00.000Z",
          text: "Hi Maria, would you have time for a call?",
        },
        reply: { subject: "Re: Backend Engineer", body: "Hi Lena, yes." },
        attachment: null,
      });
      expect(ref).toMatchObject({ path: "Drafts", uid: 9, uidValidity: 42 });
      await client.deleteDraft(ref);
    } finally {
      await client.close();
    }
    const [state] = sessions;
    const commands = state?.commands.map((c) => c.split(" ").slice(1).join(" ")) ?? [];
    expect(commands).toContain("UID SEARCH UID 7:*");
    expect(commands).toContain("CREATE Drafts");
    expect(commands.find((c) => c.startsWith("APPEND"))).toMatch(/^APPEND Drafts \(\\Draft\)/);
    expect(commands).toContain("SELECT Drafts");
    expect(commands.find((c) => c.startsWith("UID STORE"))).toMatch(/^UID STORE 9 \+FLAGS/);
    expect(state?.appended[0]).toContain("In-Reply-To: <wired-1@agency.example>");
    expect(state?.appended[0]).toContain("Hi Lena, yes.");
  });

  it("syncs a message whose INTERNALDATE the server sent in no date format", async () => {
    // imapflow hands such an INTERNALDATE over as its raw text; it once became an Invalid Date
    // whose toISOString failed every sync as an unreachable server.
    const port = await scriptedImap({ internalDate: "sometime last week" });
    const client = createMailClient(connection(port), { allowInsecure: true, address: ADDRESS });
    try {
      const synced = await client.fetchSince({ folder: "inbox", uidValidity: 42, afterUid: 6 });
      expect(synced.messages).toMatchObject([
        {
          uid: 7,
          messageId: "<wired-1@agency.example>",
          // No arrival time to read: the envelope's date stands in for it.
          receivedAt: "2026-09-28T08:15:00.000Z",
        },
      ]);
      expect(await client.fetchOriginal({ folderPath: "INBOX", uidValidity: 42, uid: 7 })).toEqual(
        expect.objectContaining({ date: "2026-09-28T08:15:00.000Z" }),
      );
    } finally {
      await client.close();
    }
  });

  it("maps a refused login to wrong_password without the password", async () => {
    const port = await scriptedImap();
    const client = createMailClient(connection(port, { password: "E2E-SECRET-wrong" }), {
      allowInsecure: true,
      address: ADDRESS,
    });
    const result = await client.test();
    await client.close();
    expect(result).toMatchObject({ ok: false, reason: "wrong_password" });
    expect(JSON.stringify(result)).not.toContain("E2E-SECRET");
  });

  it("maps a TLS client talking to a plain-text server to tls", async () => {
    const port = await scriptedImap();
    const client = createMailClient(connection(port, { tlsMode: "tls" }), {
      allowInsecure: false,
      address: ADDRESS,
    });
    const result = await client.test();
    await client.close();
    expect(result).toMatchObject({ ok: false, reason: "tls" });
  });

  it("maps a closed port to unreachable", async () => {
    const port = await scriptedImap();
    await new Promise((r) => servers.pop()?.close(r));
    const client = createMailClient(connection(port, { tlsMode: "tls" }), {
      allowInsecure: false,
      address: ADDRESS,
    });
    const result = await client.test();
    await client.close();
    expect(result).toMatchObject({ ok: false, reason: "unreachable" });
  });
});
