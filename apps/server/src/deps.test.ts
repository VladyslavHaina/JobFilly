import { aggregateIntake } from "@jobfilly/core";
import type { DatabaseConnection } from "@jobfilly/db";
import { describe, expect, it } from "vitest";
import type { Config } from "./config";
import { createBackgroundWork, createDeps, createHealth } from "./deps";
import { createLogger } from "./log";

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

describe("createDeps", () => {
  it("wires the real intake aggregation from @jobfilly/core, not a stand-in", () => {
    const deps = createDeps({
      config: { instance: "test-instance" } as Config,
      connection: fakeConnection({ reachable: true, migrated: true }),
      log: createLogger({ level: "error", instance: "test-instance", write: () => {} }),
    });
    expect(deps.intake.aggregate).toBe(aggregateIntake);
  });

  it("wires a domain port, which a test or a slice can replace", async () => {
    const log = createLogger({ level: "error", instance: "test-instance", write: () => {} });
    const connection = fakeConnection({ reachable: true, migrated: true });
    const config = { instance: "test-instance", rdapUrl: "https://rdap.test" } as Config;
    const real = createDeps({ config, connection, log });
    expect(typeof real.domains.rdap).toBe("function");
    expect(typeof real.domains.mx).toBe("function");
    const domains = { rdap: async () => ({ registeredAt: null }), mx: async () => [] };
    expect(createDeps({ config, connection, log, domains }).domains).toBe(domains);
  });
});

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

describe("background work", () => {
  it("tracks a task until it finishes and passes its error on instead of rejecting", async () => {
    const work = createBackgroundWork();
    let finish = () => {};
    const ok = work.run(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
      () => {},
    );
    const errors: unknown[] = [];
    const failing = work.run(
      async () => {
        throw new Error("boom");
      },
      (e) => errors.push(e),
    );
    expect(work.running).toBe(2);
    await failing;
    expect(errors).toEqual([new Error("boom")]);
    expect(work.running).toBe(1);
    const settled = work.settled();
    finish();
    await settled;
    await ok;
    expect(work.running).toBe(0);
  });

  it("aborts running tasks on stop, waits for them to clean up, and aborts later ones at once", async () => {
    const work = createBackgroundWork();
    const steps: string[] = [];
    void work.run(
      (signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            steps.push("aborted");
            setTimeout(() => {
              steps.push("cleaned up");
              resolve();
            }, 5);
          });
        }),
      () => {},
    );
    await work.stop();
    steps.push("stopped");
    expect(steps).toEqual(["aborted", "cleaned up", "stopped"]);
    let late: AbortSignal | undefined;
    await work.run(
      async (signal) => {
        late = signal;
      },
      () => {},
    );
    expect(late?.aborted).toBe(true);
  });

  it("stops waiting for a task that ignores the abort after the grace period", async () => {
    const work = createBackgroundWork({ stopGraceMs: 10 });
    void work.run(
      () => new Promise<void>(() => {}),
      () => {},
    );
    await work.stop();
    expect(work.running).toBe(1);
  });
});
