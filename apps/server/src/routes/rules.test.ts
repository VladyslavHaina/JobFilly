import { createConfirmedProfile, getEvaluations, getHistory, listRules } from "@jobfilly/db";
import {
  type MessageListItem,
  MessageListSchema,
  PIPELINE_REEVALUATE_JOB,
  PipelineReevaluatePayloadSchema,
  type Profile,
  type ProfileEntry,
  type Rule,
  RuleListSchema,
  RuleSchema,
} from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { defineJob } from "../jobs/queue";
import { jobRegistry } from "../jobs/registry";
import { matchStage } from "../pipeline/match";
import { reevaluateWorkspace } from "../pipeline/reevaluate";
import { applyAndReevaluate } from "../profile/changes";
import {
  createFakeAi,
  createFakeMailbox,
  createTestDeps,
  type FakeAiClient,
  type FakeMailbox,
  type RecordingStages,
  recordingStages,
  roleFacts,
  type SeededWorkspace,
  seedAiSettings,
  seedJobMail,
  seedMailbox,
  seedUser,
  seedWorkspace,
  signedIn,
  TEST_AI_MODELS,
  type TestClient,
  type TestDeps,
} from "../testing";

// A profile's rules over HTTP (F3.1, F3.3–F3.5, F4.6): listed with their plain words and source,
// switched on or off and removed through the profile change service by editors only. Switching
// one off re-scores a backlog of 300 roles within a minute with no model call and no mailbox
// access, and until then the roles are stale. Hidden roles stay reachable under the Hidden
// filter, each with its reason.

const NOW = new Date("2026-10-15T12:00:00Z");
const MINUTE = 60_000;
const ASIA = { from: "UTC+08:00", to: "UTC+08:00" };
const CET = { from: "UTC+01:00", to: "UTC+01:00" };

let deps: TestDeps;
let mailbox: FakeMailbox;
let ai: FakeAiClient;
let stages: RecordingStages;
let ws: SeededWorkspace;
let profile: Profile;
let editor: TestClient;
let viewer: TestClient;
let outsider: TestClient;

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

beforeEach(async () => {
  stages = recordingStages();
  stages.match = matchStage;
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
  ai = createFakeAi();
  deps.ai = ai.port;
  const owner = await seedUser(deps, { name: "Maria Santos" });
  const ed = await seedUser(deps, { name: "Eddie Editor" });
  const tom = await seedUser(deps, { name: "Tom Okafor" });
  const stranger = await seedUser(deps, { name: "Stranger" });
  ws = await seedWorkspace(deps, {
    owner,
    members: [
      { user: ed, role: "editor" },
      { user: tom, role: "viewer" },
    ],
  });
  const app = createApp(deps);
  editor = await signedIn(app, deps, ed);
  viewer = await signedIn(app, deps, tom);
  outsider = await signedIn(app, deps, stranger);
  await seedMailbox(deps, ws.workspaceId, {
    address: "maria.santos@inbox.example",
    conn: { host: "imap", port: 3143, tlsMode: "tls", username: "maria", password: "E2E-SECRET-p" },
    sentFolderPath: "Sent",
  });
  await seedAiSettings(deps, ws.workspaceId, {
    provider: "openai-compatible",
    baseUrl: "http://fake-ai.test/v1",
    models: TEST_AI_MODELS,
    apiKey: "E2E-SECRET-ai",
  });
  const created = await createConfirmedProfile(deps.db, ws.workspaceId, {
    name: "My job search",
    entries: [
      entry("target_roles", ["Backend Engineer"]),
      entry("remote", [{ scope: "EU", timeZones: null }]),
    ],
    createdBy: owner.id,
    at: NOW,
  });
  if (!created.ok) throw new Error("expected a profile");
  profile = created.profile;
});
afterEach(() => deps.close());

const base = () => `/api/workspaces/${ws.workspaceId}`;
const rulesUrl = (profileId = profile.id) => `${base()}/profiles/${profileId}/rules`;

