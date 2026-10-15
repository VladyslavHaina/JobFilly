import type { PayPeriod, TimeZoneRange } from "@jobfilly/schema";

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

/** "UTC+03:00" reads "UTC+3", "UTC-01:00" "UTC−1" (a real minus sign), "UTC+05:30" "UTC+5:30". */
export function formatOffset(offset: string): string {
  const m = /^UTC([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!m) return offset;
  const hours = String(Number(m[2]));
  const minutes = m[3] === "00" ? "" : `:${m[3]}`;
  const sign = m[1] === "-" && `${hours}${minutes}` !== "0" ? "−" : "+";
  return `UTC${sign}${hours}${minutes}`;
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
