import type {
  Address,
  Category,
  JobFacts,
  Pay,
  PayPeriod,
  Place,
  TimeZoneRange,
} from "@jobfilly/schema";

// How the job inbox words categories and job facts. Values come from the mail as the model
// extracted them; only international standards are interpreted here: ISO 3166-1 country codes
// (named with Intl.DisplayNames) and ISO 4217 currencies (formatted with Intl.NumberFormat).
// Everything else (contract, seniority, work permit, remote scope) is shown as written.

/**
 * The browser's locale, read on each call: pay, dates and typed amounts are written the way the
 * user's browser writes numbers and dates (TBD-130). Country names stay in English, the language
 * of the app's copy.
 */
const userLocale = () => navigator.language;

export const NOT_STATED = "Not stated";

export const CATEGORY_LABELS: Record<Category, string> = {
  recruiter_outreach: "Recruiter outreach",
  job_alert: "Job alert",
  application_update: "Application update",
  interview: "Interview",
  assessment: "Assessment",
  offer: "Offer",
  rejection: "Rejection",
  other_job: "Other job mail",
  not_job: "Not job",
};

const regionNames = new Intl.DisplayNames(["en"], { type: "region", fallback: "code" });

/** "Germany" for "DE"; the code itself when the runtime has no name for it. */
export function countryName(code: string): string {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "Berlin, Germany", "Germany" or "Berlin". */
export function formatPlace(place: Place): string {
  return [place.city, place.country ? countryName(place.country) : null]
    .filter((part): part is string => Boolean(part))
    .join(", ");
}

const PERIOD_WORDS: Record<PayPeriod, string> = {
  hour: "per hour",
  day: "per day",
  week: "per week",
  month: "per month",
  year: "per year",
};

/** "per day" for "day". */
export const formatPeriod = (period: PayPeriod) => PERIOD_WORDS[period];

const NUMBER_PARTS = new Set(["integer", "group", "decimal", "fraction", "minusSign", "plusSign"]);

/** The number portion of a formatted value, without currency or spacing. */
function numberOnly(parts: Intl.NumberFormatPart[]): string {
  return parts
    .filter((p) => NUMBER_PARTS.has(p.type))
    .map((p) => p.value)
    .join("");
}

/** "€450–550": the currency written once, where the locale puts it. */
function formatRange(format: Intl.NumberFormat, min: number, max: number): string {
  const parts = format.formatToParts(min);
  const first = parts.findIndex((p) => NUMBER_PARTS.has(p.type));
  const last = parts.findLastIndex((p) => NUMBER_PARTS.has(p.type));
  const range = `${numberOnly(parts)}–${numberOnly(format.formatToParts(max))}`;
  return [
    ...parts.slice(0, first).map((p) => p.value),
    range,
    ...parts.slice(last + 1).map((p) => p.value),
  ].join("");
}

/**
 * Pay normalised from its parts, e.g. "€450–550 per day" or "from £30 per hour"; null when the
 * mail states no amount (the as-written text then stands alone).
 */
export function formatPay(pay: Pay): string | null {
  const { min, max, currency, period } = pay;
  if (min === null && max === null) return null;
  const fractions = [min, max].some((v) => v !== null && !Number.isInteger(v)) ? 2 : 0;
  let format: Intl.NumberFormat;
  try {
    format = new Intl.NumberFormat(userLocale(), {
      ...(currency ? { style: "currency", currency, currencyDisplay: "narrowSymbol" } : {}),
      minimumFractionDigits: fractions,
      maximumFractionDigits: fractions,
    });
  } catch {
    // A currency code the runtime doesn't know: plain numbers followed by the code.
    format = new Intl.NumberFormat(userLocale(), { maximumFractionDigits: fractions });
  }
  const withCode = currency && format.resolvedOptions().style !== "currency";
  let amount: string;
  if (min !== null && max !== null) {
    amount = min === max ? format.format(min) : formatRange(format, min, max);
  } else if (min !== null) {
    amount = `from ${format.format(min)}`;
  } else {
    amount = `up to ${format.format(max as number)}`;
  }
  return [amount, withCode ? currency : null, period ? formatPeriod(period) : null]
    .filter(Boolean)
    .join(" ");
}

export type ParsedAmount = { ok: true; amount: number } | { ok: false; message: string };

/**
 * Reads an amount the user typed, with the separators of `locale` (the one amounts are shown in,
 * the browser's by default):
 * "70,000" and "1,234.56" in English, "70.000" and "1.234,56" in German. Spaces group digits in
 * any locale. Whatever the locale can't read for certain is refused, never guessed: a separator
 * that isn't its own or sits in the wrong place ("450,50" in English), and exactly three digits
 * after the decimal sign ("70.000" in English), which another locale writes as thousands.
 */
export function parseAmount(text: string, locale: string = userLocale()): ParsedAmount {
  const parts = new Intl.NumberFormat(locale).formatToParts(1234567.8);
  const group = parts.find((p) => p.type === "group")?.value ?? null;
  const decimal = parts.find((p) => p.type === "decimal")?.value ?? ".";
  const example = new Intl.NumberFormat(locale, { minimumFractionDigits: 2 }).format(1234.5);
  const retype: ParsedAmount = {
    ok: false,
    message: `Retype the amount, written like ${example}`,
  };
  const typed = text.trim();
  // Only digits and separators: its own, or another locale's (refused below, with a hint).
  const others = typed.replaceAll(decimal, "").replaceAll(group ?? decimal, "");
  if (!/\d/.test(typed) || /[^\d\s.,'’]/.test(others)) {
    return { ok: false, message: "Enter the amount as a number" };
  }
  // The digit groups before the decimal sign, and the digits after it (null without one).
  const groups = [""];
  let fraction: string | null = null;
  for (const ch of typed) {
    if (/\d/.test(ch)) {
      if (fraction === null) groups[groups.length - 1] += ch;
      else fraction += ch;
    } else if (ch === decimal && fraction === null) {
      fraction = "";
    } else if ((ch === group || /\s/.test(ch)) && fraction === null) {
      groups.push("");
    } else {
      return retype;
    }
  }
  const [first = "", ...rest] = groups;
  const grouped =
    rest.length === 0 || (/^\d{1,3}$/.test(first) && rest.every((g) => g.length === 3));
  if (!grouped || (first === "" && rest.length > 0)) return retype;
  if (fraction !== null && (fraction.length === 0 || fraction.length === 3)) return retype;
  const amount = Number(`${groups.join("") || "0"}${fraction ? `.${fraction}` : ""}`);
  return Number.isFinite(amount) ? { ok: true, amount } : retype;
}

/** "UTC+01:00 to UTC+03:00", or one offset when both ends are the same. */
export function formatTimeZones(range: TimeZoneRange): string {
  return range.from === range.to ? range.from : `${range.from} to ${range.to}`;
}

const WORK_MODES: Record<NonNullable<JobFacts["workMode"]>, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "Onsite",
};

export const formatWorkMode = (mode: NonNullable<JobFacts["workMode"]>) => WORK_MODES[mode];

/** "Talent Partners (for Nordlicht GmbH)", or whichever part the mail names. */
export function formatAgency(agency: NonNullable<JobFacts["agency"]>): string | null {
  if (agency.name && agency.client) return `${agency.name} (for ${agency.client})`;
  if (agency.name) return agency.name;
  if (agency.client) return `An agency, for ${agency.client}`;
  return null;
}

/**
 * The sender as the list shows it: the display name, unless it has an "@" in it, which could pass
 * for an address the mail didn't come from ("hr@bigcorp.example" sent from anywhere): then the
 * real address.
 */
export const senderLabel = (from: Address) =>
  from.name && !from.name.includes("@") ? from.name : from.address;

/** The URL when it is a web link safe to open; null for anything else (javascript:, data:…). */
export function safeLink(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

export const formatListDate = (iso: string) =>
  new Intl.DateTimeFormat(userLocale(), { dateStyle: "medium" }).format(new Date(iso));
export const formatFullDate = (iso: string) =>
  new Intl.DateTimeFormat(userLocale(), { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
