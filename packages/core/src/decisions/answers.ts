import {
  type Change,
  type CoreProfileKey,
  CoreProfileKeySchema,
  type DecisionChoice,
  type DraftChoice,
  groupKeyFor,
  isExtraKey,
  isPolicyKey,
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
  currencySigns,
  isCountryCode,
  isCurrencyCode,
  otherCurrencySign,
  sameWords,
  tokensOf,
} from "./words";

// A decision's answer (F7.4, TBD-195): the one profile item it adds, or words that answer the
// messages waiting on it only and write nothing. Nothing here reads a yes or a no from words, in
// any language (F8.1): the model that offers the answers says which ones turn the question down
// (draft.v1's `declines`), and the group key's parts say what a yes adds ("Yes" to
// "places:IE:Dublin:hybrid" is Dublin hybrid). So:
//
// - A choice that declines answers the waiting messages and writes nothing. Any other choice
//   adds the parts' item, completed by what its words state in a form every language shares;
//   when they can't complete it ("Yes" to "places:IE:Dublin" names no work mode) it stays
//   clickable, for the waiting messages only. Every choice offered stays clickable.
// - Typed words are a choice when they are its words ("yes" is the "Yes" offered). Otherwise,
//   under a key with parts, they add an item only when they state it in that shared form:
//   digits with the currency's own code or sign and nothing else for a minimum pay
//   ("CHF 120,000"), only the parts' own words, codes and the schema's values otherwise
//   ("Dublin, IE, hybrid"). Anything else ("Dublin doesn't work for me", "120k euros", "Ні") is
//   kept for the waiting messages only: their replies are told the words, nothing is written,
//   and it is never used for similar mail. A work permit is never made of typed words.
//
// So nothing the user turned down, and nothing the words don't state, is ever written (F6.2,
// F7.6).

