import { type SQL, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import { migrateLocked, pendingMigrations } from "./migrate";
import { type Notifier, pgNotifier } from "./notify";

/** A Drizzle database or transaction on PostgreSQL (node-postgres at runtime, PGlite in tests). */
export type Database = PgDatabase<PgQueryResultHKT>;

/**
 * Runs a raw SQL statement and returns its rows. Both drivers answer `{ rows }`; prefer the query
 * builder, this is for the few statements it can't express.
 */
export async function queryRows<T>(db: Database, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}

/** An open database with what the server needs around the queries. */
export interface DatabaseConnection {
  db: Database;
  notifier: Notifier;
  /** Applies pending migrations under the advisory lock; `applied` is 0 when another did it. */
  migrate(): Promise<{ applied: number }>;
  /** "current" when every migration this build ships is applied. */
  migrationState(): Promise<"current" | "missing">;
  /** Throws when the database can't be reached. */
  ping(): Promise<void>;
  close(): Promise<void>;
}

export interface OpenDatabaseOptions {
  /** Errors of idle connections and of the LISTEN connection, which recover on their own. */
  onError?: (error: Error) => void;
  /** Where the migrations are; defaults to the folder shipped with this package. */
  migrationsFolder?: string;
}

/** Opens PostgreSQL at `url` (a postgres:// connection string) with a small pool. */
export function openDatabase(url: string, options: OpenDatabaseOptions = {}): DatabaseConnection {
  const config: pg.PoolConfig = { connectionString: url, connectionTimeoutMillis: 5000 };
  const pool = new pg.Pool({ ...config, max: 10, idleTimeoutMillis: 30_000 });
  pool.on("error", (error) => options.onError?.(error));
  const db: Database = drizzle({ client: pool });
  const notifier = pgNotifier(config, { onError: options.onError });
  return {
    db,
    notifier,
    async migrate() {
      const client = await pool.connect();
      try {
        const session = drizzle({ client });
        return await migrateLocked(
          session,
          (migrationsFolder) => migrate(session, { migrationsFolder }),
          options.migrationsFolder,
        );
      } finally {
        client.release();
      }
    },
    async migrationState() {
      return (await pendingMigrations(db, options.migrationsFolder)) === 0 ? "current" : "missing";
    },
    async ping() {
      await db.execute(sql`select 1`);
    },
    async close() {
      await notifier.close();
      await pool.end();
    },
  };
}
