import type { Envelope, JobFacts } from "@jobfilly/schema";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DatabaseConnection, queryRows } from "../client";
import { openTestDatabase } from "../testing";
import {
  accountDeletionPreview,
  deleteAccount,
  findUserByEmail,
  registerAccount,
} from "./accounts";
import { listActivity, recordActivity } from "./activity";
import { insertCv } from "./cvs";
import { exportCvFile, exportPage, listCvFiles } from "./export";
import { createInvite } from "./invites";
import { createMailbox } from "./mailboxes";
import { saveAnalysis, saveEnvelopes } from "./messages";
import { addMember, createWorkspace, deleteWorkspace, listMembers } from "./workspaces";

// The workspace's data (MVP 3, F7): the export read in pages, deleting a workspace with
// everything it holds, and deleting an account so that no row keeps the user's name or email.

let conn: DatabaseConnection;
let maria: { userId: string; workspaceId: string };
let tom: { userId: string; workspaceId: string };
const at = new Date("2026-10-16T10:00:00.000Z");

async function register(name: string, email: string) {
  const r = await registerAccount(conn.db, {
    name,
    email,
    passwordHash: "h",
    workspaceName: `${name}'s workspace`,
  });
  if (!r.ok) throw new Error("expected ok");
  return { userId: r.user.id, workspaceId: r.workspaceId };
}

const facts = (title: string): JobFacts => ({
  title,
  company: "Nordlicht",
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
});

function envelope(n: number): Envelope {
  return {
    messageId: `<m${n}@agency.example>`,
    folder: "inbox",
    folderPath: "INBOX",
    uidValidity: 1,
    uid: n,
    date: new Date(Date.UTC(2026, 8, 1) + n * 60_000).toISOString(),
    from: { address: `sender${n}@agency.example`, name: `Sender ${n}` },
    to: [{ address: "maria@inbox.example", name: null }],
    cc: [],
    replyTo: [],
    inReplyTo: null,
    references: [],
    subject: `Role ${n}`,
    listId: null,
    listUnsubscribe: null,
    precedence: null,
    autoSubmitted: null,
    snippet: `Snippet ${n}`,
  };
}

/** A workspace holding a bit of everything: a mailbox, mail with roles, a CV, an invite, activity. */
async function fill(workspaceId: string, by: string, count = 3) {
  await createMailbox(conn.db, workspaceId, {
    address: `box-${workspaceId}@inbox.example`,
    host: "imap.inbox.example",
    port: 993,
    tlsMode: "tls",
    username: "u",
    secretCiphertext: "SEALED-SECRET",
    sentFolderPath: "Sent",
  });
  await saveEnvelopes(
    conn.db,
    workspaceId,
    Array.from({ length: count }, (_, i) => ({
      envelope: envelope(i),
      verdict: "likely_job" as const,
      reason: null,
    })),
  );
  for (let i = 0; i < count; i++) {
    await saveAnalysis(conn.db, workspaceId, {
      messageId: `<m${i}@agency.example>`,
      scanId: null,
      category: "recruiter_outreach",
      roles: [facts(`Engineer ${i}`)],
    });
  }
  await insertCv(conn.db, workspaceId, {
    name: "Backend CV",
    fileName: "maria-backend.pdf",
    mediaType: "pdf",
    bytes: new TextEncoder().encode("%PDF-CVFILE"),
    contentHash: "c".repeat(64),
    createdBy: by,
    at,
  });
  await recordActivity(
    conn.db,
    workspaceId,
    {
      kind: "export.downloaded",
      actor: { kind: "user", userId: by },
      targetUserId: null,
      refs: {},
    },
    at,
  );
}