/** Adds a rule as an applied assistant proposal would. */
async function addRule(description: string, enabled = true): Promise<Rule> {
  const result = await applyAndReevaluate(
    deps,
    ws.workspaceId,
    profile.id,
    [
      {
        op: "add",
        target: "rule",
        rule: {
          description,
          when: [
            { fact: "timeZones", op: "outside", value: { from: "UTC-01:00", to: "UTC+03:00" } },
          ],
          then: "hide",
          enabled,
        },
      },
    ],
    { source: "assistant", userId: ws.owner.id, request: "No Asian hours" },
  );
  const rule = result?.ok ? result.rules.at(-1) : undefined;
  if (!rule) throw new Error("expected a rule");
  return rule;
}

/** Runs queued jobs until none is left. */
async function drain() {
  while (await deps.queue.runOnce()) {}
}

/** Delivers `count` job messages of three remote roles each, all on `hours`. */
async function seedRemoteMail(prefix: string, count: number, hours: typeof ASIA) {
  for (let i = 0; i < count; i += 1) {
    const messageId = `<${prefix}-${i}@agency.example>`;
    await seedJobMail(deps, ws.workspaceId, mailbox, {
      messageId,
      receivedAt: new Date(NOW.getTime() - (i + 1) * MINUTE),
      roles: [0, 1, 2].map((p) =>
        roleFacts({ title: `Backend Engineer ${p}`, workMode: "remote", timeZones: hours }),
      ),
    });
    for (const p of [0, 1, 2]) {
      ai.answers.match[`${messageId}#${p}`] = {
        titleFit: { verdict: "fits", reason: "a backend role" },
        skillCloseness: [],
      };
    }
  }
}

const list = async (client: TestClient, query = "") => {
  const res = await client.get(`${base()}/messages${query}`);
  expect(res.status).toBe(200);
  return MessageListSchema.parse(await res.json());
};

/** Whether the row shows a score that is out of date: false for a current one, null for none. */
const staleScore = (m: MessageListItem) => (m.fit?.score != null ? m.fit.stale : null);

describe("the rules list", () => {
  it("lists each rule with its plain words and source, for viewers too", async () => {
    const rule = await addRule("Hide roles whose hours are outside UTC−1 to UTC+3");
    const res = await viewer.get(rulesUrl());
    expect(res.status).toBe(200);
    const body = RuleListSchema.parse(await res.json());
    expect(body.items).toEqual([rule]);
    expect(body.items[0]).toMatchObject({
      description: "Hide roles whose hours are outside UTC−1 to UTC+3",
      source: "assistant",
      enabled: true,
    });
  });

  it("shows a rule stored with no description in the plain words of its conditions", async () => {
    const rule = await addRule("");
    const res = await viewer.get(rulesUrl());
    const [item] = RuleListSchema.parse(await res.json()).items;
    expect(item).toMatchObject({
      id: rule.id,
      description: "Hide roles whose hours are outside UTC−1 to UTC+3",
    });
    // The roles it hides name it by the same words.
    await seedRemoteMail("asia", 1, ASIA);
    await drain();
    expect((await list(viewer, "?hidden=true")).items[0]?.hidden).toEqual({
      reason: 'Hidden by your rule "Hide roles whose hours are outside UTC−1 to UTC+3"',
    });
  });

  it("answers 404 for a profile that isn't the workspace's, and to outsiders", async () => {
    await addRule("A rule");
    expect((await editor.get(rulesUrl("8f0e1c62-0000-4000-8000-000000000000"))).status).toBe(404);
    expect((await editor.get(rulesUrl("not-an-id"))).status).toBe(404);
    expect((await outsider.get(rulesUrl())).status).toBe(404);
  });
});

