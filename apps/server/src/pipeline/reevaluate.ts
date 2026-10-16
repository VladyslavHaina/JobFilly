import {
  type DraftToRetry,
  getDraftClaim,
  listDraftsToRetry,
  listToEvaluate,
  markDraftFailed,
  reclaimDraft,
  roleKey,
  type ToEvaluate,
} from "@jobfilly/db";
import {
  DRAFT_CREATE_JOB,
  jobDedupeKey,
  PIPELINE_REEVALUATE_JOB,
  type PipelineReevaluatePayload,
} from "@jobfilly/schema";
import type { AppDeps } from "../deps";
import { enqueue, type JobHandler } from "../jobs/queue";
import { evaluateMessage, mailboxSession } from "./evaluate";
import { retryPlan } from "./reply";
import type { Stages } from "./stages";

// The pipeline.reevaluate job (dedupe key reevaluate:<workspaceId>): it evaluates every job
// message whose evaluation or sender check is missing or stale, which covers the first scan's
// backlog (F1.6) and every later change (rules, profile, decisions, CVs, sender marks, undo).
//
// - It snapshots listToEvaluate when it starts and works through it in batches, each message at
//   most once per run, so a failing AI or mailbox can't make it loop: what fails waits for the
//   next sweep. The run's messages share one mailbox connection, opened when the first sender
//   check needs a body; a message gone from the mailbox gets an incomplete check and leaves the
//   work list (evaluate.ts).
// - Then it re-claims the drafts to retry (failed with kind mailbox or ai, or a saving claim whose
//   job died) and enqueues draft.create with origin retry for each. Each is checked against the
//   reply policy first (retryPlan, ./reply.ts): one it holds (the message left the reply window,
//   the sender is high risk, a rule holds it…) is marked failed with kind content and the hold's
//   reason, which the sweep never retries; one whose role has no current evaluation or sender
//   check waits for the next run.
// - If anything is missing or stale because of a change made during the run (new mail, or an
//   item marked stale after it started), it enqueues the next run; this one is still running, so
//   the next one queues.

const BATCH = 20;

export interface ReevaluateOutcome {
  processed: number;
  retried: number;
  next: boolean;
}

const roleKeys = (item: ToEvaluate) => [
  ...(item.sender ? [`${item.messageId}#sender`] : []),
  ...item.roles.map((r) => roleKey({ messageId: item.messageId, position: r.position })),
];

/** Whether the listing holds work the run's snapshot didn't, or work marked stale since `since`. */
function changedDuringRun(snapshot: Set<string>, after: ToEvaluate[], since: Date): boolean {
  for (const item of after) {
    const restaled = [item.sender?.staleSince ?? null, ...item.roles.map((r) => r.staleSince)].some(
      (at) => at !== null && at >= since,
    );
    if (restaled) return true;
    if (roleKeys(item).some((key) => !snapshot.has(key))) return true;
  }
  return false;
}

export async function reevaluateWorkspace(
  deps: AppDeps,
  workspaceId: string,
  options: { signal?: AbortSignal; stages?: Stages; renewLease?: () => Promise<void> } = {},
): Promise<ReevaluateOutcome> {
  const started = deps.clock.now();
  const work = await listToEvaluate(deps.db, workspaceId);
  const snapshot = new Set(work.flatMap(roleKeys));
  let processed = 0;
  const mailbox = mailboxSession(deps, workspaceId);
  try {
    for (let i = 0; i < work.length; i += BATCH) {
      for (const item of work.slice(i, i + BATCH)) {
        options.signal?.throwIfAborted();
        const never =
          item.sender?.state === "missing" && item.roles.every((r) => r.state === "missing");
        await evaluateMessage(deps, workspaceId, item.messageId, {
          origin: never ? "backlog" : "reevaluate",
          stages: options.stages,
          mailbox,
        });
        processed += 1;
      }
      await options.renewLease?.();
    }
  } finally {
    await mailbox.close();
  }

  const retries: DraftToRetry[] = await listDraftsToRetry(deps.db, workspaceId, deps.clock.now());
  let retried = 0;
  for (const draft of retries) {
    const claim = await getDraftClaim(deps.db, workspaceId, draft.id);
    if (!claim) continue;
    const plan = await retryPlan(
      deps,
      workspaceId,
      { ...draft, origin: claim.origin },
      deps.clock.now(),
    );
    if (plan.kind === "wait") continue;
    if (!(await reclaimDraft(deps.db, workspaceId, draft.id, deps.clock.now()))) continue;
    if (plan.kind === "hold") {
      // Held for good: failed with a kind the sweep never retries, and why; Draft a reply can
      // still take it back (F6.5).
      await markDraftFailed(deps.db, workspaceId, draft.id, {
        kind: "content",
        reason: `Not tried again: ${plan.reason}`,
        now: deps.clock.now(),
      });
      await deps.live.publish(workspaceId, {
        type: "drafts.updated",
        data: { messageIds: [draft.messageId] },
      });
      continue;
    }
    await enqueue(deps, workspaceId, {
      type: DRAFT_CREATE_JOB,
      payload: {
        workspaceId,
        messageId: draft.messageId,
        position: draft.position,
        origin: "retry",
      },
      dedupeKey: jobDedupeKey.draft(workspaceId, draft.messageId, draft.position),
    });
    retried += 1;
  }

  const next = changedDuringRun(snapshot, await listToEvaluate(deps.db, workspaceId), started);
  if (next) await requestRun(deps, workspaceId, "changed_during_run");
  return { processed, retried, next };
}

/** Enqueues a re-evaluation of the workspace (deduped: at most one waits). */
export function requestRun(deps: AppDeps, workspaceId: string, reason: string) {
  return enqueue(deps, workspaceId, {
    type: PIPELINE_REEVALUATE_JOB,
    payload: { workspaceId, reason } satisfies PipelineReevaluatePayload,
    dedupeKey: jobDedupeKey.reevaluate(workspaceId),
  });
}

export const pipelineReevaluateHandler: JobHandler<PipelineReevaluatePayload> = async (ctx) => {
  await reevaluateWorkspace(ctx.deps, ctx.payload.workspaceId, {
    signal: ctx.signal,
    renewLease: ctx.renewLease,
  });
};
