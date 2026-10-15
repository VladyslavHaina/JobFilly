import { randomUUID } from "node:crypto";
import { type AppliedChanges, applyChanges, type ChangeError } from "@jobfilly/core";
import {
  type ApplyProfileChangesResult,
  applyProfileChanges,
  type Database,
  markStale,
  type StaleScope,
} from "@jobfilly/db";
import type { Change, ProfileSource } from "@jobfilly/schema";
import type { AppDeps } from "../deps";
import { requestRun } from "../pipeline/reevaluate";

// The profile change service (ARCHITECTURE › The profile change service). Every change to a
// profile's entries and rules goes through applyAndReevaluate: the profile form (source you), a
// decision answer (decision), an applied proposal (assistant) and Undo. It applies the Change
// semantics of packages/core (applyChanges), writes the profile, its rules and the history row in
// one transaction, and asks for a re-evaluation of every role, so the inbox reflects the change
// within a minute (F3.5, F4.6, F7.4, F8.3).
//
// requestReevaluation is the one way to make evaluations stale. Its triggers, each with its
// owner: intake confirm (foundation), a profile or rule change (here), a finished CV read and a
// CV delete (cvs-senders), a CV-choice override (cvs-senders), a sender mark (cvs-senders, sender
// scopes), a decision answer (replies), apply and undo (assistant).

/**
 * Marks the scope's evaluations stale (and, for a sender scope only, the sender checks), asks
 * for a deduped pipeline.reevaluate, and tells open inboxes their scores are stale meanwhile.
 */
export async function requestReevaluation(
  deps: AppDeps,
  ws: string,
  scope: StaleScope,
  reason: string,
): Promise<void> {
  await markStale(deps.db, ws, scope, deps.clock.now());
  await requestRun(deps, ws, reason);
  await deps.live.publish(ws, { type: "messages.updated", data: {} });
}

export interface ChangeRequest {
  source: Exclude<ProfileSource, "scan">;
  userId: string | null;
  /** The words behind it (the assistant request, the decision's question), or null. */
  request: string | null;
}

/**
 * Applies `changes` to the profile (one transaction, with its history row), then re-evaluates
 * every role and sends profiles.updated. Null when the workspace has no such profile; a change
 * that doesn't apply (an invalid value, an unknown rule) comes back as its error and nothing is
 * written.
 */
export async function applyAndReevaluate(
  deps: AppDeps,
  ws: string,
  profileId: string,
  changes: readonly Change[],
  meta: ChangeRequest,
): Promise<ApplyProfileChangesResult<ChangeError> | null> {
  const result = await writeProfileChanges(deps, deps.db, ws, profileId, changes, meta);
  if (result?.ok) await afterProfileChanges(deps, ws, result, meta.source);
  return result;
}

/**
 * applyAndReevaluate's write alone, on `db`: a decision answer passes the transaction that
 * answers the decision, so the profile changes only when the answer is claimed (F7.4). The
 * caller runs afterProfileChanges once that transaction is committed.
 */
export function writeProfileChanges(
  deps: AppDeps,
  db: Database,
  ws: string,
  profileId: string,
  changes: readonly Change[],
  meta: ChangeRequest,
): Promise<ApplyProfileChangesResult<ChangeError> | null> {
  const at = deps.clock.now();
  return applyProfileChanges(db, ws, profileId, changes, {
    ...meta,
    at,
    apply: (state, list): AppliedChanges =>
      applyChanges({ entries: state.profile.entries, rules: state.rules }, list, {
        profileId,
        source: meta.source,
        userId: meta.userId,
        at: at.toISOString(),
        newRuleId: randomUUID,
      }),
  });
}

/** What follows a written change: the re-evaluation of every role, and profiles.updated. */
export async function afterProfileChanges(
  deps: AppDeps,
  ws: string,
  result: Extract<ApplyProfileChangesResult<ChangeError>, { ok: true }>,
  source: ChangeRequest["source"],
): Promise<void> {
  if (result.entry) {
    await requestReevaluation(deps, ws, { all: true }, `profile.${source}`);
  }
  await deps.live.publish(ws, { type: "profiles.updated", data: {} });
}
