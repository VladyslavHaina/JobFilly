import { type Change, type Condition, type ConditionValue, formatOffset } from "@jobfilly/schema";

// Editing a proposal card before Apply (F8.2): every value a person can sensibly change is a
// text field (a rule's words, a time-zone range, a list of words, a number or an amount), held
// as the text typed and read back into Changes on Save. A UTC offset may be typed the way people
// write it ("UTC+4", "+5:30", "UTC−1").

export type RawFields = Record<string, string>;

const isRange = (v: ConditionValue): v is { from: string; to: string } =>
  typeof v === "object" && v !== null && !Array.isArray(v) && "from" in v;
const isAmount = (v: ConditionValue): v is { amount: number; currency: string; period: never } =>
  typeof v === "object" && v !== null && !Array.isArray(v) && "amount" in v;

/** What a condition's value is edited as. */
export type ValueField = "range" | "words" | "number" | "amount" | null;

export function valueField(value: ConditionValue): ValueField {
  if (value === null) return null;
  if (Array.isArray(value)) return "words";
  if (typeof value === "number") return "number";
  if (isRange(value)) return "range";
  return isAmount(value) ? "amount" : null;
}

/** "UTC+4", "+04:00", "utc −1:30" or "UTC" as the schema's "UTC+04:00"; null when it isn't one. */
export function parseOffset(text: string): string | null {
  const t = text.trim().replace(/\s+/g, "").replace("−", "-").toUpperCase();
  if (t === "UTC" || t === "0") return "UTC+00:00";
  const m = /^(?:UTC)?([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(t);
  if (!m) return null;
  const hours = Number(m[2]);
  const minutes = Number(m[3] ?? "0");
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes > 0)) return null;
  return `UTC${m[1]}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

const words = (list: readonly unknown[]) => list.map(String).join(", ");
const splitWords = (text: string) =>
  text
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);

/** Whether an entry's value is edited as words or as one number; other shapes aren't edited. */
export function entryField(value: unknown): "words" | "number" | null {
  if (!Array.isArray(value)) return null;
  if (value.every((v) => typeof v === "string")) return "words";
  if (value.length === 1 && typeof value[0] === "number") return "number";
  return null;
}

/** The text fields of a proposal's changes, keyed "<change>.<field>". */
export function rawFields(changes: readonly Change[]): RawFields {
  const raw: RawFields = {};
  changes.forEach((change, i) => {
    if (change.target === "rule") {
      if (change.op === "remove") return;
      raw[`${i}.description`] = change.rule.description;
      change.rule.when.forEach((c, j) => {
        const key = `${i}.when.${j}`;
        const v = c.value;
        if (v === null) return;
        if (Array.isArray(v)) raw[key] = words(v);
        else if (typeof v === "number") raw[key] = String(v);
        else if (isRange(v)) {
          raw[`${key}.from`] = formatOffset(v.from);
          raw[`${key}.to`] = formatOffset(v.to);
        } else if (isAmount(v)) raw[key] = String(v.amount);
      });
      return;
    }
    if (change.value === null) return;
    const field = entryField(change.value);
    if (field === "words") raw[`${i}.value`] = words(change.value);
    if (field === "number") raw[`${i}.value`] = String(change.value[0]);
  });
  return raw;
}

type Built = { ok: true; changes: Change[] } | { ok: false; error: string };

function number(text: string | undefined): number | null {
  if (text === undefined || text.trim() === "") return null;
  const n = Number(text.trim().replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function buildCondition(c: Condition, raw: RawFields, key: string): Condition | string {
  const v = c.value;
  switch (valueField(v)) {
    case "range": {
      const from = parseOffset(raw[`${key}.from`] ?? "");
      const to = parseOffset(raw[`${key}.to`] ?? "");
      if (!from || !to) return "Write each offset like UTC+4 or UTC−1:30.";
      return { ...c, value: { from, to } };
    }
    case "words": {
      const list = splitWords(raw[key] ?? "");
      return list.length > 0 ? { ...c, value: list } : "Give at least one value.";
    }
    case "number": {
      const n = number(raw[key]);
      return n === null ? "Give a number." : { ...c, value: n };
    }
    case "amount": {
      const n = number(raw[key]);
      return n === null || !isAmount(v) ? "Give an amount." : { ...c, value: { ...v, amount: n } };
    }
    default:
      return c;
  }
}

/** The changes with the typed values, or the first problem in plain words. */
export function buildChanges(changes: readonly Change[], raw: RawFields): Built {
  const out: Change[] = [];
  for (const [i, change] of changes.entries()) {
    if (change.target === "rule") {
      if (change.op === "remove") {
        out.push(change);
        continue;
      }
      const when: Condition[] = [];
      for (const [j, c] of change.rule.when.entries()) {
        const built = buildCondition(c, raw, `${i}.when.${j}`);
        if (typeof built === "string") return { ok: false, error: built };
        when.push(built);
      }
      const description = raw[`${i}.description`]?.trim() ?? change.rule.description;
      out.push({ ...change, rule: { ...change.rule, description, when } });
      continue;
    }
    const field = change.value === null ? null : entryField(change.value);
    if (field === "words") {
      out.push({ ...change, value: splitWords(raw[`${i}.value`] ?? "") });
    } else if (field === "number") {
      const n = number(raw[`${i}.value`]);
      if (n === null || !Number.isInteger(n)) return { ok: false, error: "Give a whole number." };
      out.push({ ...change, value: [n] });
    } else {
      out.push(change);
    }
  }
  return { ok: true, changes: out };
}
