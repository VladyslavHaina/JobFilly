import {
  claimDraft,
  createConfirmedProfile,
  getDraftClaim,
  getJob,
  getSenderChecks,
  listToEvaluate,
  markDraftFailed,
  saveEnvelopes,
} from "@jobfilly/db";
import {
  DRAFT_CREATE_JOB,
  jobDedupeKey,
  PIPELINE_REEVALUATE_JOB,
  PipelineReevaluatePayloadSchema,
} from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineJob, enqueue } from "../jobs/queue";
import { jobRegistry } from "../jobs/registry";
import { createScheduler } from "../sync/scheduler";
import {
  createFakeMailbox,
  createTestDeps,
  type FakeMailbox,
  type RecordingStages,
  recordingStages,
  roleFacts,
  type SeededUser,
  seedJobMail,
  seedMailbox,
  seedUser,
  type TestDeps,
} from "../testing";
import { reevaluateWorkspace, requestRun } from "./reevaluate";
import { sweep } from "./sweep";

// The sweep (TBD-191): at startup and every sync interval, one deduped pipeline.reevaluate for
// each workspace with work, so an upgraded deployment's backlog, a failed evaluation and a draft
// that failed with kind mailbox are all picked up without anyone doing anything.

const NOW = new Date("2026-10-15T12:00:00Z");

let deps: TestDeps;
let mailbox: FakeMailbox;
let maria: SeededUser;
let ws: string;
let stages: RecordingStages;

