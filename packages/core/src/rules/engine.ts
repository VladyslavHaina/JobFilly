import {
  type Category,
  type Condition,
  type ConditionValue,
  groupKeyFor,
  HARD_CONFLICT_CAP,
  type JobFacts,
  type MatchVerdict,
  type NeedSpec,
  type Pay,
  type PayThreshold,
  type Rule,
  type RuleAction,
  type RuleDraft,
  type RuleEffect,
  type RuleFact,
  type TimeZoneRange,
} from "@jobfilly/schema";
import { formatAmount, formatRange, norm, orList, rangeDisjoint, rangeWithin } from "./words";

// The rules engine (F3): whether each of a profile's rules holds for one role, with the outcome it
// causes and the rule that caused it. Pure: the same role, message fields and rules always give
// the same outcome.
//
// - A rule holds when every one of its conditions holds. A rule that is off is skipped.
// - A condition can only hold when its fact is known (F3.2). A rule with a condition whose fact
//   the mail doesn't state, and no condition that fails, is not applied, and says why: "time zone
//   not stated". `missing` is the one op that asks about an unknown fact, so it always decides.
// - Pay is compared only in the same currency and period (F4.3): pay in another one is unknown
//   ("different currency"), never converted.
// - A condition whose value can't test its fact (a time-zone range against a company name) never
//   holds.
// - Every outcome names the rule (F3.3): "Hidden by your rule "…"".

/** What the engine reads of one role: its facts, and the message fields rules may test. */
export interface RuleSubject {
  facts: JobFacts;
  /** The message's From address; rules on `sender.domain` read its domain. */
  senderAddress: string;
  category: Category | null;
}

type ConditionResult = { state: "holds" } | { state: "fails" } | { state: "unknown"; why: string };

export type RuleOutcome =
  | { state: "applies"; rule: Rule; effect: RuleEffect }
  | { state: "unknown"; rule: Rule; why: string }
  | { state: "not_applies"; rule: Rule };

/** A fact's value for one role: words, a list of words, a time-zone range, pay, or not stated. */
type FactValue =
  | { kind: "text"; value: string }
  | { kind: "list"; values: string[] }
  | { kind: "range"; value: TimeZoneRange }
  | { kind: "pay"; value: Pay }
  | { kind: "none" };

const NONE: FactValue = { kind: "none" };
const text = (value: string | null | undefined): FactValue =>
  value && value.trim() !== "" ? { kind: "text", value } : NONE;
const list = (values: readonly (string | null)[]): FactValue => {
  const known = [...new Set(values.filter((v): v is string => !!v && v.trim() !== ""))];
  return known.length > 0 ? { kind: "list", values: known } : NONE;
};

const extraKey = (fact: string) => fact.slice("extra.".length);

function factValue(fact: RuleFact, subject: RuleSubject): FactValue {
  const f = subject.facts;
  switch (fact) {
    case "places.country":
      return list(f.places.map((p) => p.country));
    case "workMode":
      return text(f.workMode);
    case "timeZones":
      return f.timeZones ? { kind: "range", value: f.timeZones } : NONE;
    case "pay":
      return f.pay ? { kind: "pay", value: f.pay } : NONE;
    case "contract":
      return text(f.contract);
    case "company":
      return text(f.company);
    case "agency":
      return text(f.agency?.name);
    case "sender.domain": {
      const at = subject.senderAddress.lastIndexOf("@");
      return at < 0 ? NONE : text(subject.senderAddress.slice(at + 1).toLowerCase());
    }
    case "category":
      return text(subject.category);
    case "skills":
      return list(f.skills);
    case "languages":
      return list(f.languages);
    default:
      return text(f.extra[extraKey(fact)]);
  }
}

/** The plain words of each fact, as rule descriptions and "not stated" reasons use them. */
function factLabel(fact: RuleFact): { label: string; plural: boolean } {
  switch (fact) {
    case "places.country":
      return { label: "country", plural: false };
    case "workMode":
      return { label: "work mode", plural: false };
    case "timeZones":
      return { label: "hours", plural: true };
    case "pay":
      return { label: "pay", plural: false };
    case "contract":
      return { label: "contract", plural: false };
    case "company":
      return { label: "company", plural: false };
    case "agency":
      return { label: "agency", plural: false };
    case "sender.domain":
      return { label: "sender's domain", plural: false };
    case "category":
      return { label: "category", plural: false };
    case "skills":
      return { label: "skills", plural: true };
    case "languages":
      return { label: "languages", plural: true };
    default:
      return { label: extraKey(fact).replace(/[-_]+/g, " "), plural: false };
  }
}

/** Why a condition on a fact the mail doesn't state isn't applied: "time zone not stated". */
const NOT_STATED: Record<string, string> = {
  "places.country": "country not stated",
  workMode: "work mode not stated",
  timeZones: "time zone not stated",
  pay: "pay not stated",
  contract: "contract not stated",
  company: "company not stated",
  agency: "agency not stated",
  "sender.domain": "sender's domain not known",
  category: "category not known",
  skills: "skills not stated",
  languages: "languages not stated",
};

