import type { DatabaseConnection } from "@jobfilly/db";
import { openTestDatabase } from "@jobfilly/db/testing";
import type { Config } from "../config";
import { type AiPort, type AppDeps, createDeps, type MailPort } from "../deps";
import type { JobRegistry } from "../jobs/queue";
import { createLogger, type LogEvent } from "../log";
import { type MovableClock, movableClock } from "./clock";

// AppDeps for tests: a migrated in-memory PGlite database, a clock that only moves when told,
// a captured log, and mail and AI ports that refuse to work until a test sets a fake. Nothing
// reaches a real mailbox, model or network.

/** The fixed JOBFILLY_SECRET_KEY of every test (32 bytes). */
export const TEST_SECRET_KEY = new Uint8Array(32).fill(42);

const TEST_PUBLIC_URL = "http://jobfilly.test";

function testConfig(overrides: Partial<Config> = {}): Config {
  const publicUrl = overrides.publicUrl ?? new URL(TEST_PUBLIC_URL);
  return {
    databaseUrl: "postgres://test@pglite/test",
    secretKey: TEST_SECRET_KEY,
    publicUrl,
    origin: publicUrl.origin,
    secureCookies: publicUrl.protocol === "https:",
    host: "127.0.0.1",
    port: 0,
    webDist: undefined,
    logLevel: "debug",
    syncIntervalSeconds: 120,
    rdapUrl: "https://rdap.test",
    allowInsecureMail: false,
    instance: "test-instance",
    ...overrides,
  };
}

interface LogLine {
  time: string;
  level: "debug" | "info" | "warn" | "error" | "fatal";
  instance: string;
  event: LogEvent;
  [field: string]: unknown;
}

export interface TestDeps extends AppDeps {
  clock: MovableClock;
  /** Every line logged so far, parsed. */
  logs: LogLine[];
  /** The raw JSON lines, for leak checks. */
  rawLogs: string[];
  connection: DatabaseConnection;
  /** Stops the queue and live updates and closes the database. */
  close(): Promise<void>;
}

const refuse = (what: string) => () => {
  throw new Error(`no fake ${what} set: assign deps.${what} in the test`);
};

/** A mail port that fails until a test replaces deps.mail. */
const unsetMailPort: MailPort = { connect: refuse("mail") };
/** An AI port that fails until a test replaces deps.ai. */
const unsetAiPort: AiPort = { client: refuse("ai") };

export interface TestDepsOptions {
  /** Where the clock starts (default 2026-10-01T10:00:00Z). */
  now?: Date;
  config?: Partial<Config>;
  mail?: MailPort;
  ai?: AiPort;
  /** The job types the queue runs (default: the app's registry). */
  registry?: JobRegistry;
  /** Lease length for the queue (default 30 s). */
  leaseMs?: number;
}

export async function createTestDeps(options: TestDepsOptions = {}): Promise<TestDeps> {
  const connection = await openTestDatabase();
  const clock = movableClock(options.now ?? new Date("2026-10-01T10:00:00Z"));
  const config = testConfig(options.config);
  const logs: LogLine[] = [];
  const rawLogs: string[] = [];
  const log = createLogger({
    level: "debug",
    instance: config.instance,
    now: () => clock.now(),
    write: (line) => {
      rawLogs.push(line);
      logs.push(JSON.parse(line) as LogLine);
    },
  });
  const deps = createDeps({
    config,
    connection,
    log,
    clock,
    mail: options.mail ?? unsetMailPort,
    ai: options.ai ?? unsetAiPort,
    registry: options.registry,
    queue: { pollMs: 20, stopGraceMs: 1000, leaseMs: options.leaseMs },
  });
  await deps.live.start();
  return Object.assign(deps, {
    clock,
    logs,
    rawLogs,
    connection,
    async close() {
      await deps.queue.stop();
      deps.live.closeAll();
      await deps.live.stop();
      await connection.close();
    },
  });
}
