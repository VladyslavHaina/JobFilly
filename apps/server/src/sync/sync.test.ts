import {
  claimDraft,
  claimJob,
  correctCategory,
  createConfirmedProfile,
  getDraftClaim,
  getEvaluations,
  getMailboxSyncStatus,
  getStoredMessages,
  getSyncState,
  saveEnvelopes,
  stopScan,
} from "@jobfilly/db";
import { type MailClient, MailUnavailableError } from "@jobfilly/mail";
import {
  type LiveEvent,
  MAIL_SYNC_JOB,
  MailSyncPayloadSchema,
  PIPELINE_REEVALUATE_JOB,
  type PipelineReevaluatePayload,
  PipelineReevaluatePayloadSchema,
  type Scan,
} from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MailPort } from "../deps";
import { createJobQueue, defineJob, type JobRegistry } from "../jobs/queue";
import { jobRegistry } from "../jobs/registry";
import {
  createFakeAi,
  createFakeMailbox,
  createTestDeps,
  type FakeAiClient,
  type FakeMailbox,
  type RecordingStages,
  recordingStages,
  roleFacts,
  type SeededUser,
  seedAiSettings,
  seedJobMail,
  seedMailbox,
  seedScan,
  seedUser,
  TEST_AI_MODELS,
  type TestDeps,
} from "../testing";
import { createMailSyncHandler, enqueueSyncs } from "./jobs";
import { backoffMs, isDue, MAX_SYNC_ANALYSIS_FAILURES, SYNC_FOLDER, syncMailbox } from "./run";
import { createScheduler, type Scheduler } from "./scheduler";

// Continuous sync (F1.1–F1.4) against the fake mailbox, the fake AI, recording pipeline stages
// and a clock that moves only when told: the scheduler, the mail.sync job across two queue
// owners, the cursor, a new UIDVALIDITY, failures with back-off, and the pipeline for new mail.

const NOW = new Date("2026-10-15T10:42:00Z");
const INTERVAL_S = 15;
const INTERVAL = INTERVAL_S * 1000;
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

let deps: TestDeps;
let mailbox: FakeMailbox;
let ai: FakeAiClient;
let stages: RecordingStages;
let maria: SeededUser;
let ws: string;
let mailboxId: string;
let firstScan: Scan;
let reevaluations: PipelineReevaluatePayload[];
let scheduler: Scheduler;
let events: LiveEvent[];

/** A mail port whose fetchSince waits while held, to keep a sync running. */
function holdable(box: FakeMailbox) {
  let gate: Promise<void> | null = null;
  let open: () => void = () => {};
  const port: MailPort = {
    connect(conn, options) {
      const client = box.port.connect(conn, options);
      const held: MailClient = {
        ...client,
        async fetchSince(query) {
          if (gate) await gate;
          return client.fetchSince(query);
        },
      };
      return held;
    },
  };
  return {
    port,
    hold() {
      gate = new Promise<void>((r) => {
        open = r;
      });
    },
    release() {
      gate = null;
      open();
    },
  };
}

function registry(
  recording: RecordingStages = stages,
  reevaluated: PipelineReevaluatePayload[] = reevaluations,
): JobRegistry {
  return {
    ...jobRegistry,
    [MAIL_SYNC_JOB]: defineJob(MailSyncPayloadSchema, createMailSyncHandler({ stages: recording })),
    [PIPELINE_REEVALUATE_JOB]: defineJob(PipelineReevaluatePayloadSchema, async (ctx) => {
      reevaluated.push(ctx.payload);
    }),
  };
}

// Each setup builds its test's world in locals and publishes it only when it is still the
// current one. Under a heavy load a setup can outlive its hook's timeout: such a late setup then
// closes what it built instead of overwriting the next test's deps, mailbox or AI half-way
// through (or seeding into a database the next test already took), and the teardown closes only
// a world that was fully set up.
let setups = 0;
let current: TestDeps | undefined;

