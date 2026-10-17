import {
  applyProfileChanges,
  createConfirmedProfile,
  getHistory,
  listProfiles,
  listRules,
} from "@jobfilly/db";
import {
  type Change,
  type Profile,
  type ProfileEntry,
  ProfileHistoryItemSchema,
  ProfileHistoryListSchema,
  type RuleDraft,
  RuleSchema,
} from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { requestRun } from "../pipeline/reevaluate";
import { applyAndReevaluate } from "../profile/changes";
import {
  createTestDeps,
  type SeededWorkspace,
  seedUser,
  seedWorkspace,
  signedIn,
  type TestClient,
  type TestDeps,
} from "../testing";

// The profile history over HTTP (F8.4): every change with who, when, the source and the request,
// in plain words before and after, newest first, for viewers too; Undo by an editor restores what
// the change touched through the profile change service and asks for a re-evaluation.

const NOW = new Date("2026-10-15T12:00:00Z");

let deps: TestDeps;
let ws: SeededWorkspace;
let profile: Profile;
let maria: TestClient;
let tom: TestClient;
let outsider: TestClient;

const entry = (key: ProfileEntry["key"], value: ProfileEntry["value"]): ProfileEntry => ({
  key,
  label: key,
  value,
  confidence: null,
  evidence: [],
  source: "scan",
  updatedAt: NOW.toISOString(),
  updatedBy: null,
});

/** Maria's workspace with Tom as a viewer, a stranger outside it, and a confirmed profile. */
async function arrange(d: TestDeps) {
  const owner = await seedUser(d, { name: "Maria Santos" });
  const viewer = await seedUser(d, { name: "Tom Okafor" });
  const stranger = await seedUser(d, { name: "Stranger" });
  const w = await seedWorkspace(d, { owner, members: [{ user: viewer, role: "viewer" }] });
  const app = createApp(d);
  const clients = {
    maria: await signedIn(app, d, owner),
    tom: await signedIn(app, d, viewer),
    outsider: await signedIn(app, d, stranger),
  };
  const created = await createConfirmedProfile(d.db, w.workspaceId, {
    name: "My job search",
    entries: [
      entry("languages", ["English", "Portuguese"]),
      entry("places", [{ country: "NL", city: "Amsterdam", mode: "hybrid" }]),
    ],
    createdBy: owner.id,
    at: NOW,
  });
  if (!created.ok) throw new Error("expected a profile");
  return { ws: w, profile: created.profile, ...clients };
}

// A setup that outlives its hook timeout (as under heavy load) keeps running while the next test
// starts. So each setup works on its own deps and publishes them only while it is still the
// current one; a superseded setup closes what it opened and never reaches the next test's database.
let setups = 0;
let opened: TestDeps | undefined;

beforeEach(async () => {
  const mine = ++setups;
  const d = await createTestDeps({ now: NOW });
  try {
    const arranged = await arrange(d);
    if (mine !== setups) throw new Error("this setup was superseded");
    deps = opened = d;
    ({ ws, profile, maria, tom, outsider } = arranged);
  } catch (error) {
    await d.close();
    if (mine === setups) throw error;
  }
});
afterEach(async () => {
  setups += 1;
  const d = opened;
  opened = undefined;
  await d?.close();
});

const historyUrl = (profileId = profile.id) =>
  `/api/workspaces/${ws.workspaceId}/profiles/${profileId}/history`;

async function change(
  changes: Change[],
  source: "you" | "decision" | "assistant",
  request: string | null,
) {
  deps.clock.advance(60_000);
  const result = await applyAndReevaluate(deps, ws.workspaceId, profile.id, changes, {
    source,
    userId: ws.owner.id,
    request,
  });
  if (!result?.ok || !result.entry) throw new Error("expected a history entry");
  return result.entry;
}

const asiaRule: RuleDraft = {
  description: "Hide roles whose working hours are UTC+5 or later",
  when: [{ fact: "timeZones", op: "within", value: { from: "UTC+05:00", to: "UTC+14:00" } }],
  then: "hide",
  enabled: true,
};

/**
 * Whether a re-evaluation of the workspace waits in the queue: the dedupe key lets only one wait,
 * so asking for another enqueues nothing while one does.
 */
async function reevaluationWaits(): Promise<boolean> {
  return !(await requestRun(deps, ws.workspaceId, "probe")).enqueued;
}

const list = async (client: TestClient) => {
  const res = await client.get(historyUrl());
  expect(res.status).toBe(200);
  return ProfileHistoryListSchema.parse(await res.json()).items;
};

