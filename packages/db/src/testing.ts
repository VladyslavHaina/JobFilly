import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { type Database, type DatabaseConnection, queryRows } from "./client";
import { migrateLocked, pendingMigrations } from "./migrate";
import { checkChannel, type Notifier } from "./notify";
import type { RoleRef } from "./queries/evaluations";
import { activityLog, drafts } from "./tables";

// Tests run against PGlite (Postgres compiled to WebAssembly) in memory: no Docker, no network.
// Starting PGlite takes about a second, so each test process migrates once, copies the result
// for every new instance, and hands closed instances to the next test after emptying them.

let template: Promise<File | Blob> | null = null;
const idle: PGlite[] = [];

function migratedTemplate(): Promise<File | Blob> {
  template ??= (async () => {
    const pglite = await PGlite.create({ extensions: { pg_trgm } });
    const db = drizzle({ client: pglite });
    await migrateLocked(db, (migrationsFolder) => migrate(db, { migrationsFolder }));
    const dump = await pglite.dumpDataDir("none");
    await pglite.close();
    return dump;
  })();
  return template;
}

async function emptyTables(pglite: PGlite): Promise<void> {
  const db = drizzle({ client: pglite });
  const tables = await queryRows<{ tablename: string }>(
    db,
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await pglite.exec(`truncate table ${list} cascade`);
}

/** LISTEN/NOTIFY on an in-memory PGlite database (tests only). */
function pgliteNotifier(db: PGlite): Notifier {
  const unlistens = new Set<() => Promise<void>>();
  return {
    async listen(channel, onPayload) {
      const stop = await db.listen(checkChannel(channel), onPayload);
      const unlisten = async () => {
        if (!unlistens.delete(unlisten)) return;
        await stop();
      };
      unlistens.add(unlisten);
      return unlisten;
    },
    async notify(channel, payload) {
      await db.query("select pg_notify($1, $2)", [checkChannel(channel), payload]);
    },
    async close() {
      await Promise.all([...unlistens].map((u) => u()));
    },
  };
}

export interface TestDatabaseOptions {
  /** Leave the database empty (no migrations applied), to test migrating itself. */
  migrated?: boolean;
  /** Sees every statement the queries send, to test how one is written (its plan, its locks). */
  logQuery?: (query: string, params: unknown[]) => void;
}

/**
 * Opens an empty in-memory database, migrated unless asked otherwise, with pg_trgm loaded.
 * close() empties it and keeps it for the next test of the same process.
 */
export async function openTestDatabase(
  options: TestDatabaseOptions = {},
): Promise<DatabaseConnection> {
  const migrated = options.migrated ?? true;
  const pglite =
    (migrated ? idle.pop() : undefined) ??
    (await PGlite.create({
      extensions: { pg_trgm },
      ...(migrated ? { loadDataDir: await migratedTemplate() } : {}),
    }));
  const logQuery = options.logQuery;
  const db = drizzle({ client: pglite, ...(logQuery ? { logger: { logQuery } } : {}) });
  const notifier = pgliteNotifier(pglite);
  let closed = false;
  return {
    db,
    notifier,
    migrate: () => migrateLocked(db, (migrationsFolder) => migrate(db, { migrationsFolder })),
    async migrationState() {
      return (await pendingMigrations(db)) === 0 ? "current" : "missing";
    },
    async ping() {
      if (closed) throw new Error("the database is closed");
      await db.execute(sql`select 1`);
    },
    async close() {
      if (closed) return;
      closed = true;
      await notifier.close();
      if (migrated) {
        await emptyTables(pglite);
        idle.push(pglite);
      } else {
        await pglite.close();
      }
    },
  };
}

/**
 * The plan of a statement the queries sent (seen through openTestDatabase's logQuery), its
 * parameters written in as literals: one line per plan row. Index scans and merge joins are off
 * while it is planned, so no path hands rows over already in order: an ORDER BY the statement
 * has shows as a Sort node, under the LockRows of its FOR UPDATE.
 */
export async function explainQuery(
  db: Database,
  query: string,
  params: unknown[],
): Promise<string[]> {
  const literal = (v: unknown) =>
    typeof v === "number" || typeof v === "boolean"
      ? String(v)
      : `'${String(v instanceof Date ? v.toISOString() : v).replaceAll("'", "''")}'`;
  const text = query.replace(/\$(\d+)/g, (_, n: string) => literal(params[Number(n) - 1]));
  return db.transaction(async (tx) => {
    for (const setting of ["enable_indexscan", "enable_bitmapscan", "enable_mergejoin"]) {
      await tx.execute(sql.raw(`set local ${setting} = off`));
    }
    const rows = await queryRows<{ "QUERY PLAN": string }>(
      tx,
      sql.raw(`explain (costs off) ${text}`),
    );
    return rows.map((r) => r["QUERY PLAN"]);
  });
}

/**
 * Puts the role's claimed draft in the mailbox state, as draft.create leaves it once the copy is
 * in the Drafts folder: for tests that need a draft the user may already be editing there. Only a
 * `saving` row of the workspace moves; returns whether one did.
 */
export async function markTestDraftInMailbox(
  db: Database,
  workspaceId: string,
  role: RoleRef,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(drafts)
    .set({ status: "in_mailbox", claimedAt: null, updatedAt: now })
    .where(
      and(
        eq(drafts.workspaceId, workspaceId),
        eq(drafts.messageId, role.messageId),
        eq(drafts.position, role.position),
        eq(drafts.status, "saving"),
      ),
    )
    .returning({ id: drafts.id });
  return rows.length > 0;
}

/**
 * The workspace's activity log rows as stored, oldest first (tests only): what recordActivity
 * wrote, before the workspace-admin slice's reader words them (MVP 3, F9).
 */
export async function activityRows(db: Database, workspaceId: string) {
  return db
    .select({
      kind: activityLog.kind,
      actorKind: activityLog.actorKind,
      actorId: activityLog.actorId,
      targetUserId: activityLog.targetUserId,
      refs: activityLog.refs,
    })
    .from(activityLog)
    .where(eq(activityLog.workspaceId, workspaceId))
    .orderBy(activityLog.at, activityLog.id);
}
