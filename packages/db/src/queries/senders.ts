import type { SenderMark } from "@jobfilly/schema";
import { and, eq, gt, or } from "drizzle-orm";
import type { Database } from "../client";
import { domainLookups, senderMarks } from "../tables";

// The sender check's own state (F5): an editor's trusted or blocked marks on an address or a
// domain (sender_marks, F5.4), kept across syncs because they are keyed by the sender, not by a
// message; and the cache of domain lookups (domain_lookups, TBD-165), per workspace. The checks
// themselves are saved and read with saveSenderCheck and getSenderChecks in ./evaluations.ts.

export type SenderMarkScope = "address" | "domain";

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
): Promise<{ mark: SenderMark; scope: SenderMarkScope; value: string } | null> {
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

export type DomainLookupKind = "rdap" | "mx";

/** A cached lookup that hasn't expired: whether it worked and what it found. */
export async function getDomainLookup(
  db: Database,
  workspaceId: string,
  input: { domain: string; kind: DomainLookupKind; now: Date },
): Promise<{ ok: boolean; result: unknown } | null> {
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
  return row ?? null;
}

/** Caches a lookup's outcome until `expiresAt`, replacing an earlier one. */
export async function saveDomainLookup(
  db: Database,
  workspaceId: string,
  input: {
    domain: string;
    kind: DomainLookupKind;
    ok: boolean;
    result: unknown;
    at: Date;
    expiresAt: Date;
  },
): Promise<void> {
  const set = {
    ok: input.ok,
    result: input.result ?? null,
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
