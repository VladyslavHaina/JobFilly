import { randomUUID } from "node:crypto";
import { orderNewestFirst } from "@jobfilly/core";
import {
  claimJob,
  countNotAnalyzed,
  createScan,
  getRoles,
  getScan,
  getStoredMessages,
  SCAN_RUN_JOB,
  saveJobCheckpoint,
  stopScan,
  usageTotal,
} from "@jobfilly/db";
import {
  type Envelope,
  type JobFacts,
  type LiveEvent,
  type Preferences,
  type ScanKind,
  ScanRunPayloadSchema,
} from "@jobfilly/schema";
import { afterEach, describe, expect, it } from "vitest";
import { DAY, MINUTE } from "../../clock";
import {
  createTestDeps,
  type SeededUser,
  seedAiSettings,
  seedMailbox,
  seedUser,
  type TestDeps,
} from "../../testing";
import { createJobQueue, defineJob, LeaseLostError } from "../queue";
import {
  aggregateFromReplies,
  BODY_SENTINEL,
  type FakeAi,
  type FakeAiAnswers,
  type FakeMail,
  fakeAi,
  fakeMail,
} from "./fakes";
import { createScanRunHandler } from "./index";

const ME = "maria.santos@inbox.example";
/** These tests run whole scans against PGlite; on a busy machine that takes a while. */
const SLOW = 120_000;
const NOW = new Date("2026-10-01T10:00:00Z");

let deps: TestDeps | undefined;
afterEach(async () => {
  await deps?.close();
  deps = undefined;
});

let uid = 0;
function mail(minutesAgo: number, overrides: Partial<Envelope> = {}): Envelope {
  uid += 1;
  const folder = overrides.folder ?? "inbox";
  return {
    messageId: `<scan-${uid}@agency.example>`,
    folder,
    folderPath: folder === "inbox" ? "INBOX" : "Sent",
    uidValidity: 7,
    uid,
    date: new Date(NOW.getTime() - minutesAgo * MINUTE).toISOString(),
    from: { address: `recruiter${uid}@agency.example`, name: `Recruiter ${uid}` },
    to: [{ address: ME, name: "Maria Santos" }],
    cc: [],
    replyTo: [],
    inReplyTo: null,
    references: [],
    subject: `A role for you ${uid}`,
    listId: null,
    listUnsubscribe: null,
    precedence: null,
    autoSubmitted: null,
    snippet: `Hello Maria, a role ${uid}`,
    ...overrides,
  };
}

const replyTo = (original: Envelope, minutesAgo: number) =>
  mail(minutesAgo, {
    folder: "sent",
    from: { address: ME, name: "Maria Santos" },
    to: [original.from],
    inReplyTo: original.messageId,
  });

const role = (title: string): JobFacts => ({
  title,
  company: "Agency",
  agency: null,
  places: [{ country: "DE", city: "Berlin" }],
  workMode: "hybrid",
  remoteScope: null,
  timeZones: null,
  pay: null,
  contract: null,
  seniority: null,
  workPermit: null,
  skills: [],
  languages: [],
  applyUrl: null,
  extra: {},
});

/** A mailbox: `likely` recruiter mails (every fifth one is not job mail) and two replies. */
function mailbox(likely: number, extra: Envelope[] = []) {
  const recruiters = Array.from({ length: likely }, (_, i) => mail(60 * (i + 1)));
  const replies = [replyTo(recruiters[0] as Envelope, 30), replyTo(recruiters[1] as Envelope, 50)];
  const notJob = new Set(recruiters.filter((_, i) => i % 5 === 4).map((e) => e.messageId));
  return { recruiters, replies, notJob, envelopes: [...recruiters, ...replies, ...extra] };
}

interface Setup {
  deps: TestDeps;
  admin: SeededUser;
  workspaceId: string;
  mail: FakeMail;
  ai: FakeAi;
  events: LiveEvent[];
  start(kind?: ScanKind): Promise<string>;
  runAll(): Promise<void>;
  setBudget(budget: number): Promise<void>;
}

