import { formatOffset, type PayPeriod, type TimeZoneRange } from "@jobfilly/schema";

// Small wording and comparison helpers shared by the rules engine and the match: how a UTC offset,
// a time-zone range and an amount read in plain words, and how words are compared (case and
// spacing never matter). No market vocabulary lives here: every word compared comes from the
// profile, a rule or the mail.

/** Lower case, inner whitespace collapsed: "  Senior  Engineer" and "senior engineer" are equal. */
export const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Minutes east of UTC of "UTC+05:30". */
function offsetMinutes(offset: string): number {
  const m = /^UTC([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!m) return Number.NaN;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -minutes : minutes;
}

/** A range as minutes, lower end first. */
function rangeMinutes(range: TimeZoneRange): [number, number] {
  const a = offsetMinutes(range.from);
  const b = offsetMinutes(range.to);
  return a <= b ? [a, b] : [b, a];
}

/** "UTC−1 to UTC+3", or one offset when both ends are the same. */
export function formatRange(range: TimeZoneRange): string {
  const [from, to] =
    offsetMinutes(range.from) <= offsetMinutes(range.to)
      ? [range.from, range.to]
      : [range.to, range.from];
  return offsetMinutes(from) === offsetMinutes(to)
    ? formatOffset(from)
    : `${formatOffset(from)} to ${formatOffset(to)}`;
}

/** Whether `inner` lies entirely inside `outer`. */
export function rangeWithin(inner: TimeZoneRange, outer: TimeZoneRange): boolean {
  const [a, b] = rangeMinutes(inner);
  const [c, d] = rangeMinutes(outer);
  return a >= c && b <= d;
}

/** Whether the two ranges share no offset at all. */
export function rangeDisjoint(a: TimeZoneRange, b: TimeZoneRange): boolean {
  const [a1, a2] = rangeMinutes(a);
  const [b1, b2] = rangeMinutes(b);
  return a2 < b1 || a1 > b2;
}

/** "CHF 120,000 per year": an ISO currency code, the amount with digit groups, the period. */
export function formatAmount(amount: number, currency: string, period: PayPeriod): string {
  const digits = amount.toLocaleString("en", { maximumFractionDigits: 2 });
  return `${currency} ${digits} per ${period}`;
}

/** "A, B or C". */
export function orList(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}

// Whole words. A word is a run of letters, digits, + and # ("C++", "C#", "B2B"), lower-cased;
// everything else breaks words. There are two ways to say one text names another:
//
// - mentions (deal-breakers, a rule's "mentions"): the words appear one after another anywhere.
//   "crypto" is in "Crypto-Exchange GmbH", "Java" in "Java-based", "Node" in "Node.js",
//   "gambling" in "the gambling's industry"; but "crypto" isn't in "Cryptography", nor "Java" in
//   "JavaScript". Finding a word is all a deal-breaker or a rule needs.
// - saysPlainly (contracts, seniority, work permits, remote scopes, where a fit is claimed): one
//   clause of the text is exactly the phrase, with no other words. "Permanent, full-time" plainly
//   says 'permanent'; "Not permanent", "Non-permanent", "This isn't a permanent role",
//   "Permanent: no" and "Keine Festanstellung" don't say 'permanent' or 'Festanstellung'. No
//   list of negation words is kept, in any language: the app can't know every way of saying
//   "not", so wording with anything more than the phrase is unknown, and so asked (F4.1).
//
// A clause ends at a comma, a semicolon, a slash, a line break or a full stop before a space
// ("Senior / Lead", "No relocation; permanent"). A colon, a dash, a bracket or a question mark
// doesn't end one: "Permanent: no", "Permanent — no" and
// "Permanent? No" keep the phrase and its answer together.

/** What ends a clause: a comma, semicolon, slash, line break, or a full stop before a space. */
const CLAUSE_BREAK = /[,;/\n]|\.\s/u;

/** The words of `s`, lower-cased, in order. */
const wordsOf = (s: string): string[] =>
  [...norm(s).matchAll(/[\p{L}\p{N}+#]+/gu)].map((m) => m[0]);

/** Whether `haystack` names `needle` in whole words, one after another. */
export function mentions(haystack: string, needle: string): boolean {
  const hay = wordsOf(haystack);
  const want = wordsOf(needle);
  if (want.length === 0) return false;
  for (let i = 0; i + want.length <= hay.length; i++) {
    if (want.every((w, k) => hay[i + k] === w)) return true;
  }
  return false;
}

const sameWords = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((w, i) => w === b[i]);

/**
 * Whether `haystack` plainly says `needle`: the two read the same once normalised, or one of
 * `haystack`'s clauses is `needle`'s words and nothing else. Anything more is unknown.
 */
export function saysPlainly(haystack: string, needle: string): boolean {
  const want = wordsOf(needle);
  if (want.length === 0) return false;
  if (sameWords(wordsOf(haystack), want)) return true;
  return haystack.split(CLAUSE_BREAK).some((clause) => sameWords(wordsOf(clause), want));
}
