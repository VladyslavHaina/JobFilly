import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { type DatabaseConnection, queryRows } from "./client";
import { migrateLocked, pendingMigrations } from "./migrate";
import { pgliteNotifier } from "./notify";

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

export interface TestDatabaseOptions {
  /** Leave the database empty (no migrations applied), to test migrating itself. */
  migrated?: boolean;
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
  const db = drizzle({ client: pglite });
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
