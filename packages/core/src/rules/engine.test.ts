import {
  type Condition,
  type ConditionValue,
  type JobFacts,
  RULE_FACTS,
  RULE_OPS,
  type Rule,
  type RuleAction,
  type RuleFact,
  type RuleOp,
} from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import {
  describeRule,
  evaluateCondition,
  evaluateRule,
  evaluateRules,
  type RuleSubject,
  ruleName,
} from "./engine";
import { formatRange } from "./words";

// The rules engine (F3.1–F3.3): plain words, the same outcome for the same input naming the rule,
// a rule never applied on a fact the mail doesn't state, and every op against every fact.

const facts = (overrides: Partial<JobFacts> = {}): JobFacts => ({
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

/** A role whose every fact is stated. */
const known: RuleSubject = {
  facts: facts({
    title: "Senior Backend Engineer",
    company: "Nordlicht Payments",
    agency: { name: "Hays", client: "Nordlicht Payments" },
    places: [{ country: "DE", city: "Berlin" }],
    workMode: "hybrid",
    timeZones: { from: "UTC+01:00", to: "UTC+02:00" },
    pay: { min: 80000, max: 95000, currency: "EUR", period: "year", asWritten: "€80–95k a year" },
    contract: "Permanent",
    skills: ["Go", "PostgreSQL"],
    languages: ["English", "German"],
    extra: { relocation: "Dublin later", team_size: "12" },
  }),
  senderAddress: "Jobs@Nordlicht.example",
  category: "recruiter_outreach",
};

/** A role the mail says nothing about. */
const unknown: RuleSubject = { facts: facts(), senderAddress: "x@y.example", category: null };

let n = 0;
const rule = (
  when: Condition[],
  then: RuleAction = "hide",
  overrides: Partial<Rule> = {},
): Rule => {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    profileId: "00000000-0000-4000-8000-0000000000ff",
    description: "",
    when,
    then,
    enabled: true,
    source: "you",
    createdAt: "2026-10-15T12:00:00.000Z",
    createdBy: null,
    ...overrides,
  };
};

const outsideEu: Condition = {
  fact: "timeZones",
  op: "outside",
  value: { from: "UTC-01:00", to: "UTC+03:00" },
};

describe("rules in plain words (F3.1)", () => {
  it("describes a time-zone rule the way the spec words it", () => {
    expect(describeRule({ when: [outsideEu], then: "hide" })).toBe(
      "Hide roles whose hours are outside UTC−1 to UTC+3",
    );
  });

  it.each<[Condition[], RuleAction, string]>([
    [
      [{ fact: "places.country", op: "in", value: ["SG", "CN"] }],
      "no_draft",
      "Don't draft replies to roles whose country is SG or CN",
    ],
    [
      [{ fact: "pay", op: "below", value: { amount: 100000, currency: "CHF", period: "year" } }],
      "cap_score",
      "Cap the fit score at 40 for roles whose pay is below CHF 100,000 per year",
    ],
    [
      [
        { fact: "workMode", op: "equals", value: ["onsite"] },
        { fact: "skills", op: "contains", value: ["PHP"] },
      ],
      "ask_first",
      "Ask me before replying to roles whose work mode is onsite and whose skills include PHP",
    ],
    [
      [{ fact: "timeZones", op: "missing", value: null }],
      "hide",
      "Hide roles whose hours aren't stated",
    ],
    [
      [{ fact: "extra.on_call", op: "contains", value: ["weekends"] }],
      "hide",
      "Hide roles whose on call mentions weekends",
    ],
    [
      [{ fact: "sender.domain", op: "not_in", value: ["agency.example"] }],
      "hide",
      "Hide roles whose sender's domain isn't agency.example",
    ],
  ])("describes %j", (when, then, words) => {
    expect(describeRule({ when, then })).toBe(words);
  });

  it("shows a rule by its own description, or its plain words when it has none", () => {
    expect(ruleName(rule([outsideEu], "hide", { description: "No Asian hours" }))).toBe(
      "No Asian hours",
    );
    expect(ruleName(rule([outsideEu]))).toBe("Hide roles whose hours are outside UTC−1 to UTC+3");
  });

  it("writes ranges the short way", () => {
    expect(formatRange({ from: "UTC+08:00", to: "UTC+08:00" })).toBe("UTC+8");
    expect(formatRange({ from: "UTC+03:00", to: "UTC-01:00" })).toBe("UTC−1 to UTC+3");
  });
});

describe("the outcome of a rule (F3.2, F3.3)", () => {
  it("is the same for the same input, and names the rule", () => {
    const asian = { from: "UTC+08:00", to: "UTC+10:00" };
    const subject = { ...known, facts: { ...known.facts, timeZones: asian } };
    const hide = rule([outsideEu], "hide", { description: "No Asian hours" });
    const first = evaluateRules([hide], subject);
    expect(evaluateRules([hide], JSON.parse(JSON.stringify(subject)))).toEqual(first);
    expect(first).toEqual({
      effects: [
        {
          ruleId: hide.id,
          action: "hide",
          reason: 'Hidden by your rule "No Asian hours"',
          need: null,
        },
      ],
      hidden: { ruleId: hide.id, reason: 'Hidden by your rule "No Asian hours"' },
      verdicts: [
        {
          entryKey: null,
          ruleId: hide.id,
          verdict: "conflicts",
          reason: 'Hidden by your rule "No Asian hours"',
          hard: false,
          need: null,
        },
      ],
    });
  });

  it("doesn't hide a role with no stated time zone, and says why", () => {
    const hide = rule([outsideEu]);
    const result = evaluateRules([hide], unknown);
    expect(result.effects).toEqual([]);
    expect(result.hidden).toBeNull();
    expect(result.verdicts).toEqual([
      {
        entryKey: null,
        ruleId: hide.id,
        verdict: "unknown",
        reason: `Your rule "${describeRule(hide)}" isn't applied: time zone not stated`,
        hard: false,
        need: null,
      },
    ]);
  });

  it("doesn't apply a rule with a failing condition, even when another fact is unknown", () => {
    const both = rule([outsideEu, { fact: "workMode", op: "equals", value: ["onsite"] }]);
    const subject = { ...unknown, facts: facts({ workMode: "remote" }) };
    expect(evaluateRule(both, subject)).toEqual({ state: "not_applies", rule: both });
    expect(evaluateRules([both], subject).verdicts).toEqual([]);
  });

  it("skips a rule that is off", () => {
    const off = rule([{ fact: "workMode", op: "in", value: ["hybrid"] }], "hide", {
      enabled: false,
    });
    expect(evaluateRules([off], known)).toEqual({ effects: [], hidden: null, verdicts: [] });
  });

  it("gives each action its effect: hide, no_draft, ask_first with a need, cap_score", () => {
    const hybrid: Condition = { fact: "workMode", op: "in", value: ["hybrid"] };
    const hide = rule([hybrid], "hide", { description: "No hybrid" });
    const noDraft = rule([hybrid], "no_draft", { description: "No hybrid drafts" });
    const ask = rule([hybrid], "ask_first", { description: "Hybrid: ask me" });
    const capScore = rule([hybrid], "cap_score", { description: "Hybrid is worse" });
    const secondHide = rule([hybrid], "hide", { description: "Another hide" });
    const result = evaluateRules([hide, noDraft, ask, capScore, secondHide], known);
    expect(result.effects).toEqual([
      { ruleId: hide.id, action: "hide", reason: 'Hidden by your rule "No hybrid"', need: null },
      {
        ruleId: noDraft.id,
        action: "no_draft",
        reason: 'No automatic reply, by your rule "No hybrid drafts"',
        need: null,
      },
      {
        ruleId: ask.id,
        action: "ask_first",
        reason: 'Asks you before a reply, by your rule "Hybrid: ask me"',
        need: {
          groupKey: `rule:${ask.id}`,
          profileKey: null,
          question: 'Reply to this role? Your rule "Hybrid: ask me" asks you first.',
          choices: [
            { label: "Yes, draft a reply", value: "yes" },
            { label: "No, leave it", value: "no" },
          ],
        },
      },
      {
        ruleId: capScore.id,
        action: "cap_score",
        reason: 'Fit score capped at 40 by your rule "Hybrid is worse"',
        need: null,
      },
      {
        ruleId: secondHide.id,
        action: "hide",
        reason: 'Hidden by your rule "Another hide"',
        need: null,
      },
    ]);
    // The first hide rule names why the role is hidden.
    expect(result.hidden).toEqual({ ruleId: hide.id, reason: 'Hidden by your rule "No hybrid"' });
    expect(result.verdicts.map((v) => [v.ruleId, v.verdict, v.hard])).toEqual([
      [hide.id, "conflicts", false],
      [noDraft.id, "conflicts", false],
      [ask.id, "conflicts", false],
      [capScore.id, "conflicts", true],
      [secondHide.id, "conflicts", false],
    ]);
  });
});

// Every op against every fact. For each fact: words that hold for the known role and words
// that don't (a list fact is matched as a whole by equals, so its hit is the whole list).
const WORDS: Record<Exclude<RuleFact, "timeZones" | "pay">, { hit: string[]; miss: string[] }> = {
  "places.country": { hit: ["de"], miss: ["SG"] },
  workMode: { hit: ["Hybrid"], miss: ["onsite"] },
  contract: { hit: ["permanent"], miss: ["freelance"] },
  company: { hit: ["nordlicht payments"], miss: ["Initech"] },
  agency: { hit: ["HAYS"], miss: ["Randstad"] },
  "sender.domain": { hit: ["nordlicht.example"], miss: ["agency.example"] },
  category: { hit: ["recruiter_outreach"], miss: ["job_alert"] },
  skills: { hit: ["go", "PostgreSQL"], miss: ["PHP"] },
  languages: { hit: ["english", "German"], miss: ["French"] },
  "extra.relocation": { hit: ["dublin later"], miss: ["never"] },
};

const RANGE_VALUE = { from: "UTC+00:00", to: "UTC+03:00" };
const PAY_VALUE = { amount: 100000, currency: "EUR", period: "year" as const };

type Expected = "holds" | "fails" | "unknown";

function wordsExpected(op: RuleOp, hit: boolean): Expected {
  if (op === "missing") return "fails";
  if (op === "within" || op === "outside" || op === "below") return "fails";
  if (op === "not_in") return hit ? "fails" : "holds";
  return hit ? "holds" : "fails";
}

const NOT_STATED: Record<RuleFact, string> = {
  "places.country": "country not stated",
  workMode: "work mode not stated",
  timeZones: "time zone not stated",
  pay: "pay not stated",
  contract: "contract not stated",
  company: "company not stated",
  agency: "agency not stated",
  "sender.domain": "",
  category: "category not known",
  skills: "skills not stated",
  languages: "languages not stated",
  "extra.relocation": "relocation not stated",
};

const state = (c: Condition, s: RuleSubject) => evaluateCondition(c, s);

describe("every op against every fact", () => {
  const allFacts = [...RULE_FACTS, "extra.relocation"] as RuleFact[];

  for (const fact of allFacts.filter((f) => f !== "timeZones" && f !== "pay")) {
    const words = WORDS[fact as keyof typeof WORDS] as { hit: string[]; miss: string[] };
    for (const op of RULE_OPS) {
      it(`${fact} ${op}`, () => {
        if (op === "missing") {
          expect(state({ fact, op, value: null }, known)).toEqual({ state: "fails" });
          const expected = fact === "sender.domain" ? "fails" : "holds";
          expect(state({ fact, op, value: null }, unknown)).toEqual({ state: expected });
          return;
        }
        const value: ConditionValue =
          op === "within" || op === "outside" ? RANGE_VALUE : op === "below" ? PAY_VALUE : null;
        const hitValue = value ?? words.hit;
        const missValue = value ?? words.miss;
        expect(state({ fact, op, value: hitValue }, known)).toEqual({
          state: wordsExpected(op, true),
        });
        expect(state({ fact, op, value: missValue }, known)).toEqual({
          state: wordsExpected(op, false),
        });
        if (fact === "sender.domain") {
          // Always known: the message has a From address.
          expect(state({ fact, op, value: ["y.example"] }, unknown).state).not.toBe("unknown");
        } else {
          expect(state({ fact, op, value: hitValue }, unknown)).toEqual({
            state: "unknown",
            why: NOT_STATED[fact],
          });
        }
      });
    }
  }

  it("compares text by containing and lists by item", () => {
    expect(state({ fact: "company", op: "contains", value: ["licht"] }, known).state).toBe("holds");
    // A list item must be the word itself: "Go" is no "Golang", "Java" no "JavaScript".
    expect(state({ fact: "skills", op: "contains", value: ["G"] }, known).state).toBe("fails");
    expect(state({ fact: "skills", op: "in", value: ["php", "go"] }, known).state).toBe("holds");
    expect(state({ fact: "skills", op: "equals", value: ["Go"] }, known).state).toBe("fails");
  });

  it.each<[RuleOp, ConditionValue, Expected]>([
    ["within", { from: "UTC+00:00", to: "UTC+03:00" }, "holds"],
    ["within", { from: "UTC+02:00", to: "UTC+05:00" }, "fails"],
    ["outside", { from: "UTC+05:00", to: "UTC+14:00" }, "holds"],
    ["outside", { from: "UTC+02:00", to: "UTC+05:00" }, "fails"],
    ["outside", { from: "UTC-01:00", to: "UTC+03:00" }, "fails"],
    ["in", ["UTC+01:00"], "fails"],
    ["not_in", ["UTC+01:00"], "fails"],
    ["contains", ["UTC"], "fails"],
    ["equals", ["UTC+01:00"], "fails"],
    ["below", PAY_VALUE, "fails"],
  ])("timeZones %s %j", (op, value, expected) => {
    expect(state({ fact: "timeZones", op, value }, known)).toEqual({ state: expected });
    expect(state({ fact: "timeZones", op, value }, unknown)).toEqual({
      state: "unknown",
      why: "time zone not stated",
    });
  });

  it("timeZones missing", () => {
    expect(state({ fact: "timeZones", op: "missing", value: null }, known).state).toBe("fails");
    expect(state({ fact: "timeZones", op: "missing", value: null }, unknown).state).toBe("holds");
  });

  it.each<[RuleOp, ConditionValue, Expected | string]>([
    ["below", { amount: 100000, currency: "EUR", period: "year" }, "holds"],
    ["below", { amount: 95000, currency: "EUR", period: "year" }, "fails"],
    ["below", { amount: 100000, currency: "CHF", period: "year" }, "different currency"],
    ["below", { amount: 9000, currency: "EUR", period: "month" }, "different period"],
    ["below", 100000, "fails"],
    ["in", ["EUR"], "fails"],
    ["not_in", ["EUR"], "fails"],
    ["contains", ["80"], "fails"],
    ["equals", ["EUR"], "fails"],
    ["within", RANGE_VALUE, "fails"],
    ["outside", RANGE_VALUE, "fails"],
  ])("pay %s %j", (op, value, expected) => {
    const result = state({ fact: "pay", op, value }, known);
    if (expected === "holds" || expected === "fails") expect(result).toEqual({ state: expected });
    else expect(result).toEqual({ state: "unknown", why: expected });
    expect(state({ fact: "pay", op, value }, unknown)).toEqual({
      state: "unknown",
      why: "pay not stated",
    });
  });

  it("pay missing, and pay without a currency, period or amount", () => {
    expect(state({ fact: "pay", op: "missing", value: null }, known).state).toBe("fails");
    expect(state({ fact: "pay", op: "missing", value: null }, unknown).state).toBe("holds");
    const pay = (p: Partial<NonNullable<JobFacts["pay"]>>) => ({
      ...unknown,
      facts: facts({
        pay: { min: null, max: null, currency: "EUR", period: "year", asWritten: "", ...p },
      }),
    });
    const below: Condition = { fact: "pay", op: "below", value: PAY_VALUE };
    expect(state(below, pay({ currency: null }))).toEqual({
      state: "unknown",
      why: "pay currency not stated",
    });
    expect(state(below, pay({ period: null }))).toEqual({
      state: "unknown",
      why: "pay period not stated",
    });
    expect(state(below, pay({}))).toEqual({ state: "unknown", why: "pay amount not stated" });
    // Only a minimum stated ("from …"): the top is open, so it is below only when known to be.
    expect(state(below, pay({ min: 90000 }))).toEqual({
      state: "unknown",
      why: "highest pay not stated",
    });
    expect(state(below, pay({ min: PAY_VALUE.amount })).state).toBe("fails");
    expect(state(below, pay({ min: 200000 })).state).toBe("fails");
    // Only a maximum stated ("up to …"): that is the top.
    expect(state(below, pay({ max: 90000 })).state).toBe("holds");
    expect(state(below, pay({ max: 200000 })).state).toBe("fails");
  });

  it("compares numbers with extra facts written as numbers", () => {
    expect(state({ fact: "extra.team_size", op: "below", value: 20 }, known).state).toBe("holds");
    expect(state({ fact: "extra.team_size", op: "below", value: 10 }, known).state).toBe("fails");
    expect(state({ fact: "extra.team_size", op: "equals", value: 12 }, known).state).toBe("holds");
    expect(state({ fact: "extra.relocation", op: "below", value: 3 }, known).state).toBe("fails");
  });
});
