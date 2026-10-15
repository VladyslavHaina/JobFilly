import { claimDraft, type RoleRef } from "@jobfilly/db";
import { DRAFT_CREATE_JOB, type DraftOrigin, jobDedupeKey } from "@jobfilly/schema";
import type { AppDeps } from "../deps";
import { enqueue } from "../jobs/queue";

/**
 * Claims the role's draft (a `saving` row; for Draft a reply a failed row is taken back) and
 * enqueues draft.create to write it. Null when the role has a live draft already: the claim went
 * to someone else, so nothing more is saved to the mailbox (F6.4).
 */
export async function requestDraft(
  deps: AppDeps,
  ws: string,
  role: RoleRef,
  input: { origin: Exclude<DraftOrigin, "retry">; userId?: string | null },
): Promise<{ id: string } | null> {
  const claim = await claimDraft(deps.db, ws, role, {
    origin: input.origin,
    now: deps.clock.now(),
    userId: input.userId ?? null,
  });
  if (!claim) return null;
  await enqueue(deps, ws, {
    type: DRAFT_CREATE_JOB,
    payload: {
      workspaceId: ws,
      messageId: role.messageId,
      position: role.position,
      origin: input.origin,
    },
    dedupeKey: jobDedupeKey.draft(ws, role.messageId, role.position),
  });
  await deps.live.publish(ws, { type: "drafts.updated", data: { messageIds: [role.messageId] } });
  return claim;
}
