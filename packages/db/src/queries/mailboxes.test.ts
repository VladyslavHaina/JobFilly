import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DatabaseConnection, queryRows } from "../client";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import { createMailbox, deleteMailbox, getMailboxConnection } from "./mailboxes";

let conn: DatabaseConnection;
let a: string;
let b: string;

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
});