describe("the profile history", () => {
  it("lists every change newest first, with who, when, the source, the request and its words", async () => {
    const byHand = await change(
      [{ op: "remove", target: "entry", key: "places", value: null }],
      "you",
      null,
    );
    const byAssistant = await change(
      [{ op: "add", target: "rule", rule: asiaRule }],
      "assistant",
      "No Asian time zones",
    );
    const items = await list(tom);
    expect(items.map((i) => i.id)).toEqual([byAssistant.id, byHand.id]);
    expect(items[0]).toMatchObject({
      by: ws.owner.id,
      byName: "Maria Santos",
      at: byAssistant.at,
      source: "assistant",
      request: "No Asian time zones",
      undoneAt: null,
      lines: [{ target: "rule", label: "Rule", before: null, after: asiaRule.description }],
    });
    expect(items[1]).toMatchObject({
      source: "you",
      request: null,
      lines: [
        {
          target: "entry",
          label: "Places you'd work onsite or hybrid",
          before: "Amsterdam, NL (hybrid)",
          after: null,
        },
      ],
    });
  });

  it("lists a rule made by hand without words by the words of its conditions (B1)", async () => {
    const rules = `/api/workspaces/${ws.workspaceId}/profiles/${profile.id}/rules`;
    const made = await maria.post(rules, { when: asiaRule.when, then: "hide" });
    expect(made.status).toBe(201);
    const rule = RuleSchema.parse(await made.json());
    deps.clock.advance(1_000);
    const later = [
      { fact: "timeZones", op: "within", value: { from: "UTC+06:00", to: "UTC+14:00" } },
    ];
    const edited = await maria.patch(`${rules}/${rule.id}`, {
      description: rule.description,
      when: later,
    });
    const changed = RuleSchema.parse(await edited.json());
    expect(changed.description).not.toBe(rule.description);

    const [edit, add] = await list(tom);
    // Each change holds the words the rule was stored with: never blank, never the old range's.
    expect(add?.changes).toMatchObject([{ op: "add", rule: { description: rule.description } }]);
    expect(rule.description.trim()).not.toBe("");
    expect(edit?.changes).toMatchObject([
      { op: "update", ruleId: rule.id, rule: { description: changed.description } },
    ]);
  });

  it("lists an older entry the schema refuses, so the rest of the list still reads", async () => {
    const good = await change(
      [{ op: "remove", target: "entry", key: "places", value: null }],
      "you",
      null,
    );
    // Rows written before the fix above: a change with blank words…
    const blank = await change(
      [{ op: "add", target: "rule", rule: { ...asiaRule, description: "" } }],
      "you",
      null,
    );
    // …and one whose before and after can't be read at all.
    deps.clock.advance(60_000);
    const broken = await applyProfileChanges(deps.db, ws.workspaceId, profile.id, [], {
      source: "you",
      userId: ws.owner.id,
      request: null,
      at: deps.clock.now(),
      apply: (state) => ({
        ok: true,
        entries: state.profile.entries,
        rules: state.rules,
        before: { entries: [{ key: "not a key", value: null }], rules: [] } as never,
        after: { entries: [], rules: [] },
      }),
    });
    if (!broken?.ok || !broken.entry) throw new Error("expected a history entry");

    const items = await list(tom);
    expect(items.map((i) => i.id)).toEqual([broken.entry.id, blank.id, good.id]);
    expect(items[0]).toMatchObject({
      changes: [],
      lines: [{ label: "This change", before: "can't be shown", after: "can't be shown" }],
    });
    // The blank words' entry keeps its lines, worded from the stored rule.
    expect(items[1]).toMatchObject({
      changes: [],
      lines: [
        {
          target: "rule",
          before: null,
          after: "Hide roles whose hours are within UTC+5 to UTC+14",
        },
      ],
    });
    expect(items[2]?.lines).toMatchObject([{ before: "Amsterdam, NL (hybrid)", after: null }]);
    // And Undo still works from the stored row.
    expect((await maria.post(`${historyUrl()}/${blank.id}/undo`)).status).toBe(200);
    expect(await listRules(deps.db, ws.workspaceId, profile.id)).toEqual([]);
  });

  it("answers 404 for a profile that isn't the workspace's, and to outsiders", async () => {
    expect((await maria.get(historyUrl("8f0e1c62-0000-4000-8000-000000000000"))).status).toBe(404);
    expect((await maria.get(historyUrl("not-an-id"))).status).toBe(404);
    expect((await outsider.get(historyUrl())).status).toBe(404);
  });
});

