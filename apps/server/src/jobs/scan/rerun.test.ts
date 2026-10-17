import {
  addMember,
  createConfirmedProfile,
  getHistory,
  getLatestScan,
  getMessageMailbox,
  listIntakeAnswers,
  listProfiles,
  SCAN_RUN_JOB,
  saveIntakeAnswer,
} from "@jobfilly/db";
import {
  type Envelope,
  IntakeFormSchema,
  type JobFacts,
  type Preferences,
  ProfileSchema,
  type ScanFocus,
  ScanRunPayloadSchema,
} from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { MINUTE } from "../../clock";
import {
  createTestDeps,
  type SeededUser,
  seedAiSettings,
  seedMailbox,
  seedScan,
  seedUser,
  signedIn,
  TEST_AI_MODELS,
  type TestClient,
  type TestDeps,
} from "../../testing";
import { defineJob } from "../queue";
import { type FakeAi, type FakeMail, fakeAi, fakeMail } from "./fakes";
import { createScanRunHandler } from "./index";

// Re-running setup (MVP 3, F1.1): an admin re-runs setup with a hint; focus.v1 reads the hint
// once and the scan keeps it; stage one reads the last 90 days of every mailbox again, so newer
// mail and the user's newer replies are in; the re-run's intake form reads only the mail in focus
// (here: Germany), and its Confirm makes a new profile next to the first one, which stays as it
// was, with a history row from the scan. The hint is never logged.

const NOW = new Date("2026-10-01T10:00:00Z");
const WORK = "maria.santos@inbox.example";
const HOME = "maria.home@post.example";
const HINT = "I've moved to Germany, permanent roles only";
const FOCUS: ScanFocus = {
  countries: ["DE"],
  cities: [],
  languages: ["de"],
  workModes: ["onsite", "hybrid"],
  contracts: ["permanent"],
  words: [],
};

let uid = 0;
function mail(id: string, minutesAgo: number, overrides: Partial<Envelope> = {}): Envelope {
  uid += 1;
  const folder = overrides.folder ?? "inbox";
  return {
    messageId: `<${id}@rerun.example>`,
    folder,
    folderPath: folder === "inbox" ? "INBOX" : "Sent",
    uidValidity: 7,
    uid,
    date: new Date(NOW.getTime() - minutesAgo * MINUTE).toISOString(),
    from: { address: `recruiter-${id}@agency.example`, name: null },
    to: [{ address: WORK, name: "Maria Santos" }],
    cc: [],
    replyTo: [],
    inReplyTo: null,
    references: [],
    subject: `A role for you (${id})`,
    listId: null,
    listUnsubscribe: null,
    precedence: null,
    autoSubmitted: null,
    snippet: `Hello Maria (${id})`,
    ...overrides,
  };
}

const reply = (id: string, to: Envelope, minutesAgo: number, from = WORK) =>
  mail(id, minutesAgo, {
    folder: "sent",
    from: { address: from, name: "Maria Santos" },
    to: [to.from],
    inReplyTo: to.messageId,
  });

