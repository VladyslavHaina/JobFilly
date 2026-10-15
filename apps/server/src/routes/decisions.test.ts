import { addMember, getHistory, listProfiles } from "@jobfilly/db";
import {
  DecisionCountSchema,
  DecisionListSchema,
  DecisionSchema,
  type NeedSpec,
} from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requestReevaluation } from "../profile/changes";
import { seedUser, type TestClient } from "../testing";
import {
  CHF_NEED,
  createHarness,
  daysAgo,
  draftAnswer,
  EUR_MIN,
  type Harness,
} from "../testing/replies";

// The decision inbox over HTTP (F7.2–F7.7): similar questions as one decision, answering writes
// the profile (source decision) and the waiting roles get their drafts, an answered question is
// never asked again, Not now and Don't ask for this message, and viewers who only read.

const ZURICH = "<zurich@x.example>";
const BASEL = "<basel@x.example>";
const ZURICH_2 = "<zurich-2@x.example>";
const DUBLIN = "<dublin@x.example>";
const key = (id: string) => `${id}#0#1`;
const CHF_120 = { amount: 120000, currency: "CHF", period: "year", asWritten: "CHF 120,000" };

const RELOCATE: NeedSpec = {
  groupKey: "extra.relocate",
  profileKey: "extra.relocate",
  question: "Would you relocate to Ireland?",
  choices: [
    { label: "Yes", value: "Yes" },
    { label: "No", value: "No" },
  ],
};

let h: Harness;
let maria: TestClient;
let base: string;
beforeEach(async () => {
  h = await createHarness();
  maria = await h.client();
  base = `/api/workspaces/${h.ws}/decisions`;
});
afterEach(() => h.close());

const events = (name: string) => h.deps.logs.filter((l) => l.event === name);

async function inbox(client = maria) {
  const res = await client.get(base);
  expect(res.status).toBe(200);
  return DecisionListSchema.parse(await res.json()).items;
}

/** The open decision of a group key. */
async function decisionOf(groupKey: string) {
  const found = (await inbox()).find((d) => d.groupKey === groupKey);
  if (!found) throw new Error(`no open decision for ${groupKey}`);
  return found;
}

async function count() {
  return DecisionCountSchema.parse(await (await maria.get(`${base}/count`)).json()).open;
}

/** Zurich and Basel both pay in CHF; Dublin asks about relocating. */
async function seedThree() {
  const at = (n: number) => daysAgo(4 - n);
  await h.deliver(ZURICH, {
    subject: "Backend in Zurich",
    receivedAt: at(1),
    roles: [{ needs: [CHF_NEED] }],
  });
  await h.deliver(BASEL, {
    subject: "Backend in Basel",
    receivedAt: at(2),
    roles: [{ needs: [CHF_NEED] }],
  });
  await h.deliver(DUBLIN, {
    subject: "Remote-first, Dublin office",
    receivedAt: at(3),
    roles: [{ needs: [RELOCATE] }],
  });
  for (const id of [ZURICH, BASEL, DUBLIN]) await h.evaluate(id);
  await h.drain();
}

describe("the decision inbox (F7.2, F7.3)", () => {
  it("shows each question once with every message waiting on it, and logs decision.created once", async () => {
    await seedThree();
    const items = await inbox();
    expect(items).toHaveLength(2);
    expect(await decisionOf("min_pay:CHF:year")).toEqual({
      id: expect.any(String),
      question: "Minimum pay in CHF per year?",
      profileKey: "min_pay",
      groupKey: "min_pay:CHF:year",
      choices: CHF_NEED.choices,
      waiting: [
        { messageId: ZURICH, position: 0, subject: "Backend in Zurich" },
        { messageId: BASEL, position: 0, subject: "Backend in Basel" },
      ],
      status: "open",
      createdAt: expect.any(String),
    });
    expect(await decisionOf("extra.relocate")).toMatchObject({
      question: "Would you relocate to Ireland?",
      waiting: [{ messageId: DUBLIN, position: 0, subject: "Remote-first, Dublin office" }],
    });
    expect(await count()).toBe(2);
    expect(events("decision.created")).toHaveLength(2);
    // Re-evaluating creates nothing new and logs nothing again.
    await requestReevaluation(h.deps, h.ws, { all: true }, "test");
    await h.drain();
    expect(await inbox()).toHaveLength(2);
    expect(events("decision.created")).toHaveLength(2);
    // No draft while the answer is missing.
    expect(h.mailbox.drafts()).toEqual([]);
  });
});

