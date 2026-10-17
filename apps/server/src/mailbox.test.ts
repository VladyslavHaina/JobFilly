import { randomBytes } from "node:crypto";
import { getMailboxConnection, getStoredMessages, saveEnvelopes } from "@jobfilly/db";
import { MailUnavailableError } from "@jobfilly/mail";
import {
  type Envelope,
  type MailConnection,
  type MailLogin,
  OAuthTokensSchema,
} from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MINUTE } from "./clock";
import type { MailPort } from "./deps";
import {
  connectMailbox,
  connectStoredMailbox,
  MailboxSecretError,
  mailboxLogin,
  ReconnectNeededError,
} from "./mailbox";
import { open } from "./secrets";
import {
  createFakeMailbox,
  createFakeOAuth,
  createTestDeps,
  type FakeOAuth,
  type SeededUser,
  seedGoogleMailbox,
  seedMailbox,
  seedUser,
  type TestDeps,
} from "./testing";

// connectMailbox and connectStoredMailbox: the one way the server opens a workspace's mailbox.
// MVP 3 (F3.2): a Google mailbox signs in with its access token, refreshed on use; a refused
// refresh turns it to "Reconnect needed" and loses nothing.

const CONN: MailConnection = {
  host: "imap.inbox.example",
  port: 993,
  tlsMode: "tls",
  username: "maria",
  password: "E2E-SECRET-maria-imap",
};

let deps: TestDeps;
let maria: SeededUser;
let opened: { conn: MailLogin; allowInsecure: boolean }[];

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

  it("says when the password was sealed under another key, naming nothing secret", async () => {
    await seed();
    const otherKey = { ...deps, config: { ...deps.config, secretKey: randomBytes(32) } };
    const error = await connectMailbox(otherKey, maria.workspaceId).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailboxSecretError);
    expect(String((error as Error).message)).not.toContain("E2E-SECRET");
    expect(opened).toEqual([]);
  });
});

describe("connectStoredMailbox", () => {
  const stored = async () => {
    await seed();
    const mailbox = await getMailboxConnection(deps.db, maria.workspaceId);
    if (!mailbox) throw new Error("no mailbox");
    return mailbox;
  };

  it("connects with the row the caller has already read, without reading it again", async () => {
    const mailbox = await stored();
    const client = connectStoredMailbox(deps, { ...mailbox, host: "imap.other.example" });
    expect(opened).toEqual([
      { conn: { ...CONN, host: "imap.other.example" }, allowInsecure: true },
    ]);
    await client.close();
  });

  it("says when the password was sealed under another key, naming nothing secret", async () => {
    const mailbox = await stored();
    const otherKey = { ...deps, config: { ...deps.config, secretKey: randomBytes(32) } };
    let error: unknown = null;
    try {
      connectStoredMailbox(otherKey, mailbox);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MailboxSecretError);
    expect(String((error as Error).message)).not.toContain("E2E-SECRET");
    expect(opened).toEqual([]);
  });
});

