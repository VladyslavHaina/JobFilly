import {
  createConfirmedProfile,
  getEvaluations,
  getJob,
  listToEvaluate,
  markStale,
} from "@jobfilly/db";
import {
  jobDedupeKey,
  PIPELINE_REEVALUATE_JOB,
  PipelineReevaluatePayloadSchema,
} from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineJob } from "../jobs/queue";
import { jobRegistry } from "../jobs/registry";
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
} from "../testing";
import { reevaluateWorkspace, requestRun } from "./reevaluate";

// The pipeline.reevaluate job: it works through a snapshot of everything missing or stale (the
// first scan's backlog, F1.6, and every later change), each message once per run, and asks for
// the next run only when something changed while it ran.

const NOW = new Date("2026-10-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

let deps: TestDeps;
let mailbox: FakeMailbox;
let maria: SeededUser;
let ws: string;
let stages: RecordingStages;

beforeEach(async () => {
  stages = recordingStages();
  deps = await createTestDeps({
    now: NOW,
    // The job runs the recording stages instead of the slices' ones.
    registry: {
      ...jobRegistry,
      [PIPELINE_REEVALUATE_JOB]: defineJob(PipelineReevaluatePayloadSchema, (ctx) =>
        reevaluateWorkspace(ctx.deps, ctx.payload.workspaceId, { stages, signal: ctx.signal }).then(
          () => {},
        ),
      ),
    },
  });
  mailbox = createFakeMailbox();
  deps.mail = mailbox.port;
  maria = await seedUser(deps);
  ws = maria.workspaceId;
  await seedMailbox(deps, ws, {
    address: "maria.santos@inbox.example",
    conn: { host: "imap", port: 3143, tlsMode: "tls", username: "maria", password: "E2E-SECRET-p" },
    sentFolderPath: "Sent",
  });
});
afterEach(() => deps.close());

const confirm = () =>
  createConfirmedProfile(deps.db, ws, { name: "p", entries: [], createdBy: maria.id, at: NOW });

async function backlog(n: number) {
  for (let i = 1; i <= n; i++) {
    await seedJobMail(deps, ws, mailbox, {
      messageId: `<b${i}@agency.example>`,
      receivedAt: new Date(NOW.getTime() - (20 + i) * DAY),
    });
  }
}

const queued = async () => {
  const run = await requestRun(deps, ws, "probe");
  return { id: run.id, alreadyQueued: !run.enqueued };
};

describe("pipeline.reevaluate", () => {
  it("evaluates the whole backlog once the profile is confirmed (F1.6)", async () => {
    await backlog(25);
    // Before the intake is confirmed only the sender checks run.
    await reevaluateWorkspace(deps, ws, { stages });
    expect(stages.calls.filter((c) => c.startsWith("sender"))).toHaveLength(25);
    expect(stages.calls.filter((c) => c.startsWith("match"))).toHaveLength(0);
    expect(await listToEvaluate(deps.db, ws)).toHaveLength(25);

    await confirm();
    stages.calls.length = 0;
    const outcome = await reevaluateWorkspace(deps, ws, { stages });
    expect(outcome).toEqual({ processed: 25, retried: 0, next: false });
    expect(stages.calls.filter((c) => c.startsWith("match"))).toHaveLength(25);
    // The checks were done already: no body was fetched again.
    expect(stages.calls.filter((c) => c.startsWith("sender"))).toHaveLength(0);
    expect(await listToEvaluate(deps.db, ws)).toEqual([]);
  });

  it("logs in to the mailbox once per run, not once per message", async () => {
    await confirm();
    await backlog(25);
    await reevaluateWorkspace(deps, ws, { stages });
    expect(mailbox.calls.fetchBody).toBe(25);
    expect(mailbox.calls.connect).toBe(1);
    // A run that needs no body never opens it.
    await markStale(deps.db, ws, { all: true }, NOW);
    await reevaluateWorkspace(deps, ws, { stages });
    expect(mailbox.calls.connect).toBe(1);
  });

  it("processes each item once per run, so a failing stage can't make it loop", async () => {
    await confirm();
    await backlog(2);
    stages.failing.match = "<b1@agency.example>";
    const outcome = await reevaluateWorkspace(deps, ws, { stages });
    expect(outcome.processed).toBe(2);
    expect(stages.calls.filter((c) => c === "match <b1@agency.example>#0")).toHaveLength(1);
    // The failure waits for the next sweep; nothing new happened, so no next run is asked for.
    expect(outcome.next).toBe(false);
    expect(await queued()).toMatchObject({ alreadyQueued: false });
  });

  it("asks for the next run when a change is made while it runs", async () => {
    await confirm();
    await backlog(2);
    // Mid-run, something marks an already processed role stale again.
    const match = stages.match;
    stages.match = async (input, ctx) => {
      const evaluation = await match(input, ctx);
      if (input.message.messageId === "<b2@agency.example>") {
        await markStale(deps.db, ws, { messageIds: ["<b1@agency.example>"] }, deps.clock.now());
      }
      return evaluation;
    };
    const outcome = await reevaluateWorkspace(deps, ws, { stages });
    expect(outcome.next).toBe(true);
    const waiting = await queued();
    expect(waiting.alreadyQueued).toBe(true);
    expect(await getJob(deps.db, ws, waiting.id)).toMatchObject({
      type: PIPELINE_REEVALUATE_JOB,
      status: "queued",
      payload: { workspaceId: ws, reason: "changed_during_run" },
    });
  });

  it("asks for the next run when new mail arrives while it runs", async () => {
    await confirm();
    await backlog(1);
    const match = stages.match;
    stages.match = async (input, ctx) => {
      await seedJobMail(deps, ws, mailbox, { messageId: "<late@x.example>", receivedAt: NOW });
      return match(input, ctx);
    };
    expect((await reevaluateWorkspace(deps, ws, { stages })).next).toBe(true);
  });

  it("runs as a queued job, deduped per workspace, and keeps a change made during it", async () => {
    await confirm();
    await backlog(3);
    const first = await requestRun(deps, ws, "intake.confirmed");
    const again = await requestRun(deps, ws, "rule.changed");
    expect(again).toEqual({ id: first.id, enqueued: false });
    expect(await deps.queue.runOnce()).toBe(true);
    expect(await getJob(deps.db, ws, first.id)).toMatchObject({ status: "done" });
    expect(await listToEvaluate(deps.db, ws)).toEqual([]);
    const rows = await getEvaluations(deps.db, ws, ["<b1@agency.example>"]);
    expect(rows[0]?.match?.score).toBe(75);
    // Nothing left: the queue is empty again.
    expect(await deps.queue.runOnce()).toBe(false);
    expect(jobDedupeKey.reevaluate(ws)).toBe(`reevaluate:${ws}`);
  });
});
