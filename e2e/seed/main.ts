import { setTimeout as wait } from "node:timers/promises";
import { ImapFlow } from "imapflow";
import { isPersona, PERSONAS, type Persona, toJson } from "../fixtures/format.ts";
import {
  ACCOUNTS,
  isMailbox,
  MAILBOX_ACCOUNTS,
  MAILBOX_NAMES,
  type MailboxName,
} from "./accounts.ts";
import {
  deliver,
  inspectDrafts,
  inspectSent,
  inspectSmtp,
  type MailboxImap,
  resetUidValidity,
} from "./commands.ts";
import { connectWithRetry } from "./connect.ts";
import { generate } from "./generate.ts";
import { type GreenMailApi, greenMailApi } from "./greenmail.ts";
import { loadPersona, SeedError, type SeedImap } from "./load.ts";

// The seed service of the test stack. In the stack it runs as
//   docker compose -p <project> -f docker/compose.e2e.yaml run --rm seed <command>
// Commands:
//   load <mailbox>               loads e2e/fixtures/<mailbox>/mail into the mailbox's Inbox and
//                                Sent: a persona's, or (MVP 3) Maria's personal one, maria-home
//   deliver <id|step>…           appends delivered mail (deliveries.json) to the Inbox, e.g.
//                                `deliver S2` (the batch) or `deliver zurich-2`; from MVP 3 also
//                                the persona's replies (deliveries-sent.json) to Sent (`deliver S1`)
//   inspect drafts <persona>     prints the persona's Drafts folder as JSON
//   inspect sent <mailbox>       prints what the app filed in the mailbox's Sent folder as JSON
//   inspect smtp                 prints what the mail server received over SMTP as JSON
//   reset-uidvalidity <persona>  gives the persona's folders a new UIDVALIDITY, keeping the mail
//   generate --per-minute <n> [--minutes <m>]
//                                appends n generated job messages a minute to each persona's
//                                Inbox, for m minutes or until stopped (the soak, F10.3)
// Environment: IMAP_HOST and IMAP_PORT (plain-text IMAP of the test mail server), FIXTURES_DIR,
// GREENMAIL_API_URL (the mail server's REST API, for inspect smtp and reset-uidvalidity).

const USAGE = [
  "Usage:",
  "  seed load <mailbox>",
  "  seed deliver <id|step>...",
  "  seed inspect drafts <persona>",
  "  seed inspect sent <mailbox>",
  "  seed inspect smtp",
  "  seed reset-uidvalidity <persona>",
  "  seed generate --per-minute <n> [--minutes <m>]",
].join("\n");

export interface SeedDeps {
  fixturesDir: string;
  now: () => Date;
  /** A connected IMAP client logged in to the mailbox. */
  open: (mailbox: MailboxName) => Promise<MailboxImap>;
  api: GreenMailApi;
  print: (text: string) => void;
  error: (text: string) => void;
  /** Waits between generated messages; returns early once stopped. */
  sleep: (ms: number) => Promise<void>;
  /** Whether the seed was asked to stop (generate). */
  stopped: () => boolean;
}

function persona(value: string | undefined, deps: SeedDeps): Persona | null {
  if (value !== undefined && isPersona(value)) return value;
  deps.error(`Unknown persona "${value ?? ""}". Known: ${PERSONAS.join(", ")}`);
  return null;
}

function mailbox(value: string | undefined, deps: SeedDeps): MailboxName | null {
  if (value !== undefined && isMailbox(value)) return value;
  deps.error(`Unknown mailbox "${value ?? ""}". Known: ${MAILBOX_NAMES.join(", ")}`);
  return null;
}

/** The options of `generate`, or null when they don't read. */
function generateOptions(args: string[]): { perMinute: number; minutes: number | null } | null {
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const [flag, value] = [args[i] as string, args[i + 1]];
    if (!["--per-minute", "--minutes"].includes(flag) || value === undefined) return null;
    options.set(flag, value);
  }
  const perMinute = Number(options.get("--per-minute"));
  const minutes = options.has("--minutes") ? Number(options.get("--minutes")) : null;
  if (!Number.isInteger(perMinute) || perMinute < 1 || perMinute > 60) return null;
  if (minutes !== null && !(Number.isFinite(minutes) && minutes > 0)) return null;
  return { perMinute, minutes };
}