async function setup(
  envelopes: Envelope[],
  answers: FakeAiAnswers,
  options: { budget?: number; progressIntervalMs?: number; ai?: boolean } = {},
): Promise<Setup> {
  const handler = createScanRunHandler({
    progressIntervalMs: options.progressIntervalMs ?? 60_000,
  });
  const d = await createTestDeps({
    now: NOW,
    registry: { [SCAN_RUN_JOB]: defineJob(ScanRunPayloadSchema, handler) },
  });
  deps = d;
  const admin = await seedUser(d, { name: "Maria Santos", email: ME });
  const workspaceId = admin.workspaceId;
  await seedMailbox(d, workspaceId, {
    address: ME,
    conn: {
      host: "imap.test",
      port: 993,
      tlsMode: "tls",
      username: ME,
      password: "E2E-SECRET-imap",
    },
    sentFolderPath: "Sent",
  });
  const setBudget = (budget: number) =>
    seedAiSettings(d, workspaceId, {
      provider: "openai-compatible",
      baseUrl: "http://fake-ai.test/v1",
      models: {
        classify: "m",
        extract: "m",
        prefs: "m",
        intake: "m",
        cv: "m",
        match: "m",
        draft: "m",
        assistant: "m",
      },
      apiKey: "E2E-SECRET-ai-key",
      budgetPerRun: budget,
    });
  if (options.ai !== false) await setBudget(options.budget ?? 300);
  const m = fakeMail(envelopes);
  const ai = fakeAi(answers);
  d.mail = m.port;
  d.ai = ai.port;
  d.intake = { aggregate: aggregateFromReplies };
  const events: LiveEvent[] = [];
  d.live.subscribe(
    { workspaceId, userId: admin.id, sessionId: randomUUID() },
    (e) => events.push(e),
    () => {},
  );
  return {
    deps: d,
    admin,
    workspaceId,
    mail: m,
    ai,
    events,
    setBudget,
    async start(kind = "first") {
      const created = await createScan(d.db, workspaceId, {
        kind,
        startedBy: admin.id,
        at: d.clock.now(),
        enqueue: true,
      });
      if (!created.ok) throw new Error("a scan is running");
      return created.scan.id;
    },
    async runAll() {
      while (await d.queue.runOnce()) {}
    },
  };
}

const recruiterAnswers = (
  notJob: Set<string>,
  prefs: (id: string) => Preferences = () => ({}),
): FakeAiAnswers => ({
  classify: (id) => (notJob.has(id) ? "not_job" : "recruiter_outreach"),
  extract: (id) => [role(`Role ${id}`)],
  prefs,
});

const logs = (d: TestDeps, event: string) => d.logs.filter((l) => l.event === event);
/** The stop message the run sent live (one stop per run). */
const stopText = (events: LiveEvent[]) => {
  const stopped = events.filter((e) => e.type === "scan.stopped");
  expect(stopped).toHaveLength(1);
  return stopped[0]?.type === "scan.stopped" ? stopped[0].data.stopMessage : null;
};
/** Waits for live events: NOTIFY reaches the subscribers asynchronously. */
const settle = () => new Promise((r) => setTimeout(r, 50));

