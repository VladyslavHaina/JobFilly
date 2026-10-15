import type { Change, ProfileEntry, Rule, RuleDraft } from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { answeredFor, applyChanges, type ChangeContext, restoreChanges } from "./changes";

const at = "2026-10-15T12:00:00.000Z";
const PROFILE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const eur = {
  amount: 70000,
  currency: "EUR",
  period: "year" as const,
  asWritten: "€70,000 a year",
};
const chf = { amount: 120000, currency: "CHF", period: "year" as const, asWritten: "CHF 120,000" };
const chfMonth = { ...chf, amount: 10000, period: "month" as const, asWritten: "CHF 10k/month" };

const entry = (key: ProfileEntry["key"], value: ProfileEntry["value"]): ProfileEntry => ({
  key,
  label: `label of ${key}`,
  value,
  confidence: "high",
  evidence: [{ messageId: "<r@inbox.example>", reason: "your reply" }],
  source: "scan",
  updatedAt: "2026-09-01T00:00:00.000Z",
  updatedBy: null,
});

const maria = {
  entries: [entry("min_pay", [eur]), entry("places", []), entry("extra.relocate", ["No"])],
  rules: [] as Rule[],
};

let ids = 0;
const ctx = (source: ChangeContext["source"] = "decision"): ChangeContext => ({
  profileId: PROFILE,
  source,
  userId: USER,
  at,
  newRuleId: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++ids).padStart(12, "0")}`,
});

const entryValue = (result: ReturnType<typeof applyChanges>, key: string) =>
  result.ok ? result.entries.find((e) => e.key === key)?.value : undefined;

describe("add on a list key (TBD-195)", () => {
  it("appends to min_pay, so the EUR and the CHF minimum are both kept", () => {
    const result = applyChanges(
      maria,
      [{ op: "add", target: "entry", key: "min_pay", value: [chf] }],
      ctx(),
    );
    expect(entryValue(result, "min_pay")).toEqual([eur, chf]);
    if (!result.ok) throw new Error("expected ok");
    expect(result.entries.find((e) => e.key === "min_pay")).toMatchObject({
      source: "decision",
      updatedBy: USER,
      updatedAt: at,
      confidence: null,
      evidence: maria.entries[0]?.evidence,
    });
    expect(result.before).toEqual({ entries: [{ key: "min_pay", value: [eur] }], rules: [] });
    expect(result.after).toEqual({ entries: [{ key: "min_pay", value: [eur, chf] }], rules: [] });
  });

  it("leaves the list as it is when the item is already there", () => {
    const result = applyChanges(
      maria,
      [{ op: "add", target: "entry", key: "min_pay", value: [eur] }],
      ctx(),
    );
    expect(result.ok && result.entries).toEqual(maria.entries);
    expect(result.ok && result.after).toEqual(result.ok && result.before);
  });

  it("creates a missing key's entry, with its label", () => {
    const result = applyChanges(
      maria,
      [{ op: "add", target: "entry", key: "deal_breakers", value: ["night shifts"] }],
      ctx("assistant"),
    );
    expect(result.ok && result.entries.at(-1)).toMatchObject({
      key: "deal_breakers",
      label: "Deal-breakers",
      value: ["night shifts"],
      source: "assistant",
      evidence: [],
    });
    expect(result.ok && result.before.entries).toEqual([{ key: "deal_breakers", value: null }]);
  });

  it("sets a scalar key (a policy key, an extra question) instead of appending", () => {
    const result = applyChanges(
      maria,
      [
        { op: "add", target: "entry", key: "extra.relocate", value: ["Yes"] },
        { op: "add", target: "entry", key: "reply_threshold", value: [80] },
      ],
      ctx(),
    );
    expect(entryValue(result, "extra.relocate")).toEqual(["Yes"]);
    expect(entryValue(result, "reply_threshold")).toEqual([80]);
  });
});

describe("update and remove", () => {
  it("update replaces the whole value", () => {
    const result = applyChanges(
      maria,
      [{ op: "update", target: "entry", key: "min_pay", value: [chf] }],
      ctx("you"),
    );
    expect(entryValue(result, "min_pay")).toEqual([chf]);
  });

  it("remove with a value removes that item; with null, the entry", () => {
    const both = { ...maria, entries: [entry("min_pay", [eur, chf]), ...maria.entries.slice(1)] };
    const one = applyChanges(
      both,
      [{ op: "remove", target: "entry", key: "min_pay", value: [eur] }],
      ctx(),
    );
    expect(entryValue(one, "min_pay")).toEqual([chf]);
    const gone = applyChanges(
      both,
      [{ op: "remove", target: "entry", key: "min_pay", value: null }],
      ctx(),
    );
    expect(gone.ok && gone.entries.map((e) => e.key)).toEqual(["places", "extra.relocate"]);
    expect(gone.ok && gone.after).toEqual({
      entries: [{ key: "min_pay", value: null }],
      rules: [],
    });
  });

  it("refuses a value that doesn't fit the key", () => {
    const result = applyChanges(
      maria,
      [{ op: "add", target: "entry", key: "min_pay", value: ["a lot"] } as Change],
      ctx(),
    );
    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_value", key: "min_pay" } });
  });
});

describe("rules", () => {
  const rule: RuleDraft = {
    description: "Hide roles whose hours are UTC+05:00 or later",
    when: [{ fact: "timeZones", op: "within", value: { from: "UTC+05:00", to: "UTC+14:00" } }],
    then: "hide",
    enabled: true,
  };

  it("adds a rule with a new id and the change's source; updates and removes it by id", () => {
    const added = applyChanges(maria, [{ op: "add", target: "rule", rule }], ctx("assistant"));
    if (!added.ok) throw new Error("expected ok");
    const [made] = added.rules;
    expect(made).toMatchObject({
      ...rule,
      profileId: PROFILE,
      source: "assistant",
      createdBy: USER,
      createdAt: at,
    });
    expect(added.before.rules).toEqual([{ id: made?.id, rule: null }]);

    const state = { entries: added.entries, rules: added.rules };
    const id = made?.id ?? "";
    const updated = applyChanges(
      state,
      [{ op: "update", target: "rule", ruleId: id, rule: { ...rule, enabled: false } }],
      ctx("you"),
    );
    expect(updated.ok && updated.rules[0]).toMatchObject({
      id,
      enabled: false,
      source: "assistant",
    });
    const removed = applyChanges(state, [{ op: "remove", target: "rule", ruleId: id }], ctx("you"));
    expect(removed.ok && removed.rules).toEqual([]);
    expect(applyChanges(maria, [{ op: "remove", target: "rule", ruleId: id }], ctx())).toEqual({
      ok: false,
      error: { kind: "unknown_rule", ruleId: id },
    });
  });

  it("restores a snapshot with the changes Undo applies", () => {
    const changes: Change[] = [
      { op: "add", target: "rule", rule },
      { op: "add", target: "entry", key: "min_pay", value: [chf] },
      { op: "add", target: "entry", key: "deal_breakers", value: ["travel"] },
    ];
    const applied = applyChanges(maria, changes, ctx("assistant"));
    if (!applied.ok) throw new Error("expected ok");
    const undo = restoreChanges(applied.before, { rules: applied.rules });
    const restored = applyChanges(
      { entries: applied.entries, rules: applied.rules },
      undo,
      ctx("you"),
    );
    if (!restored.ok) throw new Error("expected ok");
    expect(restored.rules).toEqual([]);
    expect(restored.entries.map((e) => [e.key, e.value])).toEqual(
      maria.entries.map((e) => [e.key, e.value]),
    );
  });
});

describe("answeredFor: already answered by group key (F7.6)", () => {
  it("doesn't take an EUR minimum for a CHF-per-year one; a CHF per-year item answers it", () => {
    expect(answeredFor(maria, "min_pay:CHF:year")).toBeNull();
    const withMonth = { entries: [entry("min_pay", [eur, chfMonth])] };
    expect(answeredFor(withMonth, "min_pay:CHF:year")).toBeNull();
    const withChf = { entries: [entry("min_pay", [eur, chf])] };
    expect(answeredFor(withChf, "min_pay:CHF:year")).toEqual(chf);
    expect(answeredFor(withChf, "min_pay:EUR:year")).toEqual(eur);
  });

  it("answers a group key without parts with any non-empty entry", () => {
    expect(answeredFor(maria, "extra.relocate")).toEqual(["No"]);
    expect(answeredFor(maria, "places")).toBeNull();
    expect(answeredFor(maria, "deal_breakers")).toBeNull();
  });

  it("matches words and objects by the parts the key names", () => {
    const profile = {
      entries: [
        entry("languages", ["German"]),
        entry("places", [{ country: "CH", city: "Zurich", mode: "hybrid" }]),
      ],
    };
    expect(answeredFor(profile, "languages:german")).toEqual("German");
    expect(answeredFor(profile, "places:CH")).toMatchObject({ city: "Zurich" });
    expect(answeredFor(profile, "places:IE")).toBeNull();
  });
});
