import { randomBytes } from "node:crypto";
import { getMailboxConnection } from "@jobfilly/db";
import type { MailConnection } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MailPort } from "./deps";
import { connectMailbox, MailboxSecretError } from "./mailbox";
import {
  createFakeMailbox,
  createTestDeps,
  type SeededUser,
  seedMailbox,
  seedUser,
  type TestDeps,
} from "./testing";

// connectMailbox: the one way the server opens a workspace's mailbox.

const CONN: MailConnection = {
  host: "imap.inbox.example",
  port: 993,
  tlsMode: "tls",
  username: "maria",
  password: "E2E-SECRET-maria-imap",
};

let deps: TestDeps;
let maria: SeededUser;
let opened: { conn: MailConnection; allowInsecure: boolean }[];

beforeEach(async () => {
  deps = await createTestDeps({ config: { allowInsecureMail: true } });
  const fake = createFakeMailbox();
  opened = [];
  const port: MailPort = {
    connect(conn, options) {
      opened.push({ conn, allowInsecure: options.allowInsecure });
      return fake.port.connect(conn, options);
    },
  };
  deps.mail = port;
  maria = await seedUser(deps);
});
afterEach(() => deps.close());

const seed = () =>
  seedMailbox(deps, maria.workspaceId, {
    address: "maria.santos@inbox.example",
    conn: CONN,
    sentFolderPath: "Sent",
  });

describe("connectMailbox", () => {
  it("answers null when the workspace has no mailbox, without connecting", async () => {
    expect(await connectMailbox(deps, maria.workspaceId)).toBeNull();
    expect(opened).toEqual([]);
  });

  it("connects with the stored connection, the opened password and the insecure-mail setting", async () => {
    await seed();
    const client = await connectMailbox(deps, maria.workspaceId);
    expect(client).not.toBeNull();
    expect(opened).toEqual([{ conn: CONN, allowInsecure: true }]);
    await client?.close();
  });

  it("uses a connection the caller has already read", async () => {
    await seed();
    const stored = await getMailboxConnection(deps.db, maria.workspaceId);
    if (!stored) throw new Error("no mailbox");
    await connectMailbox(deps, maria.workspaceId, { ...stored, host: "imap.other.example" });
    expect(opened.map((o) => o.conn.host)).toEqual(["imap.other.example"]);
  });

  it("says when the password was sealed under another key, naming nothing secret", async () => {
    await seed();
    const otherKey = { ...deps, config: { ...deps.config, secretKey: randomBytes(32) } };
    const error = await connectMailbox(otherKey, maria.workspaceId).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailboxSecretError);
    expect(String((error as Error).message)).not.toContain("E2E-SECRET");
    expect(opened).toEqual([]);
  });
});
