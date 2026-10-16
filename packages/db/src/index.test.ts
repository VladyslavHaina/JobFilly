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
import {
  assistantMessages,
  assistantThreads,
  drafts,
  matchAiAnswers,
  roleCvChoices,
  rules,
} from "./tables";
import { openTestDatabase } from "./testing";

let conn: DatabaseConnection | undefined;
afterEach(async () => {
  await conn?.close();
  conn = undefined;
});

// A worker's first PGlite start (initdb in WebAssembly, then migrating and loading the template
// in testing.ts) takes 5-10 seconds on a quiet machine and over 30 at load 50-119, and the first
// tests below each pay for one. vitest.config.ts gives this project the room (hookTimeout and
// testTimeout are set together); this fails without it.
describe("room on a loaded machine", () => {
  it("gives a test and its hooks 120 seconds", ({ task }) => {
    expect(task.timeout).toBeGreaterThanOrEqual(120_000);
  });
});

describe("migrations", () => {
  it("applies every migration (MVP 1, MVP 2, the CV preferred flag) once, then nothing", async () => {
    conn = await openTestDatabase({ migrated: false });
    expect(await conn.migrationState()).toBe("missing");
    expect(await conn.migrate()).toEqual({ applied: 3 });
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
      "stage_failures",
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

async function seedWorkspace(db: DatabaseConnection["db"], email = "maria@inbox.example") {
  const r = await registerAccount(db, {
    name: "Maria",
    email,
    passwordHash: "h",
    workspaceName: "w",
  });
  if (!r.ok) throw new Error("expected ok");
  return { ws: r.workspaceId, userId: r.user.id };
}

/** One analysed job message with one role. */
async function seedJobMessage(db: DatabaseConnection["db"], ws: string, messageId: string) {
  const at = new Date("2026-10-01T10:00:00Z");
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
}

async function seedProfileAndCv(db: DatabaseConnection["db"], ws: string, userId: string) {
  const at = new Date("2026-10-01T10:00:00Z");
  const created = await createConfirmedProfile(db, ws, {
    name: "p",
    entries: [],
    createdBy: userId,
    at,
  });
  if (!created.ok) throw new Error("expected a profile");
  const cv = await insertCv(db, ws, {
    name: "Backend (EN)",
    fileName: "cv.pdf",
    mediaType: "pdf",
    bytes: new Uint8Array([1, 2, 3]),
    contentHash: "b".repeat(64),
    createdBy: userId,
    at,
  });
  return { profileId: created.profile.id, cvId: cv.id };
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
    // MVP 2's migration, and the CV preferred flag's after it.
    expect(await conn.migrate()).toEqual({ applied: 2 });
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
    await seedJobMessage(db, ws, messageId);
    const { profileId, cvId } = await seedProfileAndCv(db, ws, userId);
    const role = { messageId, position: 0 };
    await linkProfileCv(db, ws, profileId, cvId);
    await db.insert(roleCvChoices).values({ workspaceId: ws, ...role, cvId, chosenAt: at });
    await db.insert(matchAiAnswers).values({
      workspaceId: ws,
      ...role,
      cvId,
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
        cvChoice: { cvId, reason: "Data role", source: "auto" },
      },
      at,
    );
    const draft = await claimDraft(db, ws, role, { origin: "on_demand", now: at });
    await db
      .update(drafts)
      .set({ status: "in_mailbox", cvId })
      .where(eq(drafts.id, draft?.id ?? ""));

    await db.execute(sql`delete from cvs where id = ${cvId}`);

    expect(await listProfileCvs(db, ws, profileId)).toEqual([]);
    expect(await db.select().from(roleCvChoices)).toEqual([]);
    expect(await db.select().from(matchAiAnswers)).toEqual([]);
    const [kept] = await db.select().from(drafts);
    expect(kept).toMatchObject({ id: draft?.id, status: "in_mailbox", cvId: null });
    const [evaluation] = await getEvaluations(db, ws, [messageId]);
    expect(evaluation?.cvChoice).toEqual({ cvId: null, reason: "Data role", source: "auto" });
  });
});

describe("references across workspaces", () => {
  it("refuses a link, an override, an evaluation, a draft, a rule or an assistant message that points into another workspace", async () => {
    conn = await openTestDatabase();
    const db = conn.db;
    const a = await seedWorkspace(db, "maria@inbox.example");
    const b = await seedWorkspace(db, "tom@inbox.example");
    const ownA = await seedProfileAndCv(db, a.ws, a.userId);
    const ofB = await seedProfileAndCv(db, b.ws, b.userId);
    const messageId = "<cross@agency.example>";
    await seedJobMessage(db, a.ws, messageId);
    const at = new Date("2026-10-01T10:00:00Z");

    await expect(linkProfileCv(db, a.ws, ofB.profileId, ofB.cvId)).rejects.toThrow();
    await expect(linkProfileCv(db, a.ws, ownA.profileId, ofB.cvId)).rejects.toThrow();
    await expect(linkProfileCv(db, a.ws, ofB.profileId, ownA.cvId)).rejects.toThrow();
    await expect(
      db
        .insert(roleCvChoices)
        .values({ workspaceId: a.ws, messageId, position: 0, cvId: ofB.cvId, chosenAt: at }),
    ).rejects.toThrow();
    const evaluation = (cvId: string) =>
      saveEvaluation(
        db,
        a.ws,
        messageId,
        {
          position: 0,
          match: null,
          hidden: null,
          ruleEffects: [],
          cvChoice: { cvId, reason: "r", source: "auto" },
        },
        at,
      );
    await expect(evaluation(ofB.cvId)).rejects.toThrow();
    const draft = await claimDraft(
      db,
      a.ws,
      { messageId, position: 0 },
      { origin: "auto", now: at },
    );
    await expect(
      db
        .update(drafts)
        .set({ cvId: ofB.cvId })
        .where(eq(drafts.id, draft?.id ?? "")),
    ).rejects.toThrow();
    const rule = (profileId: string) =>
      db.insert(rules).values({
        workspaceId: a.ws,
        profileId,
        description: "d",
        conditions: [],
        action: "hide",
        source: "you",
        createdAt: at,
        updatedAt: at,
      });
    await expect(rule(ofB.profileId)).rejects.toThrow();
    const [threadOfB] = await db
      .insert(assistantThreads)
      .values({ workspaceId: b.ws, userId: b.userId, createdAt: at, updatedAt: at })
      .returning({ id: assistantThreads.id });
    await expect(
      db.insert(assistantMessages).values({
        workspaceId: a.ws,
        threadId: threadOfB?.id ?? "",
        role: "user",
        turn: 1,
        text: "t",
        createdAt: at,
      }),
    ).rejects.toThrow();

    // The same references inside the workspace are fine.
    await linkProfileCv(db, a.ws, ownA.profileId, ownA.cvId);
    await evaluation(ownA.cvId);
    await rule(ownA.profileId);
    expect(await listProfileCvs(db, a.ws, ownA.profileId)).toHaveLength(1);
  });
});

describe("openDatabase", () => {
  it("fails to ping a database that can't be reached", async () => {
    conn = openDatabase("postgres://jobfilly:x@127.0.0.1:1/jobfilly");
    await expect(conn.ping()).rejects.toThrow();
  });
});
