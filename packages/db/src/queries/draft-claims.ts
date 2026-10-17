import type { DraftFailureKind, DraftOrigin } from "@jobfilly/schema";
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { Database } from "../client";
import { decisionMessages, drafts } from "../tables";
import type { RoleRef } from "./evaluations";

// The role-level draft lifecycle the pipeline needs. The replies
// slice's drafts.ts owns a draft's content and edits; this module owns who may write a role's
// draft and when it is tried again.
//
//   claimDraft        inserts the role's one live row in status `saving`: only the caller whose
//                     insert wins writes to the mailbox (the partial unique index on live rows)
//   releaseDraftClaim deletes a `saving` row whose draft.v1 answer raised questions, in the
//                     transaction that records the needs, so the role still counts as never
//                     drafted and gets its draft once the decision is answered
//   markDraftFailed   `failed` with a kind: `mailbox` (the mail server) and `ai` (the draft.v1
//                     call gave no draft) are retried, `content` never automatically
//   listDraftsToRetry failed with kind mailbox or ai and fewer than 5 attempts, and `saving`
//                     rows claimed more than 5 minutes ago (their job died)
//   reclaimDraft      takes one of those back to `saving`, attempts + 1, single-flight
//   draftHistory      whether a role ever had a draft (any status) or was dismissed, which holds
//                     automatic drafts back for good (replyEligibility in packages/core)

/** A draft is tried at most this many times by the sweep. */
export const DRAFT_MAX_ATTEMPTS = 5;
/** The failure kinds the sweep retries; `content` waits for Draft a reply. */
const RETRIED_KINDS: readonly DraftFailureKind[] = ["mailbox", "ai"];

/** A `saving` claim older than this belongs to a job that died. */
export const DRAFT_SAVING_TIMEOUT_MS = 5 * 60_000;

/** The key of a role in maps: "<Message-ID>#<position>". */
export function roleKey(role: RoleRef): string {
  return `${role.messageId}#${role.position}`;
}

export interface DraftHistory {
  /** A draft row of any status ever existed for the role. */
  hadDraft: boolean;
  /** "Don't ask for this message" was chosen for the role (F7.5). */
  dismissed: boolean;
}

/** Each role's draft history, keyed by roleKey. */
export async function draftHistory(
  db: Database,
  workspaceId: string,
  roles: readonly RoleRef[],
): Promise<Map<string, DraftHistory>> {
  const out = new Map<string, DraftHistory>();
  for (const r of roles) out.set(roleKey(r), { hadDraft: false, dismissed: false });
  if (roles.length === 0) return out;
  const ids = [...new Set(roles.map((r) => r.messageId))];
  const had = await db
    .selectDistinct({ messageId: drafts.messageId, position: drafts.position })
    .from(drafts)
    .where(and(eq(drafts.workspaceId, workspaceId), inArray(drafts.messageId, ids)));
  for (const r of had) {
    const entry = out.get(roleKey(r));
    if (entry) entry.hadDraft = true;
  }
  const dismissed = await db
    .selectDistinct({ messageId: decisionMessages.messageId, position: decisionMessages.position })
    .from(decisionMessages)
    .where(
      and(
        eq(decisionMessages.workspaceId, workspaceId),
        inArray(decisionMessages.messageId, ids),
        eq(decisionMessages.state, "dismissed"),
      ),
    );
  for (const r of dismissed) {
    const entry = out.get(roleKey(r));
    if (entry) entry.dismissed = true;
  }
  return out;
}

/**
 * Claims the role's draft: a new row in status `saving`. For on_demand (Draft a reply) a failed
 * row is taken back to `saving` instead, as the index allows one live row. Null when another
 * claim won (a live row exists).
 */
