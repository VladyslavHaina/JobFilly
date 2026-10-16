import {
  type Change,
  type CoreProfileKey,
  CoreProfileKeySchema,
  type DecisionChoice,
  groupKeyFor,
  isExtraKey,
  PROFILE_ITEM_SCHEMAS,
  type ProfileItem,
  type ProfileKey,
  ProfileKeySchema,
  type ProfileValue,
  parseGroupKey,
  profileItemSchema,
  turnsDown,
} from "@jobfilly/schema";
import { GROUP_PARTS } from "../profile/changes";
import {
  countriesIn,
  currenciesIn,
  isFieldWord,
  isNo,
  isYesWord,
  modesIn,
  otherCurrencySign,
  periodsIn,
  tokensOf,
} from "./words";

// A decision's answer (F7.4, TBD-195): the one profile item it adds, or a no that turns the
// question down for the messages waiting on it and writes nothing. A choice's item is taken as
// it is; the words of the free-text option are made into an item of the decision's key. The
// group key's parts say what the words don't: "min_pay:CHF:year" plus "120,000" is a CHF
// per-year minimum of 120000, as written. The words never contradict the parts: an answer that
// says no, or names another currency, period, country, work mode, city or scope than they do,
// is refused, so nothing the user turned down is ever written (F6.2, F7.6). Nothing is assumed
// beyond the key and the words; when they don't make an item, the answer is refused rather than
// guessed.

