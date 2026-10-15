import { randomUUID } from "node:crypto";
import { applyChanges } from "@jobfilly/core";
import {
  applyProfileChanges,
  createConfirmedProfile,
  getEvaluations,
  getMatchAnswer,
  listToEvaluate,
  markStale,
  matchInputHash,
} from "@jobfilly/db";
import type { Change, Cv, MatchAiOutput, Profile, ProfileEntry } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  seedCv,
  seedJobMail,
  seedMailbox,
  seedUser,
  TEST_AI_MODELS,
  type TestDeps,
} from "../testing";
import { evaluateMessage } from "./evaluate";
import { matchStage } from "./match";
import type { CvChoiceResult } from "./stages";

// The match stage (F3, F4) in the pipeline: match.v1 is called only when no stored answer has the
// same input hash, the evaluation is written with its verdicts and rule effects, and match.scored
// and rule.applied are logged. The cv-choice stage's result is built here directly.

const NOW = new Date("2026-10-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const MESSAGE = "<berlin@nordlicht.example>";

let deps: TestDeps;
let mailbox: FakeMailbox;
let ai: FakeAiClient;
let maria: SeededUser;
let ws: string;
let profile: Profile;
let cv: Cv;
let stages: RecordingStages;
let cvChoice: CvChoiceResult;

const entry = (key: ProfileEntry["key"], value: ProfileEntry["value"]): ProfileEntry => ({
  key,
  label: key,
  value,
  confidence: null,
  evidence: [],
  source: "you",
  updatedAt: NOW.toISOString(),
  updatedBy: null,
});

const answer = (verdict: "fits" | "conflicts"): MatchAiOutput => ({
  titleFit: { verdict, reason: verdict === "fits" ? "a backend role" : "a data role" },
  skillCloseness: [
    { skill: "Go", verdict: "fits", reason: "in the CV" },
    { skill: "Kafka", verdict: "unknown", reason: "not in the CV" },
  ],
});

beforeEach(async () => {
  deps = await createTestDeps({ now: NOW });
  mailbox = createFakeMailbox();
  deps.mail = mailbox.port;
  ai = createFakeAi();
  deps.ai = ai.port;
  maria = await seedUser(deps, { name: "Maria Santos" });
  ws = maria.workspaceId;
  await seedMailbox(deps, ws, {
    address: "maria.santos@inbox.example",
    conn: { host: "imap", port: 3143, tlsMode: "tls", username: "maria", password: "E2E-SECRET-p" },
    sentFolderPath: "Sent",
  });
  await seedAiSettings(deps, ws, {
    provider: "openai-compatible",
    baseUrl: "http://fake-ai.test/v1",
    models: TEST_AI_MODELS,
    apiKey: "E2E-SECRET-ai",
  });
  const created = await createConfirmedProfile(deps.db, ws, {
    name: "My job search",
    entries: [
      entry("target_roles", ["Backend Engineer"]),
      entry("places", [{ country: "DE", city: "Berlin", mode: "hybrid" }]),
      entry("min_pay", [
        { amount: 70000, currency: "EUR", period: "year", asWritten: "€70,000 a year" },
      ]),
    ],
    createdBy: maria.id,
    at: NOW,
  });
  if (!created.ok) throw new Error("expected a profile");
  profile = created.profile;
  cv = await seedCv(deps, ws, {
    name: "Backend (EN)",
    skills: ["Go", "PostgreSQL"],
    profileId: profile.id,
  });
  cvChoice = {
    cvId: cv.id,
    name: cv.name,
    language: "en",
    skills: ["Go", "PostgreSQL"],
    reason: "English backend role → Backend (EN)",
    source: "auto",
  };
  stages = recordingStages();
  stages.cvChoice = async () => cvChoice;
  stages.match = matchStage;
  await seedJobMail(deps, ws, mailbox, {
    messageId: MESSAGE,
    receivedAt: new Date(NOW.getTime() - DAY),
    from: "anna@nordlicht.example",
    roles: [
      roleFacts({
        title: "Senior Backend Engineer",
        places: [{ country: "DE", city: "Berlin" }],
        workMode: "hybrid",
        skills: ["Go", "Kafka"],
        pay: { min: 80000, max: 95000, currency: "EUR", period: "year", asWritten: "€80–95k" },
      }),
      roleFacts({
        title: "Data Engineer",
        places: [{ country: "NL", city: "Amsterdam" }],
        workMode: "hybrid",
        skills: ["Go", "Kafka"],
      }),
    ],
  });
  ai.answers.match[`${MESSAGE}#0`] = answer("fits");
  ai.answers.match[`${MESSAGE}#1`] = answer("conflicts");
});
afterEach(() => deps.close());

const evaluate = (origin: "new" | "reevaluate" = "new") =>
  evaluateMessage(deps, ws, MESSAGE, { origin, stages });

async function addRule(change: Extract<Change, { op: "add"; target: "rule" }>["rule"]) {
  const result = await applyProfileChanges(
    deps.db,
    ws,
    profile.id,
    [{ op: "add", target: "rule", rule: change }],
    {
      source: "assistant",
      userId: maria.id,
      request: null,
      at: NOW,
      apply: (state, list) =>
        applyChanges({ entries: state.profile.entries, rules: state.rules }, list, {
          profileId: profile.id,
          source: "assistant",
          userId: maria.id,
          at: NOW.toISOString(),
          newRuleId: randomUUID,
        }),
    },
  );
  if (!result?.ok) throw new Error("expected the rule to be added");
  const rule = result.rules.at(-1);
  if (!rule) throw new Error("expected a rule");
  return rule;
}

describe("the match stage", () => {
  it("scores every role with its verdicts, calling match.v1 once per role", async () => {
    const outcome = await evaluate();
    expect(outcome.evaluated).toEqual([0, 1]);
    expect(ai.calls.match).toBe(2);
    expect(ai.log.filter((l) => l.task === "match.v1").map((l) => l.key)).toEqual([
      `${MESSAGE}#0`,
      `${MESSAGE}#1`,
    ]);
    const [berlin, amsterdam] = await getEvaluations(deps.db, ws, [MESSAGE]);
    expect(berlin?.match).toMatchObject({
      cvId: cv.id,
      capped: false,
      skills: { matched: ["Go"], missing: ["Kafka"] },
    });
    expect(berlin?.match?.score).toBeGreaterThanOrEqual(70);
    expect(berlin?.match?.verdicts.find((v) => v.entryKey === "places")?.reason).toBe(
      "Berlin, hybrid — fits your 'Berlin, hybrid'",
    );
    expect(berlin?.cvChoice).toEqual({
      cvId: cv.id,
      reason: "English backend role → Backend (EN)",
      source: "auto",
    });
    expect(amsterdam?.match).toMatchObject({ capped: true });
    expect(amsterdam?.match?.score).toBeLessThanOrEqual(40);
    expect(amsterdam?.match?.verdicts[0]).toMatchObject({ entryKey: "places", hard: true });
    expect(deps.logs.filter((l) => l.event === "match.scored")).toMatchObject([
      { level: "info", position: 0, capped: false, hidden: false, aiCalled: true },
      { level: "info", position: 1, capped: true, hidden: false, aiCalled: true },
    ]);
    // The answers are stored under the hash of what the model saw, the CV's skills included.
    const hash = matchInputHash({
      messageId: MESSAGE,
      position: 0,
      role: { title: "Senior Backend Engineer", skills: ["Go", "Kafka"] },
      profile: { targetRoles: ["Backend Engineer"], skills: [] },
      cvSkills: ["Go", "PostgreSQL"],
    });
    expect(
      await getMatchAnswer(deps.db, ws, {
        messageId: MESSAGE,
        position: 0,
        cvId: cv.id,
        inputHash: hash,
      }),
    ).toEqual(answer("fits"));
  });

  it("re-scores from the stored answer without calling match.v1 again", async () => {
    await evaluate();
    const hide = await addRule({
      description: "No Amsterdam",
      when: [{ fact: "places.country", op: "in", value: ["NL"] }],
      then: "hide",
      enabled: true,
    });
    await markStale(deps.db, ws, { all: true }, NOW);
    await evaluate("reevaluate");
    expect(ai.calls.match).toBe(2);
    const [, amsterdam] = await getEvaluations(deps.db, ws, [MESSAGE]);
    expect(amsterdam?.hidden).toEqual({
      ruleId: hide.id,
      reason: 'Hidden by your rule "No Amsterdam"',
    });
    expect(amsterdam?.ruleEffects).toEqual([
      { ruleId: hide.id, action: "hide", reason: 'Hidden by your rule "No Amsterdam"', need: null },
    ]);
    expect(deps.logs.filter((l) => l.event === "rule.applied")).toMatchObject([
      { level: "info", ruleId: hide.id, action: "hide" },
    ]);
    expect(deps.logs.filter((l) => l.event === "match.scored").at(-1)).toMatchObject({
      position: 1,
      hidden: true,
      aiCalled: false,
    });
  });

  it("calls match.v1 again when what it saw changed: another CV's skills", async () => {
    await evaluate();
    cvChoice = { ...cvChoice, skills: ["Go", "PostgreSQL", "Kafka"] };
    await markStale(deps.db, ws, { all: true }, NOW);
    await evaluate("reevaluate");
    expect(ai.calls.match).toBe(4);
    const [berlin] = await getEvaluations(deps.db, ws, [MESSAGE]);
    expect(berlin?.match?.skills).toEqual({ matched: ["Go", "Kafka"], missing: [] });
  });

  it("leaves the role unevaluated when match.v1 gives no answer", async () => {
    ai.failNext("match");
    const outcome = await evaluate();
    expect(outcome.failed).toEqual([0]);
    expect(outcome.evaluated).toEqual([1]);
    expect(await listToEvaluate(deps.db, ws)).toMatchObject([
      { messageId: MESSAGE, roles: [{ position: 0, state: "missing" }] },
    ]);
    // The next sweep asks again and stores the answer.
    await evaluate("reevaluate");
    expect(await listToEvaluate(deps.db, ws)).toEqual([]);
    expect(ai.calls.match).toBe(3);
  });

  it("makes no model call for a role with neither a title nor skills", async () => {
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<bare@x.example>",
      receivedAt: NOW,
      roles: [roleFacts({ title: null })],
    });
    await evaluateMessage(deps, ws, "<bare@x.example>", { origin: "new", stages });
    expect(ai.calls.match).toBe(0);
    const [bare] = await getEvaluations(deps.db, ws, ["<bare@x.example>"]);
    expect(bare?.match?.verdicts[0]).toMatchObject({
      entryKey: "target_roles",
      verdict: "unknown",
      reason: "title not stated",
    });
  });
});
