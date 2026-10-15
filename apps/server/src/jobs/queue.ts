import {
  type ClaimedJob,
  claimJob,
  completeJob,
  handBackJob,
  MAX_LEASE_MS,
  renewLease,
  saveJobCheckpoint,
} from "@jobfilly/db";
import type { ZodType } from "zod";
import type { AppDeps } from "../deps";

// The worker side of the Postgres job queue (ARCHITECTURE › Background work). Each replica polls
// for jobs, holds a lease of at most 30 seconds and renews it while the handler works. A handler
// saves a checkpoint after each step; if its replica dies, another one claims the job once the
// lease has expired and the handler resumes from that checkpoint, so handlers must be idempotent.
// On shutdown running handlers are aborted and their jobs handed back.

export interface JobContext<P> {
  job: ClaimedJob;
  payload: P;
  /** The last checkpoint saved for this job, or null on a first run. */
  checkpoint: unknown;
  /** The instance that ran the job before (its lease expired, or it handed the job back). */
  previousInstance: string | null;
  /** Saves progress; throws LeaseLostError when another replica has taken the job over. */
  saveCheckpoint(checkpoint: unknown): Promise<void>;
  /** Renews the lease now (it is also renewed on a timer); throws LeaseLostError when lost. */
  renewLease(): Promise<void>;
  /** Aborted on shutdown or when the lease is lost: stop at the next safe point. */
  signal: AbortSignal;
  deps: AppDeps;
}

export type JobHandler<P> = (ctx: JobContext<P>) => Promise<void>;

/** A job type's payload schema and handler; see jobs/registry.ts. */
export interface JobDefinition<P> {
  payload: ZodType<P>;
  handler: JobHandler<P>;
}

export function defineJob<P>(payload: ZodType<P>, handler: JobHandler<P>): JobDefinition<P> {
  return { payload, handler };
}

// biome-ignore lint/suspicious/noExplicitAny: each entry checks its own payload type
export type JobRegistry = Record<string, JobDefinition<any>>;

export class LeaseLostError extends Error {
  constructor() {
    super("the job's lease was taken over by another instance");
    this.name = "LeaseLostError";
  }
}

export interface JobQueueOptions {
  /** This replica's name: the lease owner. */
  owner: string;
  /** Lease length, at most 30 seconds; it is renewed every third of it. */
  leaseMs?: number;
  /** How often an idle worker looks for work. */
  pollMs?: number;
  /** Jobs run at the same time on this replica. */
  concurrency?: number;
  /** How long stop() waits for aborted handlers before handing their jobs back. */
  stopGraceMs?: number;
}

export interface JobQueue {
  /** Starts polling for work. */
  start(): void;
  /** Claims and runs one job if there is one; resolves once it has finished. For tests. */
  runOnce(): Promise<boolean>;
  /** Stops claiming, aborts running handlers and hands their jobs back. */
  stop(): Promise<void>;
  /** How many jobs this replica is running now. */
  readonly running: number;
}

interface Running {
  job: ClaimedJob;
  controller: AbortController;
  done: Promise<void>;
  reason: "shutdown" | "lease_lost" | null;
}

export function createJobQueue(
  deps: AppDeps,
  registry: JobRegistry,
  options: JobQueueOptions,
): JobQueue {
  const leaseMs = Math.min(options.leaseMs ?? MAX_LEASE_MS, MAX_LEASE_MS);
  const pollMs = options.pollMs ?? 1000;
  const concurrency = options.concurrency ?? 2;
  const owner = options.owner;
  const running = new Map<string, Running>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let polling = false;

  const lease = { owner, leaseMs };

  async function run(job: ClaimedJob): Promise<void> {
    const def = registry[job.type];
    const controller = new AbortController();
    const entry: Running = { job, controller, done: Promise.resolve(), reason: null };
    const log = deps.log.child({ jobId: job.id, jobType: job.type, workspaceId: job.workspaceId });

    if (job.leaseExpired) {
      log.warn("job.lease_expired", {
        previousInstance: job.previousOwner,
        attempts: job.attempts,
      });
    }

    const loseLease = () => {
      if (!entry.reason) entry.reason = "lease_lost";
      controller.abort(new LeaseLostError());
    };

    const renew = async () => {
      const ok = await renewLease(deps.db, job.id, { ...lease, now: deps.clock.now() });
      if (!ok) {
        loseLease();
        throw new LeaseLostError();
      }
    };

    const renewal = setInterval(
      () => {
        renew().catch(() => {});
      },
      Math.max(Math.floor(leaseMs / 3), 10),
    );

    entry.done = (async () => {
      try {
        if (!def) throw new Error(`no handler for job type ${job.type}`);
        const parsed = def.payload.safeParse(job.payload);
        if (!parsed.success) throw new Error(`invalid payload for job type ${job.type}`);
        await def.handler({
          job,
          payload: parsed.data,
          checkpoint: job.checkpoint,
          previousInstance: job.previousOwner,
          signal: controller.signal,
          deps,
          renewLease: renew,
          saveCheckpoint: async (checkpoint) => {
            const ok = await saveJobCheckpoint(deps.db, job.id, {
              owner,
              checkpoint,
              now: deps.clock.now(),
            });
            if (!ok) {
              loseLease();
              throw new LeaseLostError();
            }
          },
        });
        if (entry.reason === "shutdown") {
          await handBack(job, log);
        } else if (entry.reason !== "lease_lost") {
          await completeJob(deps.db, job.id, { owner, status: "done", now: deps.clock.now() });
        }
      } catch (error) {
        if (entry.reason === "shutdown") {
          await handBack(job, log);
        } else if (entry.reason !== "lease_lost" && !(error instanceof LeaseLostError)) {
          log.error("job.failed", { error });
          await completeJob(deps.db, job.id, { owner, status: "failed", now: deps.clock.now() });
        }
      } finally {
        clearInterval(renewal);
        running.delete(job.id);
      }
    })();
    running.set(job.id, entry);
    await entry.done;
  }

  async function handBack(job: ClaimedJob, log: AppDeps["log"]) {
    if (await handBackJob(deps.db, job.id, { owner, now: deps.clock.now() })) {
      log.info("job.handed_back");
    }
  }

  async function claimOne(): Promise<ClaimedJob | null> {
    return claimJob(deps.db, {
      owner,
      types: Object.keys(registry),
      now: deps.clock.now(),
      leaseMs,
    });
  }

  async function poll() {
    if (stopped || polling) return;
    polling = true;
    try {
      while (!stopped && running.size < concurrency) {
        const job = await claimOne();
        if (!job) break;
        void run(job);
      }
    } catch (error) {
      deps.log.warn("db.connection_error", { error });
    } finally {
      polling = false;
      if (!stopped) timer = setTimeout(() => void poll(), pollMs);
    }
  }

  return {
    start() {
      stopped = false;
      void poll();
    },
    async runOnce() {
      const job = await claimOne();
      if (!job) return false;
      await run(job);
      return true;
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      const entries = [...running.values()];
      for (const entry of entries) {
        entry.reason ??= "shutdown";
        entry.controller.abort(new Error("shutting down"));
      }
      // Handlers stop at their next safe point; whatever is still running after the grace
      // period loses its lease here, so another replica can resume the job at once.
      const grace = new Promise((r) => setTimeout(r, options.stopGraceMs ?? 5000));
      await Promise.race([Promise.allSettled(entries.map((e) => e.done)), grace]);
      for (const entry of running.values()) {
        await handBack(entry.job, deps.log.child({ jobId: entry.job.id, jobType: entry.job.type }));
      }
    },
    get running() {
      return running.size;
    },
  };
}
