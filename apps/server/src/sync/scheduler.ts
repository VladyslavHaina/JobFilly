import type { AppDeps } from "../deps";
import type { Logger } from "../log";
import { sweep } from "../pipeline/sweep";
import { enqueueSyncs } from "./jobs";

// The scheduler (F1): every JOBFILLY_SYNC_INTERVAL_SECONDS it enqueues a mail.sync for each
// mailbox that is due (sync/jobs.ts: its first scan stopped, not backing off), then runs the
// pipeline sweep, whatever the syncs did, so a failed evaluation or a draft that failed with kind
// mailbox or ai is retried within one interval. It only enqueues: whichever replica claims a job
// runs it, and the dedupe key keeps one sync per mailbox across replicas (F1.2).

export interface Scheduler {
  start(): void;
  /** Whether it ticks (between start and stop). */
  readonly running: boolean;
  /** One round: the syncs, then the sweep. Never throws; failures are logged. */
  tick(): Promise<void>;
  stop(): void;
}

export function createScheduler(
  deps: AppDeps,
  options: {
    intervalMs?: number;
    sweep?: (deps: AppDeps) => Promise<unknown>;
    syncs?: (deps: AppDeps) => Promise<unknown>;
  } = {},
): Scheduler {
  const intervalMs = options.intervalMs ?? deps.config.syncIntervalSeconds * 1000;
  const runSweep = options.sweep ?? sweep;
  const runSyncs = options.syncs ?? enqueueSyncs;
  const log: Logger = deps.log;
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false;

  const tick = async () => {
    try {
      await runSyncs(deps);
    } catch (error) {
      // The syncs couldn't even be queued (the database is unreachable): the next tick retries.
      log.warn("sync.failed", { cause: "schedule_error", error });
    }
    try {
      await runSweep(deps);
    } catch (error) {
      log.warn("pipeline.sweep_failed", { error });
    }
  };

  return {
    start() {
      // A round still running when the next is due is not started twice.
      timer ??= setInterval(() => {
        if (busy) return;
        busy = true;
        void tick().finally(() => {
          busy = false;
        });
      }, intervalMs);
    },
    tick,
    get running() {
      return timer !== null;
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
