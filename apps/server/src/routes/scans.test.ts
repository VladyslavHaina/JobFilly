import { claimJob, recordAiUsage, SCAN_RUN_JOB, stopScan } from "@jobfilly/db";
import { CurrentScanSchema, type Envelope, type LiveEvent, type StopCause } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { aggregateFromReplies, fakeAi, fakeMail } from "../jobs/scan/fakes";
import {
  createTestDeps,
  type SeededUser,
  type SeededWorkspace,
  seedAiSettings,
  seedMailbox,
  seedScan,
  seedUser,
  seedWorkspace,
  signedIn,
  type TestClient,
  type TestDeps,
} from "../testing";

const NOW = new Date("2026-10-01T10:00:00Z");

let deps: TestDeps;
let app: ReturnType<typeof createApp>;
let owner: SeededUser;
let ws: SeededWorkspace;
let admin: TestClient;
let viewer: TestClient;
let editor: TestClient;
let outsider: TestClient;
let events: LiveEvent[];

beforeEach(async () => {
  deps = await createTestDeps({ now: NOW });
  app = createApp(deps);
  owner = await seedUser(deps, { name: "Maria Santos", email: "maria.santos@inbox.example" });
  const [v, e, o] = [await seedUser(deps), await seedUser(deps), await seedUser(deps)];
  ws = await seedWorkspace(deps, {
    owner,
    members: [
      { user: v, role: "viewer" },
      { user: e, role: "editor" },
    ],
  });
  admin = await signedIn(app, deps, owner);
  viewer = await signedIn(app, deps, v);
  editor = await signedIn(app, deps, e);
  outsider = await signedIn(app, deps, o);
  events = [];
  deps.live.subscribe(
    ws.workspaceId,
    (event) => events.push(event),
    () => {},
  );
});
afterEach(() => deps.close());

const url = (path = "") => `/api/workspaces/${ws.workspaceId}/scans${path}`;
const settle = () => new Promise((r) => setTimeout(r, 50));

async function connect() {
  await seedMailbox(deps, ws.workspaceId, {
    address: "maria.santos@inbox.example",
    conn: {
      host: "imap.test",
      port: 993,
      tlsMode: "tls",
      username: "maria.santos@inbox.example",
      password: "E2E-SECRET-imap",
    },
    sentFolderPath: "Sent",
  });
  await seedAiSettings(deps, ws.workspaceId, {
    provider: "openai-compatible",
    baseUrl: "http://fake-ai.test/v1",
    models: { classify: "m", extract: "m", prefs: "m", intake: "m" },
    apiKey: "E2E-SECRET-ai-key",
  });
}

async function current(client: TestClient = viewer) {
  const res = await client.get(url("/current"));
  expect(res.status).toBe(200);
  return CurrentScanSchema.parse(await res.json());
}

