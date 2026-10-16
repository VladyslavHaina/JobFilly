import {
  type AppliedMark,
  type AppliedSenderMark,
  LOOKUP_FAILED_SIGNAL,
  type MxLookupResult,
  MxLookupResultSchema,
  type RdapLookupResult,
  RdapLookupResultSchema,
  type SenderMark,
  type SenderMarkScope,
} from "@jobfilly/schema";
import { and, eq, gt, or, type SQL, sql } from "drizzle-orm";
import type { Database } from "../client";
import { domainLookups, messages, senderChecks, senderMarks } from "../tables";
import { fromDomain } from "./sender-domain";

// The sender check's own state (F5): an editor's trusted or blocked marks on an address or a
// domain (sender_marks, F5.4), kept across syncs because they are keyed by the sender, not by a
// message; and the cache of domain lookups (domain_lookups, TBD-165), per workspace. The checks
// themselves are saved and read with saveSenderCheck and getSenderChecks in ./evaluations.ts.

/** Marks an address or a domain trusted or blocked (lower case), replacing an earlier mark. */
export async function setSenderMark(
  db: Database,
  workspaceId: string,
  input: { scope: SenderMarkScope; value: string; mark: SenderMark; userId: string; at: Date },
): Promise<void> {
  const value = input.value.toLowerCase();
  const set = { mark: input.mark, markedBy: input.userId, markedAt: input.at };
  await db
    .insert(senderMarks)
    .values({ workspaceId, scope: input.scope, value, ...set })
    .onConflictDoUpdate({
      target: [senderMarks.workspaceId, senderMarks.scope, senderMarks.value],
      set,
    });
}

/** Clears the mark on an address or a domain; false when there was none. */
export async function clearSenderMark(
  db: Database,
  workspaceId: string,
  input: { scope: SenderMarkScope; value: string },
): Promise<boolean> {
  const rows = await db
    .delete(senderMarks)
    .where(
      and(
        eq(senderMarks.workspaceId, workspaceId),
        eq(senderMarks.scope, input.scope),
        eq(senderMarks.value, input.value.toLowerCase()),
      ),
    )
    .returning({ id: senderMarks.id });
  return rows.length > 0;
}

/** The mark that applies to a sender: on its address if any, otherwise on its domain. */
export async function findSenderMark(
  db: Database,
  workspaceId: string,
  address: string,
): Promise<AppliedMark | null> {
  const lower = address.toLowerCase();
  const domain = lower.includes("@") ? lower.slice(lower.lastIndexOf("@") + 1) : null;
  const rows = await db
    .select({ mark: senderMarks.mark, scope: senderMarks.scope, value: senderMarks.value })
    .from(senderMarks)
    .where(
      and(
        eq(senderMarks.workspaceId, workspaceId),
        or(
          and(eq(senderMarks.scope, "address"), eq(senderMarks.value, lower)),
          domain ? and(eq(senderMarks.scope, "domain"), eq(senderMarks.value, domain)) : undefined,
        ),
      ),
    );
  return rows.find((r) => r.scope === "address") ?? rows[0] ?? null;
}

/**
 * The mark that applies to a message's sender now (findSenderMark), the address read from the
 * workspace's own message row; null when the workspace has no such message. Keyed by the message
 * so the sender's address never travels in a URL.
 */
export async function findMessageSenderMark(
  db: Database,
  workspaceId: string,
  messageId: string,
): Promise<AppliedSenderMark | null> {
  const [row] = await db
    .select({ fromAddress: messages.fromAddress })
    .from(messages)
    .where(and(eq(messages.workspaceId, workspaceId), eq(messages.messageId, messageId)));
  if (!row) return null;
  return { applied: await findSenderMark(db, workspaceId, row.fromAddress) };
}

export type DomainLookupKind = "rdap" | "mx";

/** What a lookup of each kind found, as the cache keeps it (packages/schema). */
export interface DomainLookupResults {
  rdap: RdapLookupResult;
  mx: MxLookupResult;
}

const RESULT_SCHEMAS = { rdap: RdapLookupResultSchema, mx: MxLookupResultSchema } as const;

/** A cached lookup that hasn't expired: what it found, or that it failed. */
export type CachedDomainLookup<K extends DomainLookupKind> =
  | { ok: true; result: DomainLookupResults[K] }
  | { ok: false };

/**
 * A cached lookup that hasn't expired, or null. A stored answer that doesn't fit its kind's
 * schema (a corrupt row) is null too, a cache miss to look up again, never "no mail servers".
 */
