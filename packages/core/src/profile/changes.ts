import {
  type Change,
  CORE_PROFILE_LABELS,
  type CoreProfileKey,
  isExtraKey,
  isListProfileKey,
  isPolicyKey,
  POLICY_LABELS,
  type ProfileEntry,
  type ProfileItem,
  type ProfileKey,
  type ProfileSnapshot,
  type ProfileSource,
  type ProfileValue,
  parseGroupKey,
  profileValueSchema,
  type Rule,
  type RuleDraft,
  type RuleSource,
} from "@jobfilly/schema";
import { describeRule } from "../rules/engine";

// The semantics of a profile Change (TBD-195), pinned here and used by every writer through the
// profile change service: the profile form (update), a decision answer (add of one item), an
// applied assistant proposal, and Undo.
//
// - add on a list key (LIST_PROFILE_KEYS: every core key) appends the given items to the list
//   and never replaces it; an item equal to one already there is a no-op. Answering "CHF per
//   year" adds a CHF item to min_pay and keeps the EUR one.
// - add on any other key (a policy key, an extra question), or on a key the profile doesn't
//   have, sets the entry.
// - update replaces the whole value (created when missing).
// - remove with a value removes those items from the list; remove with null removes the entry.
// - rules are added (a new id), replaced (update, keeping id, source and creation) or removed;
//   a rule is never stored without plain words describing what it does (ruleWords).
//
// "Already answered" (F7.6) is decided by group key, never by profile key: answeredFor.

export interface ProfileContent {
  entries: readonly ProfileEntry[];
  rules: readonly Rule[];
}

export interface ChangeContext {
  profileId: string;
  source: Exclude<ProfileSource, "scan">;
  userId: string | null;
  /** ISO time of the change. */
  at: string;
  /** A fresh id for each added rule. */
  newRuleId: () => string;
}

export type ChangeError =
  | { kind: "invalid_value"; key: ProfileKey; message: string }
  | { kind: "unknown_rule"; ruleId: string };

export type AppliedChanges =
  | {
      ok: true;
      entries: ProfileEntry[];
      rules: Rule[];
      /** The entries and rules the changes touched, as they were and as they are now. */
      before: ProfileSnapshot;
      after: ProfileSnapshot;
    }
  | { ok: false; error: ChangeError };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function labelOf(key: ProfileKey): string {
  if (isPolicyKey(key)) return POLICY_LABELS[key];
  if (isExtraKey(key)) return key.slice("extra.".length);
  return CORE_PROFILE_LABELS[key as CoreProfileKey];
}

const RULE_SOURCE: Record<ChangeContext["source"], RuleSource> = {
  you: "you",
  decision: "decision",
  assistant: "assistant",
};

/**
 * The description a rule is stored with (F3.1): the one given, or its plain words from the
 * conditions when the given one is blank, or when an update changes the conditions or action but
 * keeps the old description, which would then describe a rule that is no longer there.
 */
function ruleWords(draft: RuleDraft, current: Rule | null): string {
  const given = draft.description.trim();
  if (given === "") return describeRule(draft);
  const reworded = current !== null && given !== current.description.trim();
  const sameRule =
    current === null || (same(draft.when, current.when) && draft.then === current.then);
  return sameRule || reworded ? draft.description : describeRule(draft);
}

