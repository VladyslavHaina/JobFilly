import { ImapFlow } from "imapflow";
import { isPersona, PERSONAS, type Persona, toJson } from "../fixtures/format.ts";
import { ACCOUNTS } from "./accounts.ts";
import {
  deliver,
  inspectDrafts,
  inspectSmtp,
  type MailboxImap,
  resetUidValidity,
} from "./commands.ts";
import { connectWithRetry } from "./connect.ts";
import { type GreenMailApi, greenMailApi } from "./greenmail.ts";
import { loadPersona, SeedError, type SeedImap } from "./load.ts";

// The seed service of the test stack. In the stack it runs as
//   docker compose -p <project> -f docker/compose.e2e.yaml run --rm seed <command>
// Commands:
//   load <persona>               loads e2e/fixtures/<persona>/mail into the persona's Inbox and Sent
//   deliver <id|step>…           appends delivered mail (deliveries.json) to the Inbox, e.g.
//                                `deliver S2` (the batch) or `deliver zurich-2`
//   inspect drafts <persona>     prints the persona's Drafts folder as JSON
//   inspect smtp                 prints what the mail server received over SMTP as JSON
//   reset-uidvalidity <persona>  gives the persona's folders a new UIDVALIDITY, keeping the mail
// Environment: IMAP_HOST and IMAP_PORT (plain-text IMAP of the test mail server), FIXTURES_DIR,
// GREENMAIL_API_URL (the mail server's REST API, for inspect smtp and reset-uidvalidity).

const USAGE = [
  "Usage:",
  "  seed load <persona>",
  "  seed deliver <id|step>...",
  "  seed inspect drafts <persona>",
  "  seed inspect smtp",
  "  seed reset-uidvalidity <persona>",
].join("\n");

export interface SeedDeps {
  fixturesDir: string;
  now: () => Date;
  /** A connected IMAP client logged in as the persona. */
  open: (persona: Persona) => Promise<MailboxImap>;
  api: GreenMailApi;
  print: (text: string) => void;
  error: (text: string) => void;
}

function persona(value: string | undefined, deps: SeedDeps): Persona | null {
  if (value !== undefined && isPersona(value)) return value;
  deps.error(`Unknown persona "${value ?? ""}". Known: ${PERSONAS.join(", ")}`);
  return null;
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
    const p = persona(rest[0], deps);
    if (p === null) return 2;
    const result = await loadPersona({
      persona: p,
      fixturesDir: deps.fixturesDir,
      now: deps.now(),
      open: () => deps.open(p) as Promise<SeedImap>,
    });
    deps.print(`Loaded ${p}: ${result.inbox} in Inbox, ${result.sent} in Sent`);
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
      deps.print(`Delivered ${d.id} to ${d.persona}'s Inbox: ${d.messageId}`);
    return 0;
  }
  if (command === "inspect" && rest[0] === "drafts" && rest.length === 2) {
    const p = persona(rest[1], deps);
    if (p === null) return 2;
    deps.print(toJson(await inspectDrafts(p, await deps.open(p))).trimEnd());
    return 0;
  }
  if (command === "inspect" && rest[0] === "smtp" && rest.length === 1) {
    const accounts = Object.fromEntries(PERSONAS.map((p) => [p, ACCOUNTS[p].user])) as Record<
      Persona,
      string
    >;
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
  deps.error(USAGE);
  return 2;
}

if (import.meta.main) {
  const host = process.env.IMAP_HOST ?? "imap";
  const port = Number(process.env.IMAP_PORT ?? "3143");
  const open = (p: Persona) =>
    connectWithRetry(
      () =>
        new ImapFlow({
          host,
          port,
          // The test mail server speaks plain-text IMAP only.
          secure: false,
          doSTARTTLS: false,
          auth: { user: ACCOUNTS[p].user, pass: ACCOUNTS[p].password },
          logger: false,
        }),
      { timeoutMs: 60_000, retryMs: 1_000 },
    );
  process.exitCode = await main(process.argv.slice(2), {
    fixturesDir: process.env.FIXTURES_DIR ?? "e2e/fixtures",
    now: () => new Date(),
    open,
    api: greenMailApi(process.env.GREENMAIL_API_URL ?? "http://imap:8080"),
    print: (text) => console.log(text),
    error: (text) => console.error(text),
  });
}
