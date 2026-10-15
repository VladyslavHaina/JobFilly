import type { DatabaseConnection } from "@jobfilly/db";
import { describe, expect, it } from "vitest";
import { createHealth } from "./deps";

function fakeConnection(state: { reachable: boolean; migrated: boolean }): DatabaseConnection {
  return {
    db: undefined as never,
    notifier: undefined as never,
    migrate: async () => ({ applied: 0 }),
    migrationState: async () => (state.migrated ? "current" : "missing"),
    ping: async () => {
      if (!state.reachable) throw new Error("connection refused");
    },
    close: async () => {},
  };
}

describe("readiness", () => {
  it("is ready only when the database is reachable and migrated", async () => {
    const state = { reachable: false, migrated: false };
    const health = createHealth(fakeConnection(state));
    expect(await health.check()).toEqual({ status: "not_ready", reason: "database_unreachable" });
    state.reachable = true;
    expect(await health.check()).toEqual({ status: "not_ready", reason: "migrations_missing" });
    state.migrated = true;
    expect(await health.check()).toEqual({ status: "ready" });
    // The database goes away (Postgres stopped), then comes back.
    state.reachable = false;
    expect(await health.check()).toEqual({ status: "not_ready", reason: "database_unreachable" });
    state.reachable = true;
    expect(await health.check()).toEqual({ status: "ready" });
  });

  it("turns not ready at once when shutdown begins", async () => {
    const health = createHealth(fakeConnection({ reachable: true, migrated: true }));
    expect(health.shuttingDown).toBe(false);
    health.beginShutdown();
    expect(health.shuttingDown).toBe(true);
    expect(await health.check()).toEqual({ status: "not_ready", reason: "shutting_down" });
  });
});