describe("GET /scans/current", () => {
  it("answers every member, with nothing before the first scan", async () => {
    expect(await current()).toEqual({
      progress: null,
      stopMessage: null,
      stoppedAt: null,
      totalTokens: 0,
    });
    expect((await outsider.get(url("/current"))).status).toBe(404);
  });

  it("shows the latest run with its stop in plain words and the workspace's tokens (F3.6)", async () => {
    const first = await seedScan(deps, ws.workspaceId, {
      kind: "first",
      status: "stopped",
      stopReason: "confident",
      counts: { likely: 260, analyzed: 140, notAnalyzed: 120, handledWithoutAi: 340 },
      calls: 150,
    });
    await recordAiUsage(deps.db, ws.workspaceId, {
      scanId: first.id,
      task: "classify.v1",
      inputTokens: 1200,
      outputTokens: 34,
    });
    await recordAiUsage(deps.db, ws.workspaceId, {
      scanId: null,
      task: "ai.test.v1",
      inputTokens: 10,
      outputTokens: 2,
    });
    const body = await current();
    expect(body).toEqual({
      progress: expect.objectContaining({
        scanId: first.id,
        kind: "first",
        status: "stopped",
        stopReason: "confident",
        analyzed: 140,
        likely: 260,
        notAnalyzed: 120,
        handledWithoutAi: 340,
        calls: 150,
      }),
      stopMessage: "Stopped: confident after 140 of 260 likely job emails",
      stoppedAt: NOW.toISOString(),
      totalTokens: 1246,
    });
  });

  it("words a failed run by what it ran into, and says when it stopped (TBD-112)", async () => {
    const expected: Record<StopCause, string> = {
      mailbox:
        "Stopped: couldn't read your mailbox after 3 of 12 likely job emails. Check Settings › Mailbox, then try again.",
      ai: "Stopped: the AI provider couldn't be used after 3 of 12 likely job emails. Check Settings › AI, then try again.",
      internal:
        "Stopped: something went wrong on JobFilly's side after 3 of 12 likely job emails. Your settings don't need changing; trying again later may help.",
    };
    for (const cause of ["mailbox", "ai", "internal"] as const) {
      deps.clock.advance(60_000);
      const scan = await seedScan(deps, ws.workspaceId, {
        kind: "first",
        status: "running",
        counts: { likely: 12, analyzed: 3, notAnalyzed: 9 },
      });
      const at = deps.clock.now();
      await stopScan(deps.db, ws.workspaceId, scan.id, "failed", at, cause);
      const body = await current();
      expect(body.progress).toMatchObject({ scanId: scan.id, stopReason: "failed" });
      expect(body.stopMessage).toBe(expected[cause]);
      expect(body.stoppedAt).toBe(at.toISOString());
    }
  });
});

describe("POST /scans (F4.1)", () => {
  it("lets an admin start the first scan: one queued scan and its job, sent live", async () => {
    await connect();
    const res = await admin.post(url());
    expect(res.status).toBe(201);
    const body = CurrentScanSchema.parse(await res.json());
    expect(body.progress).toMatchObject({ kind: "first", status: "queued", analyzed: 0 });
    const job = await claimJob(deps.db, {
      owner: "probe",
      types: [SCAN_RUN_JOB],
      now: deps.clock.now(),
      leaseMs: 1000,
    });
    expect(job?.payload).toEqual({ scanId: body.progress?.scanId, workspaceId: ws.workspaceId });
    await settle();
    expect(events).toEqual([
      { type: "scan.progress", data: expect.objectContaining({ status: "queued" }) },
    ]);
  });

  it("refuses a second run while one is queued or running", async () => {
    await connect();
    expect((await admin.post(url())).status).toBe(201);
    const again = await admin.post(url());
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "running" });
    expect((await admin.post(url("/analyze-rest"))).status).toBe(409);
  });

  it("asks for a mailbox and an AI provider first", async () => {
    const noMailbox = await admin.post(url());
    expect(noMailbox.status).toBe(409);
    expect(await noMailbox.json()).toEqual({
      error: "no_mailbox",
      message: "Connect a mailbox before starting a scan",
    });
    await seedMailbox(deps, ws.workspaceId, {
      address: "maria.santos@inbox.example",
      conn: { host: "imap.test", port: 993, tlsMode: "tls", username: "m", password: "p" },
      sentFolderPath: null,
    });
    const noAi = await admin.post(url());
    expect(await noAi.json()).toMatchObject({ error: "no_ai" });
  });

  it("is for admins only (F1.8)", async () => {
    await connect();
    expect((await editor.post(url())).status).toBe(403);
    expect((await viewer.post(url())).status).toBe(403);
    expect((await outsider.post(url())).status).toBe(404);
    expect((await current()).progress).toBeNull();
  });
});