describe("a Google mailbox (MVP 3, F3.2)", () => {
  let oauth: FakeOAuth;
  beforeEach(() => {
    oauth = createFakeOAuth({ now: () => deps.clock.now() });
    deps.oauth = oauth.port;
  });

  const stored = async (mailboxId: string) => {
    const mailbox = await getMailboxConnection(deps.db, maria.workspaceId, mailboxId);
    if (!mailbox) throw new Error("no mailbox");
    return mailbox;
  };
  const tokensOf = async (mailboxId: string) =>
    OAuthTokensSchema.parse(
      JSON.parse(open(deps.config.secretKey, (await stored(mailboxId)).secretCiphertext)),
    );
  const inMinutes = (n: number) => new Date(deps.clock.now().getTime() + n * MINUTE).toISOString();

  it("signs in with its access token while it is good, without refreshing", async () => {
    const { mailboxId } = await seedGoogleMailbox(deps, maria.workspaceId);
    const client = await connectMailbox(deps, maria.workspaceId, mailboxId);
    expect(await client?.test()).toMatchObject({ ok: true });
    await client?.close();
    expect(opened).toEqual([
      {
        conn: {
          host: "imap.gmail.example",
          port: 993,
          tlsMode: "tls",
          username: "maria.gmail@gmail.example",
          accessToken: "E2E-SECRET-access-0",
        },
        allowInsecure: true,
      },
    ]);
    expect(oauth.refreshes).toEqual([]);
  });

  it("refreshes an access token about to expire, and keeps the new one sealed", async () => {
    const { mailboxId, tokens } = await seedGoogleMailbox(deps, maria.workspaceId, {
      tokens: { expiresAt: inMinutes(4) },
    });
    const login = await mailboxLogin(deps, await stored(mailboxId));
    expect(login).toMatchObject({ accessToken: "E2E-SECRET-access-1" });
    expect(oauth.refreshes).toEqual(["E2E-SECRET-refresh"]);
    expect(await tokensOf(mailboxId)).toEqual({
      ...tokens,
      accessToken: "E2E-SECRET-access-1",
      expiresAt: inMinutes(60),
    });
    expect((await stored(mailboxId)).secretCiphertext).not.toContain("E2E-SECRET");
    // Good for another hour now: the next use doesn't refresh again.
    await mailboxLogin(deps, await stored(mailboxId));
    expect(oauth.refreshes).toHaveLength(1);
    expect(deps.rawLogs.join("\n")).not.toContain("E2E-SECRET");
  });

  it("turns to reconnect needed when Google refuses the refresh, losing nothing", async () => {
    const { mailboxId, tokens } = await seedGoogleMailbox(deps, maria.workspaceId, {
      tokens: { expiresAt: inMinutes(0) },
    });
    const envelope: Envelope = {
      messageId: "<kept@agency.example>",
      folder: "inbox",
      folderPath: "INBOX",
      uidValidity: 1,
      uid: 1,
      date: "2026-09-30T10:00:00.000Z",
      from: { address: "r@agency.example", name: null },
      to: [],
      cc: [],
      replyTo: [],
      inReplyTo: null,
      references: [],
      subject: "Backend Engineer",
      listId: null,
      listUnsubscribe: null,
      precedence: null,
      autoSubmitted: null,
      snippet: "",
    };
    await saveEnvelopes(
      deps.db,
      maria.workspaceId,
      [{ envelope, verdict: "likely_job", reason: null }],
      { mailboxId },
    );
    const seen: string[] = [];
    deps.live.subscribe(
      { workspaceId: maria.workspaceId, userId: maria.id, sessionId: "s" },
      (e) => seen.push(e.type),
      () => {},
    );
    oauth.revoke();

    const client = await connectMailbox(deps, maria.workspaceId, mailboxId);
    const error = await client
      ?.fetchSince({ folder: "inbox", uidValidity: null, afterUid: 0 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReconnectNeededError);
    expect(error).toBeInstanceOf(MailUnavailableError);
    expect(await client?.test()).toMatchObject({ ok: false, reason: "wrong_password" });
    await client?.close();
    expect(opened).toEqual([]);

    const mailbox = await stored(mailboxId);
    expect(mailbox.status).toBe("reconnect_needed");
    // Its tokens and its messages are all still there for when the user signs in again.
    expect(await tokensOf(mailboxId)).toEqual(tokens);
    const kept = await getStoredMessages(deps.db, maria.workspaceId, ["<kept@agency.example>"]);
    expect(kept).toHaveLength(1);
    await expect.poll(() => seen).toEqual(["workspace.updated", "mailbox.updated"]);

    // Logged once, as a warning, with ids only.
    await expect(mailboxLogin(deps, mailbox)).rejects.toBeInstanceOf(ReconnectNeededError);
    const lines = deps.logs.filter((l) => l.event === "mailbox.reconnect_needed");
    expect(lines).toEqual([
      expect.objectContaining({ level: "warn", workspaceId: maria.workspaceId, mailboxId }),
    ]);
    expect(deps.rawLogs.join("\n")).not.toMatch(/E2E-SECRET|gmail\.example/);
  });

  it("waits when Google can't be reached, as for a mail server that can't be", async () => {
    const { mailboxId } = await seedGoogleMailbox(deps, maria.workspaceId, {
      tokens: { expiresAt: inMinutes(0) },
    });
    deps.oauth = {
      ...oauth.port,
      refresh: async () => {
        throw new TypeError("fetch failed");
      },
    };
    const error = await mailboxLogin(deps, await stored(mailboxId)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailUnavailableError);
    expect(error).not.toBeInstanceOf(ReconnectNeededError);
    expect((error as MailUnavailableError).reason).toBe("unreachable");
    expect((await stored(mailboxId)).status).toBe("connected");
  });

  it("says when its tokens were sealed under another key", async () => {
    const { mailboxId } = await seedGoogleMailbox(deps, maria.workspaceId);
    const otherKey = { ...deps, config: { ...deps.config, secretKey: randomBytes(32) } };
    const mailbox = await stored(mailboxId);
    expect(() => connectStoredMailbox(otherKey, mailbox)).toThrow(MailboxSecretError);
    expect(opened).toEqual([]);
  });
});