beforeEach(async () => {
  const setup = ++setups;
  const recording = recordingStages();
  const reevaluated: PipelineReevaluatePayload[] = [];
  const seen: LiveEvent[] = [];
  const d = await createTestDeps({
    now: NOW,
    config: { syncIntervalSeconds: INTERVAL_S },
    registry: registry(recording, reevaluated),
  });
  try {
    const box = createFakeMailbox({ uidValidity: 100 });
    const fakeAi = createFakeAi();
    d.mail = box.port;
    d.ai = fakeAi.port;
    const user = await seedUser(d, { name: "Maria Santos" });
    const id = await seedMailbox(d, user.workspaceId, {
      address: "maria.santos@inbox.example",
      conn: {
        host: "imap",
        port: 3143,
        tlsMode: "tls",
        username: "msantos",
        password: "E2E-SECRET-maria-imap",
      },
      sentFolderPath: "Sent",
    });
    await seedAiSettings(d, user.workspaceId, {
      provider: "openai-compatible",
      baseUrl: "http://fake-ai.test/v1",
      models: TEST_AI_MODELS,
      apiKey: "E2E-SECRET-key",
    });
    const scan = await seedScan(d, user.workspaceId, { kind: "first", status: "stopped" });
    d.live.subscribe(
      { workspaceId: user.workspaceId, userId: user.id, sessionId: "s" },
      (e) => seen.push(e),
      () => {},
    );
    if (setup !== setups) {
      await d.close();
      return;
    }
    current = d;
    deps = d;
    mailbox = box;
    ai = fakeAi;
    stages = recording;
    reevaluations = reevaluated;
    events = seen;
    maria = user;
    ws = user.workspaceId;
    mailboxId = id;
    firstScan = scan;
    // The scheduler's own timer is never started: each test ticks by hand.
    scheduler = createScheduler(d, { sweep: async () => {} });
  } catch (error) {
    await d.close();
    throw error;
  }
});
afterEach(async () => {
  // A setup still running now is late: it closes what it built itself.
  setups++;
  const d = current;
  current = undefined;
  scheduler?.stop();
  await d?.close();
});

/** Runs every queued job on this replica. */
async function drain() {
  while (await deps.queue.runOnce()) {
    // until the queue is empty
  }
}

/** One interval: the scheduler's tick, then the jobs it queued. */
async function interval() {
  await scheduler.tick();
  await drain();
}

const logged = (event: string) => deps.logs.filter((l) => l.event === event);

/** A job message as the fake AI sees it: recruiter outreach with one role. */
function knownToAi(id: string, title = "Backend Engineer") {
  ai.answers.classify[id] = "recruiter_outreach";
  ai.answers.extract[id] = [roleFacts({ title })];
}

const deliver = (id: string, minutes = 1) =>
  mailbox.deliver({
    messageId: id,
    date: minutesAgo(minutes).toISOString(),
    from: { address: "lena.vogel@agency.example", name: "Lena Vogel" },
    subject: "Backend role",
    text: `Hello Maria, a backend role for you. ${id}`,
  });

const confirm = () =>
  createConfirmedProfile(deps.db, ws, { name: "p", entries: [], createdBy: maria.id, at: NOW });