/** Runs one seed command; returns the exit code. A SeedError is printed without a stack. */
export async function main(args: string[], deps: SeedDeps): Promise<number> {
  try {
    return await run(args, deps);
  } catch (error) {
    if (!(error instanceof SeedError)) throw error;
    deps.error(error.message);
    return 1;
  }
}

async function run(args: string[], deps: SeedDeps): Promise<number> {
  const [command, ...rest] = args;
  if (command === "load" && rest.length === 1) {
    const m = mailbox(rest[0], deps);
    if (m === null) return 2;
    const result = await loadPersona({
      persona: m,
      fixturesDir: deps.fixturesDir,
      now: deps.now(),
      open: () => deps.open(m) as Promise<SeedImap>,
    });
    deps.print(`Loaded ${m}: ${result.inbox} in Inbox, ${result.sent} in Sent`);
    return 0;
  }
  if (command === "deliver" && rest.length > 0) {
    const delivered = await deliver({
      fixturesDir: deps.fixturesDir,
      targets: rest,
      now: deps.now(),
      open: deps.open,
    });
    for (const d of delivered)
      deps.print(`Delivered ${d.id} to ${d.persona}'s ${d.folder}: ${d.messageId}`);
    return 0;
  }
  if (command === "inspect" && rest[0] === "drafts" && rest.length === 2) {
    const p = persona(rest[1], deps);
    if (p === null) return 2;
    deps.print(toJson(await inspectDrafts(p, await deps.open(p))).trimEnd());
    return 0;
  }
  if (command === "inspect" && rest[0] === "sent" && rest.length === 2) {
    const m = mailbox(rest[1], deps);
    if (m === null) return 2;
    deps.print(toJson(await inspectSent(deps.fixturesDir, m, await deps.open(m))).trimEnd());
    return 0;
  }
  if (command === "inspect" && rest[0] === "smtp" && rest.length === 1) {
    const accounts = Object.fromEntries(MAILBOX_NAMES.map((m) => [m, MAILBOX_ACCOUNTS[m].user]));
    deps.print(toJson(await inspectSmtp(deps.fixturesDir, accounts, deps.api)).trimEnd());
    return 0;
  }
  if (command === "reset-uidvalidity" && rest.length === 1) {
    const p = persona(rest[0], deps);
    if (p === null) return 2;
    const result = await resetUidValidity({
      persona: p,
      account: ACCOUNTS[p],
      open: () => deps.open(p),
      api: deps.api,
    });
    deps.print(`Reset ${p}'s UIDVALIDITY: Inbox ${result.before} -> ${result.after}`);
    deps.print(toJson(result).trimEnd());
    return 0;
  }
  if (command === "generate") {
    const options = generateOptions(rest);
    if (options === null) {
      deps.error(`${USAGE}\n<n> is 1 to 60 messages a minute; <m> a number of minutes.`);
      return 2;
    }
    const n = await generate({
      ...options,
      now: deps.now,
      sleep: deps.sleep,
      stopped: deps.stopped,
      open: deps.open,
      print: deps.print,
    });
    deps.print(`Generated ${n} messages for each of ${PERSONAS.join(", ")}`);
    return 0;
  }
  deps.error(USAGE);
  return 2;
}

if (import.meta.main) {
  const host = process.env.IMAP_HOST ?? "imap";
  const port = Number(process.env.IMAP_PORT ?? "3143");
  const open = (m: MailboxName) =>
    connectWithRetry(
      () =>
        new ImapFlow({
          host,
          port,
          // The test mail server speaks plain-text IMAP only.
          secure: false,
          doSTARTTLS: false,
          auth: { user: MAILBOX_ACCOUNTS[m].user, pass: MAILBOX_ACCOUNTS[m].password },
          logger: false,
        }),
      { timeoutMs: 60_000, retryMs: 1_000 },
    );
  // `generate` runs until stopped: a signal ends the wait between messages at once and lets the
  // run finish with its count. Every other command keeps the default signal handling.
  const stop = new AbortController();
  if (process.argv[2] === "generate") {
    for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => stop.abort());
  }
  const sleep = (ms: number) => wait(ms, undefined, { signal: stop.signal }).catch(() => undefined);
  process.exitCode = await main(process.argv.slice(2), {
    fixturesDir: process.env.FIXTURES_DIR ?? "e2e/fixtures",
    now: () => new Date(),
    open,
    api: greenMailApi(process.env.GREENMAIL_API_URL ?? "http://imap:8080"),
    print: (text) => console.log(text),
    error: (text) => console.error(text),
    sleep,
    stopped: () => stop.signal.aborted,
  });
}
