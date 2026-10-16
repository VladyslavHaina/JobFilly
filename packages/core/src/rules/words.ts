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

// Whole words. A word is a run of letters, digits, + and # ("C++", "C#", "B2B"), lower-cased.
// There are two ways to say one text names another:
//
// - mentions (deal-breakers, a rule's "mentions"): the words appear one after another, with a
//   hyphen, dot or apostrophe a break like any other. "crypto" is in "Crypto-Exchange GmbH",
//   "Java" in "Java-based", "Node" in "Node.js", "gambling" in "the gambling's industry"; but
//   "crypto" isn't in "Cryptography", nor "Java" in "JavaScript".
// - saysPlainly (contracts, seniority, work permits, remote scopes, where a fit is claimed): the
//   same, but a hyphen, dot or apostrophe between two letters joins them into one word, and the
//   words must not follow a negation in their clause. "permanent" is plainly in "Permanent,
//   full-time", but not in "Non-permanent", "Non permanent" or "Not permanent, 6 months"; "EU" is
//   not in "Non-EU". Wording that doesn't clearly say it never fits (F4.1).
//
// The negations are English function words, like the rest of the app's words; they say nothing
// about any market.

/** A hyphen, dot or apostrophe between two words: it joins them for saysPlainly. */
const JOINER = /^[-‐‑.'’]$/u;
/** What ends a clause between two words: a comma, semicolon, colon, bracket, dash, line or stop. */
const CLAUSE_BREAK = /[,;:!?()[\]\n—–]|\.\s/u;
const NEGATIONS: ReadonlySet<string> = new Set(["no", "not", "non", "without"]);

interface Word {
  word: string;
  /** A joiner ties it to the word before it: "call" in "On-Call". */
  tied: boolean;
  /** It starts a clause: the text's first word, or one after a comma, a full stop and the like. */
  clauseStart: boolean;
}

function wordsOf(s: string): Word[] {
  const words: Word[] = [];
  const text = norm(s);
  let last = 0;
  for (const m of text.matchAll(/[\p{L}\p{N}+#]+/gu)) {
    const between = text.slice(last, m.index);
    words.push({
      word: m[0],
      tied: words.length > 0 && JOINER.test(between),
      clauseStart: words.length === 0 || CLAUSE_BREAK.test(between),
    });
    last = m.index + m[0].length;
  }
  return words;
}

/** Where `needle`'s words appear one after another in `hay`. */
function* runs(hay: readonly Word[], needle: readonly Word[]): Generator<number> {
  if (needle.length === 0) return;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((w, k) => hay[i + k]?.word === w.word)) yield i;
  }
}

/** Whether `haystack` names `needle` in whole words; hyphens, dots and apostrophes break words. */
export function mentions(haystack: string, needle: string): boolean {
  return !runs(wordsOf(haystack), wordsOf(needle)).next().done;
}

/** A negation earlier in the clause of the word at `at`: "not" in "Not a permanent role". */
function negated(words: readonly Word[], at: number): boolean {
  for (let i = at; !(words[i] as Word).clauseStart; i--) {
    if (NEGATIONS.has((words[i - 1] as Word).word)) return true;
  }
  return false;
}

/**
 * Whether `haystack` plainly says `needle`: its words, one after another, neither part of a
 * longer joined word nor after a negation in their clause. A negation inside `needle` itself
 * ("No sponsorship needed") is matched word for word, so both texts say the same thing.
 */
export function saysPlainly(haystack: string, needle: string): boolean {
  const hay = wordsOf(haystack);
  const want = wordsOf(needle);
  for (const i of runs(hay, want)) {
    const end = i + want.length;
    const joined = (hay[i] as Word).tied || hay[end]?.tied === true;
    if (!joined && !negated(hay, i)) return true;
  }
  return false;
}
