import { randomUUID } from "node:crypto";
import type { AiClient } from "@jobfilly/ai";
import { aggregateIntake } from "@jobfilly/core";
import {
  getIntakeExtras,
  listToEvaluate,
  loadIntakeInput,
  saveAnalysis,
  saveEnvelopes,
  savePreferences,
  usageTotal,
} from "@jobfilly/db";
import {
  type AiClientSettings,
  CORE_PROFILE_KEYS,
  type Envelope,
  type ExtraQuestion,
  type IntakeExtraInput,
  type IntakeExtraOutput,
  IntakeFormSchema,
  type JobFacts,
  type LiveEvent,
  NOT_ENOUGH_EVIDENCE,
  type Preferences,
  ProfileListSchema,
  ProfileSchema,
  type TaskResult,
} from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { MINUTE } from "../clock";
import { createBackgroundWork } from "../deps";
import { reevaluateWorkspace, requestRun } from "../pipeline/reevaluate";
import {
  createTestDeps,
  fakeAiClient,
  recordingStages,
  type SeededUser,
  type SeededWorkspace,
  seedAiSettings,
  seedScan,
  seedUser,
  seedWorkspace,
  signedIn,
  type TestClient,
  type TestDeps,
  testClient,
} from "../testing";

// The intake form over HTTP (F6.1-F6.7) on PGlite, with a fake AI for the one intake.v1 call.

const AI_KEY = "E2E-SECRET-ai-key";
const MODELS = {
  classify: "m",
  extract: "m",
  prefs: "m",
  intake: "m",
  cv: "m",
  match: "m",
  draft: "m",
  assistant: "m",
};
const NOW = new Date("2026-10-01T10:00:00Z");
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000).toISOString();

const QUESTIONS: ExtraQuestion[] = [
  {
    slug: "relocation",
    label: "Would you relocate within the EU for the right role?",
    options: ["Yes", "No"],
    evidence: ["<maria-reply-1@inbox.example>"],
  },
  {
    slug: "notice-period",
    label: "What is your notice period?",
    options: ["1 month", "3 months"],
    evidence: ["<job-4@agency.example>"],
  },
];

type IntakeAnswer = TaskResult<IntakeExtraOutput>;
const answered = (questions: ExtraQuestion[]): IntakeAnswer => ({
  ok: true,
  data: { questions },
  usage: [{ task: "intake.v1", inputTokens: 530, outputTokens: 52 }],
});

/** A fake AI port: records every intake.v1 call and answers what the test says. */
function fakeAi() {
  const calls: IntakeExtraInput[] = [];
  const settings: AiClientSettings[] = [];
  let answer: () => Promise<IntakeAnswer> = async () => answered(QUESTIONS);
  const notUsed = () => Promise.reject(new Error("not used by the intake"));
  const client: AiClient = fakeAiClient({
    classify: notUsed,
    extract: notUsed,
    prefs: notUsed,
    test: notUsed,
    async intake(input) {
      calls.push(input);
      return answer();
    },
  });
  return {
    calls,
    settings,
    answerWith(next: () => Promise<IntakeAnswer>) {
      answer = next;
    },
    port: {
      client(s: AiClientSettings) {
        settings.push(s);
        return client;
      },
    },
  };
}

/**
 * How long a check waits for background work (the intake.v1 call, its usage, its live event).
 * vi.waitFor gives up after 1 second by default, and the work took longer than that on a machine
 * at load 50; see vitest.config.ts.
 */
const WAIT = { timeout: 30_000 };

/** vi.waitFor with room for a loaded machine. */
const waitFor = <T>(check: () => T | Promise<T>) => vi.waitFor(check, WAIT);