beforeEach(async () => {
  stages = recordingStages();
  deps = await createTestDeps({
    now: NOW,
    registry: {
      ...jobRegistry,
      [PIPELINE_REEVALUATE_JOB]: defineJob(PipelineReevaluatePayloadSchema, (ctx) =>
        reevaluateWorkspace(ctx.deps, ctx.payload.workspaceId, { stages }).then(() => {}),
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

/** The queued re-evaluation of the workspace, if one waits (a dedupe probe enqueues nothing). */
async function waitingRun(): Promise<string | null> {
  const probe = await requestRun(deps, ws, "probe");
  if (probe.enqueued) {
    // Nothing was waiting: take the probe back out by running it.
    await deps.queue.runOnce();
    return null;
  }
  return probe.id;
}

/** The waiting draft.create of a role, if any, the same way. */
async function waitingDraftJob(position: number) {
  const probe = await enqueue(deps, ws, {
    type: DRAFT_CREATE_JOB,
    payload: { workspaceId: ws, messageId: "<a@x.example>", position, origin: "retry" },
    dedupeKey: jobDedupeKey.draft(ws, "<a@x.example>", position),
  });
  return probe.enqueued ? null : getJob(deps.db, ws, probe.id);
}

describe("the sweep", () => {
  it("gives an upgraded deployment's backlog one re-evaluation at startup", async () => {
    // A profile confirmed before MVP 2 ran, and job mail never evaluated.
    await confirm();
    await seedJobMail(deps, ws, mailbox, { messageId: "<a@x.example>", receivedAt: NOW });
    expect(await sweep(deps)).toBe(1);
    expect(await sweep(deps)).toBe(1);
    const waiting = await waitingRun();
    expect(await getJob(deps.db, ws, waiting ?? "")).toMatchObject({
      type: PIPELINE_REEVALUATE_JOB,
      status: "queued",
      payload: { workspaceId: ws, reason: "sweep" },
    });
    expect(await deps.queue.runOnce()).toBe(true);
    expect(await deps.queue.runOnce()).toBe(false);
    expect(await listToEvaluate(deps.db, ws)).toEqual([]);
    expect(await sweep(deps)).toBe(0);
  });

  it("leaves a workspace without a confirmed profile alone", async () => {
    await seedJobMail(deps, ws, mailbox, { messageId: "<a@x.example>", receivedAt: NOW });
    expect(await sweep(deps)).toBe(0);
    expect(await waitingRun()).toBeNull();
  });

  it("retries a role whose evaluation failed on the next interval", async () => {
    await confirm();
    await seedJobMail(deps, ws, mailbox, { messageId: "<a@x.example>", receivedAt: NOW });
    stages.failing.match = "*";
    await sweep(deps);
    await deps.queue.runOnce();
    expect(await listToEvaluate(deps.db, ws)).toHaveLength(1);

    stages.failing = {};
    const scheduler = createScheduler(deps);
    await scheduler.tick();
    expect(await deps.queue.runOnce()).toBe(true);
    expect(await listToEvaluate(deps.db, ws)).toEqual([]);
  });

  it("checks a message gone from the mailbox once, then leaves it alone until it is seen again", async () => {
    await confirm();
    const envelope = await seedJobMail(deps, ws, mailbox, {
      messageId: "<gone@x.example>",
      receivedAt: NOW,
    });
    await seedJobMail(deps, ws, mailbox, { messageId: "<kept@x.example>", receivedAt: NOW });
    // The user deleted it before MVP 2 first ran.
    mailbox.expunge("<gone@x.example>");

    expect(await sweep(deps)).toBe(1);
    await deps.queue.runOnce();
    const [check] = await getSenderChecks(deps.db, ws, ["<gone@x.example>"]);
    expect(check).toMatchObject({
      verdict: "caution",
      complete: false,
      reasons: [{ signal: "message_gone" }],
      stale: false,
    });
    expect(await listToEvaluate(deps.db, ws)).toEqual([]);
    expect(deps.logs.filter((l) => l.event === "pipeline.message_gone")).toHaveLength(1);
    expect(deps.logs.filter((l) => l.event === "pipeline.stage_failed")).toEqual([]);

    // The next intervals have nothing to do: no run, no login, no fetch.
    const before = { ...mailbox.calls };
    const scheduler = createScheduler(deps);
    await scheduler.tick();
    await scheduler.tick();
    expect(await deps.queue.runOnce()).toBe(false);
    expect(mailbox.calls).toEqual(before);

    // A sync sees it again (it was moved back): its sender is checked with its text.
    const back = mailbox.deliver({ messageId: "<gone@x.example>", date: envelope.date });
    await saveEnvelopes(deps.db, ws, [{ envelope: back, verdict: "likely_job", reason: null }]);
    expect(await sweep(deps)).toBe(1);
    await deps.queue.runOnce();
    expect((await getSenderChecks(deps.db, ws, ["<gone@x.example>"]))[0]).toMatchObject({
      verdict: "looks_fine",
      complete: true,
      stale: false,
    });
  });

  it("re-claims a draft that failed with kind mailbox, and never one that failed on content", async () => {
    await confirm();
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<a@x.example>",
      receivedAt: NOW,
      roles: [roleFacts(), roleFacts({ title: "Other" })],
    });
    await sweep(deps);
    await deps.queue.runOnce();
    const mailboxDown = await claimDraft(
      deps.db,
      ws,
      { messageId: "<a@x.example>", position: 0 },
      {
        origin: "auto",
        now: NOW,
      },
    );
    const placeholder = await claimDraft(
      deps.db,
      ws,
      { messageId: "<a@x.example>", position: 1 },
      {
        origin: "auto",
        now: NOW,
      },
    );
    await markDraftFailed(deps.db, ws, mailboxDown?.id ?? "", {
      kind: "mailbox",
      reason: "Couldn't reach the mail server",
      now: NOW,
    });
    await markDraftFailed(deps.db, ws, placeholder?.id ?? "", {
      kind: "content",
      reason: "The draft held a placeholder",
      now: NOW,
    });

    expect(await sweep(deps)).toBe(1);
    await deps.queue.runOnce();
    expect(await getDraftClaim(deps.db, ws, mailboxDown?.id ?? "")).toMatchObject({
      status: "saving",
      attempts: 2,
    });
    expect(await getDraftClaim(deps.db, ws, placeholder?.id ?? "")).toMatchObject({
      status: "failed",
      failureKind: "content",
      attempts: 1,
    });
    expect(await waitingDraftJob(0)).toMatchObject({
      type: DRAFT_CREATE_JOB,
      status: "queued",
      payload: { workspaceId: ws, messageId: "<a@x.example>", position: 0, origin: "retry" },
    });
    expect(await waitingDraftJob(1)).toBeNull();
  });

  it("re-claims a draft whose draft.v1 call failed (kind ai) and enqueues its retry", async () => {
    await confirm();
    await seedJobMail(deps, ws, mailbox, { messageId: "<a@x.example>", receivedAt: NOW });
    await sweep(deps);
    await deps.queue.runOnce();
    const claim = await claimDraft(
      deps.db,
      ws,
      { messageId: "<a@x.example>", position: 0 },
      { origin: "auto", now: NOW },
    );
    await markDraftFailed(deps.db, ws, claim?.id ?? "", {
      kind: "ai",
      reason: "Couldn't reach the AI provider",
      now: NOW,
    });

    expect(await sweep(deps)).toBe(1);
    await deps.queue.runOnce();
    expect(await getDraftClaim(deps.db, ws, claim?.id ?? "")).toMatchObject({
      status: "saving",
      failureKind: null,
      attempts: 2,
    });
    expect(await waitingDraftJob(0)).toMatchObject({
      type: DRAFT_CREATE_JOB,
      status: "queued",
      payload: { workspaceId: ws, messageId: "<a@x.example>", position: 0, origin: "retry" },
    });
  });
});

describe("the scheduler", () => {
  it("sweeps on every tick, and a failed sweep doesn't stop the next", async () => {
    let sweeps = 0;
    const scheduler = createScheduler(deps, {
      sweep: async () => {
        sweeps += 1;
        if (sweeps === 1) throw new Error("database gone");
      },
    });
    await scheduler.tick();
    await scheduler.tick();
    expect(sweeps).toBe(2);
    expect(deps.logs.filter((l) => l.event === "pipeline.sweep_failed")).toHaveLength(1);
  });

  it("ticks every JOBFILLY_SYNC_INTERVAL_SECONDS once started, until stopped", async () => {
    let sweeps = 0;
    const scheduler = createScheduler(deps, {
      intervalMs: 10,
      sweep: async () => {
        sweeps += 1;
      },
    });
    scheduler.start();
    await expect.poll(() => sweeps).toBeGreaterThanOrEqual(2);
    scheduler.stop();
    const stopped = sweeps;
    await new Promise((r) => setTimeout(r, 40));
    expect(sweeps).toBe(stopped);
  });
});
