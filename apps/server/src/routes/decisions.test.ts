import {
  addMember,
  createConfirmedProfile,
  getHistory,
  listProfiles,
  setRoleProfileChoice,
} from "@jobfilly/db";
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
const BERLIN = "<berlin@x.example>";
/** A draft.v1 question whose group key's parts fill every field of the item. */
const HYBRID_DUBLIN = {
  profileKey: "places",
  groupKey: "places:IE:Dublin:hybrid",
  question: "Hybrid in Dublin?",
  choices: [
    { label: "Yes", declines: false },
    { label: "No", declines: true },
  ],
};
/** Questions draft.v1 asks under a key whose items are objects, as the model offers them. */
const REMOTE_EU = {
  profileKey: "remote",
  groupKey: "remote:EU",
  question: "Open to remote in the EU?",
  choices: [
    { label: "Yes", declines: false },
    { label: "No", declines: true },
  ],
};
const PERMIT_IE = {
  profileKey: "work_permits",
  groupKey: "work_permits:IE",
  question: "Can you work in Ireland?",
  choices: [
    { label: "Stamp 4", declines: false },
    { label: "Ні", declines: true },
  ],
};
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

describe("answering with several profiles (MVP 3, F1.3)", () => {
  it("writes the answer into the profile of the role waiting on it", async () => {
    const second = await createConfirmedProfile(h.deps.db, h.ws, {
      name: "Switzerland",
      entries: [],
      createdBy: h.maria.id,
      at: h.deps.clock.now(),
      alongside: true,
    });
    if (!second.ok) throw new Error("expected a profile");
    await h.deliver(ZURICH, { subject: "Backend in Zurich", roles: [{ needs: [CHF_NEED] }] });
    await setRoleProfileChoice(
      h.deps.db,
      h.ws,
      { messageId: ZURICH, position: 0 },
      {
        profileId: second.profile.id,
        userId: h.maria.id,
        at: h.deps.clock.now(),
      },
    );
    await h.evaluate(ZURICH);
    const chf = await decisionOf("min_pay:CHF:year");
    const res = await maria.post(`${base}/${chf.id}/answer`, {
      value: CHF_120,
      useForSimilar: true,
    });
    expect(res.status).toBe(200);
    expect(await getHistory(h.deps.db, h.ws, second.profile.id)).toMatchObject([
      { source: "decision", changes: [{ key: "min_pay", value: [CHF_120] }] },
    ]);
    // The first profile is left as it was.
    expect(await getHistory(h.deps.db, h.ws, h.profileId)).toEqual([]);
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

  it("never asks a draft's answered question again, whatever parts its group key has", async () => {
    // draft.v1 asks with a group key whose part ("IE") isn't a field of the key's items.
    const question = {
      profileKey: "extra.relocate",
      groupKey: "extra.relocate:IE",
      question: "Would you relocate to Ireland?",
      choices: [
        { label: "Yes", declines: false },
        { label: "No", declines: true },
      ],
    };
    await h.deliver(DUBLIN);
    h.ai.answers.draft[key(DUBLIN)] = draftAnswer({ questions: [question] });
    await h.evaluate(DUBLIN);
    await h.drain();
    const [decision] = await inbox();
    expect(decision).toMatchObject({
      question: "Would you relocate to Ireland?",
      waiting: [{ messageId: DUBLIN, position: 0 }],
    });
    expect(await h.live(DUBLIN)).toBeNull();

    h.ai.answers.draft[key(DUBLIN)] = draftAnswer();
    const res = await maria.post(`${base}/${decision?.id}/answer`, {
      value: "Yes",
      useForSimilar: true,
    });
    expect(res.status).toBe(200);
    await h.drain();
    expect(await h.live(DUBLIN)).toMatchObject({ status: "in_mailbox" });
    const [profile] = await listProfiles(h.deps.db, h.ws);
    const relocate = profile?.entries.find((e) => e.key.startsWith("extra.relocate"));
    expect(relocate?.value).toEqual(["Yes"]);

    // A later message whose draft asks the same question gets no decision; its draft uses it.
    const created = events("decision.created").length;
    await h.deliver(ZURICH_2);
    h.ai.answers.draft[key(ZURICH_2)] = draftAnswer({ questions: [question] });
    await h.evaluate(ZURICH_2);
    await h.drain();
    expect(await inbox()).toEqual([]);
    expect(events("decision.created")).toHaveLength(created);
    expect(await h.live(ZURICH_2)).toMatchObject({ status: "in_mailbox", origin: "auto" });
    expect(h.draftInputs.at(-1)?.entries).toContainEqual(
      expect.objectContaining({ key: relocate?.key, value: ["Yes"] }),
    );
  });

  it("takes free text that states an item of the key, and refuses an empty answer", async () => {
    await seedThree();
    const chf = await decisionOf("min_pay:CHF:year");
    const bad = await maria.post(`${base}/${chf.id}/answer`, { value: " ", useForSimilar: true });
    expect(bad.status).toBe(400);
    expect((await decisionOf("min_pay:CHF:year")).status).toBe("open");
    const ok = await maria.post(`${base}/${chf.id}/answer`, {
      value: "CHF 115,000",
      useForSimilar: true,
    });
    expect(ok.status).toBe(200);
    const [profile] = await listProfiles(h.deps.db, h.ws);
    expect(profile?.entries.find((e) => e.key === "min_pay")?.value).toEqual([
      EUR_MIN,
      { amount: 115000, currency: "CHF", period: "year", asWritten: "CHF 115,000" },
    ]);
    // Answered already.
    const again = await maria.post(`${base}/${chf.id}/answer`, {
      value: CHF_120,
      useForSimilar: true,
    });
    expect(again.status).toBe(409);
  });

  /**
   * Answers each of `typed` on a decision of its own, on a message of its own, with "Use this
   * answer for similar mail" on, and checks that none is a profile item: each answers its
   * waiting role only, and nothing reaches the profile or its history. `question` is a draft.v1
   * question; without one the role needs "Minimum pay in CHF per year?" from its match.
   */
  async function answerWaitingOnly(question: typeof HYBRID_DUBLIN | null, typed: string[]) {
    const ids: string[] = [];
    for (const value of typed) {
      const id = `<typed-${ids.length + 1}@x.example>`;
      ids.push(id);
      if (question) {
        await h.deliver(id);
        h.ai.answers.draft[key(id)] = draftAnswer({ questions: [question] });
        await h.evaluate(id);
        await h.drain();
      } else {
        await h.deliver(id, { roles: [{ needs: [CHF_NEED] }] });
        await h.evaluate(id);
      }
      const decision = await decisionOf(question?.groupKey ?? CHF_NEED.groupKey);
      expect(
        decision.waiting.map((w) => w.messageId),
        value,
      ).toEqual([id]);
      h.ai.answers.draft[key(id)] = draftAnswer();
      const res = await maria.post(`${base}/${decision.id}/answer`, { value, useForSimilar: true });
      expect(res.status, value).toBe(200);
      expect(DecisionSchema.parse(await res.json()).status, value).toBe("answered");
      expect(events("decision.answered").at(-1), value).toMatchObject({
        decisionId: decision.id,
        useForSimilar: false,
        declined: false,
        waitingOnly: true,
      });
    }
    // Nothing was written: the profile is as it was, and its history is empty.
    const [profile] = await listProfiles(h.deps.db, h.ws);
    expect(profile?.entries.find((e) => e.key === "min_pay")?.value).toEqual([EUR_MIN]);
    for (const k of ["places", "remote", "work_permits"]) {
      expect(profile?.entries.find((e) => e.key === k)?.value ?? [], k).toEqual([]);
    }
    expect(await getHistory(h.deps.db, h.ws, h.profileId)).toEqual([]);
    // Each waiting role's reply is told its words.
    await h.drain();
    const groupKey = question?.groupKey ?? CHF_NEED.groupKey;
    const told = `extra.answer_${groupKey.toLowerCase().replace(/[^a-z0-9_-]+/g, "_")}`;
    for (const [i, id] of ids.entries()) {
      expect(await h.live(id), id).toMatchObject({ status: "in_mailbox", origin: "decision" });
      const input = h.draftInputs.find(
        (d) => d.mail.messageId === id && d.entries.some((e) => e.key === told),
      );
      expect(input?.entries.find((e) => e.key === told)?.value, typed[i]).toEqual([typed[i]]);
    }
  }

  it("keeps words that turn a place down for the waiting role only, in any language", async () => {
    await answerWaitingOnly(HYBRID_DUBLIN, [
      "Dublin doesn't work for me",
      "Dublin is not an option",
      "Hybrid in Dublin is a no",
      "I would prefer Cork over Dublin",
      "Dublin, but remote only",
      "Так",
      "Unfortunately not",
      "いいえ",
    ]);
  });

  it("keeps words that turn a remote scope down for the waiting role only", async () => {
    await answerWaitingOnly(REMOTE_EU, ["EU is not ok", "Only outside the EU", "Nem"]);
  });

  it("never takes typed words as a work permit", async () => {
    await answerWaitingOnly(PERMIT_IE, [
      "Absolutely not",
      "Negative",
      "I need a visa",
      "I need sponsorship",
      "Unfortunately not",
      "いいえ",
      "Ei",
      "Hayır",
      "Stamp 4 for DE",
    ]);
  });

  it("keeps a minimum pay in another currency or period, or with no currency, for the waiting role only", async () => {
    await answerWaitingOnly(null, [
      "120k euros",
      "120k dollars",
      "usd 120k",
      "10k/mo",
      "10k p.m.",
      "as much as possible",
      "120,000",
    ]);
    // Words are never used for similar mail: the next message is asked again.
    await h.deliver(ZURICH_2, { roles: [{ needs: [CHF_NEED] }] });
    await h.evaluate(ZURICH_2);
    expect((await decisionOf(CHF_NEED.groupKey)).waiting.map((w) => w.messageId)).toEqual([
      ZURICH_2,
    ]);
  });

  it("keeps every answer the model offers clickable; one it says declines writes nothing", async () => {
    // A question whose group key leaves the work mode out, in Ukrainian, plus a permit question.
    const dublin = {
      profileKey: "places",
      groupKey: "places:IE:Dublin",
      question: "Дублін?",
      choices: [
        { label: "Так", declines: false },
        { label: "Ні", declines: true },
      ],
    };
    await h.deliver(BERLIN);
    h.ai.answers.draft[key(BERLIN)] = draftAnswer({ questions: [dublin, PERMIT_IE] });
    await h.evaluate(BERLIN);
    await h.drain();
    const place = await decisionOf(dublin.groupKey);
    const permit = await decisionOf(PERMIT_IE.groupKey);
    // "Так" can't complete a place (no work mode): offered, for the waiting role only.
    expect(place.choices).toEqual([
      { label: "Так", value: "Так" },
      { label: "Ні", value: "Ні", declines: true },
    ]);
    expect(permit.choices).toEqual([
      { label: "Stamp 4", value: { country: "IE", text: "Stamp 4" } },
      { label: "Ні", value: "Ні", declines: true },
    ]);
    h.ai.answers.draft[key(BERLIN)] = draftAnswer();
    for (const [decision, value, declined] of [
      [place, "Так", false],
      [permit, "Ні", true],
    ] as const) {
      const res = await maria.post(`${base}/${decision.id}/answer`, {
        value,
        useForSimilar: true,
      });
      expect(res.status, value).toBe(200);
      expect(events("decision.answered").at(-1)).toMatchObject({
        decisionId: decision.id,
        useForSimilar: false,
        declined,
        waitingOnly: true,
      });
    }
    await h.drain();
    const [profile] = await listProfiles(h.deps.db, h.ws);
    expect(profile?.entries.find((e) => e.key === "places")?.value ?? []).toEqual([]);
    expect(profile?.entries.find((e) => e.key === "work_permits")?.value ?? []).toEqual([]);
    expect(await getHistory(h.deps.db, h.ws, h.profileId)).toEqual([]);
    expect(await h.live(BERLIN)).toMatchObject({ status: "in_mailbox", origin: "decision" });
    expect(await inbox()).toEqual([]);
  });
  it("offers a yes and a no to click; the no answers the waiting role and writes nothing (F7.2)", async () => {
    await h.deliver(BERLIN);
    h.ai.answers.draft[key(BERLIN)] = draftAnswer({ questions: [HYBRID_DUBLIN] });
    await h.evaluate(BERLIN);
    await h.drain();
    const decision = await decisionOf(HYBRID_DUBLIN.groupKey);
    expect(decision.choices).toEqual([
      { label: "Yes", value: { country: "IE", city: "Dublin", mode: "hybrid" } },
      { label: "No", value: "No", declines: true },
    ]);

    h.ai.answers.draft[key(BERLIN)] = draftAnswer();
    const res = await maria.post(`${base}/${decision.id}/answer`, {
      value: "No",
      useForSimilar: true,
    });
    expect(res.status).toBe(200);
    expect(events("decision.answered")).toEqual([
      expect.objectContaining({ decisionId: decision.id, useForSimilar: false, declined: true }),
    ]);
    await h.drain();
    // Nothing is written to the profile: no place, no history.
    const [profile] = await listProfiles(h.deps.db, h.ws);
    expect(profile?.entries.find((e) => e.key === "places")?.value ?? []).toEqual([]);
    expect(await getHistory(h.deps.db, h.ws, h.profileId)).toEqual([]);
    // The waiting role gets its draft, told the answer, and the decision is gone.
    expect(await h.live(BERLIN)).toMatchObject({ status: "in_mailbox", origin: "decision" });
    const entries = h.draftInputs.at(-1)?.entries ?? [];
    expect(entries).toContainEqual({
      key: "extra.answer_places_ie_dublin_hybrid",
      label: HYBRID_DUBLIN.question,
      value: ["No"],
    });
    expect(entries.find((e) => e.key === "places")).toBeUndefined();
    expect(await inbox()).toEqual([]);
  });

  it("writes the parts' item for a clicked yes", async () => {
    await h.deliver(BERLIN);
    h.ai.answers.draft[key(BERLIN)] = draftAnswer({ questions: [HYBRID_DUBLIN] });
    await h.evaluate(BERLIN);
    await h.drain();
    const decision = await decisionOf(HYBRID_DUBLIN.groupKey);
    h.ai.answers.draft[key(BERLIN)] = draftAnswer();
    const res = await maria.post(`${base}/${decision.id}/answer`, {
      value: decision.choices[0]?.value,
      useForSimilar: true,
    });
    expect(res.status).toBe(200);
    await h.drain();
    const [profile] = await listProfiles(h.deps.db, h.ws);
    expect(profile?.entries.find((e) => e.key === "places")?.value).toEqual([
      { country: "IE", city: "Dublin", mode: "hybrid" },
    ]);
    expect(await h.live(BERLIN)).toMatchObject({ status: "in_mailbox" });
  });

  it("writes only the answer that claims the decision when two editors answer at once", async () => {
    await seedThree();
    const chf = await decisionOf("min_pay:CHF:year");
    const answer = (value: unknown) =>
      maria.post(`${base}/${chf.id}/answer`, { value, useForSimilar: true });
    const results = await Promise.all([answer(CHF_120), answer("CHF 115,000")]);
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
    expect(
      (await viewer.post(`${base}/${id}/answer`, { value: "CHF 99,000", useForSimilar: false }))
        .status,
    ).toBe(403);
    expect((await viewer.post(`${base}/${id}/not-now`)).status).toBe(403);
    expect(
      (await viewer.post(`${base}/${id}/dismiss`, { messageId: ZURICH, position: 0 })).status,
    ).toBe(403);
    expect(await inbox()).toHaveLength(2);
    expect(events("decision.answered")).toEqual([]);
    expect(await getHistory(h.deps.db, h.ws, h.profileId)).toEqual([]);
  });

  it("are not shown to a non-member, who gets 404 on a real decision", async () => {
    await seedThree();
    const id = (await decisionOf(CHF_NEED.groupKey)).id;
    const outsider = await seedUser(h.deps, { name: "Eve Outsider" });
    const eve = await h.client(outsider);
    // From her own workspace, where she is an admin, Maria's decision isn't there either.
    const own = `/api/workspaces/${outsider.workspaceId}/decisions`;
    expect((await eve.get(own)).status).toBe(200);
    expect(
      (await eve.post(`${own}/${id}/answer`, { value: CHF_120, useForSimilar: true })).status,
    ).toBe(404);
    expect((await eve.post(`${own}/${id}/not-now`)).status).toBe(404);
    expect(
      (await eve.post(`${own}/${id}/dismiss`, { messageId: ZURICH, position: 0 })).status,
    ).toBe(404);
    expect((await eve.get(base)).status).toBe(404);
    expect((await eve.get(`${base}/count`)).status).toBe(404);
    expect(
      (await eve.post(`${base}/${id}/answer`, { value: CHF_120, useForSimilar: true })).status,
    ).toBe(404);
    expect((await eve.post(`${base}/${id}/not-now`)).status).toBe(404);
    expect(
      (await eve.post(`${base}/${id}/dismiss`, { messageId: ZURICH, position: 0 })).status,
    ).toBe(404);
    expect(await inbox()).toHaveLength(2);
    expect((await decisionOf(CHF_NEED.groupKey)).waiting).toHaveLength(2);
  });
});