describe("the first scan (F4.1–F4.3)", { timeout: SLOW }, () => {
  it("sorts the last 90 days by headers, reads replies first, then likely mail newest first in batches of 20", async () => {
    const box = mailbox(25);
    const newsletters = [1, 2, 3].map((i) =>
      mail(10 * i, {
        from: { address: `news${i}@club.example`, name: null },
        listUnsubscribe: "<https://club.example/u>",
      }),
    );
    const alert = mail(5, {
      from: { address: "jobalerts-noreply@linkedin.com", name: "LinkedIn" },
      listUnsubscribe: "<https://linkedin.com/u>",
    });
    const tooOld = mail(91 * 24 * 60);
    const s = await setup([...box.envelopes, ...newsletters, alert, tooOld], {
      ...recruiterAnswers(box.notJob, (id) =>
        id === box.replies[0]?.messageId ? { target_roles: ["backend engineer"] } : {},
      ),
    });
    const scanId = await s.start();
    await s.runAll();
    await settle();

    const since = new Date(NOW.getTime() - 90 * DAY);
    expect(s.mail.fetched).toEqual([
      { folder: "inbox", since },
      { folder: "sent", since },
    ]);
    const scan = await getScan(s.deps.db, s.workspaceId, scanId);
    expect(scan).toMatchObject({ status: "stopped", stopReason: "done" });
    expect(scan?.counts).toEqual({
      handledWithoutAi: 4,
      likely: 26,
      analyzed: 26,
      jobFound: 21,
      answersFirm: 0,
      notAnalyzed: 0,
    });
    // One prefs call, two classify calls, one extract call per job message and the alert.
    expect(s.ai.calls.map((c) => c.task)).toEqual([
      "prefs.v1",
      "classify.v1",
      ...Array(17).fill("extract.v1"),
      "classify.v1",
      ...Array(4).fill("extract.v1"),
    ]);
    expect(scan?.calls).toBe(24);
    expect((await usageTotal(s.deps.db, s.workspaceId, scanId)).calls).toBe(24);
    expect(s.ai.calls[0]?.ids).toEqual(box.replies.map((r) => r.messageId));
    const likelyNewestFirst = orderNewestFirst([...box.recruiters, alert]).map((e) => e.messageId);
    const firstBatch = likelyNewestFirst.slice(0, 20);
    expect(s.ai.calls[1]?.ids).toEqual(firstBatch.filter((id) => id !== alert.messageId));
    expect(s.ai.calls[2]?.ids).toEqual([alert.messageId]);
    expect(s.ai.calls[19]?.ids).toEqual(likelyNewestFirst.slice(20));
    expect(s.ai.calls.flatMap((c) => c.ids)).not.toContain(tooOld.messageId);

    const [stored] = await getStoredMessages(s.deps.db, s.workspaceId, [alert.messageId]);
    expect(stored).toMatchObject({ category: "job_alert", analysisStatus: "done" });
    expect(await getRoles(s.deps.db, s.workspaceId, alert.messageId)).toHaveLength(1);
    const [news] = await getStoredMessages(s.deps.db, s.workspaceId, [
      newsletters[0]?.messageId as string,
    ]);
    expect(news).toMatchObject({
      stageOne: "not_job",
      category: "not_job",
      analyzedByScanId: null,
    });
    const replies = await getStoredMessages(
      s.deps.db,
      s.workspaceId,
      box.replies.map((r) => r.messageId),
    );
    expect(replies.map((r) => r.analysisStatus)).toEqual(["done", "done"]);

    expect(logs(s.deps, "scan.started")).toHaveLength(1);
    expect(logs(s.deps, "scan.batch_completed").map((l) => [l.batch, l.kind, l.analyzed])).toEqual([
      [1, "replies", 0],
      [2, "candidates", 20],
      [3, "candidates", 26],
    ]);
    expect(logs(s.deps, "scan.stopped")).toEqual([
      expect.objectContaining({ level: "info", scanId, reason: "done" }),
    ]);
    const stopped = s.events.filter((e) => e.type === "scan.stopped");
    expect(stopped).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          scanId,
          status: "stopped",
          stopReason: "done",
          stopMessage: "Stopped: done, all 26 likely job emails analyzed",
        }),
      }),
    ]);
    expect(s.mail.closed).toBe(1);
  });

  it("stores only metadata, the snippet and facts: bodies are fetched for the model, never kept or logged (F4.9)", async () => {
    const box = mailbox(3);
    const s = await setup(box.envelopes, recruiterAnswers(box.notJob));
    await s.start();
    await s.runAll();
    expect(s.mail.bodies.length).toBeGreaterThan(0);
    const ids = box.envelopes.map((e) => e.messageId);
    const stored = JSON.stringify([
      await getStoredMessages(s.deps.db, s.workspaceId, ids),
      ...(await Promise.all(ids.map((id) => getRoles(s.deps.db, s.workspaceId, id)))),
    ]);
    expect(stored).not.toContain(BODY_SENTINEL);
    expect(stored).not.toContain("More text.");
    expect(s.deps.rawLogs.join("\n")).not.toContain(BODY_SENTINEL);
    expect(s.deps.rawLogs.join("\n")).not.toMatch(/E2E-SECRET/);
    expect(s.mail.connections[0]?.password).toBe("E2E-SECRET-imap");
  });
});

