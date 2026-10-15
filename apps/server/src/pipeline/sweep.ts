import { listWorkspacesWithWork } from "@jobfilly/db";
import { jobDedupeKey, PIPELINE_REEVALUATE_JOB } from "@jobfilly/schema";
import type { AppDeps } from "../deps";
import { enqueue } from "../jobs/queue";

// The pinned backlog and retry trigger (TBD-191): one deduped pipeline.reevaluate for every
// workspace with pipeline work (a confirmed profile, and something missing or stale to evaluate,
// or a draft to retry). startWork (../start.ts) runs it once at startup, so a deployment whose
// profile was confirmed before MVP 2 is evaluated without any user action (F1.6); the scheduler
// (sync/scheduler.ts) runs it every JOBFILLY_SYNC_INTERVAL_SECONDS whatever the syncs did, so a
// role whose evaluation failed and a draft that failed with kind mailbox or ai are retried
// within one interval. listWorkspacesWithWork reads across workspaces, like the job claim.

/** Enqueues the re-evaluations; returns how many workspaces got one (a waiting one counts). */
export async function sweep(deps: AppDeps): Promise<number> {
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
