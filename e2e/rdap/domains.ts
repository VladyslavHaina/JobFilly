import { readFileSync } from "node:fs";

// The fake RDAP service's data, e2e/rdap/domains.json, written by the fixture generator
// (e2e/fixtures/build) from every sender domain of the fixtures: how many days ago each domain
// was registered. Dates are relative, like the mail's, so a domain's age is the same on every
// run. A name that isn't listed, nor under a listed domain, is not found.

export interface DomainsFile {
  /** By domain, lower case. */
  domains: Record<string, { registeredDaysAgo: number }>;
}

const DOMAINS_FILE = new URL("./domains.json", import.meta.url);

export function readDomains(path: string | URL = DOMAINS_FILE): DomainsFile {
  return JSON.parse(readFileSync(path, "utf8")) as DomainsFile;
}

/**
 * The listed domain answering for `name`: itself, or the nearest listed domain it is under
 * (jobs.nhs.uk is answered by nhs.uk when only that is listed), so a lookup by sender domain or
 * by registrable domain finds the same registration.
 */
export function findDomain(
  file: DomainsFile,
  name: string,
): { domain: string; registeredDaysAgo: number } | null {
  const labels = name.toLowerCase().replace(/\.$/, "").split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const domain = labels.slice(i).join(".");
    const entry = file.domains[domain];
    if (entry) return { domain, registeredDaysAgo: entry.registeredDaysAgo };
  }
  return null;
}
