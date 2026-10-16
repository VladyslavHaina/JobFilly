import type {
  DecisionNeed,
  DraftChoice,
  MatchVerdict,
  NeedSpec,
  ProfileEntry,
  ProfileItem,
  RoleEvaluation,
  RuleEffect,
} from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { answeredFor, applyChanges, GROUP_PARTS } from "../profile/changes";
import {
  answerChange,
  answerItem,
  answerOf,
  capAutoDrafts,
  groupNeeds,
  isOpen,
  itemFromText,
  needsFromQuestions,
  planReply,
  type ReplyPlan,
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

/** Answers draft.v1 offers that accept what the question asks. */
const offer = (...labels: string[]) => labels.map((label) => ({ label, declines: false }));
/** An answer draft.v1 offers that turns the question down. */
const no = (label: string) => ({ label, declines: true });

/** Ways to say no that no word list catches, and words that say no once read whole. */
const NO_IN_ANY_LANGUAGE = [
  "No",
  "None",
  "Nope",
  "Ні",
  "いいえ",
  "Nem",
  "Ei",
  "Hayır",
  "Unfortunately not",
  "Absolutely not",
  "Negative",
];

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
        choices: offer("CHF 110,000", "120k", "whatever you think"),
      },
      // No usable key: an extra question named after its group key.
      {
        profileKey: null,
        groupKey: "Relocation (IE)",
        question: "Relocate?",
        choices: offer("Yes"),
      },
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
          // Words that state no amount stay clickable, for the waiting roles only.
          { label: "whatever you think", value: "whatever you think" },
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
    const asked: {
      q: { profileKey: string | null; groupKey: string; choices: DraftChoice[] };
      need: { profileKey: string; groupKey: string };
      answer: ProfileItem;
    }[] = [
      // An extra question's parts become part of its name: Ireland and Germany stay apart.
      {
        q: {
          profileKey: "extra.relocate",
          groupKey: "extra.relocate:IE",
          choices: [...offer("Yes"), no("No")],
        },
        need: { profileKey: "extra.relocate_ie", groupKey: "extra.relocate_ie" },
        answer: "Yes",
      },
      // An extra question's answer is its words, a no included.
      {
        q: { profileKey: null, groupKey: "extra.relocate:DE", choices: [no("No")] },
        need: { profileKey: "extra.relocate_de", groupKey: "extra.relocate_de" },
        answer: "No",
      },
      // A word-list key's parts can't be compared with its items: an extra question named after
      // the whole group key, so no deal-breaker already there answers it.
      {
        q: { profileKey: "deal_breakers", groupKey: "deal_breakers:onsite", choices: [] },
        need: {
          profileKey: "extra.deal_breakers_onsite",
          groupKey: "extra.deal_breakers_onsite",
        },
        answer: "Fully on-site",
      },
      // A key whose parts describe its items keeps them; a permit is one the model offered.
      {
        q: { profileKey: null, groupKey: "work_permits:IE", choices: offer("Stamp 4") },
        need: { profileKey: "work_permits", groupKey: "work_permits:IE" },
        answer: "Stamp 4",
      },
      // The parts fill every field answeredFor compares, whatever the words: "Yes" isn't a scope.
      {
        q: { profileKey: "remote", groupKey: "remote:EU", choices: offer("Yes") },
        need: { profileKey: "remote", groupKey: "remote:EU" },
        answer: "Yes",
      },
      {
        q: { profileKey: "remote", groupKey: "remote:EU", choices: [] },
        need: { profileKey: "remote", groupKey: "remote:EU" },
        answer: "EU",
      },
      {
        q: {
          profileKey: "places",
          groupKey: "places:IE:Dublin:hybrid",
          choices: offer("Так"),
        },
        need: { profileKey: "places", groupKey: "places:IE:Dublin:hybrid" },
        answer: "так",
      },
      // More parts than the key's items have fields: an extra question named after them.
      {
        q: { profileKey: "remote", groupKey: "remote:EU:CET", choices: [] },
        need: { profileKey: "extra.remote_eu_cet", groupKey: "extra.remote_eu_cet" },
        answer: "EU, CET hours",
      },
      // Fewer parts than fields: the answer gives the fields the parts leave out, as an item or
      // in the words the schema spells.
      {
        q: { profileKey: "min_pay", groupKey: "min_pay:CHF", choices: [] },
        need: { profileKey: "min_pay", groupKey: "min_pay:CHF" },
        answer: { amount: 120000, currency: "CHF", period: "year", asWritten: "CHF 120k" },
      },
      {
        q: { profileKey: "places", groupKey: "places:IE", choices: [] },
        need: { profileKey: "places", groupKey: "places:IE" },
        answer: "Hybrid",
      },
      {
        q: { profileKey: "places", groupKey: "places:IE:Dublin", choices: offer("Onsite") },
        need: { profileKey: "places", groupKey: "places:IE:Dublin" },
        answer: "Onsite",
      },
      // A part no item can have (no place is "remote"): an extra question named after the parts.
      {
        q: { profileKey: "places", groupKey: "places:IE:Dublin:remote", choices: [] },
        need: {
          profileKey: "extra.places_ie_dublin_remote",
          groupKey: "extra.places_ie_dublin_remote",
        },
        answer: "Yes, remote from Dublin",
      },
    ];
    for (const { q, need: expected, answer } of asked) {
      const [need] = needsFromQuestions([{ ...q, question: "?" }]);
      expect(need, q.groupKey).toMatchObject(expected);
      if (!need?.profileKey) throw new Error("expected a profile key");
      expect(isOpen(need, maria, new Set())).toBe(true);
      const answered = answerOf(need, answer);
      if (answered?.kind !== "item") throw new Error(`${q.groupKey}: the answer makes no item`);
      const { item } = answered;
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

  it("from a draft's questions stay open when the profile answers only their bare key", () => {
    // Maria's profile as her first scan reads it (e2e/fixtures/maria): minimums in EUR, Berlin
    // and Amsterdam hybrid, remote in the EU.
    const eurDay = { amount: 450, currency: "EUR", period: "day" as const, asWritten: "€450" };
    const scanned = {
      entries: [
        entry("min_pay", [eur, eurDay]),
        entry("places", [
          { country: "DE", city: "Berlin", mode: "hybrid" },
          { country: "NL", city: "Amsterdam", mode: "hybrid" },
        ]),
        entry("remote", [{ scope: "EU", timeZones: null }]),
        entry("deal_breakers", ["Crypto"]),
      ],
    };
    // Group keys whose parts make no item, or that are another key's: no entry already there
    // answers them, so the draft is held for a decision instead of going out on a guess.
    const asked = needsFromQuestions([
      {
        profileKey: "min_pay",
        groupKey: "min_pay:CHF:annual",
        question: "Minimum pay in CHF per year?",
        choices: offer("CHF 120,000"),
      },
      {
        profileKey: "places",
        groupKey: "places:IE:Dublin:remote",
        question: "Remote from Dublin?",
        choices: offer("Yes"),
      },
      { profileKey: "places", groupKey: "relocate:IE", question: "Relocate?", choices: [] },
      { profileKey: "places", groupKey: "relocation", question: "Relocate?", choices: [] },
      { profileKey: "remote", groupKey: "remote:EU:CET", question: "CET hours?", choices: [] },
      { profileKey: "deal_breakers", groupKey: "deal_breakers:onsite", question: "?", choices: [] },
    ]);
    expect(asked).toHaveLength(6);
    for (const need of asked) {
      expect(need.groupKey, need.question).not.toMatch(/^(min_pay|places|remote|deal_breakers)$/);
      expect(isOpen(need, scanned, new Set()), need.groupKey).toBe(true);
    }
    // Once answered, the same question from a later draft is answered by the profile (F7.6).
    const [chfQuestion] = asked;
    if (!chfQuestion?.profileKey) throw new Error("expected a profile key");
    const answered = answerOf(chfQuestion, "CHF 120,000");
    if (answered?.kind !== "item") throw new Error("the answer makes no item");
    const applied = applyChanges(
      { entries: scanned.entries, rules: [] },
      [answerChange(chfQuestion.profileKey, answered.item)],
      {
        profileId: "p",
        source: "decision",
        userId: null,
        at: now.toISOString(),
        newRuleId: () => RULE,
      },
    );
    if (!applied.ok) throw new Error("the answer doesn't apply");
    const [again] = needsFromQuestions([
      { profileKey: "min_pay", groupKey: "min_pay:CHF:annual", question: "?", choices: [] },
    ]);
    expect(again && isOpen(again, applied, new Set())).toBe(false);
    // What the key's items do answer is still answered by them.
    const [eurYear, bare] = needsFromQuestions([
      { profileKey: "min_pay", groupKey: "min_pay:EUR:year", question: "?", choices: [] },
      { profileKey: "min_pay", groupKey: "min_pay", question: "?", choices: [] },
    ]);
    expect(eurYear && isOpen(eurYear, scanned, new Set())).toBe(false);
    expect(bare && isOpen(bare, scanned, new Set())).toBe(false);
  });

  it("never write what the user turned down or the words don't state, in any language", () => {
    // Per key of GROUP_PARTS: typed words make the parts' item only when they state it in a form
    // every language shares (digits with the currency's own code or sign, the parts' own words,
    // ISO codes, the schema's values). A no in any language, words naming another city, scope,
    // currency, period or country, and anything else make no item: they are kept for the
    // waiting roles only (answerOf), and nothing is written.
    const cases: Record<string, { groupKey: string; agree: string[]; refuse: string[] }> = {
      min_pay: {
        groupKey: "min_pay:chf:year",
        agree: ["CHF 120,000", "CHF 95'000", "120.000 CHF", "chf 120k", "CHF 120 000.-"],
        refuse: [
          "EUR 95,000 a month",
          "EUR 95,000",
          "95,000 a month",
          "€95,000",
          "No, 120k is too low",
          "120k euros",
          "120k dollars",
          "usd 120k",
          "USD 120k",
          "10k/mo",
          "10k p.m.",
          "CHF 10k month",
          "CHF 120k a year",
          "CHF 100-120k",
          // An amount without the currency's own code or sign doesn't state the minimum.
          "120,000",
        ],
      },
      places: {
        groupKey: "places:ie:Dublin:hybrid",
        agree: ["Dublin", "Dublin, IE, hybrid", "hybrid"],
        refuse: [
          "Yes",
          "Ja",
          "Так",
          "No, only Cork",
          "Cork",
          "Onsite",
          "Yes, but only Cork",
          "Not hybrid",
          "DE",
          "Dublin doesn't work for me",
          "Dublin is not an option",
          "Hybrid in Dublin is a no",
          "I would prefer Cork over Dublin",
          "Dublin, but remote only",
        ],
      },
      remote: {
        groupKey: "remote:EU",
        agree: ["EU"],
        refuse: [
          "Yes",
          "Worldwide",
          "I'm not open to remote",
          "EU is not ok",
          "Only outside the EU",
        ],
      },
      work_permits: {
        // A permit is never made of typed words: only of an answer the model offered.
        groupKey: "work_permits:ie",
        agree: [],
        refuse: [
          "Stamp 4",
          "IE",
          "I have none",
          "Stamp 4 for DE",
          "I need a visa",
          "I need sponsorship",
        ],
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
      if (!need) throw new Error("expected a need");
      for (const text of c.agree) {
        const item = itemFromText(profileKey, c.groupKey, text);
        if (item === null) throw new Error(`${key} ${text}: no item`);
        expect(answerOf(need, text), `${key} "${text}"`).toEqual({ kind: "item", item });
        const value = [item] as ProfileEntry["value"];
        expect(
          answeredFor({ entries: [entry(profileKey, value)] }, c.groupKey),
          `${key} ${text} answers`,
        ).not.toBeNull();
      }
      for (const text of [...c.refuse, ...NO_IN_ANY_LANGUAGE]) {
        expect(itemFromText(profileKey, c.groupKey, text), `${key} "${text}"`).toBeNull();
        expect(
          answerItem({ profileKey, groupKey: c.groupKey }, text),
          `${key} "${text}"`,
        ).toBeNull();
        // Kept for the waiting roles only: their replies are told the words, nothing is written.
        expect(answerOf(need, text), `${key} "${text}"`).toEqual({
          kind: "words",
          words: text,
          declines: false,
        });
      }
    }
    expect(itemFromText("min_pay", "min_pay:CHF:year", "CHF 120k")).toEqual({
      amount: 120000,
      currency: "CHF",
      period: "year",
      asWritten: "CHF 120k",
    });
    // The words complete what the parts leave out only with the schema's own values.
    expect(itemFromText("min_pay", "min_pay:CHF", "CHF 120k year")).toMatchObject({
      period: "year",
    });
    expect(itemFromText("min_pay", "min_pay:CHF", "CHF 120,000 per year")).toBeNull();
    expect(itemFromText("places", "places:IE:Dublin", "hybrid")).toEqual({
      country: "IE",
      city: "Dublin",
      mode: "hybrid",
    });
    expect(itemFromText("places", "places", "Dublin, IE, hybrid")).toBeNull();
    expect(itemFromText("places", "places", "IE, hybrid")).toEqual({
      country: "IE",
      city: null,
      mode: "hybrid",
    });
    expect(itemFromText("remote", "remote", "EU time zones")).toBeNull();
    // An extra question keeps its words, a no included: that is its answer.
    expect(itemFromText("extra.relocate", "extra.relocate", "No")).toBe("No");
    expect(itemFromText("reply_threshold", "reply_threshold", "80 %")).toBe(80);
    expect(itemFromText("reply_threshold", "reply_threshold", "not below 80")).toBeNull();
    // A choice's item that answers another question than the one asked is refused too.
    const decision = { profileKey: "places" as const, groupKey: "places:IE:Dublin:hybrid" };
    expect(answerItem(decision, { country: "IE", city: "Cork", mode: "hybrid" })).toBeNull();
    expect(answerItem(decision, { country: "IE", city: "Dublin", mode: "hybrid" })).toEqual({
      country: "IE",
      city: "Dublin",
      mode: "hybrid",
    });
  });

  it("keep answers to click: what the model says declines writes nothing, every other is offered", () => {
    const dublinHybrid = { country: "IE", city: "Dublin", mode: "hybrid" };
    const asked = needsFromQuestions([
      {
        profileKey: "remote",
        groupKey: "remote:EU",
        question: "Open to remote in the EU?",
        choices: [...offer("Yes"), no("No")],
      },
      {
        profileKey: "places",
        groupKey: "places:IE:Dublin:hybrid",
        question: "Hybrid in Dublin?",
        choices: [...offer("Yes", "Sure"), no("No"), no("Only Cork")],
      },
      {
        profileKey: "min_pay",
        groupKey: "min_pay:CHF:year",
        question: "Minimum pay in CHF per year?",
        choices: [...offer("CHF 110,000", "CHF 120,000"), no("No CHF roles")],
      },
      // A no the old word lists missed, offered before a yes, is still offered.
      {
        profileKey: "places",
        groupKey: "places:IE:Cork:hybrid",
        question: "Hybrid in Cork?",
        choices: [no("Absolutely not"), ...offer("Yes")],
      },
      // Fewer parts than the item has fields: a yes can't complete the item, and stays.
      {
        profileKey: "places",
        groupKey: "places:IE:Dublin",
        question: "Dublin?",
        choices: [...offer("Yes"), no("No")],
      },
      {
        profileKey: "min_pay",
        groupKey: "min_pay:CHF",
        question: "Minimum pay in CHF?",
        choices: [...offer("CHF 100k"), no("No")],
      },
      // Any language: the model says which answer declines.
      {
        profileKey: "places",
        groupKey: "places:IE:Galway:hybrid",
        question: "Гібрид у Голвеї?",
        choices: [...offer("Так"), no("Ні")],
      },
      {
        profileKey: "work_permits",
        groupKey: "work_permits:IE",
        question: "Work permit for Ireland?",
        choices: [...offer("Stamp 4"), no("いいえ"), no("Unfortunately not")],
      },
    ]);
    const choicesOf = (groupKey: string) => asked.find((n) => n.groupKey === groupKey)?.choices;
    expect(choicesOf("remote:EU")).toEqual([
      { label: "Yes", value: { scope: "EU", timeZones: null } },
      { label: "No", value: "No", declines: true },
    ]);
    expect(choicesOf("places:IE:Dublin:hybrid")).toEqual([
      { label: "Yes", value: dublinHybrid },
      { label: "Sure", value: dublinHybrid },
      { label: "No", value: "No", declines: true },
      { label: "Only Cork", value: "Only Cork", declines: true },
    ]);
    expect(choicesOf("min_pay:CHF:year")?.map((c) => c.label)).toEqual([
      "CHF 110,000",
      "CHF 120,000",
      "No CHF roles",
    ]);
    expect(choicesOf("places:IE:Cork:hybrid")).toEqual([
      { label: "Absolutely not", value: "Absolutely not", declines: true },
      { label: "Yes", value: { country: "IE", city: "Cork", mode: "hybrid" } },
    ]);
    expect(choicesOf("places:IE:Dublin")).toEqual([
      { label: "Yes", value: "Yes" },
      { label: "No", value: "No", declines: true },
    ]);
    expect(choicesOf("min_pay:CHF")).toEqual([
      { label: "CHF 100k", value: "CHF 100k" },
      { label: "No", value: "No", declines: true },
    ]);
    expect(choicesOf("places:IE:Galway:hybrid")).toEqual([
      { label: "Так", value: { country: "IE", city: "Galway", mode: "hybrid" } },
      { label: "Ні", value: "Ні", declines: true },
    ]);
    expect(choicesOf("work_permits:IE")).toEqual([
      { label: "Stamp 4", value: { country: "IE", text: "Stamp 4" } },
      { label: "いいえ", value: "いいえ", declines: true },
      { label: "Unfortunately not", value: "Unfortunately not", declines: true },
    ]);
    for (const need of asked) {
      for (const choice of need.choices) {
        // A click never writes what the user turned down: a no is for the waiting roles only,
        // and so is a choice no item can be made of; any other adds its item.
        const expected =
          typeof choice.value !== "string"
            ? { kind: "item", item: choice.value }
            : { kind: "words", words: choice.label, declines: choice.declines === true };
        expect(answerOf(need, choice.value), choice.label).toEqual(expected);
        // Typing its words is the same as clicking it.
        expect(answerOf(need, ` ${choice.label.toLowerCase()} `), choice.label).toEqual(expected);
      }
      // Typing a no nobody offered makes no item either.
      for (const text of NO_IN_ANY_LANGUAGE) {
        if (need.choices.some((c) => c.label === text)) continue;
        expect(answerOf(need, text), `${need.groupKey} "${text}"`).toMatchObject({
          kind: "words",
        });
      }
    }
    // An extra question's answer is its words, a no included, so it is never asked again.
    const [relocate] = needsFromQuestions([
      {
        profileKey: "extra.relocate",
        groupKey: "extra.relocate",
        question: "Would you relocate to Ireland?",
        choices: [...offer("Yes"), no("No")],
      },
    ]);
    if (!relocate) throw new Error("expected a need");
    expect(relocate.choices).toEqual([
      { label: "Yes", value: "Yes" },
      { label: "No", value: "No" },
    ]);
    expect(answerOf(relocate, "No")).toEqual({ kind: "item", item: "No" });
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

describe("one automatic draft per message (TBD-221)", () => {
  const fresh = { hadDraft: false, dismissed: false };
  const draft = { kind: "draft" } as const;
  const another = {
    kind: "hold",
    heldBy: [{ kind: "another_role", reason: "Another role in this email already has the reply" }],
  };
  const role = (position: number, score: number | null, plan: ReplyPlan = draft) => ({
    position,
    score,
    draftHistory: fresh,
    plan,
  });
  const plans = (roles: Parameters<typeof capAutoDrafts>[0]) =>
    capAutoDrafts(roles).map((r) => r.plan);

  it("drafts only the best-scoring eligible role; the others are held with a reason", () => {
    expect(plans([role(0, 75), role(1, 85)])).toEqual([another, draft]);
  });

  it("breaks a tie by the lowest position, and leaves a lone or held role alone", () => {
    expect(plans([role(0, 80), role(1, 80)])).toEqual([draft, another]);
    expect(plans([role(0, 80)])).toEqual([draft]);
    const held: ReplyPlan = { kind: "hold", heldBy: [{ kind: "below_threshold", reason: "Low" }] };
    expect(plans([role(0, 95, held), role(1, 75)])).toEqual([held, draft]);
  });

  it("lets a best role that waits on a question keep the place", () => {
    const ask: ReplyPlan = { kind: "ask", needs: [{ ...chfNeed, source: "match" }] };
    expect(plans([role(0, 90, ask), role(1, 80)])).toEqual([ask, another]);
  });

  it("drafts no other role once one had a draft or was dismissed", () => {
    const drafted: ReplyPlan = {
      kind: "hold",
      heldBy: [{ kind: "already_drafted", reason: "This role already had a draft" }],
    };
    for (const history of [
      { hadDraft: true, dismissed: false },
      { hadDraft: false, dismissed: true },
    ]) {
      expect(plans([{ ...role(0, 90, drafted), draftHistory: history }, role(1, 80)])).toEqual([
        drafted,
        another,
      ]);
    }
  });
});

describe("answers (F7.4)", () => {
  it("become one add Change of a single item with source decision; CHF keeps EUR", () => {
    const item = answerItem({ profileKey: "min_pay", groupKey: chfNeed.groupKey }, "CHF 120,000");
    expect(item).toEqual({
      amount: 120000,
      currency: "CHF",
      period: "year",
      asWritten: "CHF 120,000",
    });
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
      ["places", "places:IE:Dublin", "hybrid"],
      ["remote", "remote:EU", "EU"],
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
    expect(itemFromText("min_pay", "min_pay:CHF:year", "CHF 120k")).toMatchObject({
      amount: 120000,
    });
    expect(itemFromText("min_pay", "min_pay:CHF:year", "CHF 120.000")).toMatchObject({
      amount: 120000,
    });
    expect(itemFromText("min_pay", "min_pay:EUR:year", "€95,000")).toMatchObject({
      amount: 95000,
      currency: "EUR",
    });
  });
});