describe("stopping (F4.4, F4.5, F4.10)", { timeout: SLOW }, () => {
  const firm: Preferences = { target_roles: ["backend engineer"], languages: ["English"] };

  it("stops the first scan as confident after two batches that changed no answer", async () => {
    const box = mailbox(100);
    const s = await setup(
      box.envelopes,
      recruiterAnswers(box.notJob, () => firm),
    );
    const scanId = await s.start();
    await s.runAll();
    await settle();
    const scan = await getScan(s.deps.db, s.workspaceId, scanId);
    expect(scan).toMatchObject({ status: "stopped", stopReason: "confident" });
    expect(scan?.counts).toMatchObject({
      likely: 100,
      analyzed: 40,
      notAnalyzed: 60,
      answersFirm: 2,
    });
    expect(await countNotAnalyzed(s.deps.db, s.workspaceId)).toBe(60);
    const stopped = s.events.find((e) => e.type === "scan.stopped");
    expect(stopped?.type === "scan.stopped" && stopped.data.stopMessage).toBe(
      "Stopped: confident after 40 of 100 likely job emails",
    );
  });

  it("runs Analyze them on what is left: exactly the budget's calls, then on to done, never confident", async () => {
    const box = mailbox(100);
    const s = await setup(
      box.envelopes,
      recruiterAnswers(box.notJob, () => firm),
    );
    await s.start();
    await s.runAll();

    await s.setBudget(5);
    const budgetRun = await s.start("analyze_rest");
    await s.runAll();
    const scan = await getScan(s.deps.db, s.workspaceId, budgetRun);
    expect(scan).toMatchObject({ kind: "analyze_rest", status: "stopped", stopReason: "budget" });
    expect((await usageTotal(s.deps.db, s.workspaceId, budgetRun)).calls).toBe(5);
    expect(scan?.calls).toBe(5);
    // One classify call (four of the 20 are not job mail), then four extract calls.
    expect(scan?.counts).toMatchObject({ handledWithoutAi: 0, likely: 60, analyzed: 8 });
    expect(scan?.counts.notAnalyzed).toBe(52);
    expect(logs(s.deps, "scan.stopped").at(-1)).toMatchObject({ reason: "budget" });

    await s.setBudget(300);
    const rest = await s.start("analyze_rest");
    await s.runAll();
    expect(await getScan(s.deps.db, s.workspaceId, rest)).toMatchObject({
      stopReason: "done",
      counts: expect.objectContaining({ likely: 52, analyzed: 52, notAnalyzed: 0 }),
    });
    expect(s.ai.calls.filter((c) => c.task === "prefs.v1")).toHaveLength(1);
  });

  it("stops as done when nothing likely is left, also with firm answers (done wins, S7)", async () => {
    const box = mailbox(12);
    const s = await setup(
      box.envelopes,
      recruiterAnswers(box.notJob, () => firm),
    );
    const scanId = await s.start();
    await s.runAll();
    expect(await getScan(s.deps.db, s.workspaceId, scanId)).toMatchObject({ stopReason: "done" });
  });

  it("stops as done at once on a mailbox with no likely job mail", async () => {
    const s = await setup([], {});
    const scanId = await s.start();
    await s.runAll();
    expect(await getScan(s.deps.db, s.workspaceId, scanId)).toMatchObject({
      status: "stopped",
      stopReason: "done",
    });
    expect(s.ai.calls).toEqual([]);
  });
});

