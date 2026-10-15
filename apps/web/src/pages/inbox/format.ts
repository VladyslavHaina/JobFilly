import type { Category, JobFacts, Pay, PayPeriod, Place, TimeZoneRange } from "@jobfilly/schema";

// How the job inbox words categories and job facts. Values come from the mail as the model
// extracted them; only international standards are interpreted here: ISO 3166-1 country codes
// (named with Intl.DisplayNames) and ISO 4217 currencies (formatted with Intl.NumberFormat).
// Everything else (contract, seniority, work permit, remote scope) is shown as written.

/** The UI's language: the app's copy is English, so names and numbers are written for it. */
const UI_LOCALE = "en";

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

const regionNames = new Intl.DisplayNames([UI_LOCALE], { type: "region", fallback: "code" });

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
    format = new Intl.NumberFormat(UI_LOCALE, {
      ...(currency ? { style: "currency", currency, currencyDisplay: "narrowSymbol" } : {}),
      minimumFractionDigits: fractions,
      maximumFractionDigits: fractions,
    });
  } catch {
    // A currency code the runtime doesn't know: plain numbers followed by the code.
    format = new Intl.NumberFormat(UI_LOCALE, { maximumFractionDigits: fractions });
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
  return [amount, withCode ? currency : null, period ? PERIOD_WORDS[period] : null]
    .filter(Boolean)
    .join(" ");
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

/** The URL when it is a web link safe to open; null for anything else (javascript:, data:…). */
export function safeLink(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

const listDate = new Intl.DateTimeFormat(UI_LOCALE, { dateStyle: "medium" });
const fullDate = new Intl.DateTimeFormat(UI_LOCALE, { dateStyle: "medium", timeStyle: "short" });

export const formatListDate = (iso: string) => listDate.format(new Date(iso));
export const formatFullDate = (iso: string) => fullDate.format(new Date(iso));