/** Every row of every table, as JSON text, the way pg_dump would see the data. */
async function everyRow(): Promise<string> {
  const tables = await queryRows<{ tablename: string }>(
    conn.db,
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const out: string[] = [];
  for (const { tablename } of tables) {
    const rows = await queryRows<{ row: unknown }>(
      conn.db,
      sql`select row_to_json(t) as row from ${sql.identifier(tablename)} t`,
    );
    out.push(...rows.map((r) => JSON.stringify(r.row)));
  }
  return out.join("\n");
}

/** How many rows each table with a workspace_id holds for the workspace (non-zero only). */
async function rowsOf(workspaceId: string): Promise<Record<string, number>> {
  const tables = await queryRows<{ table_name: string }>(
    conn.db,
    sql`select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'workspace_id'`,
  );
  const counts: Record<string, number> = {};
  for (const { table_name } of tables) {
    const [row] = await queryRows<{ n: number }>(
      conn.db,
      sql`select count(*)::int as n from ${sql.identifier(table_name)} where workspace_id = ${workspaceId}`,
    );
    if (row?.n) counts[table_name] = row.n;
  }
  return counts;
}

beforeEach(async () => {
  conn = await openTestDatabase();
  maria = await register("Maria Santos", "maria.santos@inbox.example");
  tom = await register("Tom Okafor", "tom.okafor@inbox.example");
});
afterEach(() => conn.close());

describe("the export, read in pages (F7.1)", () => {
  it("reads every row of a part once, page by page, and only the workspace's own", async () => {
    await fill(maria.workspaceId, maria.userId, 7);
    await fill(tom.workspaceId, tom.userId, 2);
    const seen: string[] = [];
    let after: string | null = null;
    let pages = 0;
    do {
      const page = await exportPage(conn.db, maria.workspaceId, "messages", after, 3);
      seen.push(...page.rows.map((r) => String(r.messageId)));
      after = page.after;
      pages += 1;
    } while (after);
    expect(pages).toBe(3);
    expect(seen.sort()).toEqual(Array.from({ length: 7 }, (_, i) => `<m${i}@agency.example>`));
    const facts = await exportPage(conn.db, maria.workspaceId, "facts", null, 100);
    expect(facts.rows).toHaveLength(7);
    expect(facts.rows[0]).toMatchObject({ position: 0, facts: { company: "Nordlicht" } });
    expect(facts.after).toBeNull();
  });

  it("lists the CV files and reads each one, with no secret in any part", async () => {
    await fill(maria.workspaceId, maria.userId);
    const files = await listCvFiles(conn.db, maria.workspaceId);
    expect(files.map((f) => f.fileName)).toEqual(["maria-backend.pdf"]);
    const bytes = await exportCvFile(conn.db, maria.workspaceId, files[0]?.id ?? "");
    expect(new TextDecoder().decode(bytes ?? new Uint8Array())).toBe("%PDF-CVFILE");
    expect(await exportCvFile(conn.db, tom.workspaceId, files[0]?.id ?? "")).toBeNull();
    const parts = ["profiles", "rules", "cvs", "messages", "facts", "matches"] as const;
    // pipeline.json is built by the server (loadPipeline); its export test checks it too.
    for (const part of [...parts, "decisions", "drafts"] as const) {
      const page = await exportPage(conn.db, maria.workspaceId, part, null, 100);
      expect(JSON.stringify(page.rows)).not.toContain("SEALED-SECRET");
      expect(JSON.stringify(page.rows)).not.toContain("%PDF-CVFILE");
    }
  });
});

describe("deleting a workspace (F7.2)", () => {
  it("removes every row it holds, credentials and CV files included, and nothing else", async () => {
    await fill(maria.workspaceId, maria.userId);
    await fill(tom.workspaceId, tom.userId);
    await addMember(conn.db, tom.workspaceId, maria.userId, "editor");
    expect(Object.keys(await rowsOf(tom.workspaceId))).toEqual(
      expect.arrayContaining(["mailboxes", "messages", "roles", "cvs", "activity_log"]),
    );
    const before = await rowsOf(maria.workspaceId);

    expect(await deleteWorkspace(conn.db, tom.workspaceId)).toEqual({
      memberIds: expect.arrayContaining([tom.userId, maria.userId]),
    });
    expect(await rowsOf(tom.workspaceId)).toEqual({});
    expect(await everyRow()).not.toContain(tom.workspaceId);
    expect(await rowsOf(maria.workspaceId)).toEqual(before);
    expect(await deleteWorkspace(conn.db, tom.workspaceId)).toBeNull();
  });
});

describe("deleting an account (F7.3)", () => {
  it("lists the workspaces it owns with their members, and those it just leaves", async () => {
    const shared = await createWorkspace(conn.db, { name: "Tom's search", ownerId: tom.userId });
    await addMember(conn.db, shared.id, maria.userId, "viewer");
    await addMember(conn.db, maria.workspaceId, tom.userId, "editor");
    expect(await accountDeletionPreview(conn.db, tom.userId)).toEqual({
      owned: [
        { workspaceId: tom.workspaceId, name: "Tom Okafor's workspace", members: [] },
        {
          workspaceId: shared.id,
          name: "Tom's search",
          members: [{ userId: maria.userId, name: "Maria Santos" }],
        },
      ],
      memberOf: [{ workspaceId: maria.workspaceId, name: "Maria Santos's workspace" }],
    });
  });

  it("deletes what it owns, leaves the rest, and leaves neither name nor email behind", async () => {
    await addMember(conn.db, maria.workspaceId, tom.userId, "admin");
    await fill(tom.workspaceId, tom.userId);
    await recordActivity(
      conn.db,
      maria.workspaceId,
      {
        kind: "member.role_changed",
        actor: { kind: "user", userId: tom.userId },
        targetUserId: tom.userId,
        refs: { role: "admin" },
      },
      at,
    );
    // An invite Tom sent from Maria's workspace, and one to his email elsewhere.
    for (const [ws, email, by] of [
      [maria.workspaceId, "someone@else.example", tom.userId],
      [maria.workspaceId, "tom.okafor@inbox.example", maria.userId],
    ] as const) {
      await createInvite(conn.db, ws, {
        email,
        role: "viewer",
        tokenHash: `${email}-hash`,
        invitedBy: by,
        now: at,
        expiresAt: new Date(at.getTime() + 60_000),
      });
    }

    const result = await deleteAccount(
      conn.db,
      { id: tom.userId, email: "tom.okafor@inbox.example" },
      new Date(at.getTime() + 1000),
    );
    expect(result).toMatchObject({
      deletedWorkspaces: [{ workspaceId: tom.workspaceId, memberIds: [] }],
      leftWorkspaceIds: [maria.workspaceId],
    });
    expect(await findUserByEmail(conn.db, "tom.okafor@inbox.example")).toBeNull();
    expect(await rowsOf(tom.workspaceId)).toEqual({});
    expect((await listMembers(conn.db, maria.workspaceId)).map((m) => m.name)).toEqual([
      "Maria Santos",
    ]);
    const dump = await everyRow();
    expect(dump).not.toContain("tom.okafor@inbox.example");
    expect(dump).not.toContain("Tom Okafor");
    expect(dump).not.toContain(tom.userId);
    // His actions stay in Maria's log with the actor gone, and so does the deletion itself.
    const log = await listActivity(conn.db, maria.workspaceId, { limit: 10 });
    expect(log.items.map((e) => [e.kind, e.actorKind, e.actorId, e.targetUserId])).toEqual([
      ["account.deleted", "user", null, null],
      ["member.role_changed", "user", null, null],
    ]);
  });
});