/** A promise the test resolves itself, to hold a model call open. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function envelope(
  messageId: string,
  hours: number,
  folder: "inbox" | "sent",
  overrides: Partial<Envelope> = {},
): Envelope {
  return {
    messageId,
    folder,
    folderPath: folder === "sent" ? "Sent" : "INBOX",
    uidValidity: 1,
    uid: Math.round(hours * 10),
    date: hoursAgo(hours),
    from:
      folder === "sent"
        ? { address: "maria.santos@inbox.example", name: "Maria Santos" }
        : { address: `recruiter@agency${hours}.example`, name: null },
    to: [],
    cc: [],
    replyTo: [],
    inReplyTo: null,
    references: [],
    subject: `Subject ${messageId}`,
    listId: null,
    listUnsubscribe: null,
    precedence: null,
    autoSubmitted: null,
    snippet: `Snippet of ${messageId}`,
    ...overrides,
  };
}

const facts = (overrides: Partial<JobFacts>): JobFacts => ({
  title: null,
  company: null,
  agency: null,
  places: [],
  workMode: null,
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
  ...overrides,
});

const replyId = (n: number) => `<maria-reply-${n}@inbox.example>`;
const jobId = (n: number) => `<job-${n}@agency.example>`;

const MARIA_PREFS: Preferences = {
  places: [
    { country: "DE", city: "Berlin", mode: "hybrid" },
    { country: "NL", city: "Amsterdam", mode: "hybrid" },
  ],
  min_pay: [
    { amount: 70000, currency: "EUR", period: "year", asWritten: "€70,000 a year" },
    { amount: 450, currency: "EUR", period: "day", asWritten: "€450 a day" },
  ],
  contracts: ["permanent", "B2B"],
};

/** Stores what a first scan of Maria's mail leaves: two replies and six job messages. */
async function seedMariaMail(workspaceId: string) {
  await saveEnvelopes(deps.db, workspaceId, [
    ...[1, 2].map((n) => ({
      envelope: envelope(replyId(n), n, "sent"),
      verdict: "own_reply" as const,
      reason: "test",
    })),
    ...[3, 4, 5, 6, 7, 8].map((n) => ({
      envelope: envelope(jobId(n), n, "inbox"),
      verdict: "likely_job" as const,
      reason: "test",
    })),
    {
      envelope: envelope("<newsletter@shop.example>", 0.5, "inbox"),
      verdict: "not_job" as const,
      reason: "test",
    },
  ]);
  for (const n of [1, 2]) {
    await savePreferences(deps.db, workspaceId, {
      messageId: replyId(n),
      scanId: null,
      preferences: MARIA_PREFS,
    });
  }
  for (const n of [3, 4, 5, 6, 7, 8]) {
    await saveAnalysis(deps.db, workspaceId, {
      messageId: jobId(n),
      scanId: null,
      category: "recruiter_outreach",
      roles: [facts({ title: "Backend Engineer", contract: "unbefristet" })],
    });
  }
}

let deps: TestDeps;
let app: ReturnType<typeof createApp>;
let ai: ReturnType<typeof fakeAi>;
let ws: SeededWorkspace;
let maria: SeededUser;
let admin: TestClient;
let editor: TestClient;
let viewer: TestClient;
let outsider: TestClient;
let events: LiveEvent[];

beforeEach(async () => {
  ai = fakeAi();
  deps = await createTestDeps({ ai: ai.port, now: NOW });
  app = createApp(deps);
  maria = await seedUser(deps, { name: "Maria Santos", email: "maria.santos@inbox.example" });
  const ed = await seedUser(deps, { name: "Eddie Editor" });
  const tom = await seedUser(deps, { name: "Tom Okafor", email: "tom.okafor@inbox.example" });
  const stranger = await seedUser(deps, { name: "Stranger" });
  ws = await seedWorkspace(deps, {
    owner: maria,
    members: [
      { user: ed, role: "editor" },
      { user: tom, role: "viewer" },
    ],
  });
  await seedAiSettings(deps, ws.workspaceId, {
    provider: "openai-compatible",
    baseUrl: "http://fake-ai:8080/v1",
    models: MODELS,
    apiKey: AI_KEY,
  });
  admin = await signedIn(app, deps, maria);
  editor = await signedIn(app, deps, ed);
  viewer = await signedIn(app, deps, tom);
  outsider = await signedIn(app, deps, stranger);
  events = [];
  deps.live.subscribe(
    { workspaceId: ws.workspaceId, userId: maria.id, sessionId: randomUUID() },
    (e) => events.push(e),
    () => {},
  );
});
afterEach(() => deps.close());

const intakePath = (rest = "") => `/api/workspaces/${ws.workspaceId}/intake${rest}`;
const profilesPath = (rest = "") => `/api/workspaces/${ws.workspaceId}/profiles${rest}`;

async function stopFirstScan() {
  return seedScan(deps, ws.workspaceId, {
    kind: "first",
    status: "stopped",
    stopReason: "confident",
  });
}

async function form(client: TestClient) {
  const res = await client.get(intakePath());
  expect(res.status).toBe(200);
  return IntakeFormSchema.parse(await res.json());
}

