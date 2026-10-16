import type {
  DecisionNeed,
  MatchVerdict,
  NeedSpec,
  ProfileEntry,
  RoleEvaluation,
  RuleEffect,
} from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { answeredFor, applyChanges, GROUP_PARTS } from "../profile/changes";
import {
  answerChange,
  answerItem,
  answerOf,
  groupNeeds,
  isOpen,
  itemFromText,
  needsFromQuestions,
  planReply,
  type ReplyPlanInput,
  type RoleNeed,
  roleNeeds,
} from "./index";

const now = new Date("2026-10-15T12:00:00Z");
const RULE = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";

const entry = (key: ProfileEntry["key"], value: ProfileEntry["value"]): ProfileEntry => ({
  key,
  label: key,
  value,
  confidence: null,
  evidence: [],
  source: "scan",
  updatedAt: now.toISOString(),
  updatedBy: null,
});

const eur = { amount: 70000, currency: "EUR", period: "year" as const, asWritten: "70k EUR" };
const chf = { amount: 120000, currency: "CHF", period: "year" as const, asWritten: "120k CHF" };

const chfNeed: NeedSpec = {
  groupKey: "min_pay:CHF:year",
  profileKey: "min_pay",
  question: "Minimum pay in CHF per year?",
  choices: [{ label: "CHF 120,000", value: chf }],
};
const askFirst: NeedSpec = {
  groupKey: `rule:${RULE}`,
  profileKey: null,
  question: "Reply to roles at agencies?",
  choices: [],
};

const verdict = (need: NeedSpec | null): MatchVerdict => ({
  entryKey: "min_pay",
  ruleId: null,
  verdict: "unknown",
  reason: "different currency",
  hard: false,
  need,
});

const evaluation = (
  verdicts: MatchVerdict[],
  ruleEffects: RuleEffect[] = [],
): Pick<RoleEvaluation, "match" | "ruleEffects"> => ({
  match: { score: 80, verdicts, skills: { matched: [], missing: [] }, cvId: null, capped: false },
  ruleEffects,
});

const maria = { entries: [entry("min_pay", [eur])] };