describe("Couldn't analyze and the budget (F3.4, TBD-17)", { timeout: SLOW }, () => {
  it("retries an invalid item once, as a call of its own, then marks only that item failed", async () => {
    const box = mailbox(3);
    const bad = box.recruiters[1] as Envelope;
    const s = await setup(box.envelopes, {
      ...recruiterAnswers(box.notJob),
      classify: (id) => (id === bad.messageId ? "invalid" : "recruiter_outreach"),
    });
    const scanId = await s.start();
    await s.runAll();
    expect(s.ai.calls.filter((c) => c.task === "classify.v1").map((c) => c.ids)).toEqual([
      orderNewestFirst(box.recruiters).map((e) => e.messageId),
      [bad.messageId],
    ]);
    const [stored] = await getStoredMessages(s.deps.db, s.workspaceId, [bad.messageId]);
    expect(stored).toMatchObject({ analysisStatus: "failed", category: null });
    expect(await getScan(s.deps.db, s.workspaceId, scanId)).toMatchObject({
      stopReason: "done",
      calls: 1 + 2 + 2,
      counts: expect.objectContaining({ analyzed: 3, jobFound: 2 }),
    });
  });

  it("leaves an item pending when no call is left for its retry", async () => {
    const box = mailbox(3);
    const bad = box.recruiters[0] as Envelope;
    const s = await setup(
      box.recruiters,
      {
        ...recruiterAnswers(box.notJob),
        classify: (id) => (id === bad.messageId ? "invalid" : "recruiter_outreach"),
      },
      { budget: 1 },
    );
    const scanId = await s.start();
    await s.runAll();
    expect(s.ai.calls.map((c) => c.task)).toEqual(["classify.v1"]);
    const [stored] = await getStoredMessages(s.deps.db, s.workspaceId, [bad.messageId]);
    expect(stored?.analysisStatus).toBe("pending");
    expect(await getScan(s.deps.db, s.workspaceId, scanId)).toMatchObject({
      stopReason: "budget",
      counts: expect.objectContaining({ analyzed: 0, notAnalyzed: 3 }),
    });
    expect(await getStoredMessages(s.deps.db, s.workspaceId, [bad.messageId])).toHaveLength(1);
  });

  it("stops as failed when the provider can't be reached, with nothing guessed", async () => {
    const box = mailbox(5);
    const s = await setup(box.envelopes, recruiterAnswers(box.notJob));
    s.ai.failWith("unreachable");
    const scanId = await s.start();
    await s.runAll();
    expect(s.ai.calls).toHaveLength(1);
    expect(await getScan(s.deps.db, s.workspaceId, scanId)).toMatchObject({
      stopReason: "failed",
      stopCause: "ai",
      calls: 1,
    });
    expect(logs(s.deps, "scan.stopped")).toEqual([
      expect.objectContaining({ level: "warn", reason: "failed", cause: "ai_unreachable" }),
    ]);
    await settle();
    expect(stopText(s.events)).toBe(
      "Stopped: the AI provider couldn't be used after 0 of 5 likely job emails. Check Settings › AI, then try again.",
    );
    expect(await countNotAnalyzed(s.deps.db, s.workspaceId)).toBe(5);
  });

  it("stops as failed when the workspace has no AI settings", async () => {
    const s = await setup(mailbox(2).envelopes, {}, { ai: false });
    const scanId = await s.start();
    await s.runAll();
    expect(await getScan(s.deps.db, s.workspaceId, scanId)).toMatchObject({
      stopReason: "failed",
      stopCause: "ai",
    });
    expect(logs(s.deps, "scan.stopped")).toEqual([
      expect.objectContaining({ cause: "no_ai_settings", stopCause: "ai" }),
    ]);
    expect(s.mail.connections).toEqual([]);
  });

  it("opens the stored key for the provider, and reads a cleared key as no key (TBD-121)", async () => {
    /** Runs a first scan on a fresh workspace whose key is `apiKey`; the keys the client got. */
    const keysFor = async (apiKey?: string) => {
      const box = mailbox(2);
      const s = await setup(box.envelopes, recruiterAnswers(box.notJob));
      if (apiKey !== undefined) {
        await seedAiSettings(s.deps, s.workspaceId, {
          provider: "openai-compatible",
          baseUrl: "http://fake-ai.test/v1",
          models: {
            classify: "m",
            extract: "m",
            prefs: "m",
            intake: "m",
            cv: "m",
            match: "m",
            draft: "m",
            assistant: "m",
          },
          apiKey,
        });
      }
      const keys: (string | null)[] = [];
      const port = s.deps.ai;
      s.deps.ai = {
        client: (config) => {
          keys.push(config.apiKey);
          return port.client(config);
        },
      };
      const scanId = await s.start();
      await s.runAll();
      expect(await getScan(s.deps.db, s.workspaceId, scanId)).toMatchObject({
        stopReason: "done",
      });
      expect(logs(s.deps, "job.failed")).toEqual([]);
      await s.deps.close();
      deps = undefined;
      return keys;
    };
    expect(await keysFor()).toEqual(["E2E-SECRET-ai-key"]);
    expect(await keysFor("")).toEqual([null]);
  });
});