/** Waits until the extra questions are no longer pending. */
async function settledForm(client: TestClient) {
  await waitFor(async () => expect((await form(client)).extras.status).not.toBe("pending"));
  return form(client);
}

const entryOf = (f: { proposal: { entries: { key: string }[] } }, key: string) =>
  f.proposal.entries.find((e) => e.key === key);

describe("GET /intake (F6.1)", () => {
  it("is not ready until the first scan has stopped", async () => {
    const res = await viewer.get(intakePath());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "not_ready" });
    await seedScan(deps, ws.workspaceId, { kind: "first", status: "running" });
    expect((await viewer.get(intakePath())).status).toBe(409);
    expect(ai.calls).toHaveLength(0);
  });

  it("returns the core proposals aggregated from what the scan stored", async () => {
    await seedMariaMail(ws.workspaceId);
    await stopFirstScan();
    const f = await form(viewer);
    expect(f.proposal).toEqual(aggregateIntake(await loadIntakeInput(deps.db, ws.workspaceId)));
    expect(f.proposal.entries.map((e) => e.key)).toEqual([...CORE_PROFILE_KEYS]);
    expect(entryOf(f, "places")).toMatchObject({
      value: MARIA_PREFS.places,
      confidence: "medium",
      evidence: [
        { messageId: replyId(1), reason: "from 2 of your replies" },
        { messageId: replyId(2), reason: "from 2 of your replies" },
      ],
    });
    expect(entryOf(f, "target_roles")).toMatchObject({
      value: ["Backend Engineer"],
      evidence: [3, 4, 5, 6, 7, 8].map((n) => ({ messageId: jobId(n), reason: "in 6 job emails" })),
    });
    // Job mail never changes an answer the replies state.
    expect(entryOf(f, "contracts")).toMatchObject({ value: ["permanent", "B2B"] });
    expect(entryOf(f, "seniority")).toMatchObject({
      value: [],
      confidence: null,
      emptyReason: NOT_ENOUGH_EVIDENCE,
    });
    expect(f.edits).toEqual([]);
  });

  it("asks intake.v1 once, in the background, and shows up to five extra questions", async () => {
    await seedMariaMail(ws.workspaceId);
    await stopFirstScan();
    const first = await form(viewer);
    expect(first.extras).toEqual({ status: "pending", questions: [] });
    const settled = await settledForm(viewer);
    expect(settled.extras).toEqual({ status: "done", questions: QUESTIONS });
    expect(ai.calls).toHaveLength(1);
    await waitFor(() => expect(events).toContainEqual({ type: "intake.updated", data: {} }));
    // The opened key and the workspace's models reach the AI port; never the response.
    expect(ai.settings).toEqual([
      {
        provider: "openai-compatible",
        baseUrl: "http://fake-ai:8080/v1",
        models: MODELS,
        apiKey: AI_KEY,
      },
    ]);
    await form(editor);
    await form(admin);
    expect(ai.calls).toHaveLength(1);
  });

  it("gives intake.v1 the answered entries' evidence newest first and every core answer", async () => {
    await seedMariaMail(ws.workspaceId);
    await stopFirstScan();
    await settledForm(admin);
    const [input] = ai.calls;
    expect(input?.items.map((i) => i.messageId)).toEqual([
      replyId(1),
      replyId(2),
      ...[3, 4, 5, 6, 7, 8].map(jobId),
    ]);
    expect(input?.items[0]).toEqual({
      messageId: replyId(1),
      folder: "sent",
      from: { address: "maria.santos@inbox.example", name: "Maria Santos" },
      date: hoursAgo(1),
      subject: `Subject ${replyId(1)}`,
      text: `Snippet of ${replyId(1)}`,
    });
    expect(input?.answers.map((a) => a.key)).toEqual([...CORE_PROFILE_KEYS]);
    expect(input?.answers.find((a) => a.key === "min_pay")).toEqual({
      key: "min_pay",
      value: MARIA_PREFS.min_pay,
      confidence: "medium",
    });
  });

  it("records the call's usage outside any scan run", async () => {
    await seedMariaMail(ws.workspaceId);
    const scan = await stopFirstScan();
    await settledForm(viewer);
    await waitFor(async () =>
      expect(await usageTotal(deps.db, ws.workspaceId)).toEqual({
        calls: 1,
        inputTokens: 530,
        outputTokens: 52,
      }),
    );
    expect((await usageTotal(deps.db, ws.workspaceId, scan.id)).calls).toBe(0);
  });

  it("makes exactly one call when two requests open the form at once", async () => {
    await seedMariaMail(ws.workspaceId);
    await stopFirstScan();
    const held = deferred<IntakeAnswer>();
    ai.answerWith(() => held.promise);
    const [a, b] = await Promise.all([form(viewer), form(editor)]);
    expect([a.extras.status, b.extras.status]).toEqual(["pending", "pending"]);
    expect((await form(admin)).extras.status).toBe("pending");
    await waitFor(() => expect(ai.calls).toHaveLength(1));
    held.resolve(answered(QUESTIONS.slice(0, 1)));
    const settled = await settledForm(admin);
    expect(settled.extras.questions).toEqual(QUESTIONS.slice(0, 1));
    await waitFor(() => expect(events.filter((e) => e.type === "intake.updated")).toHaveLength(1));
    expect(ai.calls).toHaveLength(1);
  });

  it("lets one caller take over a claim left pending for more than 2 minutes", async () => {
    await seedMariaMail(ws.workspaceId);
    await stopFirstScan();
    // The first claimant's replica dies mid-call: its answer never comes.
    ai.answerWith(() => new Promise<IntakeAnswer>(() => {}));
    await form(viewer);
    await waitFor(() => expect(ai.calls).toHaveLength(1));
    deps.clock.advance(1 * MINUTE);
    expect((await form(viewer)).extras.status).toBe("pending");
    expect(ai.calls).toHaveLength(1);

    deps.clock.advance(1.5 * MINUTE);
    ai.answerWith(async () => answered(QUESTIONS));
    const [a, b] = await Promise.all([form(viewer), form(editor)]);
    expect([a.extras.status, b.extras.status]).toEqual(["pending", "pending"]);
    expect((await settledForm(admin)).extras.questions).toEqual(QUESTIONS);
    expect(ai.calls).toHaveLength(2);
  });

  it("goes on without extra questions when the call fails, and doesn't ask again", async () => {
    await seedMariaMail(ws.workspaceId);
    await stopFirstScan();
    ai.answerWith(async () => ({
      ok: false,
      error: { kind: "unreachable", message: "Couldn't reach the provider" },
      usage: [],
    }));
    expect((await settledForm(viewer)).extras).toEqual({ status: "failed", questions: [] });
    deps.clock.advance(10 * MINUTE);
    await form(viewer);
    expect(ai.calls).toHaveLength(1);
  });

  it("shows only questions found in the mail: evidence it was shown, each slug once", async () => {
    await seedMariaMail(ws.workspaceId);
    await stopFirstScan();
    const invented = "<invented-by-the-model@nowhere.example>";
    ai.answerWith(async () =>
      answered([
        { ...QUESTIONS[0], evidence: [invented, replyId(1)] } as ExtraQuestion,
        { slug: "visa", label: "Do you need a visa?", options: [], evidence: [invented] },
        { slug: "start-date", label: "When could you start?", options: [], evidence: [] },
        { ...QUESTIONS[0], label: "Relocation, asked again?" } as ExtraQuestion,
        QUESTIONS[1] as ExtraQuestion,
      ]),
    );
    const settled = await settledForm(viewer);
    expect(settled.extras).toEqual({ status: "done", questions: QUESTIONS });
    // Only what is shown can be answered.
    for (const slug of ["visa", "start-date"]) {
      const res = await editor.put(intakePath(`/answers/extra.${slug}`), { value: ["x"] });
      expect(res.status, slug).toBe(404);
    }
  });

  it("logs a client failure as a warning without its message, and goes on without extras", async () => {
    await seedMariaMail(ws.workspaceId);
    await stopFirstScan();
    ai.answerWith(() => Promise.reject(new TypeError("E2E-MARKER-client-failure")));
    expect((await settledForm(viewer)).extras).toEqual({ status: "failed", questions: [] });
    const line = deps.logs.find((l) => l.event === "intake.extras_failed");
    expect(line).toMatchObject({ level: "warn", workspaceId: ws.workspaceId, error: "TypeError" });
    expect(deps.rawLogs.join("\n")).not.toContain("E2E-MARKER");
    expect(deps.logs.filter((l) => l.level === "error")).toEqual([]);
  });

  it("fails for good, without logging the questions, when storing them fails", async () => {
    await seedMariaMail(ws.workspaceId);
    await stopFirstScan();
    // Postgres refuses a NUL character in jsonb, so finishIntakeExtras fails with a database error
    // whose message quotes the query's parameters: the model's questions. (The real client refuses
    // such output by its schema; this fake hands it over unchecked, as any unstorable answer.)
    ai.answerWith(async () =>
      answered([{ ...(QUESTIONS[0] as ExtraQuestion), label: "E2E-MARKER-question\u0000?" }]),
    );
    expect((await settledForm(viewer)).extras).toEqual({ status: "failed", questions: [] });
    const line = deps.logs.find((l) => l.event === "intake.extras_failed");
    expect(line).toMatchObject({ level: "warn", workspaceId: ws.workspaceId });
    expect(line?.error).toMatch(/Error$/);
    expect(deps.rawLogs.join("\n")).not.toContain("E2E-MARKER");
    expect(deps.logs.filter((l) => l.level === "error")).toEqual([]);
    await waitFor(() => expect(events.filter((e) => e.type === "intake.updated")).toHaveLength(1));
    // Final, not an abandoned claim: no takeover asks the model again, and Confirm isn't held.
    deps.clock.advance(10 * MINUTE);
    expect((await form(viewer)).extras.status).toBe("failed");
    expect(ai.calls).toHaveLength(1);
    expect((await editor.post(intakePath("/confirm"), {})).status).toBe(201);
  });

  it("calls the provider with no key when the stored key was cleared on purpose", async () => {
    // A cleared key is stored sealed as "", which must reach the AI port as no key at all.
    await seedAiSettings(deps, ws.workspaceId, {
      provider: "openai-compatible",
      baseUrl: "http://fake-ai:8080/v1",
      models: MODELS,
      apiKey: "",
    });
    await seedMariaMail(ws.workspaceId);
    await stopFirstScan();
    await form(viewer);
    await deps.background.settled();
    expect(ai.settings).toEqual([
      {
        provider: "openai-compatible",
        baseUrl: "http://fake-ai:8080/v1",
        models: MODELS,
        apiKey: null,
      },
    ]);
  });

  it("stores an answer that arrives after shutdown began, before the database closes", async () => {
    await seedMariaMail(ws.workspaceId);
    await stopFirstScan();
    const held = deferred<IntakeAnswer>();
    ai.answerWith(() => held.promise);
    await form(viewer);
    await waitFor(() => expect(ai.calls).toHaveLength(1));
    deps.health.beginShutdown();
    held.resolve(answered(QUESTIONS));
    await deps.background.settled();
    expect(await usageTotal(deps.db, ws.workspaceId)).toMatchObject({ calls: 1 });
    expect(await getIntakeExtras(deps.db, ws.workspaceId)).toMatchObject({
      status: "done",
      questions: QUESTIONS,
    });
    await waitFor(() => expect(events).toContainEqual({ type: "intake.updated", data: {} }));
    expect(deps.logs.filter((l) => l.level === "error" || l.level === "warn")).toEqual([]);
  });

  it("hands the claim back when shutdown stops the call, for the next GET to take over", async () => {
    await seedMariaMail(ws.workspaceId);
    await stopFirstScan();
    // The model hasn't answered when shutdown reaches the job hand-back step.
    ai.answerWith(() => new Promise<IntakeAnswer>(() => {}));
    await form(viewer);
    await waitFor(() => expect(ai.calls).toHaveLength(1));
    deps.health.beginShutdown();
    await deps.background.stop();
    expect(deps.background.running).toBe(0);
    expect(await usageTotal(deps.db, ws.workspaceId)).toMatchObject({ calls: 0 });
    expect(await getIntakeExtras(deps.db, ws.workspaceId)).toMatchObject({ status: "pending" });
    await waitFor(() => expect(events).toContainEqual({ type: "intake.updated", data: {} }));
    expect(deps.logs.filter((l) => l.level === "error" || l.level === "warn")).toEqual([]);

    // Another replica, with no time passing: its first GET takes the claim over and asks again.
    const background = createBackgroundWork();
    const replica = createApp({ ...deps, background });
    const viewerThere = testClient(replica, deps, viewer.cookie);
    ai.answerWith(async () => answered(QUESTIONS));
    expect((await form(viewerThere)).extras.status).toBe("pending");
    await background.settled();
    expect(ai.calls).toHaveLength(2);
    expect((await form(viewerThere)).extras).toEqual({ status: "done", questions: QUESTIONS });
    const confirm = await testClient(replica, deps, editor.cookie).post(intakePath("/confirm"), {});
    expect(confirm.status).toBe(201);
  });

  it("gives Tom's thin inbox every answer empty, and intake.v1 no items (F6.6)", async () => {
    await saveEnvelopes(deps.db, ws.workspaceId, [
      { envelope: envelope(jobId(1), 1, "inbox"), verdict: "likely_job", reason: "test" },
    ]);
    await saveAnalysis(deps.db, ws.workspaceId, {
      messageId: jobId(1),
      scanId: null,
      category: "recruiter_outreach",
      roles: [facts({ title: "Staff Nurse (Band 6)" })],
    });
    await stopFirstScan();
    const f = await settledForm(viewer);
    for (const e of f.proposal.entries) {
      expect(e, e.key).toMatchObject({ value: [], confidence: null, evidence: [] });
      expect(e.emptyReason, e.key).toBe(NOT_ENOUGH_EVIDENCE);
    }
    expect(ai.calls[0]?.items).toEqual([]);
  });

  it("is refused to non-members with 404", async () => {
    await stopFirstScan();
    expect((await outsider.get(intakePath())).status).toBe(404);
  });
});

