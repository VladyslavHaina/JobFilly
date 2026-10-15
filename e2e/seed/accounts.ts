// The test mailboxes of each persona. The imap service in docker/compose.e2e.yaml creates the
// same accounts (stack.test.ts checks they agree). Test passwords are E2E-SECRET-<name>
// strings, so the leak checks find them if they ever reach a log or the database in clear.

export interface Account {
  user: string;
  password: string;
}

export const ACCOUNTS: Readonly<Record<string, Account>> = {
  maria: { user: "maria.santos@inbox.example", password: "E2E-SECRET-maria-imap" },
  tom: { user: "tom.okafor@inbox.example", password: "E2E-SECRET-tom-imap" },
};
