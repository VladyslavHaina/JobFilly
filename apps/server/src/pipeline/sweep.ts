import { listWorkspacesWithWork } from "@jobfilly/db";
import { jobDedupeKey, PIPELINE_REEVALUATE_JOB } from "@jobfilly/schema";
import type { AppDeps } from "../deps";
import { enqueue } from "../jobs/queue";
import { retryFailedLookups } from "../senders/retry";

// The pinned backlog and retry trigger: one deduped pipeline.reevaluate for every
// workspace with pipeline work (a confirmed profile, and something missing or stale to evaluate,
// or a draft to retry). startWork (../start.ts) runs it once at startup, so a deployment whose
// profile was confirmed before MVP 2 is evaluated without any user action (F1.6); the scheduler
// (sync/scheduler.ts) runs it every JOBFILLY_SYNC_INTERVAL_SECONDS whatever the syncs did, so a
// role whose evaluation failed and a draft that failed with kind mailbox or ai are retried
// within one interval. A stage that fails again then waits a back-off (one interval, doubling up
// to an hour, stage_failures in packages/db): listWorkspacesWithWork counts only what is due at
// the clock's time, so a workspace whose only work is waiting gets no run. It reads across
// workspaces, like the job claim. First, the sender checks whose domain lookup failed and whose
// failure has expired are marked stale (senders/retry.ts), so they are checked again in the same
// run (F5.3).

/** Enqueues the re-evaluations; returns how many workspaces got one (a waiting one counts). */
export async function sweep(deps: AppDeps): Promise<number> {
  await retryFailedLookups(deps);
  const workspaces = await listWorkspacesWithWork(deps.db, deps.clock.now());
  for (const workspaceId of workspaces) {
    await enqueue(deps, workspaceId, {
      type: PIPELINE_REEVALUATE_JOB,
      payload: { workspaceId, reason: "sweep" },
      dedupeKey: jobDedupeKey.reevaluate(workspaceId),
    });
  }
  return workspaces.length;
}