describe("needs (F7.1, F7.6)", () => {
  it("are collected from match verdicts, rule effects and a draft's questions as stated", () => {
    const effect: RuleEffect = {
      ruleId: RULE,
      action: "ask_first",
      reason: "Ask first",
      need: askFirst,
    };
    const drafted: RoleNeed = {
      groupKey: "extra.relocate",
      profileKey: "extra.relocate",
      question: "Would you relocate to Ireland?",
      choices: [],
      source: "draft",
    };
    const needs = roleNeeds({
      evaluation: evaluation([verdict(chfNeed), verdict(null)], [effect]),
      recorded: [drafted],
      profile: maria,
      answeredHere: new Set(),
    });
    expect(needs).toEqual([
      { ...chfNeed, source: "match" },
      { ...askFirst, source: "rule" },
      drafted,
    ]);
  });

  it("decide 'already answered' by group key, not by profile key", () => {
    // An EUR minimum is in min_pay, yet the CHF question is still open.
    const open = roleNeeds({
      evaluation: evaluation([verdict(chfNeed)]),
      recorded: [],
      profile: maria,
      answeredHere: new Set(),
    });
    expect(open.map((n) => n.groupKey)).toEqual(["min_pay:CHF:year"]);
    // Once CHF per year is in min_pay, there is none.
    const answered = { entries: [entry("min_pay", [eur, chf])] };
    expect(answeredFor(answered, "min_pay:CHF:year")).toEqual(chf);
    expect(
      roleNeeds({
        evaluation: evaluation([verdict(chfNeed)]),
        recorded: [],
        profile: answered,
        answeredHere: new Set(),
      }),
    ).toEqual([]);
  });

  it("count an answer given for this role alone, and keep ask_first open until then", () => {
    const effect: RuleEffect = {
      ruleId: RULE,
      action: "ask_first",
      reason: "Ask first",
      need: askFirst,
    };
    const input = {
      evaluation: evaluation([verdict(chfNeed)], [effect]),
      recorded: [],
      profile: maria,
    };
    expect(roleNeeds({ ...input, answeredHere: new Set() })).toHaveLength(2);
    expect(
      roleNeeds({ ...input, answeredHere: new Set([askFirst.groupKey, chfNeed.groupKey]) }),
    ).toEqual([]);
  });

  it("from a draft's questions write a profile key, so the answer is found later", () => {
    const needs = needsFromQuestions([
      {
        profileKey: "min_pay",
        groupKey: "min_pay:CHF:year",
        question: "Minimum pay in CHF per year?",
        choices: ["CHF 110,000", "120k", "whatever you think"],
      },
      // No usable key: an extra question named after its group key.
      { profileKey: null, groupKey: "Relocation (IE)", question: "Relocate?", choices: ["Yes"] },
      // A group key of another key is replaced by the key's own.
      { profileKey: "extra.visa", groupKey: "visa:IE", question: "Visa?", choices: [] },
    ]);
    expect(needs).toEqual([
      {
        groupKey: "min_pay:CHF:year",
        profileKey: "min_pay",
        question: "Minimum pay in CHF per year?",
        choices: [
          {
            label: "CHF 110,000",
            value: { amount: 110000, currency: "CHF", period: "year", asWritten: "CHF 110,000" },
          },
          {
            label: "120k",
            value: { amount: 120000, currency: "CHF", period: "year", asWritten: "120k" },
          },
        ],
      },
      {
        groupKey: "extra.relocation_ie",
        profileKey: "extra.relocation_ie",
        question: "Relocate?",
        choices: [{ label: "Yes", value: "Yes" }],
      },
      { groupKey: "extra.visa", profileKey: "extra.visa", question: "Visa?", choices: [] },
    ]);
    const profile = { entries: [entry("extra.relocation_ie", ["Yes"])] };
    expect(answeredFor(profile, needs[1]?.groupKey ?? "")).toEqual(["Yes"]);
  });

  it("from a draft's questions stay answered once answered, whatever parts their group key has", () => {
    const asked = [
      // An extra question's parts become part of its name: Ireland and Germany stay apart.
      {
        q: { profileKey: "extra.relocate", groupKey: "extra.relocate:IE", choices: ["Yes", "No"] },
        need: { profileKey: "extra.relocate_ie", groupKey: "extra.relocate_ie" },
        answer: "Yes",
      },
      {
        q: { profileKey: null, groupKey: "extra.relocate:DE", choices: [] },
        need: { profileKey: "extra.relocate_de", groupKey: "extra.relocate_de" },
        answer: "No",
      },
      // A word-list key's parts can't be compared with its items: the key's own group key.
      {
        q: { profileKey: "deal_breakers", groupKey: "deal_breakers:onsite", choices: [] },
        need: { profileKey: "deal_breakers", groupKey: "deal_breakers" },
        answer: "Fully on-site",
      },
      // A key whose parts describe its items keeps them.
      {
        q: { profileKey: null, groupKey: "work_permits:IE", choices: [] },
        need: { profileKey: "work_permits", groupKey: "work_permits:IE" },
        answer: "Stamp 4",
      },
      // The parts fill every field answeredFor compares, whatever the words: "Yes" isn't a scope.
      {
        q: { profileKey: "remote", groupKey: "remote:EU", choices: [] },
        need: { profileKey: "remote", groupKey: "remote:EU" },
        answer: "Yes",
      },
      {
        q: { profileKey: "places", groupKey: "places:IE:Dublin:hybrid", choices: [] },
        need: { profileKey: "places", groupKey: "places:IE:Dublin:hybrid" },
        answer: "Yes",
      },
      // More parts than the key's items have fields: the key's own group key.
      {
        q: { profileKey: "remote", groupKey: "remote:EU:CET", choices: [] },
        need: { profileKey: "remote", groupKey: "remote" },
        answer: "EU, CET hours",
      },
      // Fewer parts than fields: the words give the fields the parts leave out.
      {
        q: { profileKey: "min_pay", groupKey: "min_pay:CHF", choices: [] },
        need: { profileKey: "min_pay", groupKey: "min_pay:CHF" },
        answer: "CHF 120,000 per year",
      },
      {
        q: { profileKey: "places", groupKey: "places:IE", choices: [] },
        need: { profileKey: "places", groupKey: "places:IE" },
        answer: "Hybrid",
      },
      {
        q: { profileKey: "places", groupKey: "places:IE:Dublin", choices: [] },
        need: { profileKey: "places", groupKey: "places:IE:Dublin" },
        answer: "Onsite",
      },
      // A part no item can have (no place is "remote"): the key's own group key, and the words
      // name the whole place.
      {
        q: { profileKey: "places", groupKey: "places:IE:Dublin:remote", choices: [] },
        need: { profileKey: "places", groupKey: "places" },
        answer: "Dublin, IE, hybrid",
      },
    ];
    for (const { q, need: expected, answer } of asked) {
      const [need] = needsFromQuestions([{ ...q, question: "?" }]);
      expect(need, q.groupKey).toMatchObject(expected);
      if (!need?.profileKey) throw new Error("expected a profile key");
      expect(isOpen(need, maria, new Set())).toBe(true);
      const item = answerItem(need, answer);
      if (item === null) throw new Error(`${q.groupKey}: the answer doesn't fit`);
      const applied = applyChanges(
        { entries: maria.entries, rules: [] },
        [answerChange(need.profileKey, item)],
        {
          profileId: "p",
          source: "decision",
          userId: null,
          at: now.toISOString(),
          newRuleId: () => RULE,
        },
      );
      if (!applied.ok) throw new Error(`${q.groupKey}: the answer doesn't apply`);
      // The same question from a later draft is answered by the profile now.
      const [again] = needsFromQuestions([{ ...q, question: "?" }]);
      expect(again && isOpen(again, applied, new Set()), `${q.groupKey} answered`).toBe(false);
    }
    // Relocating to Ireland doesn't answer relocating to Germany.
    const ie = { entries: [entry("extra.relocate_ie", ["Yes"])] };
    const [de] = needsFromQuestions([
      { profileKey: null, groupKey: "extra.relocate:DE", question: "?", choices: [] },
    ]);
    expect(de && isOpen(de, ie, new Set())).toBe(true);
    // Remote in the EU doesn't answer remote in the US, nor Dublin hybrid Dublin on-site.
    const answered = {
      entries: [
        entry("remote", [{ scope: "EU", timeZones: null }]),
        entry("places", [{ country: "IE", city: "Dublin", mode: "hybrid" }]),
      ],
    };
    const [us, onsite] = needsFromQuestions([
      { profileKey: "remote", groupKey: "remote:US", question: "?", choices: [] },
      { profileKey: "places", groupKey: "places:IE:Dublin:onsite", question: "?", choices: [] },
    ]);
    expect(us && isOpen(us, answered, new Set())).toBe(true);
    expect(onsite && isOpen(onsite, answered, new Set())).toBe(true);
  });

  it("never write what the words turn down or contradict, and keep the parts for a yes", () => {
    // Per key of GROUP_PARTS: words that agree make the parts' item; a no or words naming
    // another city, scope, currency, period or country are refused, never the parts' item.
    const cases: Record<string, { groupKey: string; agree: string[]; refuse: string[] }> = {
      min_pay: {
        groupKey: "min_pay:chf:year",
        agree: ["120,000", "CHF 95'000", "120k a year"],
        refuse: [
          "No",
          "None",
          "EUR 95,000 a month",
          "EUR 95,000",
          "95,000 a month",
          "€95,000",
          "No, 120k is too low",
        ],
      },
      places: {
        groupKey: "places:ie:Dublin:hybrid",
        agree: ["Yes", "Yes, hybrid", "Hybrid in Dublin is fine", "Ja"],
        refuse: ["No", "No, only Cork", "Cork", "Onsite", "Yes, but only Cork", "Not hybrid", "DE"],
      },
      remote: {
        groupKey: "remote:EU",
        agree: ["Yes", "EU", "Sure, anywhere in the EU"],
        refuse: ["No", "Worldwide", "Nope", "I'm not open to remote"],
      },
      work_permits: {
        groupKey: "work_permits:ie",
        agree: ["Stamp 4", "Stamp 4, no restrictions"],
        refuse: ["None", "No", "I have none", "Stamp 4 for DE"],
      },
    };
    for (const [key, fields] of Object.entries(GROUP_PARTS)) {
      const c = cases[key];
      if (!c || !fields) throw new Error(`${key}: add a case for it here`);
      const profileKey = key as ProfileEntry["key"];
      const [need] = needsFromQuestions([
        { profileKey: key, groupKey: c.groupKey, question: "?", choices: [] },
      ]);
      expect(need?.groupKey, key).toBe(c.groupKey);
      for (const text of c.agree) {
        const item = itemFromText(profileKey, c.groupKey, text);
        if (item === null) throw new Error(`${key} ${text}: no item`);
        const value = [item] as ProfileEntry["value"];
        expect(
          answeredFor({ entries: [entry(profileKey, value)] }, c.groupKey),
          `${key} ${text} answers`,
        ).not.toBeNull();
      }
      for (const text of c.refuse) {
        expect(itemFromText(profileKey, c.groupKey, text), `${key} "${text}"`).toBeNull();
        expect(
          answerItem({ profileKey, groupKey: c.groupKey }, text),
          `${key} "${text}"`,
        ).toBeNull();
      }
    }
    expect(itemFromText("places", "places:IE:Dublin:hybrid", "Yes")).toEqual({
      country: "IE",
      city: "Dublin",
      mode: "hybrid",
    });
    expect(itemFromText("min_pay", "min_pay:CHF:year", "120k a year")).toEqual({
      amount: 120000,
      currency: "CHF",
      period: "year",
      asWritten: "120k a year",
    });
    // A no isn't an item of a word list either: "None" is no deal breaker.
    expect(itemFromText("deal_breakers", "deal_breakers", "None")).toBeNull();
    expect(itemFromText("extra.relocate", "extra.relocate", "No")).toBe("No");
    // A choice's item that answers another question than the one asked is refused too.
    const decision = { profileKey: "places" as const, groupKey: "places:IE:Dublin:hybrid" };
    expect(answerItem(decision, { country: "IE", city: "Cork", mode: "hybrid" })).toBeNull();
    expect(answerItem(decision, { country: "IE", city: "Dublin", mode: "hybrid" })).toEqual({
      country: "IE",
      city: "Dublin",
      mode: "hybrid",
    });
  });

  it("keep answers to click: a yes adds the parts' item, a no writes nothing", () => {
    const [remote, dublin, pay] = needsFromQuestions([
      {
        profileKey: "remote",
        groupKey: "remote:EU",
        question: "Open to remote in the EU?",
        choices: ["Yes", "No"],
      },
      {
        profileKey: "places",
        groupKey: "places:IE:Dublin:hybrid",
        question: "Hybrid in Dublin?",
        choices: ["Yes", "Sure", "No", "Only Cork"],
      },
      {
        profileKey: "min_pay",
        groupKey: "min_pay:CHF:year",
        question: "Minimum pay in CHF per year?",
        choices: ["CHF 110,000", "CHF 120,000", "No CHF roles"],
      },
    ]);
    expect(remote?.choices).toEqual([
      { label: "Yes", value: { scope: "EU", timeZones: null } },
      { label: "No", value: "No" },
    ]);
    // "Sure" would add what "Yes" adds; "Only Cork" isn't Dublin, so it isn't offered.
    expect(dublin?.choices).toEqual([
      { label: "Yes", value: { country: "IE", city: "Dublin", mode: "hybrid" } },
      { label: "No", value: "No" },
    ]);
    expect(pay?.choices.map((c) => c.label)).toEqual([
      "CHF 110,000",
      "CHF 120,000",
      "No CHF roles",
    ]);
    for (const need of [remote, dublin, pay]) {
      if (!need) throw new Error("expected a need");
      for (const choice of need.choices) {
        const answer = answerOf(need, choice.value);
        // A click never writes what its label doesn't say: a no is turned down, a yes is an item.
        if (choice.label.startsWith("No")) {
          expect(answer, choice.label).toEqual({ kind: "declined", words: choice.label });
        } else {
          expect(answer, choice.label).toEqual({ kind: "item", item: choice.value });
        }
      }
      // Typing the no is the same as clicking it; typing any other no doesn't fit.
      expect(answerOf(need, "Nope")).toBeNull();
    }
    if (!remote) throw new Error("expected a need");
    expect(answerOf(remote, "No")).toEqual({ kind: "declined", words: "No" });
  });
});