describe("switching a rule on or off, and removing it (F3.5)", () => {
  it("lets an editor switch a rule off, recorded in the history; a viewer gets 403", async () => {
    const rule = await addRule("No Asian hours");
    expect((await viewer.patch(`${rulesUrl()}/${rule.id}`, { enabled: false })).status).toBe(403);
    expect((await listRules(deps.db, ws.workspaceId, profile.id))[0]?.enabled).toBe(true);

    deps.clock.advance(1_000);
    const res = await editor.patch(`${rulesUrl()}/${rule.id}`, { enabled: false });
    expect(res.status).toBe(200);
    expect(RuleSchema.parse(await res.json())).toEqual({ ...rule, enabled: false });
    expect((await listRules(deps.db, ws.workspaceId, profile.id))[0]?.enabled).toBe(false);
    const [latest] = await getHistory(deps.db, ws.workspaceId, profile.id);
    expect(latest).toMatchObject({ source: "you", before: { rules: [{ id: rule.id }] } });
    expect(latest?.after.rules[0]?.rule?.enabled).toBe(false);

    const back = await editor.patch(`${rulesUrl()}/${rule.id}`, { enabled: true });
    expect(RuleSchema.parse(await back.json()).enabled).toBe(true);
  });

  it("lets an editor remove a rule; a viewer gets 403", async () => {
    const rule = await addRule("No Asian hours");
    expect((await viewer.delete(`${rulesUrl()}/${rule.id}`)).status).toBe(403);
    expect(await listRules(deps.db, ws.workspaceId, profile.id)).toHaveLength(1);
    expect((await editor.delete(`${rulesUrl()}/${rule.id}`)).status).toBe(204);
    expect(await listRules(deps.db, ws.workspaceId, profile.id)).toEqual([]);
    expect((await editor.delete(`${rulesUrl()}/${rule.id}`)).status).toBe(404);
  });

  it("re-evaluates the roles once a rule is removed, with no model call and no mailbox", async () => {
    const rule = await addRule("No Asian hours");
    await seedRemoteMail("asia", 2, ASIA);
    await drain();
    const ids = ["<asia-0@agency.example>", "<asia-1@agency.example>"];
    expect((await list(viewer, "?hidden=true")).items.map((m) => m.id)).toEqual(ids);
    expect(await list(viewer)).toMatchObject({ items: [] });

    const aiCalls = { ...ai.calls };
    const mailCalls = { ...mailbox.calls };
    mailbox.pause();
    deps.clock.advance(1_000);
    const removedAt = deps.clock.now();
    expect((await editor.delete(`${rulesUrl()}/${rule.id}`)).status).toBe(204);

    // Until the re-evaluation has run, every score is stale: none is shown as current.
    const stale = await getEvaluations(deps.db, ws.workspaceId, ids);
    expect(stale).toHaveLength(6);
    expect(stale.every((e) => e.stale)).toBe(true);
    const during = [...(await list(viewer)).items, ...(await list(viewer, "?hidden=true")).items];
    expect(during).toHaveLength(2);
    expect(during.every((m) => staleScore(m) === true)).toBe(true);

    deps.clock.advance(5_000);
    await drain();
    const after = await getEvaluations(deps.db, ws.workspaceId, ids);
    expect(after).toHaveLength(6);
    for (const e of after) {
      expect(e.stale).toBe(false);
      expect(e.hidden).toBeNull();
      const since = new Date(e.evaluatedAt).getTime() - removedAt.getTime();
      expect(since).toBeGreaterThanOrEqual(0);
      expect(since).toBeLessThanOrEqual(MINUTE);
    }
    const shown = await list(viewer);
    expect(shown.items.map((m) => m.id)).toEqual(ids);
    expect(shown.items.every((m) => staleScore(m) === false && m.hidden === null)).toBe(true);
    expect((await list(viewer, "?hidden=true")).items).toEqual([]);
    expect(ai.calls).toEqual(aiCalls);
    expect(mailbox.calls).toEqual(mailCalls);
  });

  it("refuses a bad body, another profile's rule and a rule that isn't there", async () => {
    const rule = await addRule("No Asian hours");
    expect((await editor.patch(`${rulesUrl()}/${rule.id}`, {})).status).toBe(400);
    const other = "8f0e1c62-0000-4000-8000-000000000000";
    expect((await editor.patch(`${rulesUrl(other)}/${rule.id}`, { enabled: false })).status).toBe(
      404,
    );
    expect((await editor.delete(`${rulesUrl(other)}/${rule.id}`)).status).toBe(404);
    expect((await editor.patch(`${rulesUrl()}/${other}`, { enabled: false })).status).toBe(404);
    expect((await outsider.patch(`${rulesUrl()}/${rule.id}`, { enabled: false })).status).toBe(404);
  });

  it(
    "re-scores a backlog of 300 roles within a minute, with no model call and no mailbox",
    async () => {
      const rule = await addRule("No Asian hours");
      await seedRemoteMail("asia", 50, ASIA);
      await seedRemoteMail("cet", 50, CET);
      await drain();
      expect(ai.calls.match).toBe(300);
      expect((await list(viewer, "?hidden=true")).items).toHaveLength(50);
      expect((await list(viewer)).items).toHaveLength(50);

      // From here on the mailbox is down, and every model call and mailbox access is counted.
      const aiCalls = { ...ai.calls };
      const mailCalls = { ...mailbox.calls };
      mailbox.pause();
      const switchedAt = deps.clock.now();
      // F3.5 times the switch and the re-evaluation only: the seeding, the first drain and the
      // stale checks below are left out, and the test's own timeout is far longer than a minute.
      let started = Date.now();
      expect((await editor.patch(`${rulesUrl()}/${rule.id}`, { enabled: false })).status).toBe(200);
      let elapsed = Date.now() - started;

      // Until the re-evaluation has run, every score is stale: none is shown as current.
      const ids = [
        ...Array.from({ length: 50 }, (_, i) => `<asia-${i}@agency.example>`),
        ...Array.from({ length: 50 }, (_, i) => `<cet-${i}@agency.example>`),
      ];
      const stale = await getEvaluations(deps.db, ws.workspaceId, ids);
      expect(stale).toHaveLength(300);
      expect(stale.every((e) => e.stale)).toBe(true);
      const during = [...(await list(viewer)).items, ...(await list(viewer, "?hidden=true")).items];
      expect(during).toHaveLength(100);
      expect(during.every((m) => staleScore(m) === true)).toBe(true);

      deps.clock.advance(5_000);
      started = Date.now();
      await drain();
      elapsed += Date.now() - started;
      expect(elapsed).toBeLessThan(MINUTE);

      const after = await getEvaluations(deps.db, ws.workspaceId, ids);
      expect(after).toHaveLength(300);
      for (const e of after) {
        expect(e.stale).toBe(false);
        expect(e.hidden).toBeNull();
        expect(new Date(e.evaluatedAt).getTime() - switchedAt.getTime()).toBeLessThanOrEqual(
          MINUTE,
        );
      }
      expect(ai.calls).toEqual(aiCalls);
      expect(mailbox.calls).toEqual(mailCalls);
      expect(mailbox.calls.fetchOriginal).toBe(0);

      const shown = await list(viewer);
      expect(shown.items).toHaveLength(100);
      expect(shown.items.every((m) => staleScore(m) === false && m.hidden === null)).toBe(true);
      expect((await list(viewer, "?hidden=true")).items).toEqual([]);
    },
    5 * MINUTE,
  );
});