describe("what a failed run ran into (TBD-112)", { timeout: SLOW }, () => {
  it("names the mailbox when a body can't be read mid-run", async () => {
    const box = mailbox(5);
    const s = await setup(box.envelopes, recruiterAnswers(box.notJob));
    s.ai.beforeAnswer = (task) => {
      if (task === "prefs.v1") s.mail.failing.bodies = true;
    };
    const scanId = await s.start();
    await s.runAll();
    await settle();
    expect(await getScan(s.deps.db, s.workspaceId, scanId)).toMatchObject({
      stopReason: "failed",
      stopCause: "mailbox",
    });
    expect(logs(s.deps, "scan.stopped")).toEqual([
      expect.objectContaining({ level: "warn", cause: "mail_error", stopCause: "mailbox" }),
    ]);
    expect(stopText(s.events)).toBe(
      "Stopped: couldn't read your mailbox after 0 of 5 likely job emails. Check Settings › Mailbox, then try again.",
    );
  });

  it("names the mailbox when stage one can't read the envelopes", async () => {
    const s = await setup(mailbox(3).envelopes, {});
    s.mail.failing.envelopes = true;
    const scanId = await s.start();
    await s.runAll();
    await settle();
    expect(await getScan(s.deps.db, s.workspaceId, scanId)).toMatchObject({
      stopReason: "failed",
      stopCause: "mailbox",
    });
    expect(logs(s.deps, "scan.stopped")).toEqual([
      expect.objectContaining({ cause: "stage_one_error", stopCause: "mailbox" }),
    ]);
    expect(stopText(s.events)).toMatch(
      /^Stopped: couldn't read your mailbox .* Settings › Mailbox/,
    );
    expect(s.ai.calls).toEqual([]);
  });

  it("says the fault is JobFilly's after an internal error, counting the calls the run made (S4)", async () => {
    const box = mailbox(5);
    const s = await setup(box.envelopes, recruiterAnswers(box.notJob));
    // The replies' preferences call answers, then aggregating the proposal breaks.
    s.deps.intake = {
      aggregate: () => {
        throw new Error("aggregation broke");
      },
    };
    const scanId = await s.start();
    await s.runAll();
    await settle();
    expect(s.ai.calls.map((c) => c.task)).toEqual(["prefs.v1"]);
    const scan = await getScan(s.deps.db, s.workspaceId, scanId);
    expect(scan).toMatchObject({
      status: "stopped",
      stopReason: "failed",
      stopCause: "internal",
      calls: 1,
      inputTokens: 100,
      outputTokens: 10,
    });
    expect(scan?.calls).toBe((await usageTotal(s.deps.db, s.workspaceId, scanId)).calls);
    expect(logs(s.deps, "job.failed")).toHaveLength(1);
    expect(logs(s.deps, "scan.stopped")).toEqual([
      expect.objectContaining({ level: "warn", reason: "failed", cause: "error", calls: 1 }),
    ]);
    const stopped = s.events.filter((e) => e.type === "scan.stopped");
    expect(stopped).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ calls: 1, tokens: 110 }) }),
    ]);
    const text = stopText(s.events);
    expect(text).toBe(
      "Stopped: something went wrong on JobFilly's side after 0 of 5 likely job emails. Your settings don't need changing; trying again later may help.",
    );
  });

  it("treats a throw from the AI client as JobFilly's fault, not the provider's", async () => {
    // The fake model has no prefs answer: the client throws instead of returning a failure.
    const s = await setup(mailbox(3).envelopes, {});
    const scanId = await s.start();
    await s.runAll();
    expect(await getScan(s.deps.db, s.workspaceId, scanId)).toMatchObject({
      stopReason: "failed",
      stopCause: "internal",
    });
    expect(logs(s.deps, "scan.stopped")).toEqual([
      expect.objectContaining({ cause: "ai_client_error", stopCause: "internal" }),
    ]);
  });
});

