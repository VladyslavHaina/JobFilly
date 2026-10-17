import type { JobFacts } from "@jobfilly/schema";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DatabaseConnection, queryRows } from "../client";
import { decisionMessages, decisions, drafts } from "../tables";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import {
  createMailbox,
  deleteMailbox,
  getMailboxConnection,
  getMailboxRemovalSummary,
  listMailboxes,
  markMailboxReconnectNeeded,
  reconnectMailbox,
  updateMailboxSecret,
} from "./mailboxes";
import { saveAnalysis, saveEnvelopes } from "./messages";
import { createScan, stopScan } from "./scans";
import { listMailboxesToSync, recordSyncFailure } from "./sync";

let conn: DatabaseConnection;
let a: string;
let b: string;
let userA: string;

beforeEach(async () => {
  conn = await openTestDatabase();
  const ids: string[] = [];
  for (const key of ["a", "b"]) {
    const r = await registerAccount(conn.db, {
      name: key,
      email: `${key}@x.example`,
      passwordHash: "h",
      workspaceName: key,
    });
    if (!r.ok) throw new Error("expected ok");
    ids.push(r.workspaceId);
    if (key === "a") userA = r.user.id;
  }
  [a, b] = ids as [string, string];
});
afterEach(() => conn.close());

const mailbox = {
  address: "maria.santos@inbox.example",
  host: "imap.inbox.example",
  port: 993,
  tlsMode: "tls" as const,
  username: "maria.santos@inbox.example",
  secretCiphertext: "v1.sealed",
  sentFolderPath: "Sent",
};

