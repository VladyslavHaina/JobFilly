import type { AiClient } from "@jobfilly/ai";
import { createAiClient } from "@jobfilly/ai";
import { aggregateIntake } from "@jobfilly/core";
import type { Database, DatabaseConnection } from "@jobfilly/db";
import { createMailClient, type MailClient } from "@jobfilly/mail";
import type { AiClientSettings, MailConnection, Readiness } from "@jobfilly/schema";
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

// What every route and job handler gets: the database, configuration, clock, logger, live
// updates, the queue, and the ports to the mailbox and the AI provider. Tests replace the ports
// with fakes (src/testing), so no test needs a mailbox or a model.

export interface MailPort {
  connect(conn: MailConnection, options: { allowInsecure: boolean }): MailClient;
}

export interface AiPort {
  client(settings: AiClientSettings): AiClient;
}

/** Readiness (F7.2): the database is reachable, migrated, and shutdown hasn't begun. */
export interface Health {
  check(): Promise<Readiness>;
  /** Readiness answers 503 from now on. */
  beginShutdown(): void;
  readonly shuttingDown: boolean;
}

export interface AppDeps {
  db: Database;
  config: Config;
  clock: Clock;
  log: Logger;
  live: LiveHub;
  queue: JobQueue;
  mail: MailPort;
  ai: AiPort;
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
  registry?: JobRegistry;
  queue?: Omit<JobQueueOptions, "owner">;
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
    mail: input.mail ?? mailPort,
    ai: input.ai ?? aiPort(input.log),
    intake: { aggregate: aggregateIntake },
    health: createHealth(input.connection),
  };
  deps.queue = createJobQueue(deps, input.registry ?? jobRegistry, {
    owner: input.config.instance,
    ...input.queue,
  });
  return deps;
}