/** An amount as digits, with the separators of any locale and an optional "k". */
const AMOUNT = /\d(?:[\d.,'’   ]*\d)?(?:\s*[kK](?![\p{L}\p{N}]))?/gu;

/** A number written in digits of any locale: "120,000", "120.000", "120 000", "120k", "95'000". */
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

const norm = (v: unknown) => String(v ?? "").toLowerCase();

type FieldSchema = { safeParse(value: unknown): { success: boolean }; options?: unknown };

/** The schemas of a core key's item fields, when its items are objects. */
function fieldSchemasOf(profileKey: ProfileKey): Record<string, FieldSchema> | null {
  const core = CoreProfileKeySchema.safeParse(profileKey);
  if (!core.success) return null;
  const schema = PROFILE_ITEM_SCHEMAS[core.data];
  return "shape" in schema ? (schema.shape as Record<string, FieldSchema>) : null;
}

/** The values the schema spells for a field ("onsite", "hybrid"), when it is an enum. */
function schemaValuesOf(profileKey: ProfileKey, field: string): readonly string[] {
  const options = fieldSchemasOf(profileKey)?.[field]?.options;
  return Array.isArray(options) ? (options as string[]) : [];
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

/** What may stand around what an answer states: "Dublin, IE." */
const NEUTRAL = /^[\s.,;:!?()\-–—]*$/u;

/**
 * The fields the words state, starting from the parts: each word must be one of the parts' own
 * words, an ISO code in capitals, or a value the schema spells ("hybrid", "year"), and each of
 * those must fill a field the parts leave out or equal the part. Null when a word is anything
 * else, names another value than a part, or two values for one field; and when there is no word.
 */
function statedFields(
  profileKey: ProfileKey,
  parts: Record<string, string>,
  text: string,
): Record<string, string> | null {
  const fields = partFieldsOf(profileKey) ?? [];
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length === 0 || !NEUTRAL.test(text.replace(/[\p{L}\p{N}]+/gu, ""))) return null;
  const own = new Set(Object.values(parts).flatMap((v) => tokensOf(v)));
  const out = { ...parts };
  for (const word of words) {
    const [token = ""] = tokensOf(word);
    if (own.has(token)) continue;
    const field = fields.find((f) =>
      f === "country"
        ? isCountryCode(word)
        : f === "currency"
          ? /^[A-Z]{3}$/.test(word) && isCurrencyCode(word)
          : schemaValuesOf(profileKey, f).includes(token),
    );
    if (field === undefined) return null;
    const value = CODE_FIELDS.has(field) ? word : token;
    if (out[field] !== undefined && norm(out[field]) !== norm(value)) return null;
    out[field] = value;
  }
  return out;
}

/**
 * A minimum pay the words state: one amount in digits, the currency's own code or sign (when
 * `marked`), the period as the schema spells it when the parts leave it out, and nothing else.
 * "CHF 120,000" is one under "min_pay:CHF:year"; "120k euros", "usd 120k", "10k/mo" aren't.
 */
function minPayOf(
  parts: Record<string, string>,
  text: string,
  options: { marked: boolean },
): ProfileItem | null {
  const [amount, ...more] = text.match(AMOUNT) ?? [];
  if (amount === undefined || more.length > 0) return null;
  const rest = text.replace(AMOUNT, " ");
  const named = currenciesIn(rest);
  const currency = parts.currency ?? (named.length === 1 ? named[0] : undefined);
  if (currency === undefined || otherCurrencySign(rest, currency)) return null;
  const signs = currencySigns(currency);
  const marked = signs.some((s) => rest.includes(s)) || tokensOf(rest).includes(norm(currency));
  if (options.marked && !marked) return null;
  const unsigned = signs.reduce((r, s) => r.replaceAll(s, " "), rest);
  const withCurrency: Record<string, string> = { ...parts, currency };
  // Around the amount alone ("€95,000") there is no word to read, only punctuation at most.
  const bare = tokensOf(unsigned).length === 0;
  const filled = bare
    ? NEUTRAL.test(unsigned) && withCurrency
    : statedFields("min_pay", withCurrency, unsigned);
  if (!filled) return null;
  if (filled.period === undefined) return null;
  return parse("min_pay", {
    amount: amountOf(amount),
    currency,
    period: filled.period,
    asWritten: text.trim(),
  });
}

/** Whether the words name another country, currency or schema value than the parts. */
function contradicts(profileKey: ProfileKey, parts: Record<string, string>, text: string) {
  const other = (field: string, named: readonly string[]) =>
    parts[field] !== undefined && named.some((n) => norm(n) !== norm(parts[field]));
  const tokens = tokensOf(text);
  return (
    other("country", countriesIn(text)) ||
    other("currency", currenciesIn(text)) ||
    (parts.currency !== undefined && otherCurrencySign(text, parts.currency)) ||
    (partFieldsOf(profileKey) ?? []).some((f) =>
      other(
        f,
        schemaValuesOf(profileKey, f).filter((v) => tokens.includes(v)),
      ),
    )
  );
}

/** A place from the fields, with no city when the parts and the words name none. */
function placeOf(filled: Record<string, string>): ProfileItem | null {
  return parse("places", { country: filled.country, city: filled.city ?? null, mode: filled.mode });
}

/**
 * The item a choice the model offers adds when it doesn't decline: the parts' item, completed
 * by what its words state (minPayOf, statedFields). Null when they can't complete it, or name
 * another country, currency or work mode than the parts: then the choice stays clickable for
 * the waiting messages only.
 */
function itemOfChoice(profileKey: ProfileKey, groupKey: string, label: string): ProfileItem | null {
  const parts = fieldsFromParts(profileKey, parseGroupKey(groupKey).parts);
  if (contradicts(profileKey, parts, label)) return null;
  switch (profileKey) {
    case "min_pay":
      return minPayOf(parts, label, { marked: false });
    case "places": {
      const complete = parts.country !== undefined && parts.city !== undefined && parts.mode;
      if (complete) return placeOf(parts);
      const filled = statedFields(profileKey, parts, label);
      return filled ? placeOf(filled) : null;
    }
    case "remote":
      return parts.scope ? parse(profileKey, { scope: parts.scope, timeZones: null }) : null;
    case "work_permits":
      return parse(profileKey, { country: parts.country ?? null, text: label.trim() });
    default:
      return null;
  }
}

/**
 * A choice draft.v1 offers, as the decision shows it (F7.2). An extra question keeps its words,
 * "No" included: that is its answer, written like any other. Under a core key, a choice that
 * declines answers the waiting messages and writes nothing; any other adds its item, or stays
 * clickable for the waiting messages only when its words make none (itemOfChoice).
 */
export function choiceOf(
  profileKey: ProfileKey,
  groupKey: string,
  choice: DraftChoice,
): DecisionChoice {
  const label = choice.label.trim() || choice.label;
  if (isExtraKey(profileKey)) return { label, value: label };
  if (choice.declines) return { label, value: label, declines: true };
  const item = partFieldsOf(profileKey)
    ? itemOfChoice(profileKey, groupKey, label)
    : itemFromText(profileKey, groupKey, label);
  return { label, value: item ?? label };
}

/**
 * Typed words as one item of `profileKey`, or null when they don't state one. An extra question
 * keeps its words; a policy key takes a number in digits ("80", "80 %"); a list of words takes
 * them as they are. Under a key with parts every field the parts name comes from the parts, so
 * the item answers the group key it was asked under (F7.6), and the words must state the rest
 * in a form every language shares (minPayOf with the currency's own code or sign,
 * statedFields): "CHF 120,000" under "min_pay:CHF:year", "hybrid" under "places:IE:Dublin",
 * "EU" under "remote:EU". A work permit is never made of typed words.
 */
export function itemFromText(
  profileKey: ProfileKey,
  groupKey: string,
  text: string,
): ProfileItem | null {
  const words = text.trim();
  if (!words) return null;
  if (!partFieldsOf(profileKey)) {
    if (isPolicyKey(profileKey)) {
      const number = /^(\d+)\s*%?$/u.exec(words)?.[1];
      return number === undefined ? null : parse(profileKey, Number(number));
    }
    return parse(profileKey, words);
  }
  const parts = fieldsFromParts(profileKey, parseGroupKey(groupKey).parts);
  switch (profileKey) {
    case "min_pay":
      return minPayOf(parts, words, { marked: true });
    case "places": {
      const filled = statedFields(profileKey, parts, words);
      return filled ? placeOf(filled) : null;
    }
    case "remote": {
      const filled = parts.scope ? statedFields(profileKey, parts, words) : null;
      return filled ? parse(profileKey, { scope: parts.scope, timeZones: null }) : null;
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
 * The item a value adds: a choice's item checked against the key and the group key's parts, or
 * typed words made into an item (itemFromText). For a decision without a profile key (an
 * ask_first rule) the words are kept as they are. Null when the value makes no item.
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
 * mail", otherwise for the waiting roles only), or give `words` to the waiting roles only and
 * write nothing: a choice that declines (`declines`), one whose words make no item, or typed
 * words that don't state one.
 */
export type Answer =
  | { kind: "item"; item: ProfileItem }
  | { kind: "words"; words: string; declines: boolean };

/** The answer `value` gives `decision`, or null when it doesn't fit. */
export function answerOf(
  decision: {
    profileKey: ProfileKey | null;
    groupKey: string;
    choices: readonly DecisionChoice[];
  },
  value: ProfileItem,
): Answer | null {
  const { profileKey } = decision;
  const item = (it: ProfileItem | null): Answer | null =>
    it === null ? null : { kind: "item", item: it };
  if (profileKey === null || typeof value !== "string") return item(answerItem(decision, value));
  const words = value.trim();
  if (!words) return null;
  const forWaiting = (w: string, declines: boolean): Answer => ({
    kind: "words",
    words: w,
    declines,
  });
  // A click sends the choice's value; typing its words is the same as clicking it.
  const choice =
    decision.choices.find((c) => c.value === value) ??
    (tokensOf(words).length > 0
      ? decision.choices.find((c) => sameWords(c.label, words))
      : undefined);
  if (choice) {
    if (choice.declines && !isExtraKey(profileKey)) return forWaiting(choice.label, true);
    if (typeof choice.value !== "string") return item(answerItem(decision, choice.value));
    const own = turnsDown(profileKey, choice.value) ? null : parse(profileKey, choice.value);
    return own === null ? forWaiting(choice.label, false) : { kind: "item", item: own };
  }
  const typed = itemFromText(profileKey, decision.groupKey, words);
  if (typed !== null) return { kind: "item", item: typed };
  // Words where the key's items are objects are told to the waiting roles' replies (turnsDown).
  return turnsDown(profileKey, words) ? forWaiting(words, false) : null;
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
 *   of a field of the key's items, in order (GROUP_PARTS), and the answer completes the fields
 *   they leave out ("min_pay:CHF" plus "CHF 120,000 year", "places:IE:Dublin" plus "hybrid").
 *   So "remote:EU" and "places:IE:Dublin:hybrid" are answered by what their answer adds.
 *   Otherwise a core key's parts are dropped: answeredFor would compare its items (words) with
 *   the first part, and "Fully on-site" never equals "onsite" ("deal_breakers:onsite" is
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