describe("answering (F7.4, F7.6)", () => {
  it("writes the profile entry (source decision), drafts the waiting roles and closes the decision", async () => {
    await seedThree();
    const chf = await decisionOf("min_pay:CHF:year");
    h.ai.answers.draft[key(ZURICH)] = draftAnswer();
    h.ai.answers.draft[key(BASEL)] = draftAnswer();
    const answeredAt = h.deps.clock.now();
    const res = await maria.post(`${base}/${chf.id}/answer`, {
      value: CHF_120,
      useForSimilar: true,
    });
    expect(res.status).toBe(200);
    expect(DecisionSchema.parse(await res.json())).toMatchObject({
      status: "answered",
      waiting: [],
    });

    const [profile] = await listProfiles(h.deps.db, h.ws);
    expect(profile?.entries.find((e) => e.key === "min_pay")).toMatchObject({
      value: [EUR_MIN, CHF_120],
      source: "decision",
    });
    const [history] = await getHistory(h.deps.db, h.ws, h.profileId);
    expect(history).toMatchObject({
      source: "decision",
      request: "Minimum pay in CHF per year?",
      by: h.maria.id,
      changes: [{ op: "add", target: "entry", key: "min_pay", value: [CHF_120] }],
    });
    expect(events("decision.answered")).toEqual([
      expect.objectContaining({ decisionId: chf.id, useForSimilar: true, roles: 2 }),
    ]);

    h.deps.clock.advance(30_000);
    await h.drain();
    for (const id of [ZURICH, BASEL]) {
      const draft = await h.live(id);
      expect(draft).toMatchObject({ status: "in_mailbox", origin: "decision" });
      expect(Date.parse(draft?.updatedAt ?? "") - answeredAt.getTime()).toBeLessThanOrEqual(60_000);
    }
    expect(
      h.mailbox
        .drafts()
        .map((d) => d.original.messageId)
        .sort(),
    ).toEqual([BASEL, ZURICH]);
    expect((await inbox()).map((d) => d.question)).toEqual(["Would you relocate to Ireland?"]);
    // The draft was written with the answer in the profile.
    expect(h.draftInputs[0]?.entries).toContainEqual(
      expect.objectContaining({ key: "min_pay", value: [EUR_MIN, CHF_120] }),
    );

    // A later message that needs the same answer gets no decision; its draft uses it.
    await h.deliver(ZURICH_2, { roles: [{ needs: [CHF_NEED] }] });
    h.ai.answers.draft[key(ZURICH_2)] = draftAnswer();
    await h.evaluate(ZURICH_2);
    await h.drain();
    expect((await inbox()).map((d) => d.question)).toEqual(["Would you relocate to Ireland?"]);
    expect(events("decision.created")).toHaveLength(2);
    expect(await h.live(ZURICH_2)).toMatchObject({ status: "in_mailbox", origin: "auto" });
    expect(h.draftInputs.at(-1)?.entries).toContainEqual(
      expect.objectContaining({ key: "min_pay", value: [EUR_MIN, CHF_120] }),
    );
  });

  it("takes free text made into an item of the key, and refuses one that doesn't fit", async () => {
    await seedThree();
    const chf = await decisionOf("min_pay:CHF:year");
    const bad = await maria.post(`${base}/${chf.id}/answer`, {
      value: "as much as possible",
      useForSimilar: true,
    });
    expect(bad.status).toBe(400);
    expect((await decisionOf("min_pay:CHF:year")).status).toBe("open");
    const ok = await maria.post(`${base}/${chf.id}/answer`, {
      value: "115,000",
      useForSimilar: true,
    });
    expect(ok.status).toBe(200);
    const [profile] = await listProfiles(h.deps.db, h.ws);
    expect(profile?.entries.find((e) => e.key === "min_pay")?.value).toEqual([
      EUR_MIN,
      { amount: 115000, currency: "CHF", period: "year", asWritten: "115,000" },
    ]);
    // Answered already.
    const again = await maria.post(`${base}/${chf.id}/answer`, {
      value: CHF_120,
      useForSimilar: true,
    });
    expect(again.status).toBe(409);
  });

  it("writes only the answer that claims the decision when two editors answer at once", async () => {
    await seedThree();
    const chf = await decisionOf("min_pay:CHF:year");
    const answer = (value: unknown) =>
      maria.post(`${base}/${chf.id}/answer`, { value, useForSimilar: true });
    const results = await Promise.all([answer(CHF_120), answer("115,000")]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const [profile] = await listProfiles(h.deps.db, h.ws);
    const minPay = profile?.entries.find((e) => e.key === "min_pay")?.value as unknown[];
    expect(minPay).toHaveLength(2);
    expect(minPay[0]).toEqual(EUR_MIN);
    expect(await getHistory(h.deps.db, h.ws, h.profileId)).toHaveLength(1);
    expect(events("decision.answered")).toHaveLength(1);
  });

  it("without 'Use this answer for similar mail' answers only the messages waiting now", async () => {
    await seedThree();
    const chf = await decisionOf("min_pay:CHF:year");
    h.ai.answers.draft[key(ZURICH)] = draftAnswer();
    h.ai.answers.draft[key(BASEL)] = draftAnswer();
    const res = await maria.post(`${base}/${chf.id}/answer`, {
      value: CHF_120,
      useForSimilar: false,
    });
    expect(res.status).toBe(200);
    await h.drain();
    // The profile is unchanged; the waiting roles got drafts written with the answer.
    const [profile] = await listProfiles(h.deps.db, h.ws);
    expect(profile?.entries.find((e) => e.key === "min_pay")?.value).toEqual([EUR_MIN]);
    expect(await getHistory(h.deps.db, h.ws, h.profileId)).toEqual([]);
    expect((await h.live(ZURICH))?.status).toBe("in_mailbox");
    expect((await h.live(BASEL))?.status).toBe("in_mailbox");
    expect(h.draftInputs[0]?.entries).toContainEqual(
      expect.objectContaining({ key: "min_pay", value: [EUR_MIN, CHF_120] }),
    );
    // A later message asks again.
    await h.deliver(ZURICH_2, { roles: [{ needs: [CHF_NEED] }] });
    await h.evaluate(ZURICH_2);
    expect((await decisionOf("min_pay:CHF:year")).waiting.map((w) => w.messageId)).toEqual([
      ZURICH_2,
    ]);
  });
});

describe("Not now and Don't ask for this message (F7.5)", () => {
  it("Not now keeps the decision; Don't ask closes it for that message, which never gets a draft", async () => {
    await seedThree();
    const relocation = await decisionOf("extra.relocate");
    const later = await maria.post(`${base}/${relocation.id}/not-now`);
    expect(later.status).toBe(200);
    expect((await inbox()).map((d) => d.id)).toContain(relocation.id);

    const res = await maria.post(`${base}/${relocation.id}/dismiss`, {
      messageId: DUBLIN,
      position: 0,
    });
    expect(res.status).toBe(200);
    expect((await inbox()).map((d) => d.id)).not.toContain(relocation.id);
    expect(await count()).toBe(1);
    // Nothing brings an automatic draft back: a re-evaluation, nor answering another decision.
    h.ai.answers.draft[key(DUBLIN)] = draftAnswer();
    await requestReevaluation(h.deps, h.ws, { all: true }, "test");
    await h.drain();
    const chf = await decisionOf("min_pay:CHF:year");
    await maria.post(`${base}/${chf.id}/answer`, { value: CHF_120, useForSimilar: true });
    await h.drain();
    expect(await h.live(DUBLIN)).toBeNull();
    expect(h.mailbox.drafts().map((d) => d.original.messageId)).not.toContain(DUBLIN);
    // Dismissing again, or a role that isn't waiting, is a 404.
    const again = await maria.post(`${base}/${relocation.id}/dismiss`, {
      messageId: DUBLIN,
      position: 0,
    });
    expect(again.status).toBe(404);
  });
});

describe("viewers (F7.7)", () => {
  it("see decisions but get 403 on every change", async () => {
    await seedThree();
    const tom = await seedUser(h.deps, { name: "Tom Okafor" });
    await addMember(h.deps.db, h.ws, tom.id, "viewer");
    const viewer = await h.client(tom);
    const items = await inbox(viewer);
    expect(items).toHaveLength(2);
    expect((await viewer.get(`${base}/count`)).status).toBe(200);
    const id = items[0]?.id;
    expect(
      (await viewer.post(`${base}/${id}/answer`, { value: CHF_120, useForSimilar: true })).status,
    ).toBe(403);
    expect((await viewer.post(`${base}/${id}/not-now`)).status).toBe(403);
    expect(
      (await viewer.post(`${base}/${id}/dismiss`, { messageId: ZURICH, position: 0 })).status,
    ).toBe(403);
    expect(await inbox()).toHaveLength(2);
  });
});
