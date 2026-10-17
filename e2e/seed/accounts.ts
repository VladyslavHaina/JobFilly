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

/**
 * MVP 3: Maria's other test mailboxes (F3.1): her personal address, which accepts SMTP too, and
 * her Gmail test account, signed in with Google against the fake authorisation server (e2e/oauth),
 * whose access token is this password. Loading mail into them is the fixtures slice's.
 */
export const EXTRA_ACCOUNTS = {
  "maria-home": { user: "maria.home@post.example", password: "E2E-SECRET-maria-home-imap" },
  "maria-gmail": { user: "maria.gmail@gmail.example", password: "E2E-SECRET-maria-gmail-imap" },
} as const satisfies Record<string, Account>;

/** Every test mailbox the seed logs in to: each persona's and Maria's other two (MVP 3). */
export type MailboxName = Persona | keyof typeof EXTRA_ACCOUNTS;

export const MAILBOX_ACCOUNTS: Readonly<Record<MailboxName, Account>> = {
  ...ACCOUNTS,
  ...EXTRA_ACCOUNTS,
};

export const MAILBOX_NAMES = Object.keys(MAILBOX_ACCOUNTS) as MailboxName[];

export function isMailbox(value: string): value is MailboxName {
  return (MAILBOX_NAMES as string[]).includes(value);
}
