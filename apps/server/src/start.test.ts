import { createConfirmedProfile, getSenderChecks, listToEvaluate } from "@jobfilly/db";
import {
  PIPELINE_REEVALUATE_JOB,
  type PipelineReevaluatePayload,
  PipelineReevaluatePayloadSchema,
} from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineJob } from "./jobs/queue";
import { jobRegistry } from "./jobs/registry";
import { reevaluateWorkspace } from "./pipeline/reevaluate";
import { startWork } from "./start";
import { createScheduler, type Scheduler } from "./sync/scheduler";
import {
  createFakeMailbox,
  createTestDeps,
  type FakeMailbox,
  type RecordingStages,
  recordingStages,
  type SeededUser,
  seedJobMail,
  seedMailbox,
  seedUser,
  type TestDeps,
} from "./testing";

// The ready sequence index.ts runs once the database is migrated (F1.6, TBD-191): a deployment
// whose profile was confirmed before MVP 2 has job mail nobody evaluated, and nothing but the
// startup sweep evaluates it: no new mail, no intake confirm, no change.

const NOW = new Date("2026-10-15T12:00:00Z");

let deps: TestDeps;
let mailbox: FakeMailbox;
let maria: SeededUser;
let stages: RecordingStages;
let runs: PipelineReevaluatePayload[];
let scheduler: Scheduler;

beforeEach(async () => {
  stages = recordingStages();
  runs = [];
  deps = await createTestDeps({
    now: NOW,
    registry: {
      ...jobRegistry,
      [PIPELINE_REEVALUATE_JOB]: defineJob(PipelineReevaluatePayloadSchema, async (ctx) => {
        runs.push(ctx.payload);
        await reevaluateWorkspace(ctx.deps, ctx.payload.workspaceId, { stages });
      }),
    },
  });
  mailbox = createFakeMailbox();
  deps.mail = mailbox.port;
  maria = await seedUser(deps);
  await seedMailbox(deps, maria.workspaceId, {
    address: "maria.santos@inbox.example",
    conn: { host: "imap", port: 3143, tlsMode: "tls", username: "maria", password: "E2E-SECRET-p" },
    sentFolderPath: "Sent",
  });
  // A long interval: only the startup sweep can do anything during a test.
  scheduler = createScheduler(deps, { intervalMs: 60_000 });
});
afterEach(async () => {
  scheduler.stop();
  await deps.close();
});

describe("startWork", () => {
  it("evaluates an upgraded deployment's backlog at startup, then keeps the scheduler running", async () => {
    const ws = maria.workspaceId;
    await createConfirmedProfile(deps.db, ws, {
      name: "My job search",
      entries: [],
      createdBy: maria.id,
      at: NOW,
    });
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<backlog@agency.example>",
      receivedAt: NOW,
    });
    expect(scheduler.running).toBe(false);

    await startWork(deps, scheduler);

    expect(scheduler.running).toBe(true);
    await expect.poll(() => listToEvaluate(deps.db, ws)).toEqual([]);
    expect(runs).toEqual([{ workspaceId: ws, reason: "sweep" }]);
    expect(stages.calls).toContain("sender <backlog@agency.example>");
    expect(await getSenderChecks(deps.db, ws, ["<backlog@agency.example>"])).toHaveLength(1);
  });

  it("starts the queue and the scheduler when there is nothing to evaluate", async () => {
    await startWork(deps, scheduler);
    expect(scheduler.running).toBe(true);
    expect(deps.logs.filter((l) => l.event === "pipeline.sweep_failed")).toEqual([]);
    expect(runs).toEqual([]);
  });
});

// The backlog test above waits on the queue's background run with expect.poll, and every test
// here starts PGlite in beforeEach. On a machine at load 50-119 the run outlasted expect.poll's
// default second and a worker's first PGlite start Vitest's default hook timeout. vitest.config.ts
// gives this project the room (hookTimeout and testTimeout are set together); these fail without it.
describe("room on a loaded machine", () => {
  it("gives a test and its hooks 120 seconds", ({ task }) => {
    expect(task.timeout).toBeGreaterThanOrEqual(120_000);
  });

  it("keeps expect.poll polling past Vitest's 1-second default", async () => {
    const start = Date.now();
    await expect.poll(() => Date.now() - start).toBeGreaterThan(1_500);
  });
});