describe("new mail (F1.1)", () => {
  it("is sorted, extracted and run through the pipeline within one interval, live", async () => {
    await confirm();
    // The first scan stored this one; the sync starts after it.
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<old@agency.example>",
      receivedAt: minutesAgo(60),
    });
    deliver("<new@agency.example>");
    knownToAi("<new@agency.example>");

    await interval();

    expect(ai.log).toEqual([
      { task: "classify.v1", key: "<new@agency.example>" },
      { task: "extract.v1", key: "<new@agency.example>" },
    ]);
    expect(stages.calls).toEqual([
      "sender <new@agency.example>",
      "cvChoice <new@agency.example>#0",
      "match <new@agency.example>#0",
      "reply <new@agency.example>",
    ]);
    const [stored] = await getStoredMessages(deps.db, ws, ["<new@agency.example>"]);
    expect(stored).toMatchObject({ category: "recruiter_outreach", analysisStatus: "done" });
    expect((await getEvaluations(deps.db, ws, ["<new@agency.example>"]))[0]?.match?.score).toBe(75);
    await expect
      .poll(() => events)
      .toContainEqual({ type: "messages.updated", data: { messageIds: ["<new@agency.example>"] } });
    expect(events).toContainEqual({ type: "mailbox.updated", data: {} });
    expect(logged("pipeline.message_processed")).toMatchObject([{ origin: "new" }]);
    expect(logged("sync.started")).toMatchObject([{ level: "info", mailboxId, workspaceId: ws }]);
    expect(logged("sync.completed")).toMatchObject([{ level: "info", mailboxId, new: 1 }]);
    expect(await getSyncState(deps.db, ws, mailboxId, SYNC_FOLDER)).toMatchObject({
      uidValidity: 100,
      lastUid: 2,
      lastSyncedAt: NOW,
    });
    // Connected with the mailbox's stored address (the drafts' From), not the IMAP login.
    expect(mailbox.connections.map((c) => c.username)).toContain("msantos");
    expect(new Set(mailbox.addresses)).toEqual(new Set(["maria.santos@inbox.example"]));
  });

  it("reads only what came after the last sync, and nothing when nothing came", async () => {
    deliver("<a@agency.example>");
    knownToAi("<a@agency.example>");
    await interval();
    deliver("<b@agency.example>");
    knownToAi("<b@agency.example>");
    deps.clock.advance(INTERVAL);
    await interval();
    deps.clock.advance(INTERVAL);
    await interval();
    expect(ai.log.map((l) => l.key)).toEqual([
      "<a@agency.example>",
      "<a@agency.example>",
      "<b@agency.example>",
      "<b@agency.example>",
    ]);
    expect(logged("sync.completed").map((l) => l.new)).toEqual([1, 1, 0]);
    // Without a confirmed profile only the sender stage runs.
    expect(stages.calls).toEqual(["sender <a@agency.example>", "sender <b@agency.example>"]);
  });

  it("keeps mail the model sorts as not job out of the rest of the pipeline", async () => {
    mailbox.deliver({
      messageId: "<news@list.example>",
      date: minutesAgo(1).toISOString(),
      text: "news",
    });
    ai.answers.classify["<news@list.example>"] = "not_job";
    await interval();
    expect(ai.log).toEqual([{ task: "classify.v1", key: "<news@list.example>" }]);
    expect(stages.calls).toEqual([]);
    expect((await getStoredMessages(deps.db, ws, ["<news@list.example>"]))[0]).toMatchObject({
      category: "not_job",
    });
  });

  it("keeps the cursor before mail the model couldn't sort yet, and sorts it next time", async () => {
    deliver("<a@agency.example>");
    deliver("<b@agency.example>");
    knownToAi("<a@agency.example>");
    knownToAi("<b@agency.example>");
    ai.failNext("classify", "unreachable");
    await interval();
    expect(await getSyncState(deps.db, ws, mailboxId, SYNC_FOLDER)).toMatchObject({ lastUid: 0 });
    expect(logged("pipeline.stage_failed")).toMatchObject([
      { stage: "analyze", error: "ai_unreachable" },
    ]);
    // The sync itself worked: the mailbox isn't failing.
    expect(await getMailboxSyncStatus(deps.db, ws, mailboxId)).toMatchObject({ state: "ok" });

    deps.clock.advance(INTERVAL);
    await interval();
    const stored = await getStoredMessages(deps.db, ws, [
      "<a@agency.example>",
      "<b@agency.example>",
    ]);
    expect(stored.map((m) => m.analysisStatus)).toEqual(["done", "done"]);
    expect(await getSyncState(deps.db, ws, mailboxId, SYNC_FOLDER)).toMatchObject({ lastUid: 2 });
    expect(logged("sync.completed").map((l) => l.new)).toEqual([2, 0]);
  });

  it("sorts mail whose Date header is hours old on the next sync after one failure", async () => {
    // Its sender dated it two hours ago (a late delivery, a clock that is off); it arrived now.
    deliver("<late@agency.example>", 120);
    knownToAi("<late@agency.example>");
    ai.failNext("classify", "provider_error");
    await interval();
    expect(await getSyncState(deps.db, ws, mailboxId, SYNC_FOLDER)).toMatchObject({ lastUid: 0 });

    deps.clock.advance(INTERVAL);
    await interval();
    const [stored] = await getStoredMessages(deps.db, ws, ["<late@agency.example>"]);
    expect(stored).toMatchObject({ category: "recruiter_outreach", analysisStatus: "done" });
    expect(await getSyncState(deps.db, ws, mailboxId, SYNC_FOLDER)).toMatchObject({ lastUid: 1 });
  });

  it("lets go of mail only after the provider failed on it in many syncs, leaving it not analyzed", async () => {
    // The fake AI has no answer for this one: the provider fails on it every time.
    deliver("<stuck@agency.example>");
    const sync = async () => {
      await interval();
      deps.clock.advance(INTERVAL);
    };
    for (let i = 1; i < MAX_SYNC_ANALYSIS_FAILURES; i++) await sync();
    // Every one of those syncs tried it again, and the cursor stayed before it.
    expect(ai.log.filter((l) => l.key === "<stuck@agency.example>")).toHaveLength(
      MAX_SYNC_ANALYSIS_FAILURES - 1,
    );
    expect(await getSyncState(deps.db, ws, mailboxId, SYNC_FOLDER)).toMatchObject({ lastUid: 0 });

    // The last try: it is let go, and the mail after it holds the cursor now.
    deliver("<fresh@agency.example>");
    knownToAi("<fresh@agency.example>");
    await sync();
    expect(await getSyncState(deps.db, ws, mailboxId, SYNC_FOLDER)).toMatchObject({ lastUid: 1 });
    expect(logged("sync.completed").at(-1)).toMatchObject({ waiting: 1, letGo: 1 });

    const calls = ai.log.length;
    await sync();
    // Only the fresh one is read and sorted; the stuck one waits for "Analyze them".
    expect(ai.log.slice(calls).map((l) => l.key)).toEqual([
      "<fresh@agency.example>",
      "<fresh@agency.example>",
    ]);
    const stored = await getStoredMessages(deps.db, ws, [
      "<stuck@agency.example>",
      "<fresh@agency.example>",
    ]);
    expect(stored.map((m) => m.analysisStatus)).toEqual(["pending", "done"]);
    expect(await getSyncState(deps.db, ws, mailboxId, SYNC_FOLDER)).toMatchObject({ lastUid: 2 });
  });

  it("reads every message after a known cursor as new, whatever its Date header says", async () => {
    deliver("<first@agency.example>");
    knownToAi("<first@agency.example>");
    await interval();
    expect(await getSyncState(deps.db, ws, mailboxId, SYNC_FOLDER)).toMatchObject({ lastUid: 1 });

    // Dated by its sender before the first scan's window, it arrives after the cursor.
    mailbox.deliver({
      messageId: "<misdated@agency.example>",
      date: new Date(Date.parse(firstScan.startedAt) - 91 * 24 * 3600_000).toISOString(),
      receivedAt: NOW.toISOString(),
      text: "A backend role for you.",
    });
    knownToAi("<misdated@agency.example>");
    deps.clock.advance(INTERVAL);
    await interval();
    const [stored] = await getStoredMessages(deps.db, ws, ["<misdated@agency.example>"]);
    expect(stored).toMatchObject({ category: "recruiter_outreach", analysisStatus: "done" });
    expect(logged("sync.completed").map((l) => l.new)).toEqual([1, 1]);
    expect(await getSyncState(deps.db, ws, mailboxId, SYNC_FOLDER)).toMatchObject({ lastUid: 2 });
  });

  it("reading the whole folder, leaves out mail that arrived before the first scan's window", async () => {
    const beforeWindow = new Date(Date.parse(firstScan.startedAt) - 91 * 24 * 3600_000);
    mailbox.deliver({ messageId: "<ancient@agency.example>", date: beforeWindow.toISOString() });
    // Its Date header is as old, but it arrived now: how old mail is goes by its arrival.
    mailbox.deliver({
      messageId: "<misdated@agency.example>",
      date: beforeWindow.toISOString(),
      receivedAt: minutesAgo(1).toISOString(),
    });
    deliver("<new@agency.example>");
    knownToAi("<new@agency.example>");
    knownToAi("<misdated@agency.example>");
    await interval();
    expect(await getStoredMessages(deps.db, ws, ["<ancient@agency.example>"])).toEqual([]);
    expect(
      (await getStoredMessages(deps.db, ws, ["<misdated@agency.example>"])).map(
        (m) => m.envelope.messageId,
      ),
    ).toEqual(["<misdated@agency.example>"]);
    expect(logged("sync.completed")).toMatchObject([{ new: 2, beforeWindow: 1 }]);
  });
});

