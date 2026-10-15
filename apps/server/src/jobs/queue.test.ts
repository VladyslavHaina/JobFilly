import { claimJob, enqueueJob, getJob, saveJobCheckpoint } from "@jobfilly/db";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestDeps, seedUser, type TestDeps } from "../testing";
import { defineJob, type JobContext, type JobRegistry, LeaseLostError } from "./queue";
import { jobRegistry } from "./registry";
import { scanRunHandler } from "./scan/index";

let deps: TestDeps | undefined;
afterEach(async () => {
  await deps?.close();
  deps = undefined;
});

const Payload = z.object({ n: z.number() });
type P = z.infer<typeof Payload>;

async function setup(handler: (ctx: JobContext<P>) => Promise<void>, leaseMs?: number) {
  const registry: JobRegistry = { "test.job": defineJob(Payload, handler) };
  deps = await createTestDeps({ registry, leaseMs });
  const user = await seedUser(deps);
  return { deps, workspaceId: user.workspaceId };
}

describe("the job queue worker", () => {
  it("runs a job with its validated payload and marks it done", async () => {
    const seen: P[] = [];
    const { deps, workspaceId } = await setup(async (ctx) => {
      seen.push(ctx.payload);
      expect(ctx.checkpoint).toBeNull();
      expect(ctx.previousInstance).toBeNull();
    });
    const { id } = await enqueueJob(deps.db, workspaceId, {
      type: "test.job",
      payload: { n: 7 },
      now: deps.clock.now(),
    });
    expect(await deps.queue.runOnce()).toBe(true);
    expect(seen).toEqual([{ n: 7 }]);
    expect((await getJob(deps.db, id))?.status).toBe("done");
    expect(await deps.queue.runOnce()).toBe(false);
  });

  it("fails a job whose payload is invalid or whose handler throws", async () => {
    const { deps, workspaceId } = await setup(async () => {
      throw new Error("boom");
    });
    const now = deps.clock.now();
    const bad = await enqueueJob(deps.db, workspaceId, {
      type: "test.job",
      payload: { n: "x" },
      now,
    });
    const throws = await enqueueJob(deps.db, workspaceId, {
      type: "test.job",
      payload: { n: 1 },
      now,
    });
    await deps.queue.runOnce();
    await deps.queue.runOnce();
    expect((await getJob(deps.db, bad.id))?.status).toBe("failed");
    expect((await getJob(deps.db, throws.id))?.status).toBe("failed");
    expect(deps.logs.filter((l) => l.event === "job.failed")).toHaveLength(2);
    expect(deps.logs.find((l) => l.event === "job.failed")).toMatchObject({
      level: "error",
      jobType: "test.job",
      workspaceId,
    });
  });

  it("takes over a job whose lease expired, resuming from its checkpoint", async () => {
    let ctxSeen: JobContext<P> | undefined;
    const { deps, workspaceId } = await setup(async (ctx) => {
      ctxSeen = ctx;
    });
    const { id } = await enqueueJob(deps.db, workspaceId, {
      type: "test.job",
      payload: { n: 1 },
      now: deps.clock.now(),
    });
    // app-a claims it, saves a checkpoint and dies.
    await claimJob(deps.db, {
      owner: "app-a",
      types: ["test.job"],
      now: deps.clock.now(),
      leaseMs: 30_000,
    });
    await saveJobCheckpoint(deps.db, id, {
      owner: "app-a",
      checkpoint: { batch: 2 },
      now: deps.clock.now(),
    });
    expect(await deps.queue.runOnce()).toBe(false);
    deps.clock.advance(30_000);
    expect(await deps.queue.runOnce()).toBe(true);
    expect(ctxSeen?.previousInstance).toBe("app-a");
    expect(ctxSeen?.checkpoint).toEqual({ batch: 2 });
    expect(deps.logs.find((l) => l.event === "job.lease_expired")).toMatchObject({
      level: "warn",
      instance: "test-instance",
      previousInstance: "app-a",
      jobId: id,
    });
    expect((await getJob(deps.db, id))?.status).toBe("done");
  });

  it("stops a handler whose lease was taken over, without completing the job", async () => {
    const { deps, workspaceId } = await setup(async (ctx) => {
      await ctx.saveCheckpoint({ step: 1 });
      // Another replica takes over while this one stalls past its lease.
      deps.clock.advance(31_000);
      await claimJob(deps.db, {
        owner: "app-b",
        types: ["test.job"],
        now: deps.clock.now(),
        leaseMs: 30_000,
      });
      await expect(ctx.saveCheckpoint({ step: 2 })).rejects.toBeInstanceOf(LeaseLostError);
      expect(ctx.signal.aborted).toBe(true);
      throw ctx.signal.reason;
    });
    const { id } = await enqueueJob(deps.db, workspaceId, {
      type: "test.job",
      payload: { n: 1 },
      now: deps.clock.now(),
    });
    await deps.queue.runOnce();
    const job = await getJob(deps.db, id);
    expect(job).toMatchObject({ status: "running", leaseOwner: "app-b", checkpoint: { step: 1 } });
    expect(deps.logs.some((l) => l.event === "job.failed")).toBe(false);
  });

  it("on stop, aborts running handlers and hands their jobs back", async () => {
    let started!: () => void;
    const running = new Promise<void>((r) => {
      started = r;
    });
    const { deps, workspaceId } = await setup(async (ctx) => {
      started();
      await new Promise((_, reject) => {
        ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason));
      });
    });
    const { id } = await enqueueJob(deps.db, workspaceId, {
      type: "test.job",
      payload: { n: 1 },
      now: deps.clock.now(),
    });
    deps.queue.start();
    await running;
    expect(deps.queue.running).toBe(1);
    await deps.queue.stop();
    expect(await getJob(deps.db, id)).toMatchObject({
      status: "queued",
      leaseOwner: null,
      previousOwner: "test-instance",
    });
    expect(deps.logs.some((l) => l.event === "job.handed_back")).toBe(true);
    expect(deps.queue.running).toBe(0);
  });

  it("renews the lease on its own while the handler works", async () => {
    let release!: () => void;
    const { deps, workspaceId } = await setup(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
      300,
    );
    const t0 = deps.clock.now().getTime();
    const { id } = await enqueueJob(deps.db, workspaceId, {
      type: "test.job",
      payload: { n: 1 },
      now: deps.clock.now(),
    });
    const done = deps.queue.runOnce();
    await expect
      .poll(async () => (await getJob(deps.db, id))?.leaseExpiresAt?.getTime())
      .toBe(t0 + 300);
    deps.clock.advance(250);
    // The timer renews every third of the lease: from now, 300 ms more.
    await expect
      .poll(async () => (await getJob(deps.db, id))?.leaseExpiresAt?.getTime())
      .toBe(t0 + 550);
    deps.clock.advance(100);
    const other = await claimJob(deps.db, {
      owner: "app-b",
      types: ["test.job"],
      now: deps.clock.now(),
      leaseMs: 1000,
    });
    expect(other).toBeNull();
    release();
    await done;
    expect((await getJob(deps.db, id))?.status).toBe("done");
  });
});

describe("the registry", () => {
  it("runs 'scan.run' jobs with scanRunHandler and checks their payload", () => {
    const def = jobRegistry["scan.run"];
    expect(def?.handler).toBe(scanRunHandler);
    expect(def?.payload.safeParse({ scanId: "x", workspaceId: "y" }).success).toBe(false);
  });
});
