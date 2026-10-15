import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { type DatabaseConnection, openDatabase, queryRows } from "./index";
import { openTestDatabase } from "./testing";

let conn: DatabaseConnection | undefined;
afterEach(async () => {
  await conn?.close();
  conn = undefined;
});

describe("migrations", () => {
  it("applies the one MVP 1 migration once, then reports nothing to apply", async () => {
    conn = await openTestDatabase({ migrated: false });
    expect(await conn.migrationState()).toBe("missing");
    expect(await conn.migrate()).toEqual({ applied: 1 });
    expect(await conn.migrate()).toEqual({ applied: 0 });
    expect(await conn.migrationState()).toBe("current");
  });

  it("creates every MVP 1 table, each workspace-owned one with workspace_id", async () => {
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
      "intake_answers",
      "intake_extras",
      "invites",
      "jobs",
      "mailboxes",
      "memberships",
      "messages",
      "profiles",
      "roles",
      "scans",
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

describe("openDatabase", () => {
  it("fails to ping a database that can't be reached", async () => {
    conn = openDatabase("postgres://jobfilly:x@127.0.0.1:1/jobfilly");
    await expect(conn.ping()).rejects.toThrow();
  });
});
