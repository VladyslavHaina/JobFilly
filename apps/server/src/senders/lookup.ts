import type { Config } from "../config";
import type { DomainPort } from "../deps";

// Domain lookups for the sender check (F5): the domain's age from RDAP (JOBFILLY_RDAP_URL) and its
// MX records from DNS (the system resolver). The port is pinned by the foundation; the
// cvs-senders slice writes the real lookups (and caches them in domain_lookups). Tests use the
// fake in src/testing.
export function createDomainPort(_config: Pick<Config, "rdapUrl">): DomainPort {
  const notYet = () =>
    Promise.reject(new Error("domain lookups are written by the cvs-senders slice"));
  return { rdap: notYet, mx: notYet };
}