export async function getDomainLookup<K extends DomainLookupKind>(
  db: Database,
  workspaceId: string,
  input: { domain: string; kind: K; now: Date },
): Promise<CachedDomainLookup<K> | null> {
  const [row] = await db
    .select({ ok: domainLookups.ok, result: domainLookups.result })
    .from(domainLookups)
    .where(
      and(
        eq(domainLookups.workspaceId, workspaceId),
        eq(domainLookups.domain, input.domain.toLowerCase()),
        eq(domainLookups.kind, input.kind),
        gt(domainLookups.expiresAt, input.now),
      ),
    );
  if (!row) return null;
  if (!row.ok) return { ok: false };
  const parsed = RESULT_SCHEMAS[input.kind].safeParse(row.result);
  return parsed.success ? { ok: true, result: parsed.data as DomainLookupResults[K] } : null;
}

/**
 * How long the last lookup of this kind was kept when it failed, whether or not it has expired;
 * null when the last one worked or there was none. The server keeps a repeated failure longer.
 */
export async function lastLookupFailure(
  db: Database,
  workspaceId: string,
  input: { domain: string; kind: DomainLookupKind },
): Promise<{ keptMs: number } | null> {
  const [row] = await db
    .select({ lookedUpAt: domainLookups.lookedUpAt, expiresAt: domainLookups.expiresAt })
    .from(domainLookups)
    .where(
      and(
        eq(domainLookups.workspaceId, workspaceId),
        eq(domainLookups.domain, input.domain.toLowerCase()),
        eq(domainLookups.kind, input.kind),
        eq(domainLookups.ok, false),
      ),
    );
  return row ? { keptMs: row.expiresAt.getTime() - row.lookedUpAt.getTime() } : null;
}

/** Caches a lookup's outcome until `expiresAt`, replacing an earlier one. */
export async function saveDomainLookup<K extends DomainLookupKind>(
  db: Database,
  workspaceId: string,
  input: { domain: string; kind: K; at: Date; expiresAt: Date } & CachedDomainLookup<K>,
): Promise<void> {
  const set = {
    ok: input.ok,
    result: input.ok ? input.result : null,
    lookedUpAt: input.at,
    expiresAt: input.expiresAt,
  };
  await db
    .insert(domainLookups)
    .values({ workspaceId, domain: input.domain.toLowerCase(), kind: input.kind, ...set })
    .onConflictDoUpdate({
      target: [domainLookups.workspaceId, domainLookups.domain, domainLookups.kind],
      set,
    });
}

// --- Checks whose domain lookup failed (F5.3): looked up again once the failure has expired. ---

/**
 * A current check whose lookup failed, of a sender whose domain no longer has a failure in the
 * cache: looking it up again may now work. The failure is kept longer each time it repeats, so a
 * domain whose lookup always fails (a registry without RDAP) is retried less and less often.
 */
function retryableCheck(now: Date): SQL {
  const failedSignal = JSON.stringify([{ signal: LOOKUP_FAILED_SIGNAL }]);
  return sql`${senderChecks.stale} = false
    and ${senderChecks.reasons} @> ${failedSignal}::jsonb
    and exists (
      select 1 from ${messages}
      where ${messages.workspaceId} = ${senderChecks.workspaceId}
        and ${messages.messageId} = ${senderChecks.messageId}
        and not exists (
          select 1 from ${domainLookups}
          where ${domainLookups.workspaceId} = ${senderChecks.workspaceId}
            and ${domainLookups.domain} = ${fromDomain}
            and ${domainLookups.ok} = false
            and ${domainLookups.expiresAt} > ${now.toISOString()}::timestamptz
        )
    )`;
}

/**
 * The workspaces with a check to look up again (retryableCheck). Reads across workspaces, like
 * listWorkspacesWithWork: only the sweep calls it, then marks each workspace's checks itself.
 */
export async function listWorkspacesWithFailedLookups(db: Database, now: Date): Promise<string[]> {
  const rows = await db
    .selectDistinct({ workspaceId: senderChecks.workspaceId })
    .from(senderChecks)
    .where(retryableCheck(now));
  return rows.map((r) => r.workspaceId);
}

/**
 * Marks the workspace's checks to look up again stale (retryableCheck), so the next pipeline run
 * checks those messages again. Returns how many went stale.
 */
export async function markFailedLookupChecksStale(
  db: Database,
  workspaceId: string,
  now: Date,
): Promise<number> {
  const rows = await db
    .update(senderChecks)
    .set({ stale: true, staleSince: now })
    .where(and(eq(senderChecks.workspaceId, workspaceId), retryableCheck(now)))
    .returning({ messageId: senderChecks.messageId });
  return rows.length;
}
