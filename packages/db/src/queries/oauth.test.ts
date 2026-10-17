import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DatabaseConnection, queryRows } from "../client";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import { createMailbox, deleteMailbox } from "./mailboxes";
import { saveOAuthState, takeOAuthState } from "./oauth";

// The Google sign-ins waiting for their callback (MVP 3, F3.2): one use, within the expiry.

let conn: DatabaseConnection;
let ws: string;
let userId: string;

beforeEach(async () => {
  conn = await openTestDatabase();
  const r = await registerAccount(conn.db, {
    name: "Maria",
    email: "maria@inbox.example",
    passwordHash: "h",
    workspaceName: "w",
  });
  if (!r.ok) throw new Error("expected ok");
  ws = r.workspaceId;
  userId = r.user.id;
});
afterEach(() => conn.close());

const T0 = new Date("2026-10-16T10:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

const state = (hash: string, overrides: { mailboxId?: string | null; at?: Date } = {}) => ({
  userId,
  stateHash: hash,
  verifierCiphertext: "v1.verifier",
  mailboxId: overrides.mailboxId ?? null,
  createdAt: overrides.at ?? T0,
  expiresAt: new Date((overrides.at ?? T0).getTime() + 10 * 60_000),
});

const stored = async () =>
  (
    await queryRows<{ hash: string }>(
      conn.db,
      sql`select state_hash as hash from oauth_states order by state_hash`,
    )
  ).map((r) => r.hash);

describe("oauth states", () => {
  it("gives a waiting sign-in once, with its workspace and user", async () => {
    await saveOAuthState(conn.db, ws, state("h1"));
    expect(await takeOAuthState(conn.db, "h1", minutes(9))).toEqual({
      workspaceId: ws,
      userId,
      verifierCiphertext: "v1.verifier",
      mailboxId: null,
    });
    expect(await takeOAuthState(conn.db, "h1", minutes(9))).toBeNull();
    expect(await takeOAuthState(conn.db, "unknown", minutes(9))).toBeNull();
  });

  it("refuses an expired one and removes it all the same", async () => {
    await saveOAuthState(conn.db, ws, state("h1"));
    expect(await takeOAuthState(conn.db, "h1", minutes(10))).toBeNull();
    expect(await stored()).toEqual([]);
  });

  it("drops the workspace's expired sign-ins when a new one starts", async () => {
    await saveOAuthState(conn.db, ws, state("h1"));
    await saveOAuthState(conn.db, ws, state("h2", { at: minutes(5) }));
    expect(await stored()).toEqual(["h1", "h2"]);
    await saveOAuthState(conn.db, ws, state("h3", { at: minutes(11) }));
    expect(await stored()).toEqual(["h2", "h3"]);
  });

  it("names the mailbox a reconnect is for, and goes when that mailbox is disconnected", async () => {
    const created = await createMailbox(conn.db, ws, {
      address: "maria.gmail@gmail.example",
      host: "imap.gmail.example",
      port: 993,
      tlsMode: "tls",
      username: "maria.gmail@gmail.example",
      secretCiphertext: "v1.tokens",
      sentFolderPath: null,
      authKind: "google",
    });
    if (!created.ok) throw new Error("expected ok");
    await saveOAuthState(conn.db, ws, state("h1", { mailboxId: created.mailboxId }));
    await deleteMailbox(conn.db, ws, created.mailboxId);
    expect(await takeOAuthState(conn.db, "h1", minutes(1))).toBeNull();
  });
});
