import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { queryRows } from "./client";
import {
  claimDraft,
  type DatabaseConnection,
  getEvaluations,
  insertCv,
  linkProfileCv,
  listProfileCvs,
  openDatabase,
  registerAccount,
  saveAnalysis,
  saveEnvelopes,
  saveEvaluation,
} from "./index";
import { createConfirmedProfile } from "./queries/profiles";
import { drafts, matchAiAnswers, roleCvChoices } from "./tables";
import { openTestDatabase } from "./testing";

let conn: DatabaseConnection | undefined;
afterEach(async () => {
  await conn?.close();
  conn = undefined;
});

describe("migrations", () => {
  it("applies the MVP 1 and MVP 2 migrations once, then reports nothing to apply", async () => {
    conn = await openTestDatabase({ migrated: false });
    expect(await conn.migrationState()).toBe("missing");
    expect(await conn.migrate()).toEqual({ applied: 2 });
    expect(await conn.migrate()).toEqual({ applied: 0 });
    expect(await conn.migrationState()).toBe("current");
  });

  it("creates every table, each workspace-owned one with workspace_id", async () => {
    conn = await openTestDatabase();
    const rows = await queryRows<{ table_name: string; has_workspace: boolean }>(
      conn.db,
      sql`select t.table_name,
            exists (select 1 from information_schema.columns c
                    where c.table_name = t.table_name and c.column_name = 'workspace_id')
              as has_workspace
          from information_schema.tables t
          where t.table_schema = 'public' order by t.table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      "ai_settings",
      "ai_usage",
      "assistant_messages",
      "assistant_proposals",
      "assistant_threads",
      "cvs",
      "decision_messages",
      "decisions",
      "domain_lookups",
      "drafts",
      "intake_answers",
      "intake_extras",
      "invites",
      "jobs",
      "mailbox_sync",
      "mailboxes",
      "match_ai_answers",
      "memberships",
      "messages",
      "profile_cvs",
      "profile_history",
      "profiles",
      "role_cv_choices",
      "role_evaluations",
      "roles",
      "rules",
      "scans",
      "sender_checks",
      "sender_marks",
      "sessions",
      "users",
      "workspaces",
    ]);
    const global = ["sessions", "users", "workspaces"];
    for (const r of rows) expect(r.has_workspace).toBe(!global.includes(r.table_name));
  });

  it("loads pg_trgm and indexes the search text with it", async () => {
    conn = await openTestDatabase();
    const [ext] = await queryRows<{ n: number }>(
      conn.db,
      sql`select count(*)::int as n from pg_extension where extname = 'pg_trgm'`,
    );
    expect(ext?.n).toBe(1);
    const [index] = await queryRows<{ indexdef: string }>(
      conn.db,
      sql`select indexdef from pg_indexes where indexname = 'messages_search_text_trgm_idx'`,
    );
    expect(index?.indexdef).toContain("gin_trgm_ops");
  });

  it("gives each test its own empty database", async () => {
    conn = await openTestDatabase();
    await conn.db.execute(
      sql`insert into users (name, email, password_hash) values ('A', 'a@x.example', 'h')`,
    );
    await conn.close();
    conn = await openTestDatabase();
    const [row] = await queryRows<{ n: number }>(
      conn.db,
      sql`select count(*)::int as n from users`,
    );
    expect(row?.n).toBe(0);
  });
});

const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

/** A migrations folder holding only MVP 1's migration, as a deployment before MVP 2 had. */
function mvp1Folder(): string {
  const dir = mkdtempSync(join(tmpdir(), "jobfilly-mvp1-"));
  mkdirSync(join(dir, "meta"));
  copyFileSync(join(MIGRATIONS, "0000_mvp1.sql"), join(dir, "0000_mvp1.sql"));
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, "meta", "_journal.json"), "utf8"));
  journal.entries = journal.entries.slice(0, 1);
  writeFileSync(join(dir, "meta", "_journal.json"), JSON.stringify(journal));
  return dir;
}

async function seedWorkspace(db: DatabaseConnection["db"]) {
  const r = await registerAccount(db, {
    name: "Maria",
    email: "maria@inbox.example",
    passwordHash: "h",
    workspaceName: "w",
  });
  if (!r.ok) throw new Error("expected ok");
  return { ws: r.workspaceId, userId: r.user.id };
}

describe("the MVP 2 migration", () => {
  it("gives saved AI settings a model for each new task, from their extract model", async () => {
    conn = await openTestDatabase({ migrated: false });
    const folder = mvp1Folder();
    try {
      await migrate(conn.db as unknown as PgliteDatabase, { migrationsFolder: folder });
    } finally {
      rmSync(folder, { recursive: true });
    }
    const { ws } = await seedWorkspace(conn.db);
    await conn.db.execute(
      sql`insert into ai_settings (workspace_id, provider, models) values (${ws}, 'anthropic',
        ${JSON.stringify({ classify: "small", extract: "big", prefs: "big", intake: "big" })}::jsonb)`,
    );
    expect(await conn.migrate()).toEqual({ applied: 1 });
    const [row] = await queryRows<{ models: Record<string, string> }>(
      conn.db,
      sql`select models from ai_settings where workspace_id = ${ws}`,
    );
    expect(row?.models).toEqual({
      classify: "small",
      extract: "big",
      prefs: "big",
      intake: "big",
      cv: "big",
      match: "big",
      draft: "big",
      assistant: "big",
    });
  });

  it("keeps CV files at 5 MB or less", async () => {
    conn = await openTestDatabase();
    const { ws, userId } = await seedWorkspace(conn.db);
    const cv = (size: number) =>
      insertCv(conn?.db as DatabaseConnection["db"], ws, {
        name: "CV",
        fileName: "cv.pdf",
        mediaType: "pdf",
        bytes: new Uint8Array(size),
        contentHash: "a".repeat(64),
        createdBy: userId,
        at: new Date(),
      });
    await expect(cv(5 * 1024 * 1024)).resolves.toMatchObject({ sizeBytes: 5 * 1024 * 1024 });
    await expect(cv(5 * 1024 * 1024 + 1)).rejects.toThrow();
  });

  it("deletes a CV with its links, overrides and stored answers, and keeps drafts and evaluations", async () => {
    conn = await openTestDatabase();
    const db = conn.db;
    const { ws, userId } = await seedWorkspace(db);
    const at = new Date("2026-10-01T10:00:00Z");
    const messageId = "<cv-delete@agency.example>";
    await saveEnvelopes(db, ws, [
      {
        envelope: {
          messageId,
          folder: "inbox",
          folderPath: "INBOX",
          uidValidity: 1,
          uid: 1,
          date: at.toISOString(),
          from: { address: "r@agency.example", name: null },
          to: [],
          cc: [],
          replyTo: [],
          inReplyTo: null,
          references: [],
          subject: "s",
          listId: null,
          listUnsubscribe: null,
          precedence: null,
          autoSubmitted: null,
          snippet: "",
        },
        verdict: "likely_job",
        reason: null,
      },
    ]);
    await saveAnalysis(db, ws, {
      messageId,
      scanId: null,
      category: "recruiter_outreach",
      roles: [
        {
          title: "Backend",
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
        },
      ],
    });
    const created = await createConfirmedProfile(db, ws, {
      name: "p",
      entries: [],
      createdBy: userId,
      at,
    });
    if (!created.ok) throw new Error("expected a profile");
    const cv = await insertCv(db, ws, {
      name: "Data engineering (EN)",
      fileName: "data.pdf",
      mediaType: "pdf",
      bytes: new Uint8Array([1, 2, 3]),
      contentHash: "b".repeat(64),
      createdBy: userId,
      at,
    });
    const role = { messageId, position: 0 };
    await linkProfileCv(db, ws, created.profile.id, cv.id);
    await db.insert(roleCvChoices).values({ workspaceId: ws, ...role, cvId: cv.id, chosenAt: at });
    await db.insert(matchAiAnswers).values({
      workspaceId: ws,
      ...role,
      cvId: cv.id,
      inputHash: "c".repeat(64),
      answer: { titleFit: { verdict: "fits", reason: "r" }, skillCloseness: [] },
    });
    await saveEvaluation(
      db,
      ws,
      messageId,
      {
        position: 0,
        match: null,
        hidden: null,
        ruleEffects: [],
        cvChoice: { cvId: cv.id, reason: "Data role", source: "auto" },
      },
      at,
    );
    const draft = await claimDraft(db, ws, role, { origin: "on_demand", now: at });
    await db
      .update(drafts)
      .set({ status: "in_mailbox", cvId: cv.id })
      .where(eq(drafts.id, draft?.id ?? ""));

    await db.execute(sql`delete from cvs where id = ${cv.id}`);

    expect(await listProfileCvs(db, ws, created.profile.id)).toEqual([]);
    expect(await db.select().from(roleCvChoices)).toEqual([]);
    expect(await db.select().from(matchAiAnswers)).toEqual([]);
    const [kept] = await db.select().from(drafts);
    expect(kept).toMatchObject({ id: draft?.id, status: "in_mailbox", cvId: null });
    const [evaluation] = await getEvaluations(db, ws, [messageId]);
    expect(evaluation?.cvChoice).toEqual({ cvId: null, reason: "Data role", source: "auto" });
  });
});

describe("openDatabase", () => {
  it("fails to ping a database that can't be reached", async () => {
    conn = openDatabase("postgres://jobfilly:x@127.0.0.1:1/jobfilly");
    await expect(conn.ping()).rejects.toThrow();
  });
});