/** A number written in words of any locale: "120,000", "120.000", "120 000", "120k", "95'000". */
function amountOf(text: string): number | null {
  const m = /(\d[\d.,'’\s ]*)(\s*[kK]\b)?/.exec(text);
  if (!m?.[1]) return null;
  const digits = m[1].trim();
  if (m[2]) {
    const n = Number.parseFloat(digits.replace(/[\s'’ ]/g, "").replace(",", "."));
    return Number.isFinite(n) ? Math.round(n * 1000) : null;
  }
  const n = Number.parseInt(digits.replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

const parse = (key: ProfileKey, value: unknown): ProfileItem | null => {
  const result = profileItemSchema(key).safeParse(value);
  return result.success ? result.data : null;
};

const partFieldsOf = (profileKey: ProfileKey): readonly string[] | undefined =>
  GROUP_PARTS[profileKey as CoreProfileKey];

// Fields holding an ISO code, written upper case whatever the group key's case.
const CODE_FIELDS: ReadonlySet<string> = new Set(["country", "currency"]);
// Fields holding words, which an answer can only restate: other words may name another city or
// scope, and that can't be told apart from a yes.
const TEXT_FIELDS: ReadonlySet<string> = new Set(["city", "scope"]);

const norm = (v: unknown) => String(v ?? "").toLowerCase();

type FieldSchema = { safeParse(value: unknown): { success: boolean } };

/** The schemas of a core key's item fields, when its items are objects. */
function fieldSchemasOf(profileKey: ProfileKey): Record<string, FieldSchema> | null {
  const core = CoreProfileKeySchema.safeParse(profileKey);
  if (!core.success) return null;
  const schema = PROFILE_ITEM_SCHEMAS[core.data];
  return "shape" in schema ? (schema.shape as Record<string, FieldSchema>) : null;
}

/** Whether a group key part is a valid value of its field ("hybrid" is a mode, "remote" isn't). */
function partFits(profileKey: ProfileKey, field: string, part: string): boolean {
  const value = CODE_FIELDS.has(field) ? part.toUpperCase() : part;
  return fieldSchemasOf(profileKey)?.[field]?.safeParse(value).success === true;
}

/**
 * The fields of an item its group key's parts fill, as answeredFor compares them (GROUP_PARTS):
 * "places:IE:Dublin:hybrid" is country IE, city Dublin and mode hybrid.
 */
function fieldsFromParts(profileKey: ProfileKey, parts: readonly string[]) {
  const filled: Record<string, string> = {};
  (partFieldsOf(profileKey) ?? []).forEach((field, i) => {
    const part = parts[i];
    if (part) filled[field] = CODE_FIELDS.has(field) ? part.toUpperCase() : part;
  });
  return filled;
}

/** What the words name for a field a part may fill: a code, a pay period, a work mode. */
function namedIn(field: string, text: string): string[] {
  switch (field) {
    case "country":
      return countriesIn(text);
    case "currency":
      return currenciesIn(text);
    case "period":
      return periodsIn(text);
    case "mode":
      return modesIn(text);
    default:
      return [];
  }
}

/**
 * The parts completed from the words (a period, a mode, a code the parts leave out), or null
 * when the words contradict a part or name two values for one field.
 */
function complete(
  fields: readonly string[],
  parts: Record<string, string>,
  text: string,
): Record<string, string> | null {
  const out = { ...parts };
  for (const field of fields) {
    const named = namedIn(field, text);
    const part = parts[field];
    if (part !== undefined) {
      if (named.some((n) => norm(n) !== norm(part))) return null;
      if (field === "currency" && otherCurrencySign(text, part)) return null;
    } else if (named.length > 1) {
      return null;
    } else if (named[0] !== undefined) {
      out[field] = named[0];
    }
  }
  return out;
}

/** Whether every word is a yes, a part, a code, or a period or mode word: nothing else is said. */
function saysOnlyParts(text: string, filled: Record<string, string>): boolean {
  const own = new Set(Object.values(filled).flatMap((v) => tokensOf(v)));
  const codes = new Set([...countriesIn(text), ...currenciesIn(text)].map(norm));
  return tokensOf(text).every((t) => isYesWord(t) || own.has(t) || codes.has(t) || isFieldWord(t));
}

/** Whether the words name `value`: "Dublin" in "Hybrid in Dublin is fine". */
function restates(text: string, value: string): boolean {
  const want = tokensOf(value);
  const got = tokensOf(text);
  if (want.length === 0) return false;
  return got.some((_, i) => want.every((w, j) => got[i + j] === w));
}

/**
 * Whether the words agree with the parts' words (a city, a scope): they restate them, or say
 * nothing but a yes and the parts. "Cork" doesn't agree with Dublin, nor "Worldwide" with EU.
 */
function agrees(text: string, parts: Record<string, string>): boolean {
  const named = Object.entries(parts).filter(([field]) => TEXT_FIELDS.has(field));
  if (named.length === 0) return true;
  return saysOnlyParts(text, parts) || named.every(([, value]) => restates(text, value));
}

/**
 * The city of a place the parts don't name: none when the words name only the country and the
 * mode ("IE, hybrid"), or the one comma-separated piece that is neither ("Dublin, IE, hybrid").
 * Undefined when it can't be told.
 */
function cityOf(text: string, filled: Record<string, string>): string | null | undefined {
  if (saysOnlyParts(text, filled)) return null;
  const pieces = text
    .split(/[,;/]/)
    .map((p) => p.trim())
    .filter(Boolean);
  const other = pieces.filter((p) => !saysOnlyParts(p, filled));
  return other.length === 1 ? other[0] : undefined;
}

/** A core key whose items are words, where "None" or "No" adds no item. */
const isWordListKey = (key: ProfileKey) =>
  CoreProfileKeySchema.safeParse(key).success && fieldSchemasOf(key) === null;

/**
 * The free-text answer `text` as one item of `profileKey`, or null when it can't be one. Every
 * field the group key's parts name comes from the parts, so the item answers the group key it
 * was asked under (F7.6), and the words must agree with them; the words fill only the fields
 * the parts don't ("120,000" is the amount of "min_pay:CHF:year", "120k a year" also the period
 * of "min_pay:CHF", "EU time zones" the scope of "remote", "hybrid" the mode of
 * "places:IE:Dublin"). A no is never an item of a core key: it adds nothing to the profile.
 */
export function itemFromText(
  profileKey: ProfileKey,
  groupKey: string,
  text: string,
): ProfileItem | null {
  const words = text.trim();
  if (!words) return null;
  const fields = partFieldsOf(profileKey);
  if (!fields) {
    // An extra question keeps its words, "No" included: that is its answer.
    if (isWordListKey(profileKey) && isNo(words)) return null;
    const asIs = parse(profileKey, words);
    if (asIs !== null) return asIs;
    if (profileKey === "reply_threshold" || profileKey === "reply_window_days") {
      return parse(profileKey, amountOf(words));
    }
    return null;
  }
  if (isNo(words)) return null;
  const parts = fieldsFromParts(profileKey, parseGroupKey(groupKey).parts);
  const filled = complete(fields, parts, words);
  if (filled === null || !agrees(words, parts)) return null;
  switch (profileKey) {
    case "min_pay":
      return parse(profileKey, { amount: amountOf(words), asWritten: words, ...filled });
    case "work_permits":
      return parse(profileKey, { country: parts.country ?? null, text: words });
    case "remote":
      return parse(profileKey, { scope: parts.scope ?? words, timeZones: null });
    case "places": {
      const city = parts.city ?? cityOf(words, filled);
      if (city === undefined) return null;
      return parse(profileKey, { ...filled, city });
    }
    default:
      return null;
  }
}

/** Whether an item has the fields the group key's parts name (answeredFor compares them). */
function matchesParts(profileKey: ProfileKey, groupKey: string, item: ProfileItem): boolean {
  const fields = partFieldsOf(profileKey);
  const { parts } = parseGroupKey(groupKey);
  if (!fields || parts.length === 0) return true;
  if (typeof item !== "object") return false;
  return parts.every(
    (part, i) =>
      fields[i] !== undefined && norm((item as Record<string, unknown>)[fields[i]]) === norm(part),
  );
}

/**
 * The item an answer adds: a choice's value checked against the key and the group key's parts,
 * or free text made into an item (itemFromText). For a decision without a profile key (an
 * ask_first rule) the words are kept as they are. Null when the answer doesn't fit.
 */
export function answerItem(
  decision: { profileKey: ProfileKey | null; groupKey: string },
  value: ProfileItem,
): ProfileItem | null {
  const { profileKey, groupKey } = decision;
  if (profileKey === null) return value;
  if (typeof value === "string") return itemFromText(profileKey, groupKey, value);
  const fits = parse(profileKey, value);
  // An item asked under "min_pay:CHF:year" is a CHF per-year minimum; any other answers another
  // question than the one asked.
  return fits !== null && matchesParts(profileKey, groupKey, fits) ? fits : null;
}

/**
 * What an answer does (F7.4): add `item` (to the profile with "Use this answer for similar
 * mail", otherwise for the waiting roles only), or turn the question down for the waiting roles
 * and write nothing: a "No" choice of a question whose items are objects (turnsDown), or the
 * same words typed.
 */
export type Answer = { kind: "item"; item: ProfileItem } | { kind: "declined"; words: string };

/** The answer `value` gives `decision`, or null when it doesn't fit. */
export function answerOf(
  decision: {
    profileKey: ProfileKey | null;
    groupKey: string;
    choices: readonly DecisionChoice[];
  },
  value: ProfileItem,
): Answer | null {
  const declines = decision.choices.some(
    (c) => c.value === value && turnsDown(decision.profileKey, c.value),
  );
  if (declines && typeof value === "string") return { kind: "declined", words: value };
  const item = answerItem(decision, value);
  return item === null ? null : { kind: "item", item };
}

/**
 * The profile change an answer makes (F7.4): one `add` of a single item to the decision's key,
 * applied with source decision, so the items already there stay ("CHF per year" keeps the EUR
 * minimum, TBD-195).
 */
export function answerChange(profileKey: ProfileKey, item: ProfileItem): Change {
  return { op: "add", target: "entry", key: profileKey, value: [item] as ProfileValue };
}

/** A slug for an extra key from a model's words: "Relocate to Ireland?" is "relocate_to_ireland". */
function slugOf(words: string): string {
  return words
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 64);
}

/** An extra key named after `words`, or null when they have nothing to name it by. */
export const extraKey = (words: string): ProfileKey | null => {
  const slug = slugOf(words);
  return slug ? `extra.${slug}` : null;
};

/**
 * The profile key a draft's question writes and the group key it is asked under, chosen so the
 * answer is found later (F7.6): what an answer adds to the profile key always answers the group
 * key (answeredFor).
 *
 * - The key it names (or its group key's own key, when it names none) is kept. Its group key
 *   stays only when it belongs to that key and its parts can make an item: each is a valid value
 *   of a field of the key's items, in order (GROUP_PARTS), and itemFromText reads the fields
 *   they leave out from the words ("min_pay:CHF" plus "120k a year", "places:IE:Dublin" plus
 *   "hybrid"). So "remote:EU" and "places:IE:Dublin:hybrid" are answered by what their answer
 *   adds. Otherwise a core key's parts are dropped: answeredFor would compare its items (words)
 *   with the first part, and "Fully on-site" never equals "onsite" ("deal_breakers:onsite" is
 *   "deal_breakers"; "places:IE:Dublin:remote", whose mode no place has, is "places").
 * - An extra question's parts become part of its name: "extra.relocate:IE" is
 *   "extra.relocate_ie", so relocating to Ireland and to Germany stay two questions.
 * - Otherwise it is an extra question named after its whole group key, or its words.
 */
export function questionKeys(question: {
  profileKey: string | null;
  groupKey: string;
  question: string;
}): { profileKey: ProfileKey; groupKey: string } {
  const { profileKey: head, parts } = parseGroupKey(question.groupKey);
  const named = ProfileKeySchema.safeParse(question.profileKey);
  const own = ProfileKeySchema.safeParse(head);
  const key = named.success ? named.data : own.success ? own.data : null;
  if (key !== null) {
    if (head !== key || parts.length === 0) return { profileKey: key, groupKey: groupKeyFor(key) };
    const fields = partFieldsOf(key);
    const makesItem =
      fields !== undefined &&
      parts.length <= fields.length &&
      parts.every((part, i) => part !== "" && partFits(key, fields[i] ?? "", part));
    if (makesItem) return { profileKey: key, groupKey: question.groupKey };
    if (!isExtraKey(key)) return { profileKey: key, groupKey: groupKeyFor(key) };
    const folded = extraKey([key.replace(/^extra\./, ""), ...parts].join("_")) ?? key;
    return { profileKey: folded, groupKey: groupKeyFor(folded) };
  }
  const extra =
    extraKey([head.replace(/^extra\./, ""), ...parts].join("_")) ??
    extraKey(question.question) ??
    "extra.question";
  return { profileKey: extra, groupKey: groupKeyFor(extra) };
}