describe("Undo", () => {
  it("restores an entry, records the restore and asks for a re-evaluation", async () => {
    const added = await change(
      [{ op: "add", target: "entry", key: "languages", value: ["German"] }],
      "assistant",
      "I speak German too",
    );
    expect((await tom.post(`${historyUrl()}/${added.id}/undo`)).status).toBe(403);
    while (await deps.queue.runOnce()) {}
    expect(await reevaluationWaits()).toBe(false);
    while (await deps.queue.runOnce()) {}

    deps.clock.advance(1_000);
    const res = await maria.post(`${historyUrl()}/${added.id}/undo`);
    expect(res.status).toBe(200);
    const undone = ProfileHistoryItemSchema.parse(await res.json());
    expect(undone).toMatchObject({ id: added.id, undoneAt: deps.clock.now().toISOString() });
    const [current] = await listProfiles(deps.db, ws.workspaceId);
    expect(current?.entries.find((e) => e.key === "languages")?.value).toEqual([
      "English",
      "Portuguese",
    ]);
    // The restore is itself in the history, by hand, and the roles are evaluated again.
    const [restore] = await getHistory(deps.db, ws.workspaceId, profile.id);
    expect(restore).toMatchObject({ source: "you", by: ws.owner.id });
    expect(restore?.after.entries).toMatchObject([
      { key: "languages", value: ["English", "Portuguese"] },
    ]);
    expect(await reevaluationWaits()).toBe(true);
    expect(deps.logs.filter((l) => l.event === "profile.change_undone")).toEqual([
      expect.objectContaining({ entryId: added.id, workspaceId: ws.workspaceId }),
    ]);
    // Once only.
    expect((await maria.post(`${historyUrl()}/${added.id}/undo`)).status).toBe(409);
  });

  it("sets the reply threshold by hand and undoes it back to the default (MVP 3, S3)", async () => {
    deps.clock.advance(1_000);
    const set = await maria.patch(`/api/workspaces/${ws.workspaceId}/profiles/${profile.id}`, {
      entries: [{ key: "reply_threshold", value: [80] }],
    });
    expect(set.status).toBe(200);
    const [latest] = await list(tom);
    expect(latest).toMatchObject({
      source: "you",
      lines: [
        {
          label: "Fit score that gets an automatic reply",
          before: null,
          after: "80",
        },
      ],
    });
    expect((await maria.post(`${historyUrl()}/${latest?.id}/undo`)).status).toBe(200);
    const [current] = await listProfiles(deps.db, ws.workspaceId);
    expect(current?.entries.some((e) => e.key === "reply_threshold")).toBe(false);
  });

  it("brings back a removed rule and removes an added one", async () => {
    const added = await change([{ op: "add", target: "rule", rule: asiaRule }], "assistant", "x");
    const [rule] = await listRules(deps.db, ws.workspaceId, profile.id);
    if (!rule) throw new Error("expected a rule");
    const removed = await change([{ op: "remove", target: "rule", ruleId: rule.id }], "you", null);
    expect(await listRules(deps.db, ws.workspaceId, profile.id)).toEqual([]);

    expect((await maria.post(`${historyUrl()}/${removed.id}/undo`)).status).toBe(200);
    // The rule that came back is the one removed: same id, source and creation (F8.4).
    expect(await listRules(deps.db, ws.workspaceId, profile.id)).toEqual([rule]);
    // So undoing its addition removes it again, and records that restore.
    const before = await getHistory(deps.db, ws.workspaceId, profile.id);
    expect((await maria.post(`${historyUrl()}/${added.id}/undo`)).status).toBe(200);
    expect(await listRules(deps.db, ws.workspaceId, profile.id)).toEqual([]);
    expect(await getHistory(deps.db, ws.workspaceId, profile.id)).toHaveLength(before.length + 1);
  });

  it("answers 404 for an entry that isn't the profile's", async () => {
    const added = await change([{ op: "add", target: "rule", rule: asiaRule }], "assistant", "x");
    const other = "8f0e1c62-0000-4000-8000-000000000000";
    expect((await maria.post(`${historyUrl()}/${other}/undo`)).status).toBe(404);
    expect((await maria.post(`${historyUrl(other)}/${added.id}/undo`)).status).toBe(404);
    expect((await outsider.post(`${historyUrl()}/${added.id}/undo`)).status).toBe(404);
  });
});