/** Applies `changes` in order. Pure: the same input always gives the same output. */
export function applyChanges(
  content: ProfileContent,
  changes: readonly Change[],
  ctx: ChangeContext,
): AppliedChanges {
  const entries = new Map(content.entries.map((e) => [e.key, e]));
  const order = content.entries.map((e) => e.key);
  const rules = new Map(content.rules.map((r) => [r.id, r]));
  const ruleOrder = content.rules.map((r) => r.id);
  const touchedKeys: ProfileKey[] = [];
  const touchedRules: string[] = [];
  const before: ProfileSnapshot = { entries: [], rules: [] };

  const touchKey = (key: ProfileKey) => {
    if (touchedKeys.includes(key)) return;
    touchedKeys.push(key);
    before.entries.push({ key, value: entries.get(key)?.value ?? null });
  };
  const touchRule = (id: string) => {
    if (touchedRules.includes(id)) return;
    touchedRules.push(id);
    before.rules.push({ id, rule: rules.get(id) ?? null });
  };

  const setValue = (key: ProfileKey, value: ProfileValue): ChangeError | null => {
    const parsed = profileValueSchema(key).safeParse(value);
    if (!parsed.success) {
      return {
        kind: "invalid_value",
        key,
        message: parsed.error.issues[0]?.message ?? "invalid value",
      };
    }
    const current = entries.get(key);
    if (!current) order.push(key);
    entries.set(key, {
      key,
      label: current?.label ?? labelOf(key),
      value: parsed.data,
      confidence: null,
      evidence: current?.evidence ?? [],
      source: ctx.source,
      updatedAt: ctx.at,
      updatedBy: ctx.userId,
    });
    return null;
  };

  for (const change of changes) {
    if (change.target === "entry") {
      const { key } = change;
      const current = entries.get(key);
      touchKey(key);
      let error: ChangeError | null = null;
      if (change.op === "add") {
        if (current && isListProfileKey(key)) {
          const items = [...(current.value as unknown[])];
          for (const item of change.value as unknown[]) {
            if (!items.some((i) => same(i, item))) items.push(item);
          }
          if (items.length !== (current.value as unknown[]).length) {
            error = setValue(key, items as ProfileValue);
          }
        } else {
          error = setValue(key, change.value);
        }
      } else if (change.op === "update") {
        error = setValue(key, change.value);
      } else if (change.value === null) {
        if (current) {
          entries.delete(key);
          order.splice(order.indexOf(key), 1);
        }
      } else if (current) {
        const drop = change.value as unknown[];
        const items = (current.value as unknown[]).filter((i) => !drop.some((d) => same(d, i)));
        if (items.length !== (current.value as unknown[]).length) {
          error = setValue(key, items as ProfileValue);
        }
      }
      if (error) return { ok: false, error };
      continue;
    }
    if (change.op === "add") {
      const id = ctx.newRuleId();
      touchRule(id);
      rules.set(id, {
        ...change.rule,
        description: ruleWords(change.rule, null),
        id,
        profileId: ctx.profileId,
        source: RULE_SOURCE[ctx.source],
        createdAt: ctx.at,
        createdBy: ctx.userId,
      });
      ruleOrder.push(id);
      continue;
    }
    const current = rules.get(change.ruleId);
    if (!current) return { ok: false, error: { kind: "unknown_rule", ruleId: change.ruleId } };
    touchRule(change.ruleId);
    if (change.op === "update") {
      rules.set(change.ruleId, {
        ...current,
        ...change.rule,
        description: ruleWords(change.rule, current),
      });
    } else {
      rules.delete(change.ruleId);
      ruleOrder.splice(ruleOrder.indexOf(change.ruleId), 1);
    }
  }

  const after: ProfileSnapshot = {
    entries: touchedKeys.map((key) => ({ key, value: entries.get(key)?.value ?? null })),
    rules: touchedRules.map((id) => ({ id, rule: rules.get(id) ?? null })),
  };
  return {
    ok: true,
    entries: order.map((key) => entries.get(key) as ProfileEntry),
    rules: ruleOrder.map((id) => rules.get(id) as Rule),
    before,
    after,
  };
}

/** The changes that restore `snapshot` (Undo restores a history entry's `before`). */
export function restoreChanges(
  snapshot: ProfileSnapshot,
  current: Pick<ProfileContent, "rules">,
): Change[] {
  const changes: Change[] = snapshot.entries.map(({ key, value }) =>
    value === null
      ? { op: "remove", target: "entry", key, value: null }
      : { op: "update", target: "entry", key, value },
  );
  for (const { id, rule } of snapshot.rules) {
    const exists = current.rules.some((r) => r.id === id);
    if (rule === null) {
      if (exists) changes.push({ op: "remove", target: "rule", ruleId: id });
    } else {
      const draft = {
        description: rule.description,
        when: rule.when,
        then: rule.then,
        enabled: rule.enabled,
      };
      changes.push(
        exists
          ? { op: "update", target: "rule", ruleId: id, rule: draft }
          : { op: "add", target: "rule", rule: draft },
      );
    }
  }
  return changes;
}

/**
 * The fields of an item that a group key's parts name, per list key: "min_pay:CHF:year" is
 * answered by a min_pay item with currency CHF and period year. A key not listed here compares
 * its items (words) with the first part.
 */
const GROUP_PARTS: Partial<Record<CoreProfileKey, readonly string[]>> = {
  min_pay: ["currency", "period"],
  places: ["country", "city", "mode"],
  remote: ["scope"],
  work_permits: ["country"],
};

const norm = (v: unknown) => String(v ?? "").toLowerCase();

/**
 * What already answers a group key (F7.6), or null: for a key with parts, the first item whose
 * named fields equal the parts (an EUR minimum doesn't answer "min_pay:CHF:year"); for a key
 * without parts, a non-empty entry's whole value.
 */
export function answeredFor(
  profile: Pick<ProfileContent, "entries">,
  groupKey: string,
): ProfileItem | ProfileValue | null {
  const { profileKey, parts } = parseGroupKey(groupKey);
  const entry = profile.entries.find((e) => e.key === profileKey);
  const items = (entry?.value ?? []) as ProfileItem[];
  if (items.length === 0) return null;
  if (parts.length === 0) return entry?.value ?? null;
  const fields = GROUP_PARTS[profileKey as CoreProfileKey];
  const match = items.find((item) => {
    if (!fields || typeof item !== "object") return norm(item) === norm(parts[0]);
    return parts.every(
      (part, i) =>
        fields[i] !== undefined &&
        norm((item as Record<string, unknown>)[fields[i]]) === norm(part),
    );
  });
  return match ?? null;
}
