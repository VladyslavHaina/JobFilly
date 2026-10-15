import type { Address, JobFacts, Pay, PayPeriod } from "../format.ts";

// Small builders shared by the persona sources.

/** One role's facts: everything not given is unknown (null or empty), never guessed. */
export function role(facts: Partial<JobFacts>): JobFacts {
  return {
    title: null,
    company: null,
    agency: null,
    places: [],
    workMode: null,
    remoteScope: null,
    timeZones: null,
    pay: null,
    contract: null,
    seniority: null,
    workPermit: null,
    skills: [],
    languages: [],
    applyUrl: null,
    extra: {},
    ...facts,
  };
}

export function pay(
  min: number | null,
  max: number | null,
  currency: string,
  period: PayPeriod,
  asWritten: string,
): Pay {
  return { min, max, currency, period, asWritten };
}

/** "Jonas Krüger" at krueger.example -> jonas.kruger@krueger.example. */
export function personAt(name: string, domain: string): Address {
  const local = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, ".")
    .replace(/^\.|\.$/g, "");
  return { address: `${local}@${domain}`, name };
}

export function firstName(a: Address): string {
  return (a.name ?? a.address).split(" ")[0] as string;
}

/** 70000 -> "70,000" (en) or "70.000" (de, pt, nl). */
export function amount(n: number, lang: "en" | "de" | "pt" | "nl"): string {
  return n.toLocaleString("en-US").replace(/,/g, lang === "en" ? "," : ".");
}

const DAY = 24 * 60;
export const days = (d: number): number => Math.round(d * DAY);