describe("grouping (F7.3)", () => {
  it("makes one decision of min_pay:CHF:year listing every waiting message", () => {
    const need = (messageId: string, position = 0): DecisionNeed => ({
      ...chfNeed,
      source: "match",
      messageId,
      position,
    });
    const groups = groupNeeds([
      need("<zurich@x.example>"),
      need("<basel@x.example>"),
      need("<zurich@x.example>"),
      { ...askFirst, source: "rule", messageId: "<zurich@x.example>", position: 0 },
    ]);
    expect(groups).toEqual([
      {
        ...chfNeed,
        waiting: [
          { messageId: "<zurich@x.example>", position: 0, source: "match" },
          { messageId: "<basel@x.example>", position: 0, source: "match" },
        ],
      },
      { ...askFirst, waiting: [{ messageId: "<zurich@x.example>", position: 0, source: "rule" }] },
    ]);
  });
});

describe("draft, ask or hold (F6.1, F7.1)", () => {
  const base: ReplyPlanInput = {
    origin: "auto",
    category: "recruiter_outreach",
    receivedAt: new Date(now.getTime() - 2 * 86_400_000),
    now,
    profile: maria,
    score: 80,
    capped: false,
    senderVerdict: "looks_fine",
    ruleEffects: [],
    needs: [],
    draftHistory: { hadDraft: false, dismissed: false },
  };
  const needs: RoleNeed[] = [{ ...chfNeed, source: "match" }];

  it("drafts a good match with nothing open, and asks when something is", () => {
    expect(planReply(base)).toEqual({ kind: "draft" });
    expect(planReply({ ...base, needs })).toEqual({ kind: "ask", needs });
  });

  it("records a need only for a role replyEligibility would otherwise allow", () => {
    const held = [
      planReply({ ...base, needs, score: 55 }),
      planReply({ ...base, needs, senderVerdict: "high_risk" }),
      planReply({ ...base, needs, category: "job_alert" }),
      planReply({ ...base, needs, receivedAt: new Date(now.getTime() - 30 * 86_400_000) }),
      planReply({ ...base, needs, draftHistory: { hadDraft: false, dismissed: true } }),
      planReply({ ...base, needs, draftHistory: { hadDraft: true, dismissed: false } }),
    ];
    expect(held.map((p) => p.kind)).toEqual(["hold", "hold", "hold", "hold", "hold", "hold"]);
  });

  it("asks an ask_first rule's question instead of holding, and drafts once answered", () => {
    const effect: RuleEffect = {
      ruleId: RULE,
      action: "ask_first",
      reason: "Ask first",
      need: askFirst,
    };
    const asked = planReply({
      ...base,
      ruleEffects: [effect],
      needs: [{ ...askFirst, source: "rule" }],
    });
    expect(asked).toEqual({ kind: "ask", needs: [{ ...askFirst, source: "rule" }] });
    expect(planReply({ ...base, ruleEffects: [effect], needs: [] })).toEqual({ kind: "draft" });
    // A hide rule still holds.
    const hide: RuleEffect = { ruleId: RULE, action: "hide", reason: "Hidden", need: null };
    expect(planReply({ ...base, ruleEffects: [hide], needs }).kind).toBe("hold");
  });
});