describe("the scheduler", () => {
  it("waits for the first scan to stop", async () => {
    const tom = await seedUser(deps, { name: "Tom Okafor" });
    const tomMailbox = await seedMailbox(deps, tom.workspaceId, {
      address: "tom.okafor@inbox.example",
      conn: { host: "imap", port: 3143, tlsMode: "tls", username: "tom", password: "p" },
      sentFolderPath: null,
    });
    const scan = await seedScan(deps, tom.workspaceId, { kind: "first", status: "running" });
    // Only Maria's mailbox is due; Tom's first scan still reads his mailbox.
    expect(await enqueueSyncs(deps)).toBe(1);
    expect(await syncMailbox(deps, tom.workspaceId, tomMailbox)).toEqual({
      status: "skipped",
      reason: "first_scan_running",
    });
    await stopScan(deps.db, tom.workspaceId, scan.id, "done", NOW);
    expect(await enqueueSyncs(deps)).toBe(2);
  });

  it("enqueues one mail.sync per mailbox per interval on two owners; one runs at a time (F1.2)", async () => {
    const gate = holdable(mailbox);
    deps.mail = gate.port;
    const appB = createJobQueue(deps, registry(), { owner: "app-b" });
    const schedulerB = createScheduler(deps, { sweep: async () => {} });

    // Both replicas tick: one sync waits.
    await scheduler.tick();
    await schedulerB.tick();
    gate.hold();
    const running = deps.queue.runOnce();
    await expect.poll(() => logged("sync.started").length).toBe(1);
    expect(await appB.runOnce()).toBe(false);

    // The next interval queues the next sync while this one runs; it waits for it.
    deps.clock.advance(INTERVAL);
    await scheduler.tick();
    await schedulerB.tick();
    expect(await appB.runOnce()).toBe(false);
    gate.release();
    await running;
    expect(await appB.runOnce()).toBe(true);
    expect(await appB.runOnce()).toBe(false);
    expect(await deps.queue.runOnce()).toBe(false);
    expect(logged("sync.started")).toHaveLength(2);
    expect(logged("sync.completed")).toHaveLength(2);
  });

  it("lets another owner take over a killed owner's sync once its lease expires (F1.2)", async () => {
    deliver("<a@agency.example>");
    knownToAi("<a@agency.example>");
    await scheduler.tick();
    // app-a claims the sync and dies before finishing it.
    const claimed = await claimJob(deps.db, {
      owner: "app-a",
      types: [MAIL_SYNC_JOB],
      now: deps.clock.now(),
      leaseMs: 30_000,
    });
    expect(claimed?.type).toBe(MAIL_SYNC_JOB);
    const appB = createJobQueue(deps, registry(), { owner: "app-b" });
    expect(await appB.runOnce()).toBe(false);
    deps.clock.advance(31_000);
    expect(await appB.runOnce()).toBe(true);
    expect(logged("job.lease_expired")).toMatchObject([
      { level: "warn", jobType: MAIL_SYNC_JOB, previousInstance: "app-a" },
    ]);
    expect(logged("sync.completed")).toMatchObject([{ mailboxId, new: 1 }]);
    expect((await getStoredMessages(deps.db, ws, ["<a@agency.example>"]))[0]?.analysisStatus).toBe(
      "done",
    );
  });

  it("calls the real sweep on every tick, whatever the sync did", async () => {
    await confirm();
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<backlog@agency.example>",
      receivedAt: NOW,
    });
    const real = createScheduler(deps);
    mailbox.pause();
    await real.tick();
    await drain();
    expect(logged("sync.failed")).toHaveLength(1);
    expect(reevaluations).toEqual([{ workspaceId: ws, reason: "sweep" }]);
    mailbox.resume();
    deps.clock.advance(INTERVAL);
    await real.tick();
    await drain();
    expect(logged("sync.completed")).toHaveLength(1);
    expect(reevaluations).toHaveLength(2);
  });
});

