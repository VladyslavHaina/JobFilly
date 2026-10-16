import {
  type Change,
  type ChangeLine,
  entryLabel,
  isListProfileKey,
  type ProfileItem,
  type ProfileKey,
  type ProfileSnapshot,
  type ProfileValue,
  type Rule,
  type RuleDraft,
} from "@jobfilly/schema";
import { describeRule, ruleName } from "../rules/engine";
import { formatAmount, formatRange } from "../rules/words";

// A proposal in plain words (F8.2) and the profile history's lines (F8.4): each entry and rule a
// list of changes touches, as it was and as it would be, and a summary of the changes. Every word
// of a value comes from the profile itself; only the labels and the joining words are the app's.

/** "recruiter_outreach" reads "Recruiter outreach". */
const categoryWords = (category: string) => {
  const words = category.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function itemWords(key: ProfileKey, item: ProfileItem): string {
  if (typeof item === "string") return key === "reply_to" ? categoryWords(item) : item;
  if (typeof item === "number") return String(item);
  if ("mode" in item) {
    return `${[item.city, item.country].filter(Boolean).join(", ")} (${item.mode})`;
  }
  if ("scope" in item) {
    return item.timeZones ? `${item.scope} (${formatRange(item.timeZones)})` : item.scope;
  }
  if ("amount" in item) return formatAmount(item.amount, item.currency, item.period);
  return item.country ? `${item.text} (${item.country})` : item.text;
}

/** A profile value in plain words: its items joined, "none" for an empty list. */
function valueWords(key: ProfileKey, value: ProfileValue): string {
  const items = (value as ProfileItem[]).map((item) => itemWords(key, item));
  return items.length > 0 ? items.join("; ") : "none";
}

/** A rule in plain words, with "(off)" when it is switched off. */
function ruleWords(rule: Pick<Rule, "description" | "when" | "then" | "enabled">): string {
  return `${ruleName(rule)}${rule.enabled ? "" : " (off)"}`;
}

/**
 * One line per entry and rule the snapshots name, before and after in plain words; null where
 * it doesn't exist. `before` and `after` are applyChanges' snapshots, which name the same entries
 * and rules in the same order.
 */
export function changeLines(before: ProfileSnapshot, after: ProfileSnapshot): ChangeLine[] {
  const entries = before.entries.map(({ key, value }): ChangeLine => {
    const next = after.entries.find((e) => e.key === key)?.value ?? null;
    return {
      target: "entry",
      label: entryLabel(key),
      before: value === null ? null : valueWords(key, value),
      after: next === null ? null : valueWords(key, next),
    };
  });
  const rules = before.rules.map(({ id, rule }): ChangeLine => {
    const next = after.rules.find((r) => r.id === id)?.rule ?? null;
    return {
      target: "rule",
      label: "Rule",
      before: rule === null ? null : ruleWords(rule),
      after: next === null ? null : ruleWords(next),
    };
  });
  return [...entries, ...rules];
}

/** One change in plain words; `rules` are the profile's rules now, to name a changed one. */
function changeWords(change: Change, rules: readonly Rule[]): string {
  if (change.target === "rule") {
    if (change.op === "add") return ruleWords(change.rule);
    const current = rules.find((r) => r.id === change.ruleId);
    const name = current ? ruleName(current) : "a rule that is gone";
    if (change.op === "remove") return `Remove the rule "${name}"`;
    const onlySwitched =
      current !== undefined &&
      sameRule(current, change.rule) &&
      current.description === change.rule.description &&
      current.enabled !== change.rule.enabled;
    if (onlySwitched) {
      return `${change.rule.enabled ? "Switch on" : "Switch off"} the rule "${name}"`;
    }
    return `Change the rule "${name}" to "${ruleWords(change.rule)}"`;
  }
  const label = entryLabel(change.key);
  if (change.op === "remove") {
    return change.value === null
      ? `Clear ${label}`
      : `Remove ${valueWords(change.key, change.value)} from ${label}`;
  }
  if (change.op === "add" && isListProfileKey(change.key)) {
    return `Add ${valueWords(change.key, change.value)} to ${label}`;
  }
  return `Set ${label} to ${valueWords(change.key, change.value)}`;
}

/** The changes in plain words, as a proposal's summary once the user edited it. */
export function changeSummary(changes: readonly Change[], rules: readonly Rule[]): string {
  return changes.map((c) => changeWords(c, rules)).join("; ");
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A proposal's summary after an edit of its changes (F8.2): the model's own words while the
 * changes are as proposed, else the edited changes in plain words.
 */
export function editedSummary(
  proposal: { summary: string; changes: readonly Change[] },
  changes: readonly Change[],
  rules: readonly Rule[],
): string {
  return same(changes, proposal.changes) ? proposal.summary : changeSummary(changes, rules);
}

/** Whether two rules have the same conditions and action (and so the same plain words). */
function sameRule(a: Pick<RuleDraft, "when" | "then">, b: Pick<RuleDraft, "when" | "then">) {
  return same(a.when, b.when) && a.then === b.then;
}

/**
 * The model's changes as a proposal is first stored (F3.1, F8.2): each rule it adds or changes
 * described in plain words from its conditions and action, as an edit rewords them, so the card
 * never shows words that say something else than the rule does. An update that keeps a rule's
 * conditions and action (switching it on or off) keeps its words.
 */
export function rewordProposed(changes: readonly Change[], rules: readonly Rule[]): Change[] {
  return changes.map((change) => {
    if (change.target !== "rule" || change.op === "remove") return change;
    const current = change.op === "update" ? rules.find((r) => r.id === change.ruleId) : undefined;
    if (current && sameRule(current, change.rule)) return change;
    return { ...change, rule: { ...change.rule, description: describeRule(change.rule) } };
  });
}

/**
 * The edited changes of a proposal card (F8.2), with each rule's description reworded when the
 * edit changed its conditions or action but kept the old words: "UTC+5 or later" edited to
 * UTC+4 must not keep saying UTC+5. A description the user rewrote is kept.
 */
export function rewordEdited(original: readonly Change[], edited: readonly Change[]): Change[] {
  return edited.map((change, i) => {
    const was = original[i];
    if (change.target !== "rule" || change.op === "remove") return change;
    if (was?.target !== "rule" || was.op === "remove") return change;
    const keptWords = change.rule.description.trim() === was.rule.description.trim();
    if (!keptWords || sameRule(change.rule, was.rule)) return change;
    return { ...change, rule: { ...change.rule, description: describeRule(change.rule) } };
  });
}
