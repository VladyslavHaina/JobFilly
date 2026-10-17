import type { AppDeps } from "./deps";
import { sweep } from "./pipeline/sweep";
import type { Scheduler } from "./sync/scheduler";

// What a replica starts once its database is reachable and migrated (index.ts), before it says
// it is ready: one pipeline sweep, so a deployment whose profile was confirmed before MVP 2 ran
// gets its backlog evaluated without anyone doing anything (F1.6); then the job queue,
// which runs that re-evaluation; then the scheduler, which syncs and sweeps every
// JOBFILLY_SYNC_INTERVAL_SECONDS. A failed sweep is logged and the next tick tries again.

export async function startWork(deps: AppDeps, scheduler: Pick<Scheduler, "start">): Promise<void> {
  await sweep(deps).catch((error: unknown) => deps.log.warn("pipeline.sweep_failed", { error }));
  deps.queue.start();
  scheduler.start();
}
