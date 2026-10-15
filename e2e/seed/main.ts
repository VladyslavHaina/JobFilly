import { ImapFlow } from "imapflow";
import { isPersona, PERSONAS } from "../fixtures/format.ts";
import { ACCOUNTS } from "./accounts.ts";
import { connectWithRetry } from "./connect.ts";
import { loadPersona, SeedError } from "./load.ts";

// The seed service of the test stack. In the stack it runs as
//   docker compose -p <project> -f docker/compose.e2e.yaml run --rm seed <command>
// Commands:
//   load <persona>   loads e2e/fixtures/<persona>/mail into the persona's Inbox and Sent
// Environment: IMAP_HOST and IMAP_PORT (plain-text IMAP of the test mail server), FIXTURES_DIR.

const USAGE = "Usage: seed load <persona>";

async function main(args: string[]): Promise<number> {
  const [command, persona, ...rest] = args;
  if (command !== "load" || persona === undefined || rest.length > 0) {
    console.error(USAGE);
    return 2;
  }
  if (!isPersona(persona)) {
    console.error(`Unknown persona "${persona}". Known: ${PERSONAS.join(", ")}`);
    return 2;
  }
  const account = ACCOUNTS[persona];
  const host = process.env.IMAP_HOST ?? "imap";
  const port = Number(process.env.IMAP_PORT ?? "3143");
  const result = await loadPersona({
    persona,
    fixturesDir: process.env.FIXTURES_DIR ?? "e2e/fixtures",
    now: new Date(),
    open: () =>
      connectWithRetry(
        () =>
          new ImapFlow({
            host,
            port,
            // The test mail server speaks plain-text IMAP only.
            secure: false,
            doSTARTTLS: false,
            auth: { user: account.user, pass: account.password },
            logger: false,
          }),
        { timeoutMs: 60_000, retryMs: 1_000 },
      ),
  });
  console.log(`Loaded ${persona}: ${result.inbox} in Inbox, ${result.sent} in Sent`);
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof SeedError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
