import { Resolver } from "node:dns/promises";
import type { DomainFacts } from "@jobfilly/core";
import {
  type DomainLookupKind,
  type DomainLookupResults,
  getDomainLookup,
  lastLookupFailure,
  saveDomainLookup,
} from "@jobfilly/db";
import { type RdapDomainAnswer, RdapDomainAnswerSchema } from "@jobfilly/schema";
import type { Config } from "../config";
import type { AppDeps, DomainPort } from "../deps";
import type { Logger } from "../log";

// Domain lookups for the sender check (F5): the domain's age from RDAP (JOBFILLY_RDAP_URL) and its
// MX records from DNS (the system resolver). createDomainPort is the real DomainPort; lookupDomain
// asks it through the workspace's cache in domain_lookups, so a sender writing again, or another
// replica, doesn't look the same domain up again. A failed lookup is cached briefly (longer each
// time it fails again) and makes the check incomplete, never "looks fine" (F5.3); it is logged as
// sender.lookup_incomplete. Once the failure has expired, the sweep has the check done again
// (./retry.ts).

const TIMEOUT_MS = 5000;

/** What the real port uses to reach the network; tests pass fakes. */
export interface DomainPortOptions {
  fetch?: typeof fetch;
  resolveMx?: (domain: string) => Promise<{ exchange: string; priority: number }[]>;
  timeoutMs?: number;
}

/** DNS answers that mean "no MX records" rather than "the lookup failed". */
const NO_RECORDS = new Set(["ENODATA", "ENOTFOUND"]);

/** An RDAP answer that isn't an RDAP domain object: the lookup failed, on purpose. */
class RdapAnswerError extends Error {
  override name = "RdapAnswerError";
}

/** The registration date of an RDAP domain answer (RFC 9083 events), or null. */
function registeredAt(answer: RdapDomainAnswer): string | null {
  const event = answer.events?.find((e) => e.eventAction === "registration");
  const date = event ? Date.parse(event.eventDate) : Number.NaN;
  return Number.isFinite(date) ? new Date(date).toISOString() : null;
}

export function createDomainPort(
  config: Pick<Config, "rdapUrl">,
  options: DomainPortOptions = {},
): DomainPort {
  const fetchFn = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const base = () => (config.rdapUrl.endsWith("/") ? config.rdapUrl : `${config.rdapUrl}/`);
  let resolver: Resolver | null = null;
  const resolveMx =
    options.resolveMx ??
    ((domain: string) => {
      resolver ??= new Resolver({ timeout: timeoutMs, tries: 2 });
      return resolver.resolveMx(domain);
    });
  return {
    async rdap(domain) {
      const res = await fetchFn(new URL(`domain/${encodeURIComponent(domain)}`, base()), {
        headers: { Accept: "application/rdap+json, application/json" },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`RDAP answered ${res.status}`);
      const answer = RdapDomainAnswerSchema.safeParse(await res.json());
      if (!answer.success) throw new RdapAnswerError("RDAP answered something else than a domain");
      return { registeredAt: registeredAt(answer.data) };
    },
    async mx(domain) {
      try {
        const records = await resolveMx(domain);
        // A null MX (RFC 7505) has an empty exchange: the domain takes no mail.
        return records.map((r) => r.exchange).filter((exchange) => exchange.length > 0);
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        if (typeof code === "string" && NO_RECORDS.has(code)) return [];
        throw error;
      }
    },
  };
}

const HOUR_MS = 60 * 60 * 1000;
/** How long an answer is kept: a registration date barely changes, MX records may. */
const KEEP_MS: Record<DomainLookupKind, number> = { rdap: 30 * 24 * HOUR_MS, mx: 24 * HOUR_MS };
/**
 * A failure is kept briefly, so a burst of mail from one domain asks once; each failure in a row
 * is kept twice as long as the one before, up to a day, so a domain whose lookup always fails
 * (a registry without RDAP) is asked less and less often.
 */
const KEEP_FAILURE_MS = 15 * 60 * 1000;
const MAX_KEEP_FAILURE_MS = 24 * HOUR_MS;

type LookupDeps = Pick<AppDeps, "db" | "clock" | "domains">;

/** How long to keep a failure: twice as long as the failure before it, if the last one failed. */
async function keepFailureMs(
  deps: LookupDeps,
  ws: string,
  key: { domain: string; kind: DomainLookupKind },
): Promise<number> {
  const last = await lastLookupFailure(deps.db, ws, key);
  if (!last) return KEEP_FAILURE_MS;
  return Math.min(Math.max(last.keptMs * 2, KEEP_FAILURE_MS), MAX_KEEP_FAILURE_MS);
}

/** One lookup through the cache: the answer, or "failed" (logged, the domain not named). */
async function cachedLookup<K extends DomainLookupKind>(
  deps: LookupDeps,
  ws: string,
  key: { domain: string; kind: K },
  ask: () => Promise<DomainLookupResults[K]>,
  log: Logger,
): Promise<DomainLookupResults[K] | "failed"> {
  const now = deps.clock.now();
  const cached = await getDomainLookup(deps.db, ws, { ...key, now });
  if (cached?.ok) return cached.result;
  if (cached) {
    log.warn("sender.lookup_incomplete", { kind: key.kind, cached: true });
    return "failed";
  }
  try {
    const result = await ask();
    const expiresAt = new Date(now.getTime() + KEEP_MS[key.kind]);
    await saveDomainLookup(deps.db, ws, { ...key, ok: true, result, at: now, expiresAt });
    return result;
  } catch (error) {
    const expiresAt = new Date(now.getTime() + (await keepFailureMs(deps, ws, key)));
    await saveDomainLookup(deps.db, ws, { ...key, ok: false, at: now, expiresAt });
    log.warn("sender.lookup_incomplete", {
      kind: key.kind,
      cached: false,
      error: error instanceof Error ? error.name : "unknown",
    });
    return "failed";
  }
}

/** The domain's age and MX records for the sender check, through the workspace's cache. */
export async function lookupDomain(
  deps: LookupDeps,
  ws: string,
  domain: string,
  log: Logger,
): Promise<DomainFacts> {
  const [rdap, mx] = await Promise.all([
    cachedLookup(deps, ws, { domain, kind: "rdap" }, () => deps.domains.rdap(domain), log),
    cachedLookup(deps, ws, { domain, kind: "mx" }, () => deps.domains.mx(domain), log),
  ]);
  return { rdap, mx };
}