describe("answers (F7.4)", () => {
  it("become one add Change of a single item with source decision; CHF keeps EUR", () => {
    const item = answerItem({ profileKey: "min_pay", groupKey: chfNeed.groupKey }, "120,000");
    expect(item).toEqual({ amount: 120000, currency: "CHF", period: "year", asWritten: "120,000" });
    const change = answerChange("min_pay", item ?? chf);
    expect(change).toEqual({ op: "add", target: "entry", key: "min_pay", value: [item] });
    const applied = applyChanges({ entries: maria.entries, rules: [] }, [change], {
      profileId: "p",
      source: "decision",
      userId: null,
      at: now.toISOString(),
      newRuleId: () => RULE,
    });
    expect(applied.ok && applied.entries).toEqual([
      expect.objectContaining({ key: "min_pay", value: [eur, item], source: "decision" }),
    ]);
  });

  it("take a choice's item as it is and refuse what doesn't fit the key", () => {
    const decision = { profileKey: "min_pay" as const, groupKey: chfNeed.groupKey };
    expect(answerItem(decision, chf)).toEqual(chf);
    expect(answerItem(decision, "no idea")).toBeNull();
    expect(answerItem({ profileKey: "min_pay", groupKey: "min_pay" }, "120,000")).toBeNull();
    expect(answerItem({ profileKey: null, groupKey: askFirst.groupKey }, "Yes")).toBe("Yes");
  });

  it("make free text an item of the decision's key, answering its group key", () => {
    const cases: [ProfileEntry["key"], string, string][] = [
      ["min_pay", "min_pay:CHF:year", "CHF 95'000"],
      ["work_permits", "work_permits:IE", "Stamp 4"],
      ["remote", "remote", "EU time zones"],
      ["extra.relocate", "extra.relocate", "Maybe later"],
      ["deal_breakers", "deal_breakers", "On-call"],
      ["reply_threshold", "reply_threshold", "80"],
    ];
    for (const [key, groupKey, text] of cases) {
      const item = itemFromText(key, groupKey, text);
      expect(item, `${key} ${text}`).not.toBeNull();
      const change = answerChange(key, item ?? "");
      const applied = applyChanges({ entries: [], rules: [] }, [change], {
        profileId: "p",
        source: "decision",
        userId: null,
        at: now.toISOString(),
        newRuleId: () => RULE,
      });
      expect(applied.ok, `${key} applies`).toBe(true);
      if (applied.ok) expect(answeredFor(applied, groupKey), `${key} answers`).not.toBeNull();
    }
    expect(itemFromText("min_pay", "min_pay:CHF:year", "120k")).toMatchObject({ amount: 120000 });
    expect(itemFromText("min_pay", "min_pay:CHF:year", "120.000")).toMatchObject({
      amount: 120000,
    });
  });
});
