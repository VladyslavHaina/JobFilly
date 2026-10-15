import { createScan, usagePerDay, usageTotal } from "@jobfilly/db";
import type { AiClientSettings, JobFacts } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aiClientFor } from "./ai-usage";
import {
  createFakeAi,
  createTestDeps,
  type FakeAiClient,
  type SeededUser,
  seedUser,
  TEST_AI_MODELS,
  type TestDeps,
} from "./testing";

// F1.5: Settings › AI shows model calls and tokens per day. Every AI call the server makes goes
// through aiClientFor, which records each call's usage, so no task can be left uncounted: the
// MVP 2 tasks (cv.read, match, draft.create, the assistant) and the sync's classify and extract
// show up as the MVP 1 ones do, failed calls included.

const NOW = new Date("2026-10-15T12:00:00Z");
const settings: AiClientSettings = {
  provider: "openai-compatible",
  baseUrl: "http://fake-ai/v1",
  models: TEST_AI_MODELS,
  apiKey: null,
};

let deps: TestDeps;
let ai: FakeAiClient;
let maria: SeededUser;

beforeEach(async () => {
  ai = createFakeAi({
    match: { "<m@x>#0": { titleFit: { verdict: "fits", reason: "r" }, skillCloseness: [] } },
  });
  deps = await createTestDeps({ now: NOW, ai: ai.port });
  maria = await seedUser(deps);
});
afterEach(() => deps.close());

const role: JobFacts = {
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
};
const mail = {
  messageId: "<m@x>",
  folder: "inbox" as const,
  from: { address: "a@x.example", name: null },
  date: NOW.toISOString(),
  subject: "s",
  text: "t",
};

const match = {
  messageId: "<m@x>",
  position: 0,
  role: { title: null, skills: [] },
  profile: { targetRoles: [], skills: [] },
  cvSkills: [],
};

describe("aiClientFor", () => {
  it("records every task's calls with the clock's day, whether the call worked or not", async () => {
    const ws = maria.workspaceId;
    const client = aiClientFor(deps, ws, settings);
    // The MVP 2 tasks: match has an answer, the others fail the way a provider does.
    expect((await client.match(match)).ok).toBe(true);
    await client.readCv({ contentHash: "a".repeat(64), fileName: "cv.pdf", text: "Go" });
    await client.draft({ attempt: 1, mail, position: 0, role, entries: [], cv: null });
    await client.assistant({ turn: 1, text: "hide asia", history: [], entries: [], rules: [] });
    // And the MVP 1 ones, which the sync uses too.
    await client.classify([mail]);
    await client.extract(mail);
    await client.prefs([mail]);
    await client.intake({ items: [], answers: [] });
    await client.test();
    expect(Object.values(ai.calls).reduce((a, b) => a + b, 0)).toBe(9);

    expect(await usagePerDay(deps.db, ws)).toEqual([
      { day: "2026-10-15", calls: 9, inputTokens: 900, outputTokens: 180 },
    ]);
    // The next day is a day of its own.
    deps.clock.set(new Date("2026-10-16T00:30:00Z"));
    await client.match(match);
    expect((await usagePerDay(deps.db, ws)).map((d) => [d.day, d.calls])).toEqual([
      ["2026-10-16", 1],
      ["2026-10-15", 9],
    ]);
  });

  it("scopes the usage to a scan run when given one, and to its own workspace", async () => {
    const ws = maria.workspaceId;
    const created = await createScan(deps.db, ws, { kind: "first", startedBy: maria.id });
    if (!created.ok) throw new Error("expected a scan");
    await aiClientFor(deps, ws, settings, { scanId: created.scan.id }).classify([mail]);
    await aiClientFor(deps, ws, settings).test();
    expect(await usageTotal(deps.db, ws, created.scan.id)).toMatchObject({ calls: 1 });
    expect(await usageTotal(deps.db, ws)).toMatchObject({ calls: 2 });
    const tom = await seedUser(deps);
    expect(await usagePerDay(deps.db, tom.workspaceId)).toEqual([]);
  });
});