const role = (overrides: Partial<JobFacts>): JobFacts => ({
  title: "Backend Engineer",
  company: "Agency",
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

const remoteJob = mail("remote-eu", 60 * 24 * 40);
const oldReply = reply("old-reply", remoteJob, 60 * 24 * 39);
const munichJob = mail("munich", 60 * 24);
const newReply = reply("moved", munichJob, 60 * 20);
const hamburgJob = mail("hamburg", 60 * 5, { to: [{ address: HOME, name: "Maria" }] });

const PREFS: Record<string, Preferences> = {
  [oldReply.messageId]: { remote: [{ scope: "EU", timeZones: null }], contracts: ["B2B"] },
  [newReply.messageId]: {
    places: [{ country: "DE", city: null, mode: "onsite" }],
    contracts: ["permanent"],
    min_pay: [{ amount: 75000, currency: "EUR", period: "year", asWritten: "€75,000 a year" }],
  },
};
const ROLES: Record<string, JobFacts[]> = {
  [remoteJob.messageId]: [role({ workMode: "remote", remoteScope: "EU" })],
  [munichJob.messageId]: [
    role({
      places: [{ country: "DE", city: "München" }],
      workMode: "onsite",
      contract: "permanent",
    }),
  ],
  [hamburgJob.messageId]: [
    role({
      places: [{ country: "DE", city: "Hamburg" }],
      workMode: "hybrid",
      contract: "permanent",
    }),
  ],
};

let deps: TestDeps;
let owner: SeededUser;
let admin: TestClient;
let editor: TestClient;
let mailFake: FakeMail;
let ai: FakeAi;
let homeMailbox: string;

beforeEach(async () => {
  deps = await createTestDeps({
    now: NOW,
    registry: {
      [SCAN_RUN_JOB]: defineJob(
        ScanRunPayloadSchema,
        createScanRunHandler({ progressIntervalMs: 60_000 }),
      ),
    },
  });
  const app = createApp(deps);
  owner = await seedUser(deps, { name: "Maria Santos", email: WORK });
  const ed = await seedUser(deps, { name: "Eddie Editor" });
  await addMember(deps.db, owner.workspaceId, ed.id, "editor");
  admin = await signedIn(app, deps, owner);
  editor = await signedIn(app, deps, ed);
  for (const address of [WORK, HOME]) {
    const id = await seedMailbox(deps, owner.workspaceId, {
      address,
      conn: { host: "imap.test", port: 993, tlsMode: "tls", username: address, password: "E2E-p" },
      sentFolderPath: "Sent",
    });
    if (address === HOME) homeMailbox = id;
  }
  await seedAiSettings(deps, owner.workspaceId, {
    provider: "openai-compatible",
    baseUrl: "http://fake-ai.test/v1",
    models: TEST_AI_MODELS,
    apiKey: "E2E-SECRET-ai",
  });
  mailFake = fakeMail({
    [WORK]: [remoteJob, oldReply, munichJob, newReply],
    [HOME]: [hamburgJob],
  });
  ai = fakeAi({
    classify: () => "recruiter_outreach",
    extract: (id) => ROLES[id] ?? [],
    prefs: (id) => PREFS[id] ?? {},
    focus: (hint) => (hint === HINT ? FOCUS : undefined),
  });
  deps.mail = mailFake.port;
  deps.ai = ai.port;
});
afterEach(() => deps.close());

const base = () => `/api/workspaces/${owner.workspaceId}`;
const runAll = async () => {
  while (await deps.queue.runOnce()) {}
};

/** The first scan has stopped and its profile ("Remote EU") is confirmed. */
async function confirmedFirst() {
  await seedScan(deps, owner.workspaceId, { kind: "first", status: "stopped", stopReason: "done" });
  const created = await createConfirmedProfile(deps.db, owner.workspaceId, {
    name: "Remote EU",
    entries: [],
    createdBy: owner.id,
    at: NOW,
  });
  if (!created.ok) throw new Error("expected a profile");
  deps.clock.advance(MINUTE);
  return created.profile;
}

describe("re-running setup (F1.1)", () => {
  it("is for admins once the first scan has stopped and a profile is confirmed", async () => {
    const rerun = { kind: "rerun", hint: HINT };
    expect((await editor.post(`${base()}/scans`, rerun)).status).toBe(403);
    expect((await admin.post(`${base()}/scans`, rerun)).status).toBe(409);
    await seedScan(deps, owner.workspaceId, {
      kind: "first",
      status: "stopped",
      stopReason: "done",
    });
    const noProfile = await admin.post(`${base()}/scans`, rerun);
    expect(noProfile.status).toBe(409);
    expect(await noProfile.json()).toMatchObject({ error: "no_profile" });
    const tooLong = await admin.post(`${base()}/scans`, { kind: "rerun", hint: "x".repeat(501) });
    expect(tooLong.status).toBe(400);
  });

  it("focuses the scan on the hint and makes a new profile next to the first", async () => {
    const first = await confirmedFirst();
    await saveIntakeAnswer(deps.db, owner.workspaceId, {
      key: "seniority",
      value: ["Senior"],
      source: "you",
      updatedBy: owner.id,
      at: NOW,
    });

    const started = await admin.post(`${base()}/scans`, { kind: "rerun", hint: `  ${HINT}  ` });
    expect(started.status).toBe(201);
    // The earlier form's answers go (D18): the re-run's form starts afresh.
    expect(await listIntakeAnswers(deps.db, owner.workspaceId)).toEqual([]);
    // The form waits for the re-run.
    expect((await admin.get(`${base()}/intake`)).status).toBe(409);

    await runAll();
    const scan = await getLatestScan(deps.db, owner.workspaceId, "rerun");
    expect(scan).toMatchObject({ status: "stopped", hint: HINT, focus: FOCUS });
    expect(ai.calls.filter((c) => c.task === "focus.v1")).toEqual([
      { task: "focus.v1", ids: [HINT] },
    ]);
    // Both mailboxes were read, and the home mailbox's mail is filed under it and read from it.
    expect(mailFake.connections.map((c) => c.username).sort()).toEqual([HOME, WORK].sort());
    expect(await getMessageMailbox(deps.db, owner.workspaceId, hamburgJob.messageId)).toBe(
      homeMailbox,
    );
    expect(mailFake.bodies).toContain(`${HOME} ${hamburgJob.messageId}`);
    expect(deps.logs.filter((l) => l.event === "scan.started")).toMatchObject([{ kind: "rerun" }]);
    // The hint is never logged.
    expect(deps.rawLogs.filter((l) => l.includes("moved to Germany"))).toEqual([]);

    const res = await admin.get(`${base()}/intake`);
    expect(res.status).toBe(200);
    const form = IntakeFormSchema.parse(await res.json());
    expect(form.rerun).toEqual({ hint: HINT, confirmed: false });
    const answer = (key: string) => form.proposal.entries.find((e) => e.key === key);
    // Only the mail in focus: the newer reply about Germany, not the remote EU one.
    expect(answer("places")?.value).toEqual([{ country: "DE", city: null, mode: "onsite" }]);
    expect(answer("min_pay")?.value).toMatchObject([{ currency: "EUR", period: "year" }]);
    expect(answer("contracts")?.value).toEqual(["permanent"]);
    expect(answer("remote")?.value).toEqual([]);

    await deps.background.settled();
    const confirmed = await editor.post(`${base()}/intake/confirm`, { name: "Germany permanent" });
    expect(confirmed.status).toBe(201);
    const profile = ProfileSchema.parse(await confirmed.json());
    expect(profile.name).toBe("Germany permanent");
    const profiles = await listProfiles(deps.db, owner.workspaceId);
    expect(profiles.map((p) => [p.name, p.enabled])).toEqual([
      ["Remote EU", true],
      ["Germany permanent", true],
    ]);
    // The first profile is untouched.
    expect(profiles[0]).toEqual(first);
    expect(await getHistory(deps.db, owner.workspaceId, profile.id)).toMatchObject([
      { source: "scan", by: expect.any(String), undoneAt: null },
    ]);
    expect(deps.logs.filter((l) => l.event === "intake.confirmed")).toMatchObject([
      { profileId: profile.id, kind: "rerun" },
    ]);

    const after = IntakeFormSchema.parse(await (await admin.get(`${base()}/intake`)).json());
    expect(after.rerun).toEqual({ hint: HINT, confirmed: true });
    expect((await editor.post(`${base()}/intake/confirm`, {})).status).toBe(409);
  });

  it("re-runs without a hint over all the mail of the window", async () => {
    await confirmedFirst();
    expect((await admin.post(`${base()}/scans`, { kind: "rerun" })).status).toBe(201);
    await runAll();
    expect(ai.calls.some((c) => c.task === "focus.v1")).toBe(false);
    const form = IntakeFormSchema.parse(await (await admin.get(`${base()}/intake`)).json());
    expect(form.rerun).toEqual({ hint: null, confirmed: false });
    const remote = form.proposal.entries.find((e) => e.key === "remote");
    expect(remote?.value).toEqual([{ scope: "EU", timeZones: null }]);
  });

  it("stops as failed when focus.v1 gives no answer, and reads no mail", async () => {
    await confirmedFirst();
    ai.failWith("unreachable");
    expect((await admin.post(`${base()}/scans`, { kind: "rerun", hint: HINT })).status).toBe(201);
    await runAll();
    expect(await getLatestScan(deps.db, owner.workspaceId, "rerun")).toMatchObject({
      status: "stopped",
      stopReason: "failed",
      stopCause: "ai",
    });
    expect(mailFake.bodies).toEqual([]);
  });
});