describe("PUT /intake/answers/:key (F6.4)", () => {
  beforeEach(async () => {
    await seedMariaMail(ws.workspaceId);
    await stopFirstScan();
  });

  const berlinOnly = { value: [{ country: "DE", city: "Berlin", mode: "hybrid" }] };

  it("stores an editor's click edit as theirs", async () => {
    const res = await editor.put(intakePath("/answers/places"), berlinOnly);
    expect(res.status).toBe(200);
    const edit = await res.json();
    expect(edit).toMatchObject({ key: "places", value: berlinOnly.value, source: "you" });
    const f = await form(viewer);
    expect(f.edits).toEqual([edit]);
    expect(f.edits[0]?.updatedAt).toBe(NOW.toISOString());
    // The proposal stays what the scan found; the form shows the edit on top.
    expect(entryOf(f, "places")).toMatchObject({ value: MARIA_PREFS.places });
    await waitFor(() => expect(events).toContainEqual({ type: "intake.updated", data: {} }));
  });

  it("is refused to viewers with 403 and to non-members with 404", async () => {
    expect((await viewer.put(intakePath("/answers/places"), berlinOnly)).status).toBe(403);
    expect((await outsider.put(intakePath("/answers/places"), berlinOnly)).status).toBe(404);
    expect((await form(admin)).edits).toEqual([]);
  });

  it("checks the value against the question's shape", async () => {
    const res = await editor.put(intakePath("/answers/places"), { value: ["Berlin"] });
    expect(res.status).toBe(400);
    const pay = await editor.put(intakePath("/answers/min_pay"), {
      value: [{ amount: 30, currency: "pounds", period: "hour", asWritten: "£30/h" }],
    });
    expect(pay.status).toBe(400);
    expect((await editor.put(intakePath("/answers/salary"), { value: [] })).status).toBe(404);
    // Words Postgres can't store are refused here, not when they are written.
    const nul = await editor.put(intakePath("/answers/target_roles"), { value: ["Dev\u0000"] });
    expect(nul.status).toBe(400);
  });

  it("accepts answers to the extra questions that were asked, and only those", async () => {
    await settledForm(viewer);
    const ok = await editor.put(intakePath("/answers/extra.relocation"), { value: ["Yes"] });
    expect(ok.status).toBe(200);
    const unknown = await editor.put(intakePath("/answers/extra.salary-history"), { value: ["x"] });
    expect(unknown.status).toBe(404);
  });
});