function notStated(fact: RuleFact): string {
  return NOT_STATED[fact] ?? `${factLabel(fact).label} not stated`;
}

const isWords = (v: ConditionValue): v is string[] => Array.isArray(v);
const isRange = (v: ConditionValue): v is TimeZoneRange =>
  typeof v === "object" && v !== null && !Array.isArray(v) && "from" in v;
const isPayThreshold = (v: ConditionValue): v is PayThreshold =>
  typeof v === "object" && v !== null && !Array.isArray(v) && "amount" in v;

const FAILS: ConditionResult = { state: "fails" };
const HOLDS: ConditionResult = { state: "holds" };
const when = (holds: boolean): ConditionResult => (holds ? HOLDS : FAILS);

/**
 * Pay against a threshold, only in the same currency and period (F4.3): below when even the
 * highest pay offered is under the threshold. A minimum alone ("from €50k", as the inbox shows it)
 * leaves the top open, and an open top is never guessed: a minimum under the threshold is unknown
 * ("highest pay not stated"), one at or over it is not below.
 */
export function comparePay(
  pay: Pay,
  threshold: Pick<PayThreshold, "amount" | "currency" | "period">,
) {
  if (!pay.currency) return { state: "unknown" as const, why: "pay currency not stated" };
  if (!pay.period) return { state: "unknown" as const, why: "pay period not stated" };
  if (pay.currency !== threshold.currency) {
    return { state: "unknown" as const, why: "different currency" };
  }
  if (pay.period !== threshold.period)
    return { state: "unknown" as const, why: "different period" };
  if (pay.max !== null) return { state: "known" as const, below: pay.max < threshold.amount };
  if (pay.min === null) return { state: "unknown" as const, why: "pay amount not stated" };
  if (pay.min >= threshold.amount) return { state: "known" as const, below: false };
  return { state: "unknown" as const, why: "highest pay not stated" };
}

function wordsCondition(op: Condition["op"], fact: FactValue, words: string[]): ConditionResult {
  const wanted = words.map(norm);
  if (fact.kind === "text") {
    const value = norm(fact.value);
    const isOne = wanted.includes(value);
    if (op === "in" || op === "equals") return when(isOne);
    if (op === "not_in") return when(!isOne);
    if (op === "contains") return when(wanted.some((w) => w !== "" && value.includes(w)));
    return FAILS;
  }
  if (fact.kind === "list") {
    const values = fact.values.map(norm);
    const anyIn = values.some((v) => wanted.includes(v));
    if (op === "in" || op === "contains") return when(anyIn);
    if (op === "not_in") return when(!anyIn);
    if (op === "equals") {
      return when(
        values.every((v) => wanted.includes(v)) && wanted.every((w) => values.includes(w)),
      );
    }
    return FAILS;
  }
  return FAILS;
}

function numberCondition(op: Condition["op"], fact: FactValue, n: number): ConditionResult {
  if (fact.kind !== "text") return FAILS;
  const value = Number(fact.value.trim().replace(/,/g, ""));
  if (Number.isNaN(value)) return FAILS;
  if (op === "below") return when(value < n);
  if (op === "equals" || op === "in") return when(value === n);
  if (op === "not_in") return when(value !== n);
  return FAILS;
}

/** Whether one condition holds for the role, fails, or can't be told (its fact is unknown). */
export function evaluateCondition(condition: Condition, subject: RuleSubject): ConditionResult {
  const fact = factValue(condition.fact, subject);
  if (condition.op === "missing") return when(fact.kind === "none");
  if (fact.kind === "none") return { state: "unknown", why: notStated(condition.fact) };
  const { op, value } = condition;
  if (op === "within" || op === "outside") {
    if (fact.kind !== "range" || !isRange(value)) return FAILS;
    return when(
      op === "within" ? rangeWithin(fact.value, value) : rangeDisjoint(fact.value, value),
    );
  }
  if (op === "below") {
    if (fact.kind === "pay" && isPayThreshold(value)) {
      const compared = comparePay(fact.value, value);
      if (compared.state === "unknown") return compared;
      return when(compared.below);
    }
    if (typeof value === "number") return numberCondition(op, fact, value);
    return FAILS;
  }
  if (isWords(value)) return wordsCondition(op, fact, value);
  if (typeof value === "number") return numberCondition(op, fact, value);
  return FAILS;
}

// Plain words (F3.1).

const ACTION_LEAD: Record<RuleAction, string> = {
  hide: "Hide roles",
  no_draft: "Don't draft replies to roles",
  ask_first: "Ask me before replying to roles",
  cap_score: `Cap the fit score at ${HARD_CONFLICT_CAP} for roles`,
};

