import {
  type Change,
  type CoreProfileKey,
  groupKeyFor,
  isExtraKey,
  type ProfileItem,
  type ProfileKey,
  ProfileKeySchema,
  type ProfileValue,
  parseGroupKey,
  profileItemSchema,
} from "@jobfilly/schema";
import { GROUP_PARTS } from "../profile/changes";

// A decision's answer as the one profile item it adds (F7.4, TBD-195): a choice's item as it is,
// or the words of the free-text option made into an item of the decision's key. The group key's
// parts say what the words can't: "min_pay:CHF:year" plus "120,000" is a CHF per-year minimum of
// 120000, as written. Nothing is assumed beyond the key and the words; when they don't make an
// item, the answer is refused rather than guessed.

/** A number written in words of any locale: "120,000", "120.000", "120 000", "120k", "95'000". */
function amountOf(text: string): number | null {
  const m = /(\d[\d.,'’\s ]*)(\s*[kK]\b)?/.exec(text);
  if (!m?.[1]) return null;
  const digits = m[1].trim();
  if (m[2]) {
    const n = Number.parseFloat(digits.replace(/[\s'’ ]/g, "").replace(",", "."));
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

/**
 * The free-text answer `text` as one item of `profileKey`, or null when it can't be one. Every
 * field the group key's parts name comes from the parts, never from the words, so the item
 * answers the group key it was asked under (F7.6); the words fill only the fields the parts
 * don't ("120,000" is the amount of "min_pay:CHF:year", "EU time zones" the scope of "remote").
 */
export function itemFromText(
  profileKey: ProfileKey,
  groupKey: string,
  text: string,
): ProfileItem | null {
  const words = text.trim();
  const filled = fieldsFromParts(profileKey, parseGroupKey(groupKey).parts);
  const asIs = parse(profileKey, words);
  if (asIs !== null) return asIs;
  switch (profileKey) {
    case "min_pay":
      return parse(profileKey, { amount: amountOf(words), asWritten: words, ...filled });
    case "work_permits":
      return parse(profileKey, { country: null, text: words, ...filled });
    case "remote":
      return parse(profileKey, { scope: words, timeZones: null, ...filled });
    case "places":
      return parse(profileKey, { city: words, ...filled });
    case "reply_threshold":
    case "reply_window_days":
      return parse(profileKey, amountOf(words));
    default:
      return null;
  }
}

/**
 * The item an answer adds: a choice's value checked against the key, or free text made into an
 * item (itemFromText). For a decision without a profile key (an ask_first rule) the words are
 * kept as they are. Null when the answer doesn't fit.
 */
export function answerItem(
  decision: { profileKey: ProfileKey | null; groupKey: string },
  value: ProfileItem,
): ProfileItem | null {
  if (decision.profileKey === null) return value;
  const fits = parse(decision.profileKey, value);
  if (fits !== null) return fits;
  return typeof value === "string"
    ? itemFromText(decision.profileKey, decision.groupKey, value)
    : null;
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

const extraKey = (words: string): ProfileKey | null => {
  const slug = slugOf(words);
  return slug ? `extra.${slug}` : null;
};

/**
 * The profile key a draft's question writes and the group key it is asked under, chosen so the
 * answer is found later (F7.6): what an answer adds to the profile key always answers the group
 * key (answeredFor).
 *
 * - The key it names (or its group key's own key, when it names none) is kept. Its group key
 *   stays only when it belongs to that key; the parts stay only when each names a field of the
 *   key's items (GROUP_PARTS), which itemFromText fills from the part, so "remote:EU" and
 *   "places:IE:Dublin:hybrid" are answered by what their answer adds. Otherwise a core key's
 *   parts are dropped: answeredFor would compare its items (words) with the first part, and
 *   "Fully on-site" never equals "onsite" ("deal_breakers:onsite" is "deal_breakers").
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
    if (fields && parts.length <= fields.length && parts.every(Boolean)) {
      return { profileKey: key, groupKey: question.groupKey };
    }
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