describe("POST /intake/confirm (F6.5)", () => {
  beforeEach(async () => {
    await seedMariaMail(ws.workspaceId);
    await stopFirstScan();
  });

  it("saves 'My job search' with every entry and its source, and logs intake.confirmed", async () => {
    await settledForm(viewer);
    await editor.put(intakePath("/answers/places"), {
      value: [{ country: "DE", city: "Berlin", mode: "hybrid" }],
    });
    await editor.put(intakePath("/answers/extra.relocation"), { value: ["Yes"] });
    deps.clock.advance(MINUTE);
    const res = await editor.post(intakePath("/confirm"), {});
    expect(res.status).toBe(201);
    const profile = ProfileSchema.parse(await res.json());
    expect(profile).toMatchObject({
      workspaceId: ws.workspaceId,
      name: "My job search",
      confirmedAt: new Date(NOW.getTime() + MINUTE).toISOString(),
    });
    expect(profile.entries.map((e) => e.key)).toEqual([
      ...CORE_PROFILE_KEYS,
      "extra.relocation",
      "extra.notice-period",
    ]);
    const byKey = Object.fromEntries(profile.entries.map((e) => [e.key, e]));
    expect(byKey.places).toMatchObject({
      value: [{ country: "DE", city: "Berlin", mode: "hybrid" }],
      source: "you",
    });
    expect(byKey.min_pay).toMatchObject({ value: MARIA_PREFS.min_pay, source: "scan" });
    expect(byKey["extra.relocation"]).toMatchObject({ value: ["Yes"], source: "you" });
    expect(byKey["extra.notice-period"]).toMatchObject({ value: [], source: "scan" });

    const line = deps.logs.find((l) => l.event === "intake.confirmed");
    expect(line).toMatchObject({
      level: "info",
      profileId: profile.id,
      workspaceId: ws.workspaceId,
    });
  });

  it("waits for the extra questions: refused while they are pending, then saved with them", async () => {
    const held = deferred<IntakeAnswer>();
    ai.answerWith(() => held.promise);
    expect((await form(editor)).extras.status).toBe("pending");
    const early = await editor.post(intakePath("/confirm"), {});
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ error: "extras_pending" });
    held.resolve(answered(QUESTIONS));
    await settledForm(editor);
    const res = await editor.post(intakePath("/confirm"), {});
    expect(res.status).toBe(201);
    const profile = ProfileSchema.parse(await res.json());
    expect(profile.entries.map((e) => e.key)).toContain("extra.relocation");
  });

  it("has the first scan's backlog matched once confirmed (F1.6)", async () => {
    const stages = recordingStages();
    stages.sender = async () => ({
      check: { verdict: "looks_fine", complete: true, reasons: [], mark: null },
      language: null,
    });
    // Before Confirm the pipeline can only check the senders: there is no profile to match.
    await reevaluateWorkspace(deps, ws.workspaceId, { stages });
    expect(await listToEvaluate(deps.db, ws.workspaceId)).toHaveLength(6);
    await settledForm(viewer);
    expect((await editor.post(intakePath("/confirm"), {})).status).toBe(201);
    // Confirm asked for the re-evaluation: one is waiting.
    expect((await requestRun(deps, ws.workspaceId, "probe")).enqueued).toBe(false);
    const outcome = await reevaluateWorkspace(deps, ws.workspaceId, { stages });
    expect(outcome.processed).toBe(6);
    expect(stages.calls.filter((c) => c.startsWith("match"))).toHaveLength(6);
    expect(await listToEvaluate(deps.db, ws.workspaceId)).toEqual([]);
  });

  it("can be finished without any edit", async () => {
    const res = await admin.post(intakePath("/confirm"), {});
    expect(res.status).toBe(201);
    const profile = ProfileSchema.parse(await res.json());
    expect(profile.entries.every((e) => e.source === "scan")).toBe(true);
  });

  it("takes another name, and is made once", async () => {
    const res = await editor.post(intakePath("/confirm"), { name: "Remote EU" });
    expect(ProfileSchema.parse(await res.json()).name).toBe("Remote EU");
    const again = await editor.post(intakePath("/confirm"), {});
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "confirmed" });
    const edit = await editor.put(intakePath("/answers/contracts"), { value: ["B2B"] });
    expect(edit.status).toBe(409);
  });

  it("is refused to viewers with 403 and to non-members with 404 (F6.7)", async () => {
    expect((await viewer.post(intakePath("/confirm"), {})).status).toBe(403);
    expect((await outsider.post(intakePath("/confirm"), {})).status).toBe(404);
    const list = ProfileListSchema.parse(await (await admin.get(profilesPath())).json());
    expect(list.items).toEqual([]);
  });

  it("is refused before the first scan has stopped", async () => {
    const other = await seedWorkspace(deps, { owner: maria });
    const res = await admin.post(`/api/workspaces/${other.workspaceId}/intake/confirm`, {});
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "not_ready" });
  });
});