describe("a new UIDVALIDITY (F1.3)", () => {
  it("re-indexes by Message-ID and keeps every correction, evaluation and draft", async () => {
    await confirm();
    deliver("<a@agency.example>", 3);
    deliver("<b@agency.example>", 2);
    knownToAi("<a@agency.example>");
    knownToAi("<b@agency.example>");
    await interval();
    await correctCategory(deps.db, ws, "<b@agency.example>", "offer");
    const draft = await claimDraft(
      deps.db,
      ws,
      { messageId: "<a@agency.example>", position: 0 },
      { origin: "auto", now: NOW },
    );
    const calls = ai.log.length;
    const stageCalls = stages.calls.length;

    mailbox.setUidValidity("inbox", 200);
    deliver("<c@agency.example>");
    knownToAi("<c@agency.example>");
    deps.clock.advance(INTERVAL);
    await interval();

    expect(logged("sync.uidvalidity_changed")).toMatchObject([
      { mailboxId, folder: "INBOX", previous: 100, current: 200 },
    ]);
    const stored = await getStoredMessages(deps.db, ws, [
      "<a@agency.example>",
      "<b@agency.example>",
      "<c@agency.example>",
    ]);
    const byId = Object.fromEntries(stored.map((m) => [m.envelope.messageId, m]));
    expect(byId["<a@agency.example>"]).toMatchObject({
      envelope: { uidValidity: 200, uid: 1 },
      category: "recruiter_outreach",
    });
    expect(byId["<b@agency.example>"]).toMatchObject({
      envelope: { uidValidity: 200, uid: 2 },
      category: "offer",
      categorySource: "you",
    });
    expect(byId["<c@agency.example>"]).toMatchObject({ envelope: { uidValidity: 200, uid: 3 } });
    expect(
      await getEvaluations(deps.db, ws, ["<a@agency.example>", "<b@agency.example>"]),
    ).toMatchObject([{ stale: false }, { stale: false }]);
    expect(await getDraftClaim(deps.db, ws, draft?.id ?? "")).toMatchObject({ status: "saving" });
    // Only the new message went to the model and through the pipeline.
    expect(ai.log.slice(calls).map((l) => l.key)).toEqual([
      "<c@agency.example>",
      "<c@agency.example>",
    ]);
    expect(stages.calls.slice(stageCalls)[0]).toBe("sender <c@agency.example>");
    expect(logged("sync.completed").at(-1)).toMatchObject({ new: 1 });
    expect(await getSyncState(deps.db, ws, mailboxId, SYNC_FOLDER)).toMatchObject({
      uidValidity: 200,
      lastUid: 3,
    });
    // The re-indexed message's body is found again under its new UID.
    expect(
      await mailbox.port.connect({} as never, { allowInsecure: false, address: "" }).fetchBody({
        folderPath: "INBOX",
        uidValidity: 200,
        uid: 1,
      }),
    ).not.toBeNull();
  });

  it("still sorts mail a sync held the cursor for, under its new UID, but not the first scan's", async () => {
    await confirm();
    // The first scan stored both; it left the first for "Analyze them".
    const backlog = mailbox.deliver({
      messageId: "<backlog@agency.example>",
      date: minutesAgo(90).toISOString(),
      text: "A role for you.",
    });
    await saveEnvelopes(deps.db, ws, [{ envelope: backlog, verdict: "likely_job", reason: null }]);
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<sorted@agency.example>",
      receivedAt: minutesAgo(60),
    });
    // A sync stores <a> (UID 3), but the model can't sort it yet: the cursor stays before it.
    deliver("<a@agency.example>");
    knownToAi("<a@agency.example>");
    ai.failNext("classify", "unreachable");
    await interval();
    expect(await getSyncState(deps.db, ws, mailboxId, SYNC_FOLDER)).toMatchObject({
      uidValidity: 100,
      lastUid: 2,
    });
    expect((await getStoredMessages(deps.db, ws, ["<a@agency.example>"]))[0]).toMatchObject({
      analysisStatus: "pending",
    });
    const calls = ai.log.length;

    // The folder is rebuilt without <sorted>: <a> is UID 2 now.
    mailbox.expunge("<sorted@agency.example>");
    mailbox.setUidValidity("inbox", 200);
    deps.clock.advance(INTERVAL);
    await interval();

    expect(ai.log.slice(calls)).toEqual([
      { task: "classify.v1", key: "<a@agency.example>" },
      { task: "extract.v1", key: "<a@agency.example>" },
    ]);
    const stored = await getStoredMessages(deps.db, ws, [
      "<a@agency.example>",
      "<backlog@agency.example>",
    ]);
    const byId = Object.fromEntries(stored.map((m) => [m.envelope.messageId, m]));
    expect(byId["<a@agency.example>"]).toMatchObject({
      envelope: { uidValidity: 200, uid: 2 },
      category: "recruiter_outreach",
      analysisStatus: "done",
    });
    expect(byId["<backlog@agency.example>"]).toMatchObject({
      envelope: { uidValidity: 200, uid: 1 },
      analysisStatus: "pending",
    });
    expect(stages.calls).toEqual([
      "sender <a@agency.example>",
      "cvChoice <a@agency.example>#0",
      "match <a@agency.example>#0",
      "reply <a@agency.example>",
    ]);
    expect(await getSyncState(deps.db, ws, mailboxId, SYNC_FOLDER)).toMatchObject({
      uidValidity: 200,
      lastUid: 2,
    });
    expect(logged("sync.completed").at(-1)).toMatchObject({ new: 0, waiting: 0 });
  });
});

