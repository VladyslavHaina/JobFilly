import { PERSONAS, type Persona } from "../fixtures/format.ts";
import { soakMessage, soakMessageId } from "../fixtures/soak.ts";
import type { SeedImap } from "./load.ts";

// `seed generate --per-minute N [--minutes M]` (F10.3): the soak's new
// mail. Every 60/N seconds it appends one generated job message to each persona's Inbox (one
// workspace each), dated now and unread, until M minutes have passed or the seed is stopped
// (SIGTERM, SIGINT). The fake AI answers the messages from the templates in fixtures/soak.ts by
// their Message-ID. Each run names its messages after its start time, so a second run never
// repeats a Message-ID.

const INBOX = "INBOX";

export interface GenerateOptions {
  perMinute: number;
  /** How long to run; null runs until stopped. */
  minutes: number | null;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  stopped: () => boolean;
  open: (persona: Persona) => Promise<SeedImap>;
  print: (text: string) => void;
}

/** Runs the generator; returns how many messages it appended to each persona's Inbox. */
export async function generate(options: GenerateOptions): Promise<number> {
  const run = options.now().getTime().toString(36);
  const total = options.minutes === null ? null : Math.round(options.minutes * options.perMinute);
  const pause = 60_000 / options.perMinute;
  let n = 0;
  while (!options.stopped() && (total === null || n < total)) {
    n += 1;
    for (const persona of PERSONAS) {
      const client = await options.open(persona);
      try {
        const at = options.now();
        await client.append(INBOX, soakMessage(persona, run, n, at), [], at);
      } finally {
        await client.logout();
      }
      options.print(`Generated ${soakMessageId(persona, run, n)} for ${persona}`);
    }
    if (total === null || n < total) await options.sleep(pause);
  }
  return n;
}
