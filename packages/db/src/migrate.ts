import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { type Database, queryRows } from "./client";

/**
 * The migrations folder: packages/db/migrations next to this file's src/ folder, or, in the
 * server bundle, the copy the build puts next to dist/index.js (dist/migrations).
 */
const MIGRATIONS_FOLDER =
  [
    fileURLToPath(new URL("../migrations", import.meta.url)),
    fileURLToPath(new URL("./migrations", import.meta.url)),
  ].find((dir) => existsSync(join(dir, "meta", "_journal.json"))) ??
  fileURLToPath(new URL("../migrations", import.meta.url));

/** The advisory lock that keeps replicas starting together from migrating at the same time. */
const MIGRATION_LOCK_KEY = 7_461_726_810;

/** How many shipped migrations the database hasn't applied yet. */
export async function pendingMigrations(
  db: Database,
  folder: string = MIGRATIONS_FOLDER,
): Promise<number> {
  const files = readMigrationFiles({ migrationsFolder: folder });
  const [table] = await queryRows<{ t: string | null }>(
    db,
    sql`select to_regclass('drizzle.__drizzle_migrations')::text as t`,
  );
  if (!table?.t) return files.length;
  const [last] = await queryRows<{ created_at: string | number | null }>(
    db,
    sql`select max(created_at) as created_at from drizzle.__drizzle_migrations`,
  );
  const lastMillis = Number(last?.created_at ?? 0);
  return files.filter((m) => m.folderMillis > lastMillis).length;
}

/**
 * Applies the pending migrations under a Postgres advisory lock and says how many this call
 * applied, so of several replicas starting together exactly one reports them. `db` must be one
 * session (a dedicated connection): the lock belongs to the session that took it.
 */
export async function migrateLocked(
  db: Database,
  run: (folder: string) => Promise<void>,
  folder: string = MIGRATIONS_FOLDER,
): Promise<{ applied: number }> {
  await db.execute(sql`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`);
  try {
    const pending = await pendingMigrations(db, folder);
    if (pending > 0) await run(folder);
    return { applied: pending };
  } finally {
    await db.execute(sql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`);
  }
}