describe("a failing sync (F1.4)", () => {
  it("is logged, backs off exponentially and shows 'failing since'; resume clears it", async () => {
    mailbox.pause();
    await interval();
    expect(logged("sync.failed")).toMatchObject([
      { level: "warn", mailboxId, cause: "mail_unavailable", failures: 1, retryInSeconds: 15 },
    ]);
    expect(await getMailboxSyncStatus(deps.db, ws, mailboxId)).toEqual({
      state: "failing",
      lastSyncedAt: null,
      failingSince: NOW.toISOString(),
      reason: "unreachable",
      message: "Couldn't reach the mail server",
    });
    expect(events).toContainEqual({ type: "mailbox.updated", data: {} });

    // The next interval retries; then it waits two intervals, then four.
    const attempts = () => logged("sync.started").length;
    const tickAfter = async (ms: number) => {
      deps.clock.advance(ms);
      await interval();
      return attempts();
    };
    expect(await tickAfter(INTERVAL)).toBe(2);
    expect(logged("sync.failed").at(-1)).toMatchObject({ failures: 2, retryInSeconds: 30 });
    expect(await tickAfter(INTERVAL)).toBe(2);
    expect(await tickAfter(INTERVAL)).toBe(3);
    expect(logged("sync.failed").at(-1)).toMatchObject({ failures: 3, retryInSeconds: 60 });
    expect(await tickAfter(INTERVAL)).toBe(3);
    expect(await tickAfter(INTERVAL)).toBe(3);
    expect(await tickAfter(INTERVAL)).toBe(3);
    expect(await tickAfter(INTERVAL)).toBe(4);
    // Still failing since the first failure.
    expect(await getMailboxSyncStatus(deps.db, ws, mailboxId)).toMatchObject({
      state: "failing",
      failingSince: NOW.toISOString(),
    });

    mailbox.resume();
    deliver("<a@agency.example>");
    knownToAi("<a@agency.example>");
    deps.clock.advance(8 * INTERVAL);
    await interval();
    expect(await getMailboxSyncStatus(deps.db, ws, mailboxId)).toEqual({
      state: "ok",
      lastSyncedAt: deps.clock.now().toISOString(),
      failingSince: null,
      reason: null,
      message: null,
    });
    expect(await getSyncState(deps.db, ws, mailboxId, SYNC_FOLDER)).toMatchObject({
      failures: 0,
      nextAttemptAt: null,
    });
    expect(logged("sync.completed")).toMatchObject([{ new: 1 }]);
  });

  it("keeps a sync queued while a failing one hangs from trying before the back-off ends", async () => {
    const gate = holdable(mailbox);
    deps.mail = gate.port;
    mailbox.pause();
    gate.hold();
    await scheduler.tick();
    const running = deps.queue.runOnce();
    await expect.poll(() => logged("sync.started").length).toBe(1);

    // The next tick queues a second sync behind the hanging one; then that one fails.
    deps.clock.advance(INTERVAL);
    await scheduler.tick();
    gate.release();
    await running;
    expect(logged("sync.failed")).toMatchObject([{ failures: 1, retryInSeconds: 15 }]);

    // The queued one runs at once but makes no attempt, so no new failure.
    await drain();
    expect(logged("sync.started")).toHaveLength(1);
    expect(logged("sync.failed")).toHaveLength(1);

    // Once the back-off has passed, the next interval tries again.
    deps.clock.advance(INTERVAL);
    await interval();
    expect(logged("sync.started")).toHaveLength(2);
  });

  it("fails the same way when the connection never comes up", async () => {
    deliver("<a@agency.example>");
    mailbox.failNext("connect");
    await interval();
    expect(logged("sync.failed")).toMatchObject([{ cause: "mail_unavailable", failures: 1 }]);
    expect(await getMailboxSyncStatus(deps.db, ws, mailboxId)).toMatchObject({
      reason: "unreachable",
    });
    // Nothing was read, so nothing is lost: the next sync reads it.
    expect(await getStoredMessages(deps.db, ws, ["<a@agency.example>"])).toEqual([]);
    knownToAi("<a@agency.example>");
    deps.clock.advance(INTERVAL);
    await interval();
    expect(logged("sync.completed")).toMatchObject([{ new: 1 }]);
  });

  it("names neither the server nor the password in its log lines", async () => {
    mailbox.failNext("fetchSince", new Error("imap.inbox.example refused E2E-SECRET-maria-imap"));
    await interval();
    expect(logged("sync.failed")).toMatchObject([{ cause: "error", error: "Error" }]);
    expect(deps.rawLogs.join("\n")).not.toMatch(/E2E-SECRET|imap\.inbox\.example/);
    expect(await getMailboxSyncStatus(deps.db, ws, mailboxId)).toMatchObject({
      state: "failing",
      reason: "error",
      message: "Something went wrong while syncing the mailbox",
    });
  });

  it("keeps the mail server's own reason, for the status to show its words", async () => {
    mailbox.failNext("fetchSince", new MailUnavailableError("wrong_password"));
    await interval();
    expect(await getMailboxSyncStatus(deps.db, ws, mailboxId)).toMatchObject({
      state: "failing",
      reason: "wrong_password",
      message: expect.stringMatching(/didn't accept the user name or password/),
    });
  });
});

describe("the mail.sync job", () => {
  it("is registered with its payload schema", () => {
    const def = jobRegistry[MAIL_SYNC_JOB];
    expect(def).toBeDefined();
    expect(def?.payload.safeParse({ mailboxId }).success).toBe(true);
    expect(def?.payload.safeParse({ mailboxId: "x" }).success).toBe(false);
  });

  it("does nothing for a mailbox that was disconnected meanwhile", async () => {
    expect(await syncMailbox(deps, ws, "00000000-0000-4000-8000-000000000000")).toEqual({
      status: "skipped",
      reason: "no_mailbox",
    });
    expect(logged("sync.started")).toEqual([]);
  });
});

describe("the back-off", () => {
  it("doubles from one interval, up to 15 minutes", () => {
    expect([1, 2, 3, 4].map((n) => backoffMs(n, INTERVAL))).toEqual([
      15_000, 30_000, 60_000, 120_000,
    ]);
    expect(backoffMs(20, INTERVAL)).toBe(15 * 60_000);
    expect(backoffMs(20, 30 * 60_000)).toBe(30 * 60_000);
  });

  it("counts an attempt due up to half an interval early", () => {
    expect(isDue(null, NOW, INTERVAL)).toBe(true);
    expect(isDue(new Date(NOW.getTime() + 7_000), NOW, INTERVAL)).toBe(true);
    expect(isDue(new Date(NOW.getTime() + 8_000), NOW, INTERVAL)).toBe(false);
  });
});
