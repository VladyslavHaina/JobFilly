import type { AiClient } from "@jobfilly/ai";
import { createAiClient } from "@jobfilly/ai";
import { aggregateIntake } from "@jobfilly/core";
import type { Database, DatabaseConnection } from "@jobfilly/db";
import { createMailClient, type MailClient, type MailClientOptions } from "@jobfilly/mail";
import type { AiClientSettings, MailLogin, Readiness } from "@jobfilly/schema";
import { type Clock, systemClock } from "./clock";
import type { Config } from "./config";
import {
  createJobQueue,
  type JobQueue,
  type JobQueueOptions,
  type JobRegistry,
} from "./jobs/queue";
import { jobRegistry } from "./jobs/registry";
import { createLiveHub, type LiveHub } from "./live";
import type { Logger } from "./log";
import { createDomainPort } from "./senders/lookup";

// What every route and job handler gets: the database, configuration, clock, logger, live
// updates, the queue, and the ports to the mailbox, the AI provider and the domain lookups. Tests
// replace the ports with fakes (src/testing), so no test needs a mailbox, a model or a network.

/** The mailbox port: IMAP with a password or (MVP 3, F3.2) an OAuth access token. */
export interface MailPort {
  connect(conn: MailLogin, options: MailClientOptions): MailClient;
}

export interface AiPort {
  client(settings: AiClientSettings): AiClient;
}

/**
 * Domain lookups for the sender check (F5): when a domain was registered (RDAP, through
 * JOBFILLY_RDAP_URL) and its MX records (DNS). Each throws when the lookup fails, which leaves the
 * check incomplete, never "looks fine" (F5.3). senders/lookup.ts builds the real one.
 */
export interface DomainPort {
  rdap(domain: string): Promise<{ registeredAt: string | null }>;
  mx(domain: string): Promise<string[]>;
}

/** Readiness (F7.2): the database is reachable, migrated, and shutdown hasn't begun. */
export interface Health {
  check(): Promise<Readiness>;
  /** Readiness answers 503 from now on. */
  beginShutdown(): void;
  readonly shuttingDown: boolean;
}

/**
 * Work a request starts and doesn't wait for: the one intake.v1 call made outside the job queue
 * (routes/intake.ts). Shutdown sees it here: at the job hand-back step it aborts what still runs
 * and waits for each task to clean up while the database is still open.
 */
export interface BackgroundWork {
  /**
   * Starts `task` now with a signal that aborts on stop(). The returned promise settles once the
   * task has finished and never rejects: a task's error goes to `onError`.
   */
  run(
    task: (signal: AbortSignal) => Promise<void>,
    onError: (error: unknown) => void,
  ): Promise<void>;
  /** Resolves once every task running now has finished (tests). */
  settled(): Promise<void>;
  /**
   * Aborts every running task and waits for them, at most `stopGraceMs`. A task started after
   * this gets a signal that is already aborted.
   */
  stop(): Promise<void>;
  /** How many tasks are running on this replica. */
  readonly running: number;
}

export function createBackgroundWork(options: { stopGraceMs?: number } = {}): BackgroundWork {
  const tasks = new Set<{ controller: AbortController; done: Promise<void> }>();
  let stopped = false;
  const settled = async () => {
    await Promise.all([...tasks].map((t) => t.done));
  };
  return {
    run(task, onError) {
      const entry = { controller: new AbortController(), done: Promise.resolve() };
      if (stopped) entry.controller.abort(new Error("shutting down"));
      // Registered before the task starts, so it is forgotten even if it ends synchronously.
      tasks.add(entry);
      entry.done = (async () => {
        try {
          await task(entry.controller.signal);
        } catch (error) {
          try {
            onError(error);
          } catch {
            // Reporting the error must not make the task's promise reject.
          }
        } finally {
          tasks.delete(entry);
        }
      })();
      return entry.done;
    },
    settled,
    async stop() {
      stopped = true;
      for (const t of tasks) t.controller.abort(new Error("shutting down"));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const grace = new Promise<void>((r) => {
        timer = setTimeout(r, options.stopGraceMs ?? 5000);
      });
      await Promise.race([settled(), grace]);
      clearTimeout(timer);
    },
    get running() {
      return tasks.size;
    },
  };
}

export interface AppDeps {
  db: Database;
  config: Config;
  clock: Clock;
  log: Logger;
  live: LiveHub;
  queue: JobQueue;
  background: BackgroundWork;
  mail: MailPort;
  ai: AiPort;
  domains: DomainPort;
  intake: { aggregate: typeof aggregateIntake };
  health: Health;
}

export function createHealth(connection: DatabaseConnection): Health {
  let shuttingDown = false;
  let migrated = false;
  return {
    async check() {
      if (shuttingDown) return { status: "not_ready", reason: "shutting_down" };
      try {
        await connection.ping();
      } catch {
        return { status: "not_ready", reason: "database_unreachable" };
      }
      // Once current, a replica stays current: migrations only ever move forward.
      if (!migrated) {
        try {
          migrated = (await connection.migrationState()) === "current";
        } catch {
          migrated = false;
        }
      }
      return migrated ? { status: "ready" } : { status: "not_ready", reason: "migrations_missing" };
    },
    beginShutdown() {
      shuttingDown = true;
    },
    get shuttingDown() {
      return shuttingDown;
    },
  };
}

const mailPort: MailPort = {
  connect: (conn, options) => createMailClient(conn, options),
};

/** The AI port; invalid model output is reported as a redacted warning (ai.output_invalid). */
function aiPort(log: Logger): AiPort {
  return {
    client: (settings) => createAiClient(settings, { onEvent: (e) => log.warn(e.event, { ...e }) }),
  };
}

export interface DepsInput {
  config: Config;
  connection: DatabaseConnection;
  log: Logger;
  clock?: Clock;
  mail?: MailPort;
  ai?: AiPort;
  domains?: DomainPort;
  registry?: JobRegistry;
  queue?: Omit<JobQueueOptions, "owner">;
  /** How long shutdown waits for aborted background work (default 5 s, as for jobs). */
  backgroundStopGraceMs?: number;
}

/** Wires the dependencies; production passes only config, connection and log. */
export function createDeps(input: DepsInput): AppDeps {
  const deps: AppDeps = {
    db: input.connection.db,
    config: input.config,
    clock: input.clock ?? systemClock,
    log: input.log,
    live: createLiveHub(input.connection.notifier, input.log),
    // Set below: the queue's handlers get these same deps.
    queue: undefined as unknown as JobQueue,
    background: createBackgroundWork({ stopGraceMs: input.backgroundStopGraceMs }),
    mail: input.mail ?? mailPort,
    ai: input.ai ?? aiPort(input.log),
    domains: input.domains ?? createDomainPort(input.config),
    intake: { aggregate: aggregateIntake },
    health: createHealth(input.connection),
  };
  deps.queue = createJobQueue(deps, input.registry ?? jobRegistry, {
    owner: input.config.instance,
    ...input.queue,
  });
  return deps;
}
