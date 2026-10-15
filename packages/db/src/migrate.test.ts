import { fileURLToPath } from "node:url";
import type { SQL } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import type { Database } from "./client";
import { migrateLocked } from "./migrate";

// F7.3: replicas starting together migrate exactly once. migrateLocked takes a Postgres advisory
// lock, counts the pending migrations inside it and only then runs them. PGlite has a single
// session, so it can't show two replicas racing; these fakes record every statement and share one
// lock and one migrations table between "sessions", the way Postgres does between connections.

const dialect = new PgDialect();

/** One Postgres server as far as migrating goes: the advisory lock and the applied migrations. */
class FakeServer {
  /** Everything every session did, in order. */
  readonly log: string[] = [];
  private lockHeld = false;
  private waiting: (() => void)[] = [];
  /** folderMillis of the newest applied migration; null until the migrations table exists. */
  lastApplied: number | null = null;

  session(name: string): Database {
    const execute = async (query: SQL) => {
      const text = dialect.sqlToQuery(query).sql;
      if (text.includes("pg_advisory_lock(")) {
        this.log.push(`${name}: lock`);
        while (this.lockHeld) await new Promise<void>((resolve) => this.waiting.push(resolve));
        this.lockHeld = true;
        this.log.push(`${name}: locked`);
        return { rows: [{}] };
      }
      if (text.includes("pg_advisory_unlock(")) {
        this.log.push(`${name}: unlock`);
        this.lockHeld = false;
        this.waiting.shift()?.();
        return { rows: [{}] };
      }
      if (text.includes("to_regclass")) {
        this.log.push(`${name}: pending`);
        // Let the other session run in between, as a real round trip would.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { rows: [{ t: this.lastApplied === null ? null : "drizzle.__drizzle_migrations" }] };
      }
      if (text.includes("max(created_at)")) {
        return { rows: [{ created_at: this.lastApplied }] };
      }
      throw new Error(`unexpected statement: ${text}`);
    };
    return { execute } as unknown as Database;
  }

  /** The `run` a session passes: applies every migration of the folder, as drizzle's would. */
  runner(name: string, options: { fail?: boolean } = {}) {
    return async (folder: string) => {
      this.log.push(`${name}: run`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (options.fail) throw new Error("migration failed");
      const files = readMigrationFiles({ migrationsFolder: folder });
      this.lastApplied = Math.max(...files.map((f) => f.folderMillis));
    };
  }
}

const shipped = readMigrationFiles({
  migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
}).length;

describe("migrating under the advisory lock", () => {
  it("takes the lock before counting and running, and releases it afterwards", async () => {
    const server = new FakeServer();
    expect(await migrateLocked(server.session("a"), server.runner("a"))).toEqual({
      applied: shipped,
    });
    expect(server.log).toEqual(["a: lock", "a: locked", "a: pending", "a: run", "a: unlock"]);
  });

  it("releases the lock when a migration fails", async () => {
    const server = new FakeServer();
    await expect(
      migrateLocked(server.session("a"), server.runner("a", { fail: true })),
    ).rejects.toThrow(/migration failed/);
    expect(server.log).toEqual(["a: lock", "a: locked", "a: pending", "a: run", "a: unlock"]);
    // The next replica can take the lock and migrate.
    expect(await migrateLocked(server.session("b"), server.runner("b"))).toEqual({
      applied: shipped,
    });
  });

  it("applies nothing and never runs once the migrations are applied", async () => {
    const server = new FakeServer();
    await migrateLocked(server.session("a"), server.runner("a"));
    server.log.length = 0;
    expect(await migrateLocked(server.session("b"), server.runner("b"))).toEqual({ applied: 0 });
    expect(server.log).toEqual(["b: lock", "b: locked", "b: pending", "b: unlock"]);
  });

  it("migrates exactly once when two replicas start together", async () => {
    const server = new FakeServer();
    const results = await Promise.all([
      migrateLocked(server.session("a"), server.runner("a")),
      migrateLocked(server.session("b"), server.runner("b")),
    ]);
    expect(results.map((r) => r.applied).sort()).toEqual([0, shipped]);
    expect(server.log.filter((line) => line.endsWith(": run"))).toHaveLength(1);
    // The second replica counted only after the first had released the lock.
    const firstUnlock = server.log.findIndex((line) => line.endsWith(": unlock"));
    const pendings = server.log.flatMap((line, i) => (line.endsWith(": pending") ? [i] : []));
    expect(pendings).toHaveLength(2);
    expect(pendings[1]).toBeGreaterThan(firstUnlock);
  });
});
