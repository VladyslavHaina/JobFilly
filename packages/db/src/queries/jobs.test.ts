import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import {
  claimJob,
  completeJob,
  enqueueJob,
  getJob,
  handBackJob,
  MAX_LEASE_MS,
  renewLease,
  saveJobCheckpoint,
} from "./jobs";

let conn: DatabaseConnection;
let workspaceId: string;
const t0 = new Date("2026-10-01T10:00:00Z");
const after = (ms: number) => new Date(t0.getTime() + ms);

beforeEach(async () => {
  conn = await openTestDatabase();
  const r = await registerAccount(conn.db, {
    name: "Maria",
    email: "maria@inbox.example",
    passwordHash: "h",
    workspaceName: "Maria's workspace",
  });
  if (!r.ok) throw new Error("expected ok");
  workspaceId = r.workspaceId;
});
afterEach(() => conn.close());

const claim = (owner: string, now: Date, leaseMs = 10_000) =>
  claimJob(conn.db, { owner, types: ["scan.run"], now, leaseMs });

describe("the job queue", () => {
  it("claims the oldest queued job of the given types, never twice", async () => {
    const a = await enqueueJob(conn.db, workspaceId, {
      type: "scan.run",
      payload: { n: 1 },
      now: t0,
    });
    await enqueueJob(conn.db, workspaceId, { type: "other", payload: {}, now: t0 });
    const b = await enqueueJob(conn.db, workspaceId, {
      type: "scan.run",
      payload: { n: 2 },
      now: after(1),
    });
    const [first, second, third] = await Promise.all([
      claim("app-a", t0),
      claim("app-b", t0),
      claim("app-c", t0),
    ]);
    const claimed = [first, second, third].filter((j) => j !== null);
    expect(claimed.map((j) => j.id).sort()).toEqual([a.id, b.id].sort());
    expect(claimed.find((j) => j.id === a.id)).toMatchObject({
      type: "scan.run",
      workspaceId,
      payload: { n: 1 },
      checkpoint: null,
      attempts: 1,
      previousOwner: null,
      leaseExpired: false,
    });
    expect(await claim("app-d", t0)).toBeNull();
  });

  it("caps the lease at 30 seconds", async () => {
    const { id } = await enqueueJob(conn.db, workspaceId, {
      type: "scan.run",
      payload: {},
      now: t0,
    });
    await claim("app-a", t0, 10 * 60_000);
    expect((await getJob(conn.db, id))?.leaseExpiresAt).toEqual(after(MAX_LEASE_MS));
  });

  it("takes over an expired lease, records the previous owner and keeps the checkpoint", async () => {
    const { id } = await enqueueJob(conn.db, workspaceId, {
      type: "scan.run",
      payload: {},
      now: t0,
    });
    await claim("app-a", t0, 20_000);
    expect(
      await saveJobCheckpoint(conn.db, id, { owner: "app-a", checkpoint: { batch: 3 }, now: t0 }),
    ).toBe(true);
    expect(await claim("app-b", after(19_999))).toBeNull();
    const taken = await claim("app-b", after(20_000));
    expect(taken).toMatchObject({
      id,
      checkpoint: { batch: 3 },
      attempts: 2,
      previousOwner: "app-a",
      leaseExpired: true,
    });
    // The old owner has lost the job: none of its writes go through any more.
    expect(
      await renewLease(conn.db, id, { owner: "app-a", now: after(20_001), leaseMs: 10_000 }),
    ).toBe(false);
    expect(
      await saveJobCheckpoint(conn.db, id, { owner: "app-a", checkpoint: { batch: 9 }, now: t0 }),
    ).toBe(false);
    expect(await completeJob(conn.db, id, { owner: "app-a", status: "done", now: t0 })).toBe(false);
    expect((await getJob(conn.db, id))?.checkpoint).toEqual({ batch: 3 });
  });

  it("renewing keeps the lease alive", async () => {
    const { id } = await enqueueJob(conn.db, workspaceId, {
      type: "scan.run",
      payload: {},
      now: t0,
    });
    await claim("app-a", t0, 10_000);
    expect(
      await renewLease(conn.db, id, { owner: "app-a", now: after(9_000), leaseMs: 10_000 }),
    ).toBe(true);
    expect(await claim("app-b", after(15_000))).toBeNull();
    expect((await getJob(conn.db, id))?.leaseExpiresAt).toEqual(after(19_000));
  });

  it("a handed-back job is claimed again at once, naming who handed it back", async () => {
    const { id } = await enqueueJob(conn.db, workspaceId, {
      type: "scan.run",
      payload: {},
      now: t0,
    });
    await claim("app-a", t0);
    expect(await handBackJob(conn.db, id, { owner: "app-a", now: after(1) })).toBe(true);
    expect(await claim("app-b", after(2))).toMatchObject({
      id,
      previousOwner: "app-a",
      leaseExpired: false,
    });
  });

  it("a completed job is never claimed again", async () => {
    const { id } = await enqueueJob(conn.db, workspaceId, {
      type: "scan.run",
      payload: {},
      now: t0,
    });
    await claim("app-a", t0);
    expect(await completeJob(conn.db, id, { owner: "app-a", status: "done", now: t0 })).toBe(true);
    expect(await claim("app-b", after(60_000))).toBeNull();
    expect((await getJob(conn.db, id))?.status).toBe("done");
  });
});