describe("mailboxes", () => {
  // MVP 3 replaces MVP 1's one mailbox per workspace (F2.5) with one per address (F3.1).
  it("stores several mailboxes per workspace, one per address, the oldest first", async () => {
    const first = await createMailbox(conn.db, a, mailbox);
    expect(first.ok).toBe(true);
    expect(await createMailbox(conn.db, a, mailbox)).toEqual({ ok: false, reason: "exists" });
    const second = await createMailbox(conn.db, a, { ...mailbox, address: "other@inbox.example" });
    expect(second.ok).toBe(true);
    expect((await createMailbox(conn.db, b, mailbox)).ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("expected ok");
    expect(await getMailboxConnection(conn.db, a)).toEqual({
      mailboxId: first.mailboxId,
      ...mailbox,
      status: "connected",
      authKind: "password",
    });
    expect((await getMailboxConnection(conn.db, a, second.mailboxId))?.address).toBe(
      "other@inbox.example",
    );
    expect(await getMailboxConnection(conn.db, b, second.mailboxId)).toBeNull();
  });

  it("deletes the mailbox with its sealed secret, only within its workspace", async () => {
    const created = await createMailbox(conn.db, a, mailbox);
    if (!created.ok) throw new Error("expected ok");
    expect(await deleteMailbox(conn.db, b, created.mailboxId)).toBe(false);
    expect(await deleteMailbox(conn.db, a, created.mailboxId)).toBe(true);
    expect(await getMailboxConnection(conn.db, a)).toBeNull();
    const [row] = await queryRows<{ n: number }>(
      conn.db,
      sql`select count(*)::int as n from mailboxes where secret_ciphertext = 'v1.sealed'`,
    );
    expect(row?.n).toBe(0);
    expect((await createMailbox(conn.db, a, mailbox)).ok).toBe(true);
  });

  it("lists every mailbox of the workspace, the oldest first (F3.1)", async () => {
    const first = await createMailbox(conn.db, a, mailbox);
    const second = await createMailbox(conn.db, a, {
      ...mailbox,
      address: "maria.gmail@gmail.example",
      authKind: "google",
    });
    await createMailbox(conn.db, b, mailbox);
    if (!first.ok || !second.ok) throw new Error("expected ok");
    const listed = await listMailboxes(conn.db, a);
    expect(listed.map((m) => [m.mailboxId, m.authKind])).toEqual([
      [first.mailboxId, "password"],
      [second.mailboxId, "google"],
    ]);
  });
});

describe("a Google mailbox's sign-in (F3.2)", () => {
  async function google() {
    const created = await createMailbox(conn.db, a, {
      ...mailbox,
      address: "maria.gmail@gmail.example",
      authKind: "google",
      secretCiphertext: "v1.tokens",
    });
    if (!created.ok) throw new Error("expected ok");
    return created.mailboxId;
  }

  it("keeps refreshed tokens, only within its workspace", async () => {
    const id = await google();
    expect(await updateMailboxSecret(conn.db, b, id, "v1.other")).toBe(false);
    expect(await updateMailboxSecret(conn.db, a, id, "v1.refreshed")).toBe(true);
    expect((await getMailboxConnection(conn.db, a, id))?.secretCiphertext).toBe("v1.refreshed");
  });

  it("turns to reconnect needed once, and keeps it through failing syncs until reconnected", async () => {
    const id = await google();
    expect(await markMailboxReconnectNeeded(conn.db, b, id)).toBe(false);
    expect(await markMailboxReconnectNeeded(conn.db, a, id)).toBe(true);
    expect(await markMailboxReconnectNeeded(conn.db, a, id)).toBe(false);
    await recordSyncFailure(conn.db, a, id, {
      folderPath: "INBOX",
      failures: 1,
      nextAttemptAt: new Date(),
      reason: "wrong_password",
      message: "x",
      at: new Date(),
    });
    expect((await getMailboxConnection(conn.db, a, id))?.status).toBe("reconnect_needed");
    // The scheduler leaves it alone meanwhile.
    const scan = await createScan(conn.db, a, { kind: "first", startedBy: userA, at: new Date() });
    if (!scan.ok) throw new Error("expected ok");
    await stopScan(conn.db, a, scan.scan.id, "done", new Date());
    expect(await listMailboxesToSync(conn.db, "INBOX")).toEqual([]);

    const server = { host: "imap.gmail.example", port: 993, tlsMode: "tls" as const };
    expect(
      await reconnectMailbox(conn.db, a, id, {
        ...server,
        username: "maria.gmail@gmail.example",
        secretCiphertext: "v1.new",
        sentFolderPath: "[Gmail]/Sent Mail",
      }),
    ).toBe(true);
    expect(await getMailboxConnection(conn.db, a, id)).toMatchObject({
      ...server,
      status: "connected",
      secretCiphertext: "v1.new",
      sentFolderPath: "[Gmail]/Sent Mail",
      address: "maria.gmail@gmail.example",
      authKind: "google",
    });
    expect((await listMailboxesToSync(conn.db, "INBOX")).map((m) => m.mailboxId)).toEqual([id]);
  });
});

describe("disconnecting a mailbox (F7.4)", () => {
  const envelope = (n: number) => ({
    envelope: {
      messageId: `<m${n}@agency.example>`,
      folder: "inbox" as const,
      folderPath: "INBOX",
      uidValidity: 7,
      uid: n,
      date: "2026-10-01T10:00:00.000Z",
      from: { address: `r${n}@agency.example`, name: null },
      to: [],
      cc: [],
      replyTo: [],
      inReplyTo: null,
      references: [],
      subject: `Subject ${n}`,
      listId: null,
      listUnsubscribe: null,
      precedence: null,
      autoSubmitted: null,
      snippet: "",
    },
    verdict: "likely_job" as const,
    reason: null,
  });
  const facts: JobFacts = {
    title: "Backend Engineer",
    company: null,
    agency: null,
    places: [],
    workMode: null,
    remoteScope: null,
    timeZones: null,
    pay: null,
    contract: null,
    seniority: null,
    workPermit: null,
    skills: [],
    languages: [],
    applyUrl: null,
    extra: {},
  };

  /** Two mailboxes, two messages each with roles; m1 has a draft; decisions over them. */
  async function seed() {
    const home = await createMailbox(conn.db, a, {
      ...mailbox,
      address: "maria.home@post.example",
    });
    const work = await createMailbox(conn.db, a, mailbox);
    if (!home.ok || !work.ok) throw new Error("expected ok");
    await saveEnvelopes(conn.db, a, [envelope(1), envelope(2)], { mailboxId: home.mailboxId });
    await saveEnvelopes(conn.db, a, [envelope(3)], { mailboxId: work.mailboxId });
    for (const [n, count] of [
      [1, 2],
      [2, 1],
      [3, 1],
    ] as const) {
      await saveAnalysis(conn.db, a, {
        messageId: `<m${n}@agency.example>`,
        scanId: null,
        category: "recruiter_outreach",
        roles: Array.from({ length: count }, () => facts),
      });
    }
    const now = new Date();
    await conn.db.insert(drafts).values({
      workspaceId: a,
      messageId: "<m1@agency.example>",
      position: 0,
      status: "in_mailbox",
      origin: "auto",
      createdAt: now,
      updatedAt: now,
    });
    const decision = async (key: string, status: "open" | "answered", ns: number[]) => {
      const [row] = await conn.db
        .insert(decisions)
        .values({
          workspaceId: a,
          groupKey: key,
          question: "q",
          choices: [],
          status,
          createdAt: now,
        })
        .returning({ id: decisions.id });
      if (!row) throw new Error("no decision");
      for (const n of ns) {
        await conn.db.insert(decisionMessages).values({
          decisionId: row.id,
          workspaceId: a,
          messageId: `<m${n}@agency.example>`,
          position: 0,
          state: "waiting",
          source: "draft",
          createdAt: now,
          updatedAt: now,
        });
      }
      return row.id;
    };
    const only = await decision("only-home", "open", [1, 2]);
    const both = await decision("both", "open", [1, 3]);
    const answered = await decision("answered", "answered", [2]);
    return { home: home.mailboxId, work: work.mailboxId, only, both, answered };
  }

  const count = async (table: string) =>
    (
      await queryRows<{ n: number }>(
        conn.db,
        sql`select count(*)::int as n from ${sql.identifier(table)} where workspace_id = ${a}`,
      )
    )[0]?.n;

  it("says what goes before it goes", async () => {
    const { home, work } = await seed();
    expect(await getMailboxRemovalSummary(conn.db, a, home)).toEqual({
      address: "maria.home@post.example",
      messages: 2,
      roles: 3,
      drafts: 1,
      decisions: 1,
    });
    expect(await getMailboxRemovalSummary(conn.db, a, work)).toMatchObject({
      messages: 1,
      roles: 1,
      drafts: 0,
      decisions: 0,
    });
    expect(await getMailboxRemovalSummary(conn.db, b, home)).toBeNull();
  });

  it("deletes its messages and everything tied to them, and nothing of the other mailbox", async () => {
    const { home, work, only, both, answered } = await seed();
    expect(await deleteMailbox(conn.db, a, home)).toBe(true);
    expect(await count("messages")).toBe(1);
    expect(await count("roles")).toBe(1);
    expect(await count("drafts")).toBe(0);
    const left = await conn.db.select({ id: decisions.id }).from(decisions);
    // The decision that also waits on the work mailbox's role stays, and so does an answered one.
    expect(left.map((d) => d.id).sort()).toEqual([both, answered].sort());
    expect(left.map((d) => d.id)).not.toContain(only);
    expect((await listMailboxes(conn.db, a)).map((m) => m.mailboxId)).toEqual([work]);
  });
});