export async function claimDraft(
  db: Database,
  workspaceId: string,
  role: RoleRef,
  input: { origin: DraftOrigin; now: Date; userId?: string | null },
): Promise<{ id: string } | null> {
  const [row] = await db
    .insert(drafts)
    .values({
      workspaceId,
      messageId: role.messageId,
      position: role.position,
      status: "saving",
      attempts: 1,
      claimedAt: input.now,
      origin: input.origin,
      createdBy: input.userId ?? null,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing({
      target: [drafts.workspaceId, drafts.messageId, drafts.position],
      where: sql`status <> 'discarded'`,
    })
    .returning({ id: drafts.id });
  if (row) return row;
  if (input.origin !== "on_demand") return null;
  const [reused] = await db
    .update(drafts)
    .set({
      status: "saving",
      claimedAt: input.now,
      attempts: sql`${drafts.attempts} + 1`,
      origin: "on_demand",
      failureKind: null,
      failureReason: null,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(drafts.workspaceId, workspaceId),
        eq(drafts.messageId, role.messageId),
        eq(drafts.position, role.position),
        eq(drafts.status, "failed"),
      ),
    )
    .returning({ id: drafts.id });
  return reused ?? null;
}

/**
 * Lets go of a claim whose draft.v1 answer raised questions: the `saving` row is deleted, so the
 * role still counts as never drafted. Pass the transaction that records the needs.
 */
export async function releaseDraftClaim(
  db: Database,
  workspaceId: string,
  draftId: string,
): Promise<boolean> {
  const rows = await db
    .delete(drafts)
    .where(
      and(eq(drafts.workspaceId, workspaceId), eq(drafts.id, draftId), eq(drafts.status, "saving")),
    )
    .returning({ id: drafts.id });
  return rows.length > 0;
}

/** Marks a claimed draft failed, with why in plain words (F6.7). */
export async function markDraftFailed(
  db: Database,
  workspaceId: string,
  draftId: string,
  input: { kind: DraftFailureKind; reason: string; now: Date },
): Promise<boolean> {
  const rows = await db
    .update(drafts)
    .set({
      status: "failed",
      failureKind: input.kind,
      failureReason: input.reason,
      claimedAt: null,
      updatedAt: input.now,
    })
    .where(
      and(eq(drafts.workspaceId, workspaceId), eq(drafts.id, draftId), eq(drafts.status, "saving")),
    )
    .returning({ id: drafts.id });
  return rows.length > 0;
}

export interface DraftToRetry extends RoleRef {
  id: string;
  attempts: number;
  status: "failed" | "saving";
}

function retryable(workspaceId: string, now: Date) {
  const cutoff = new Date(now.getTime() - DRAFT_SAVING_TIMEOUT_MS);
  return and(
    eq(drafts.workspaceId, workspaceId),
    lt(drafts.attempts, DRAFT_MAX_ATTEMPTS),
    or(
      and(eq(drafts.status, "failed"), inArray(drafts.failureKind, [...RETRIED_KINDS])),
      and(eq(drafts.status, "saving"), lt(drafts.claimedAt, cutoff)),
    ),
  );
}

/**
 * The drafts the sweep tries again: failed with kind mailbox or ai, and `saving` rows claimed
 * more than 5 minutes ago, each with fewer than 5 attempts. A content failure is never retried
 * automatically. A draft that used up its attempts stays failed with its reason on the Drafts
 * page (F6.7), and Draft a reply takes it back.
 */
export async function listDraftsToRetry(
  db: Database,
  workspaceId: string,
  now: Date,
): Promise<DraftToRetry[]> {
  const rows = await db
    .select({
      id: drafts.id,
      messageId: drafts.messageId,
      position: drafts.position,
      attempts: drafts.attempts,
      status: drafts.status,
    })
    .from(drafts)
    .where(retryable(workspaceId, now));
  return rows.map((r) => ({ ...r, status: r.status as "failed" | "saving" }));
}

/** Takes a retryable draft back to `saving`, attempts + 1; false when another caller did. */
export async function reclaimDraft(
  db: Database,
  workspaceId: string,
  draftId: string,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(drafts)
    .set({
      status: "saving",
      claimedAt: now,
      attempts: sql`${drafts.attempts} + 1`,
      failureKind: null,
      failureReason: null,
      updatedAt: now,
    })
    .where(and(eq(drafts.id, draftId), retryable(workspaceId, now)))
    .returning({ id: drafts.id });
  return rows.length > 0;
}

/** The draft row's claim state (status, failure kind, attempts, origin), or null. */
export async function getDraftClaim(db: Database, workspaceId: string, draftId: string) {
  const [row] = await db
    .select({
      status: drafts.status,
      failureKind: drafts.failureKind,
      attempts: drafts.attempts,
      origin: drafts.origin,
    })
    .from(drafts)
    .where(and(eq(drafts.workspaceId, workspaceId), eq(drafts.id, draftId)));
  return row ?? null;
}