function valueWords(value: ConditionValue): string {
  if (isWords(value)) return orList(value);
  if (isRange(value)) return formatRange(value);
  if (isPayThreshold(value)) return formatAmount(value.amount, value.currency, value.period);
  if (typeof value === "number") return String(value);
  return "";
}

function describeCondition(condition: Condition): string {
  const { label, plural } = factLabel(condition.fact);
  const is = plural ? "are" : "is";
  const isnt = plural ? "aren't" : "isn't";
  const v = valueWords(condition.value);
  switch (condition.op) {
    case "in":
      return plural ? `whose ${label} include ${v}` : `whose ${label} is ${v}`;
    case "not_in":
      return plural ? `whose ${label} don't include ${v}` : `whose ${label} isn't ${v}`;
    case "within":
      return `whose ${label} ${is} within ${v}`;
    case "outside":
      return `whose ${label} ${is} outside ${v}`;
    case "below":
      return `whose ${label} ${is} below ${v}`;
    case "contains":
      return plural ? `whose ${label} include ${v}` : `whose ${label} mentions ${v}`;
    case "equals":
      return plural ? `whose ${label} are exactly ${v}` : `whose ${label} is ${v}`;
    case "missing":
      return `whose ${label} ${isnt} stated`;
  }
}

/**
 * A rule in plain words, from its conditions and action: "Hide roles whose hours are outside
 * UTC−1 to UTC+3".
 */
export function describeRule(rule: Pick<RuleDraft, "when" | "then">): string {
  return `${ACTION_LEAD[rule.then]} ${rule.when.map(describeCondition).join(" and ")}`;
}

/** The words a rule is shown by: its own description, or else its plain words. */
export function ruleName(rule: Pick<RuleDraft, "description" | "when" | "then">): string {
  return rule.description.trim() || describeRule(rule);
}

/** The decision an ask_first rule raises: answered per message, never written to the profile. */
function askFirstNeed(rule: Rule, name: string): NeedSpec {
  return {
    groupKey: groupKeyFor("rule", [rule.id]),
    profileKey: null,
    question: `Reply to this role? Your rule "${name}" asks you first.`,
    choices: [
      { label: "Yes, draft a reply", value: "yes" },
      { label: "No, leave it", value: "no" },
    ],
  };
}

function effectReason(action: RuleAction, name: string): string {
  switch (action) {
    case "hide":
      return `Hidden by your rule "${name}"`;
    case "no_draft":
      return `No automatic reply, by your rule "${name}"`;
    case "ask_first":
      return `Asks you before a reply, by your rule "${name}"`;
    case "cap_score":
      return `Fit score capped at ${HARD_CONFLICT_CAP} by your rule "${name}"`;
  }
}

/** One rule against one role. A rule that is off never applies. */
export function evaluateRule(rule: Rule, subject: RuleSubject): RuleOutcome {
  if (!rule.enabled) return { state: "not_applies", rule };
  let unknown: string | null = null;
  for (const condition of rule.when) {
    const result = evaluateCondition(condition, subject);
    if (result.state === "fails") return { state: "not_applies", rule };
    if (result.state === "unknown") unknown ??= result.why;
  }
  if (unknown !== null) return { state: "unknown", rule, why: unknown };
  const name = ruleName(rule);
  return {
    state: "applies",
    rule,
    effect: {
      ruleId: rule.id,
      action: rule.then,
      reason: effectReason(rule.then, name),
      need: rule.then === "ask_first" ? askFirstNeed(rule, name) : null,
    },
  };
}

export interface RulesResult {
  /** What each rule that holds does to the role, in the rules' order. */
  effects: RuleEffect[];
  /** The first hide rule that holds, naming it; null when the role is shown. */
  hidden: { ruleId: string; reason: string } | null;
  /**
   * The rules that apply, as match verdicts: those that hold conflict (cap_score is a hard
   * conflict), those whose fact is unknown say why they aren't applied (F3.2).
   */
  verdicts: MatchVerdict[];
}

/** Every rule of the profile against one role, in the rules' order. */
export function evaluateRules(rules: readonly Rule[], subject: RuleSubject): RulesResult {
  const result: RulesResult = { effects: [], hidden: null, verdicts: [] };
  for (const rule of rules) {
    const outcome = evaluateRule(rule, subject);
    if (outcome.state === "not_applies") continue;
    if (outcome.state === "unknown") {
      result.verdicts.push({
        entryKey: null,
        ruleId: rule.id,
        verdict: "unknown",
        reason: `Your rule "${ruleName(rule)}" isn't applied: ${outcome.why}`,
        hard: false,
        need: null,
      });
      continue;
    }
    const { effect } = outcome;
    result.effects.push(effect);
    if (effect.action === "hide" && !result.hidden) {
      result.hidden = { ruleId: rule.id, reason: effect.reason };
    }
    result.verdicts.push({
      entryKey: null,
      ruleId: rule.id,
      verdict: "conflicts",
      reason: effect.reason,
      hard: effect.action === "cap_score",
      need: null,
    });
  }
  return result;
}