describe("the Hidden filter (F3.3, F3.4)", () => {
  it("lists the hidden messages, each with the rule that hides it", async () => {
    const rule = await addRule("No Asian hours");
    await seedRemoteMail("asia", 2, ASIA);
    await seedRemoteMail("cet", 1, CET);
    await drain();

    const hidden = await list(viewer, "?hidden=true");
    expect(hidden.items.map((m) => [m.id, m.hidden])).toEqual([
      ["<asia-0@agency.example>", { reason: 'Hidden by your rule "No Asian hours"' }],
      ["<asia-1@agency.example>", { reason: 'Hidden by your rule "No Asian hours"' }],
    ]);
    const shown = await list(viewer);
    expect(shown.items.map((m) => [m.id, m.hidden])).toEqual([["<cet-0@agency.example>", null]]);

    const [evaluation] = await getEvaluations(deps.db, ws.workspaceId, ["<asia-0@agency.example>"]);
    expect(evaluation?.hidden).toEqual({
      ruleId: rule.id,
      reason: 'Hidden by your rule "No Asian hours"',
    });
    expect(deps.logs.filter((l) => l.event === "rule.applied")).toHaveLength(6);
    expect(deps.logs.find((l) => l.event === "rule.applied")).toMatchObject({
      ruleId: rule.id,
      action: "hide",
    });
  });
});
