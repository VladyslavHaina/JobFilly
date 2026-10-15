import { SeedError } from "./load.ts";

// The seed runs right after the stack starts, when the mail server may still be booting: keep
// trying to connect until it answers, but give up at once on a refused login.

export interface Connectable {
  connect(): Promise<void>;
}

export interface ConnectOptions {
  /** How long to keep trying, in milliseconds. */
  timeoutMs: number;
  /** The pause between attempts, in milliseconds. */
  retryMs: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** A connected client from `create`; a fresh client per attempt (a failed one can't reconnect). */
export async function connectWithRetry<T extends Connectable>(
  create: () => T,
  options: ConnectOptions,
): Promise<T> {
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const deadline = now() + options.timeoutMs;
  for (;;) {
    const client = create();
    try {
      await client.connect();
      return client;
    } catch (error) {
      if (isLoginRefused(error)) {
        throw new SeedError("The mail server refused the login: check the persona's account");
      }
      if (now() + options.retryMs > deadline) {
        throw new SeedError(
          `Can't reach the mail server after ${Math.round(options.timeoutMs / 1000)} s: ${describe(error)}`,
        );
      }
      await sleep(options.retryMs);
    }
  }
}

function isLoginRefused(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { authenticationFailed?: unknown }).authenticationFailed === true
  );
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? `${code} ${error.message}` : error.message;
  }
  return String(error);
}