describe("live progress, cancel and takeover (F4.6–F4.8)", { timeout: SLOW }, () => {
  it("sends progress while a long call is under way, at the configured interval", async () => {
    const box = mailbox(3);
    const s = await setup(box.envelopes, recruiterAnswers(box.notJob), { progressIntervalMs: 40 });
    const running = (events: LiveEvent[]) =>
      events.filter((e) => e.type === "scan.progress" && e.data.status === "running");
    // The classify call answers only once three more progress events have come in meanwhile.
    s.ai.beforeAnswer = async (task) => {
      if (task !== "classify.v1") return;
      const seen = s.events.length;
      while (running(s.events.slice(seen)).length < 3) await settle();
    };
    const scanId = await s.start();
    await s.runAll();
    await settle();
    const progress = running(s.events);
    expect(progress.length).toBeGreaterThanOrEqual(3);
    expect(progress.every((e) => e.type === "scan.progress" && e.data.scanId === scanId)).toBe(
      true,
    );
    expect(s.events.at(-3)?.type).toBe("scan.stopped");
  });

  it("stores each finished batch's counts before it says so live, also while a tick is still being sent (F4.6)", async () => {
    const box = mailbox(25);
    const s = await setup(box.envelopes, recruiterAnswers(box.notJob), { progressIntervalMs: 40 });
    const tick = () => new Promise((r) => setTimeout(r, 5));
    // A progress tick stores the counts, then is slow to go out live (a busy NOTIFY): it is held
    // from the first classify call until the batch it was stored in has finished.
    const publish = s.deps.live.publish;
    let hold: Promise<void> | null = null;
    let held = 0;
    // What the screen would read (GET /scans/current) as each batch tells it to refetch.
    const stored: (number | undefined)[] = [];
    s.deps.live.publish = async (workspaceId, event) => {
      if (hold && event.type === "scan.progress") {
        held += 1;
        await hold;
      }
      if (event.type === "messages.updated") {
        stored.push((await getScan(s.deps.db, workspaceId, scanId))?.counts.analyzed);
      }
      return publish(workspaceId, event);
    };
    let armed = true;
    s.ai.beforeAnswer = async (task) => {
      if (task !== "classify.v1" || !armed) return;
      armed = false;
      let release = () => {};
      hold = new Promise((r) => {
        release = r;
      });
      while (held === 0) await tick();
      void (async () => {
        while (logs(s.deps, "scan.batch_completed").length < 2) await tick();
        hold = null;
        release();
      })();
    };
    const scanId = await s.start();
    await s.runAll();
    await settle();
    expect(logs(s.deps, "scan.batch_completed").map((l) => l.analyzed)).toEqual([0, 20, 25]);
    // Each batch's own counts, and the stop's: not the ones of the tick under way.
    expect(stored).toEqual([0, 20, 25, 25]);
  });

  it("ends without another call or stop once an admin has cancelled the scan", async () => {
    const box = mailbox(30);
    const s = await setup(box.envelopes, recruiterAnswers(box.notJob));
    const scanId = await s.start();
    s.ai.beforeAnswer = async (task, n) => {
      if (task === "extract.v1" && n === 4) {
        await stopScan(s.deps.db, s.workspaceId, scanId, "cancelled", s.deps.clock.now());
      }
    };
    await s.runAll();
    expect(s.ai.calls).toHaveLength(4);
    expect(await getScan(s.deps.db, s.workspaceId, scanId)).toMatchObject({
      stopReason: "cancelled",
    });
    expect(logs(s.deps, "scan.stopped")).toEqual([]);
  });

  it("does nothing for a scan cancelled before any replica took it", async () => {
    const s = await setup(mailbox(3).envelopes, {});
    const scanId = await s.start();
    await stopScan(s.deps.db, s.workspaceId, scanId, "cancelled", s.deps.clock.now());
    await s.runAll();
    expect(s.mail.connections).toEqual([]);
    expect(logs(s.deps, "scan.started")).toEqual([]);
  });

  it("is run by one replica only, even when two look for work at once", async () => {
    const box = mailbox(3);
    const s = await setup(box.envelopes, recruiterAnswers(box.notJob));
    const other = createJobQueue(
      s.deps,
      { [SCAN_RUN_JOB]: defineJob(ScanRunPayloadSchema, createScanRunHandler()) },
      {
        owner: "replica-b",
      },
    );
    await s.start();
    const ran = await Promise.all([s.deps.queue.runOnce(), other.runOnce()]);
    expect(ran.filter(Boolean)).toHaveLength(1);
    expect(logs(s.deps, "scan.started")).toHaveLength(1);
  });

  it("is taken over by another replica once the lease of a killed one expires, from its last checkpoint (F4.8)", async () => {
    const box = mailbox(70);
    const s = await setup(box.envelopes, recruiterAnswers(box.notJob));
    const scanId = await s.start();

    // Replica A claims the job and dies during batch 3: its fifth extract call there never
    // answers, and nothing renews its lease any more.
    const claimed = await claimJob(s.deps.db, {
      owner: "replica-a",
      types: [SCAN_RUN_JOB],
      now: s.deps.clock.now(),
      leaseMs: 30_000,
    });
    if (!claimed) throw new Error("no job");
    const killedAt = 1 + 17 + 17 + 1 + 5;
    let release = () => {};
    s.ai.beforeAnswer = (_task, n) => {
      if (n === killedAt) return new Promise<void>((resolve) => (release = resolve));
    };
    const dead = createScanRunHandler({ progressIntervalMs: 60_000 })({
      job: claimed,
      payload: ScanRunPayloadSchema.parse(claimed.payload),
      checkpoint: claimed.checkpoint,
      previousInstance: claimed.previousOwner,
      signal: new AbortController().signal,
      deps: s.deps,
      renewLease: async () => {},
      saveCheckpoint: async (checkpoint) => {
        const ok = await saveJobCheckpoint(s.deps.db, claimed.id, {
          owner: "replica-a",
          checkpoint,
          now: s.deps.clock.now(),
        });
        if (!ok) throw new LeaseLostError();
      },
    });
    while (s.ai.calls.length < killedAt) await settle();
    const finishedByA = new Set(
      (
        await getStoredMessages(
          s.deps.db,
          s.workspaceId,
          box.recruiters.map((e) => e.messageId),
        )
      )
        .filter((m) => m.analysisStatus !== "pending")
        .map((m) => m.envelope.messageId),
    );
    // Batches 1 and 2 (40 messages), then batch 3's four not-job messages and four extracts.
    expect(finishedByA.size).toBe(48);

    // Replica B (the test queue) claims the job once the 30-second lease has run out.
    s.deps.clock.advance(31_000);
    s.ai.beforeAnswer = null;
    const before = s.ai.calls.length;
    expect(await s.deps.queue.runOnce()).toBe(true);
    const resumed = s.ai.calls.slice(before);
    expect(resumed.map((c) => c.task)).not.toContain("prefs.v1");
    for (const c of resumed) for (const id of c.ids) expect(finishedByA.has(id), id).toBe(false);
    expect(new Set(resumed.flatMap((c) => c.ids)).size).toBe(70 - 48);

    const scan = await getScan(s.deps.db, s.workspaceId, scanId);
    expect(scan).toMatchObject({ status: "stopped", stopReason: "done" });
    expect(scan?.counts).toMatchObject({ likely: 70, analyzed: 70, notAnalyzed: 0 });
    expect(logs(s.deps, "job.lease_expired")).toEqual([
      expect.objectContaining({ previousInstance: "replica-a" }),
    ]);
    expect(logs(s.deps, "scan.resumed")).toEqual([
      expect.objectContaining({ scanId, previousInstance: "replica-a" }),
    ]);
    expect(logs(s.deps, "scan.started")).toHaveLength(1);
    // No batch number is used twice: B goes on from A's last checkpoint (batch 3).
    expect(logs(s.deps, "scan.batch_completed").map((l) => l.batch)).toEqual([1, 2, 3, 4, 5]);

    // The dead replica's call answers after all: it changes nothing and stops nothing.
    release();
    await dead;
    expect(await getScan(s.deps.db, s.workspaceId, scanId)).toMatchObject({ stopReason: "done" });
    expect(logs(s.deps, "scan.stopped")).toHaveLength(1);
  });
});
