import {
  type Change,
  CountryCodeSchema,
  groupKeyFor,
  isExtraKey,
  type ProfileItem,
  type ProfileKey,
  ProfileKeySchema,
  type ProfileValue,
  parseGroupKey,
  profileItemSchema,
} from "@jobfilly/schema";

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

/** The free-text answer `text` as one item of `profileKey`, or null when it can't be one. */
export function itemFromText(
  profileKey: ProfileKey,
  groupKey: string,
  text: string,
): ProfileItem | null {
  const words = text.trim();
  const { parts } = parseGroupKey(groupKey);
  const country = (part: string | undefined) =>
    part && CountryCodeSchema.safeParse(part.toUpperCase()).success ? part.toUpperCase() : null;
  const asIs = parse(profileKey, words);
  if (asIs !== null) return asIs;
  switch (profileKey) {
    case "min_pay":
      return parse(profileKey, {
        amount: amountOf(words),
        currency: parts[0]?.toUpperCase(),
        period: parts[1],
        asWritten: words,
      });
    case "work_permits":
      return parse(profileKey, { country: country(parts[0]), text: words });
    case "remote":
      return parse(profileKey, { scope: words, timeZones: null });
    case "places":
      return parse(profileKey, { country: country(parts[0]), city: words, mode: parts[2] });
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

/**
 * The keys whose group key parts name fields of an item: itemFromText fills those fields from the
 * parts, and answeredFor (profile/changes.ts, GROUP_PARTS) compares them, so "min_pay:CHF:year" is
 * answered by the CHF per-year minimum the answer adds. Any other key's items are words, which
 * answeredFor would compare with the first part: an answer "Yes" never equals "IE".
 */
const KEYS_WITH_PARTS: ReadonlySet<string> = new Set([
  "min_pay",
  "places",
  "remote",
  "work_permits",
]);

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
 *   stays only when it belongs to that key; the parts stay only for a key whose items they
 *   describe (KEYS_WITH_PARTS). A core key's other parts are dropped ("deal_breakers:onsite" is
 *   "deal_breakers").
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
    if (KEYS_WITH_PARTS.has(key)) return { profileKey: key, groupKey: question.groupKey };
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