describe("POST /scans/:scanId/cancel (F4.4)", () => {
  it("stops a running scan as cancelled, with the not-analyzed count up to date", async () => {
    const scan = await seedScan(deps, ws.workspaceId, {
      kind: "first",
      status: "running",
      counts: { likely: 30, analyzed: 20, notAnalyzed: 99 },
    });
    const res = await admin.post(url(`/${scan.id}/cancel`));
    expect(res.status).toBe(200);
    const body = CurrentScanSchema.parse(await res.json());
    expect(body.progress).toMatchObject({
      status: "stopped",
      stopReason: "cancelled",
      notAnalyzed: 0,
    });
    expect(body.stopMessage).toBe("Stopped: cancelled after 20 of 30 likely job emails");
    expect(deps.logs.filter((l) => l.event === "scan.stopped")).toEqual([
      expect.objectContaining({ scanId: scan.id, reason: "cancelled" }),
    ]);
    await settle();
    expect(events).toEqual([
      {
        type: "scan.stopped",
        data: expect.objectContaining({
          scanId: scan.id,
          stopReason: "cancelled",
          stopMessage: "Stopped: cancelled after 20 of 30 likely job emails",
        }),
      },
    ]);
    const again = await admin.post(url(`/${scan.id}/cancel`));
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "stopped" });
  });

  it("answers 404 for a scan that isn't the workspace's, and 403 below admin", async () => {
    const other = await seedUser(deps);
    const theirs = await seedScan(deps, other.workspaceId, {
      kind: "first",
      status: "running",
      startedBy: other.id,
    });
    expect((await admin.post(url(`/${theirs.id}/cancel`))).status).toBe(404);
    expect((await admin.post(url("/not-a-uuid/cancel"))).status).toBe(404);
    const mine = await seedScan(deps, ws.workspaceId, { kind: "first", status: "running" });
    expect((await editor.post(url(`/${mine.id}/cancel`))).status).toBe(403);
    expect((await current()).progress?.status).toBe("running");
  });
});

describe("POST /scans/analyze-rest (F4.10)", () => {
  it("needs the first scan to have stopped, then queues a run over what is left", async () => {
    await connect();
    const none = await admin.post(url("/analyze-rest"));
    expect(none.status).toBe(409);
    expect(await none.json()).toMatchObject({ error: "no_first_scan" });
    await seedScan(deps, ws.workspaceId, {
      kind: "first",
      status: "stopped",
      stopReason: "confident",
    });
    const res = await admin.post(url("/analyze-rest"));
    expect(res.status).toBe(201);
    expect(CurrentScanSchema.parse(await res.json()).progress).toMatchObject({
      kind: "analyze_rest",
      status: "queued",
    });
    expect((await editor.post(url("/analyze-rest"))).status).toBe(403);
  });
});

describe("a scan from start to stop", () => {
  it("is started over HTTP, run by the queue, and shown stopped to every member", async () => {
    await connect();
    const envelopes: Envelope[] = Array.from({ length: 3 }, (_, i) => ({
      messageId: `<route-${i}@agency.example>`,
      folder: "inbox",
      folderPath: "INBOX",
      uidValidity: 1,
      uid: i + 1,
      date: new Date(NOW.getTime() - (i + 1) * 3600_000).toISOString(),
      from: { address: `r${i}@agency.example`, name: null },
      to: [],
      cc: [],
      replyTo: [],
      inReplyTo: null,
      references: [],
      subject: "A role",
      listId: null,
      listUnsubscribe: null,
      precedence: null,
      autoSubmitted: null,
      snippet: "Hello",
    }));
    deps.mail = fakeMail(envelopes).port;
    deps.ai = fakeAi({ classify: () => "recruiter_outreach", extract: () => [] }).port;
    deps.intake = { aggregate: aggregateFromReplies };
    expect((await admin.post(url())).status).toBe(201);
    while (await deps.queue.runOnce()) {}
    const body = await current();
    expect(body.progress).toMatchObject({ status: "stopped", stopReason: "done", analyzed: 3 });
    expect(body.stopMessage).toBe("Stopped: done, all 3 likely job emails analyzed");
    expect(body.totalTokens).toBe(4 * 110);
  });
});
