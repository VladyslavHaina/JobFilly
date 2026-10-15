import type { BackgroundWork, Health } from "./deps";
import type { JobQueue } from "./jobs/queue";
import type { LiveHub } from "./live";
import type { Logger } from "./log";
import type { RunningServer } from "./node";
import type { Scheduler } from "./sync/scheduler";

// Graceful shutdown on SIGTERM, in the order of ARCHITECTURE › Kubernetes readiness: the
// scheduler stops starting syncs and sweeps; readiness turns 503 at once; a drain so load
// balancers stop routing here; stop accepting connections and close the live-update streams
// (browsers reconnect elsewhere); in-flight requests get up to 20 seconds; running jobs hand back
// their leases while background work (the intake.v1 call) is aborted and releases its claim,
// both while the database is still open; then the caller exits 0.

export interface ShutdownTargets {
  health: Health;
  log: Logger;
  server: RunningServer;
  live: LiveHub;
  queue: JobQueue;
  background: BackgroundWork;
  /** Stops at once, so no new sync or sweep starts during shutdown. */
  scheduler?: Pick<Scheduler, "stop">;
  /** Closes the database last. */
  closeDatabase(): Promise<void>;
}

export interface ShutdownOptions {
  drainMs?: number;
  inflightMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const DRAIN_MS = 5000;
export const INFLIGHT_MS = 20_000;

export async function shutdown(targets: ShutdownTargets, options: ShutdownOptions = {}) {
  const sleep = options.sleep ?? realSleep;
  const { health, log, server, live, queue, background } = targets;

  targets.scheduler?.stop();
  health.beginShutdown();
  log.info("server.shutting_down", { drainMs: options.drainMs ?? DRAIN_MS });
  await sleep(options.drainMs ?? DRAIN_MS);

  const closed = server.close();
  live.closeAll();
  const inTime = await Promise.race([
    closed.then(() => true),
    sleep(options.inflightMs ?? INFLIGHT_MS).then(() => false),
  ]);
  if (!inTime) {
    server.closeAllConnections();
    await closed.catch(() => {});
  }

  await Promise.all([queue.stop(), background.stop()]);
  await live.stop().catch(() => {});
  await targets.closeDatabase().catch(() => {});
  log.info("server.stopped", { requestsFinishedInTime: inTime });
}
