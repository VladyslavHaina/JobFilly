import type { AppDeps } from "../deps";
import type { Logger } from "../log";
import { sweep } from "../pipeline/sweep";

// The scheduler (F1): every JOBFILLY_SYNC_INTERVAL_SECONDS it starts each mailbox's sync and runs
// the pipeline sweep, whatever the syncs did, so a failed evaluation or a draft that failed with
// kind mailbox or ai is retried within one interval. The mailbox slice adds the syncs to `tick` and
// keeps the sweep call (its test asserts it).

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
  options: { intervalMs?: number; sweep?: (deps: AppDeps) => Promise<unknown> } = {},
): Scheduler {
  const intervalMs = options.intervalMs ?? deps.config.syncIntervalSeconds * 1000;
  const runSweep = options.sweep ?? sweep;
  const log: Logger = deps.log;
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false;

  const tick = async () => {
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
