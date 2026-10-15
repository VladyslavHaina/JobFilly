import { EventEmitter } from "node:events";
import type pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseConnection } from "./client";
import { pgNotifier } from "./notify";
import { openTestDatabase } from "./testing";

let conn: DatabaseConnection | undefined;
afterEach(async () => {
  await conn?.close();
  conn = undefined;
});

const nextTick = () => new Promise((r) => setTimeout(r, 10));

describe("LISTEN/NOTIFY on PGlite", () => {
  it("delivers a payload to every listener of the channel, until it unlistens", async () => {
    conn = await openTestDatabase();
    const a: string[] = [];
    const b: string[] = [];
    const stopA = await conn.notifier.listen("live_events", (p) => a.push(p));
    await conn.notifier.listen("live_events", (p) => b.push(p));
    await conn.notifier.listen("other_channel", () => a.push("wrong"));
    await conn.notifier.notify("live_events", '{"n":1}');
    await nextTick();
    expect(a).toEqual(['{"n":1}']);
    expect(b).toEqual(['{"n":1}']);
    await stopA();
    await conn.notifier.notify("live_events", '{"n":2}');
    await nextTick();
    expect(a).toEqual(['{"n":1}']);
    expect(b).toEqual(['{"n":1}', '{"n":2}']);
  });

  it("refuses channel names that aren't plain identifiers", async () => {
    conn = await openTestDatabase();
    await expect(conn.notifier.listen('x"; drop table users; --', () => {})).rejects.toThrow(
      /invalid channel/,
    );
    await expect(conn.notifier.notify("Bad-Name", "x")).rejects.toThrow(/invalid channel/);
  });
});

/** A stand-in for pg.Client: records queries and lets the test raise notifications and errors. */
class FakeClient extends EventEmitter {
  queries: string[] = [];
  ended = false;
  async connect() {}
  async query(text: string) {
    this.queries.push(text);
    return { rows: [] };
  }
  async end() {
    this.ended = true;
  }
}

describe("LISTEN/NOTIFY on node-postgres", () => {
  function setup() {
    const clients: FakeClient[] = [];
    const pool = { query: vi.fn(async () => ({ rows: [] })) } as unknown as pg.Pool;
    const errors: Error[] = [];
    const notifier = pgNotifier(
      pool,
      {},
      {
        createClient: () => {
          const c = new FakeClient();
          clients.push(c);
          return c as unknown as pg.Client;
        },
        onError: (e) => errors.push(e),
        reconnectDelayMs: 1,
      },
    );
    return { clients, pool, errors, notifier };
  }

  it("listens on one dedicated connection and notifies through the pool", async () => {
    const { clients, pool, notifier } = setup();
    const got: string[] = [];
    await notifier.listen("live_events", (p) => got.push(p));
    await notifier.listen("live_events", (p) => got.push(`2:${p}`));
    expect(clients).toHaveLength(1);
    expect(clients[0]?.queries).toEqual(['LISTEN "live_events"']);
    clients[0]?.emit("notification", { channel: "live_events", payload: "hi" });
    expect(got).toEqual(["hi", "2:hi"]);
    await notifier.notify("live_events", "x");
    expect(pool.query).toHaveBeenCalledWith("select pg_notify($1, $2)", ["live_events", "x"]);
    await notifier.close();
    expect(clients[0]?.ended).toBe(true);
  });

  it("reconnects after the connection fails and listens to every channel again", async () => {
    const { clients, errors, notifier } = setup();
    const got: string[] = [];
    await notifier.listen("a_channel", (p) => got.push(p));
    await notifier.listen("b_channel", (p) => got.push(p));
    clients[0]?.emit("error", new Error("connection lost"));
    await vi.waitFor(() => expect(clients[1]?.queries).toHaveLength(2));
    expect(errors.map((e) => e.message)).toEqual(["connection lost"]);
    expect(clients[1]?.queries.sort()).toEqual(['LISTEN "a_channel"', 'LISTEN "b_channel"']);
    clients[1]?.emit("notification", { channel: "b_channel", payload: "again" });
    expect(got).toEqual(["again"]);
    await notifier.close();
  });

  it("unlistens when the last callback of a channel goes", async () => {
    const { clients, notifier } = setup();
    const stop = await notifier.listen("a_channel", () => {});
    await stop();
    expect(clients[0]?.queries).toEqual(['LISTEN "a_channel"', 'UNLISTEN "a_channel"']);
    await notifier.close();
  });
});
