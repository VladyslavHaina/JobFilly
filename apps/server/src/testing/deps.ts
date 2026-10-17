import type { AiClient } from "@jobfilly/ai";
import type { DatabaseConnection } from "@jobfilly/db";
import { openTestDatabase } from "@jobfilly/db/testing";
import type { MailClient } from "@jobfilly/mail";
import type { AiModels } from "@jobfilly/schema";
import type { Config } from "../config";
import {
  type AiPort,
  type AppDeps,
  createDeps,
  type DomainPort,
  type MailPort,
  type OAuthPort,
  type SmtpPort,
} from "../deps";
import type { JobRegistry } from "../jobs/queue";
import { createLogger, type LogEvent } from "../log";
import { type MovableClock, movableClock } from "./clock";

// AppDeps for tests: a migrated in-memory PGlite database, a clock that only moves when told,
// a captured log, mail and AI ports that refuse to work until a test sets a fake (createFakeMailbox
// in ./mailbox.ts, createFakeAi in ./ai.ts), and a fake DomainPort. Nothing reaches a real
// mailbox, model or network.

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
    google: null,
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
  domains: FakeDomainPort;
  /** Every line logged so far, parsed. */
  logs: LogLine[];
  /** The raw JSON lines, for leak checks. */
  rawLogs: string[];
  connection: DatabaseConnection;
  /** Stops the queue, background work and live updates, and closes the database. */
  close(): Promise<void>;
}

const refuse = (what: string) => () => {
  throw new Error(`no fake ${what} set: assign deps.${what} in the test`);
};

/** A model for every task, for AI settings in tests. */
export const TEST_AI_MODELS: AiModels = {
  classify: "m",
  extract: "m",
  prefs: "m",
  intake: "m",
  cv: "m",
  match: "m",
  draft: "m",
  assistant: "m",
};

const unused = (what: string) => () => Promise.reject(new Error(`this test's fake has no ${what}`));

/** A MailClient doing only what `methods` give; anything else rejects (tests only). */
export function fakeMailClient(methods: Partial<MailClient>): MailClient {
  return {
    test: unused("test"),
    fetchEnvelopes: unused("fetchEnvelopes"),
    fetchBody: unused("fetchBody"),
    fetchSince: unused("fetchSince"),
    fetchOriginal: unused("fetchOriginal"),
    ensureDraftsFolder: unused("ensureDraftsFolder"),
    saveDraft: unused("saveDraft"),
    replaceDraft: unused("replaceDraft"),
    draftAttachment: unused("draftAttachment"),
    deleteDraft: unused("deleteDraft"),
    appendSent: unused("appendSent"),
    close: () => Promise.resolve(),
    ...methods,
  };
}

/** An AiClient doing only what `methods` give; anything else rejects (tests only). */
export function fakeAiClient(methods: Partial<AiClient>): AiClient {
  return {
    classify: unused("classify"),
    extract: unused("extract"),
    prefs: unused("prefs"),
    intake: unused("intake"),
    test: unused("test"),
    readCv: unused("readCv"),
    match: unused("match"),
    draft: unused("draft"),
    assistant: unused("assistant"),
    ...methods,
  };
}

/**
 * The fake DomainPort (F5): RDAP and MX answers per domain, set with setRdap and setMx ('fail'
 * makes the lookup throw, as a failed lookup does), a default for every other domain (registered
 * ten years before the test clock's start, one MX record), and call counts.
 */
export interface FakeDomainPort extends DomainPort {
  setRdap(domain: string, answer: { registeredAt: string | null } | "fail"): void;
  setMx(domain: string, answer: string[] | "fail"): void;
  calls: { rdap: string[]; mx: string[] };
}

export function createFakeDomains(defaults: { registeredAt?: string } = {}): FakeDomainPort {
  const rdap = new Map<string, { registeredAt: string | null } | "fail">();
  const mx = new Map<string, string[] | "fail">();
  const calls = { rdap: [] as string[], mx: [] as string[] };
  const registeredAt = defaults.registeredAt ?? "2016-10-01T00:00:00.000Z";
  return {
    calls,
    setRdap: (domain, answer) => rdap.set(domain.toLowerCase(), answer),
    setMx: (domain, answer) => mx.set(domain.toLowerCase(), answer),
    async rdap(domain) {
      calls.rdap.push(domain);
      const answer = rdap.get(domain.toLowerCase()) ?? { registeredAt };
      if (answer === "fail") throw new Error("RDAP lookup failed");
      return answer;
    },
    async mx(domain) {
      calls.mx.push(domain);
      const answer = mx.get(domain.toLowerCase()) ?? [`mx.${domain.toLowerCase()}`];
      if (answer === "fail") throw new Error("MX lookup failed");
      return answer;
    },
  };
}

/** A mail port that fails until a test replaces deps.mail. */
const unsetMailPort: MailPort = { connect: refuse("mail") };
/** An AI port that fails until a test replaces deps.ai. */
const unsetAiPort: AiPort = { client: refuse("ai") };
/** SMTP and Google's token endpoint fail until a test sets them (createFakeSmtp, createFakeOAuth). */
const unsetSmtpPort: SmtpPort = { send: refuse("smtp"), test: refuse("smtp") };
const unsetOAuthPort: OAuthPort = { exchange: refuse("oauth"), refresh: refuse("oauth") };

export interface TestDepsOptions {
  /** Where the clock starts (default 2026-10-01T10:00:00Z). */
  now?: Date;
  config?: Partial<Config>;
  mail?: MailPort;
  ai?: AiPort;
  domains?: FakeDomainPort;
  smtp?: SmtpPort;
  oauth?: OAuthPort;
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
  const domains = options.domains ?? createFakeDomains();
  const deps = createDeps({
    config,
    connection,
    log,
    clock,
    mail: options.mail ?? unsetMailPort,
    ai: options.ai ?? unsetAiPort,
    domains,
    smtp: options.smtp ?? unsetSmtpPort,
    oauth: options.oauth ?? unsetOAuthPort,
    registry: options.registry,
    queue: { pollMs: 20, stopGraceMs: 1000, leaseMs: options.leaseMs },
    backgroundStopGraceMs: 1000,
  });
  await deps.live.start();
  return Object.assign(deps, {
    clock,
    domains,
    logs,
    rawLogs,
    connection,
    async close() {
      await Promise.all([deps.queue.stop(), deps.background.stop()]);
      deps.live.closeAll();
      await deps.live.stop();
      await connection.close();
    },
  });
}
