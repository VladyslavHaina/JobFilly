import { PERSONA_ADDRESSES, PERSONAS, type Persona } from "../fixtures/format.ts";

// The test mailboxes of each persona, made from the persona list and addresses of
// fixtures/format.ts. The imap service in docker/compose.e2e.yaml creates the same accounts
// (stack.test.ts checks they agree). Test passwords are E2E-SECRET-<name> strings, so the leak
// checks find them if they ever reach a log or the database in clear.

export interface Account {
  user: string;
  password: string;
}

export const ACCOUNTS: Readonly<Record<Persona, Account>> = Object.fromEntries(
  PERSONAS.map((p) => [p, { user: PERSONA_ADDRESSES[p], password: `E2E-SECRET-${p}-imap` }]),
) as Record<Persona, Account>;
