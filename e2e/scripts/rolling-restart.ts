import { spawn } from "node:child_process";
import { PERSONA_ADDRESSES, PERSONAS, type Persona } from "../fixtures/format.ts";
import {
  composeArgs,
  DIRECT_PORTS,
  LOGIN_PASSWORDS,
  PROXY_PORT,
  REPLICAS,
  type Replica,
  ROOT,
} from "../specs/shared.ts";

// S10 of docs/mvp/MVP-3.md, the scripted part: a rolling restart under load (F10.1, F10.2).
//
//   node e2e/scripts/rolling-restart.ts [--gap-seconds 10]
//
// On the running test stack (pnpm e2e:stack up), after the scenario's own steps have started
// Maria's and Tom's scans and new mail is arriving (`seed generate`), it signs each persona in
// with a session of its own, polls /api/auth/me through the proxy every 200 ms with both
// sessions, and meanwhile restarts app-a, app-b and app-c in turn (`docker compose restart`):
// each one, once it answers ready on its direct port again, is followed by the gap before the
// next. Then it prints every failed request (anything but a 200, or no answer within 5 s) and
// every sign-out (a 401), and exits 1 when there is one, 0 otherwise. Whether every scan and
// sync completed is read from the logs and the page, as the scenario says.

const ORIGIN = `http://127.0.0.1:${PROXY_PORT}`;
const POLL_MS = 200;
const REQUEST_TIMEOUT_MS = 5_000;
const READY_TIMEOUT_MS = 180_000;
const DEFAULT_GAP_MS = 10_000;

export interface RollingDeps {
  /** Runs `docker compose <args>` on the running stack; resolves with its exit code. */
  compose(args: string[]): Promise<number>;
  fetch: typeof fetch;
  sleep(ms: number): Promise<void>;
  /** Milliseconds, for the report's times. */
  now(): number;
  print(line: string): void;
}

interface Poll {
  persona: Persona;
  /** Milliseconds since the first restart began. */
  at: number;
  /** The status, or null when nothing answered in time. */
  status: number | null;
}

/** Signs the persona in through the proxy; its session cookie, or null. */
export async function signIn(
  deps: Pick<RollingDeps, "fetch">,
  persona: Persona,
): Promise<string | null> {
  const response = await deps
    .fetch(`${ORIGIN}/api/auth/sign-in`, {
      method: "POST",
      headers: { Origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({
        email: PERSONA_ADDRESSES[persona],
        password: LOGIN_PASSWORDS[persona],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    .catch(() => null);
  if (!response) return null;
  await response.body?.cancel();
  if (response.status !== 200) return null;
  const cookies = response.headers.getSetCookie().map((c) => c.split(";")[0]);
  return cookies.length > 0 ? cookies.join("; ") : null;
}

/** The status of GET `url`, or null when nothing answers in time. */
async function statusOf(deps: RollingDeps, url: string, cookie?: string): Promise<number | null> {
  try {
    const response = await deps.fetch(url, {
      headers: cookie ? { Origin: ORIGIN, cookie } : { Origin: ORIGIN },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return response.status;
  } catch {
    return null;
  }
}

export async function rollingRestart(
  deps: RollingDeps,
  options: { gapMs?: number; replicas?: readonly Replica[] } = {},
): Promise<number> {
  const gapMs = options.gapMs ?? DEFAULT_GAP_MS;
  const replicas = options.replicas ?? REPLICAS;

  const sessions = new Map<Persona, string>();
  for (const persona of PERSONAS) {
    const cookie = await signIn(deps, persona);
    if (!cookie) {
      deps.print(
        `${persona} could not sign in through ${ORIGIN} (is the test stack up, with both personas registered?): nothing was restarted`,
      );
      return 1;
    }
    sessions.set(persona, cookie);
  }

  const started = deps.now();
  const polls: Poll[] = [];
  let polling = true;
  const poller = (async () => {
    while (polling) {
      await Promise.all(
        [...sessions].map(async ([persona, cookie]) => {
          const status = await statusOf(deps, `${ORIGIN}/api/auth/me`, cookie);
          polls.push({ persona, at: deps.now() - started, status });
        }),
      );
      await deps.sleep(POLL_MS);
    }
  })();

  const problems: string[] = [];
  try {
    for (const replica of replicas) {
      const at = deps.now() - started;
      deps.print(`${seconds(at)} restarting ${replica}`);
      const code = await deps.compose(["restart", replica]);
      if (code !== 0) problems.push(`docker compose restart ${replica} exited ${code}`);
      const readyUrl = `http://127.0.0.1:${DIRECT_PORTS[replica]}/api/health/ready`;
      const deadline = deps.now() + READY_TIMEOUT_MS;
      while ((await statusOf(deps, readyUrl)) !== 200) {
        if (deps.now() > deadline) {
          problems.push(`${replica} was not ready within ${READY_TIMEOUT_MS / 1000} s`);
          break;
        }
        await deps.sleep(1_000);
      }
      deps.print(`${seconds(deps.now() - started)} ${replica} is ready again`);
      await deps.sleep(gapMs);
    }
  } finally {
    polling = false;
    await poller;
  }

  const failed = polls.filter((p) => p.status !== 200);
  const signedOut = new Set(failed.filter((p) => p.status === 401).map((p) => p.persona));
  // Still signed in afterwards, too.
  for (const [persona, cookie] of sessions) {
    if ((await statusOf(deps, `${ORIGIN}/api/auth/me`, cookie)) === 401) signedOut.add(persona);
  }

  deps.print(`Requests through the proxy: ${polls.length}, failed: ${failed.length}`);
  for (const p of failed) {
    deps.print(`  ${seconds(p.at)} ${p.persona}: ${p.status ?? "no answer"}`);
  }
  deps.print(`Signed out: ${signedOut.size === 0 ? "nobody" : [...signedOut].join(", ")}`);
  for (const problem of problems) deps.print(`Problem: ${problem}`);
  return failed.length === 0 && signedOut.size === 0 && problems.length === 0 ? 0 : 1;
}

const seconds = (ms: number) => `+${(ms / 1000).toFixed(1)}s`;

/** The gap from `--gap-seconds <n>`, the default without it, or null when it doesn't read. */
export function gapFrom(args: string[]): number | null {
  if (args.length === 0) return DEFAULT_GAP_MS;
  const [flag, value] = args;
  const n = Number(value);
  return args.length === 2 && flag === "--gap-seconds" && Number.isInteger(n) && n >= 0
    ? n * 1000
    : null;
}

if (import.meta.main) {
  const gapMs = gapFrom(process.argv.slice(2));
  if (gapMs === null) {
    console.error("Usage: node e2e/scripts/rolling-restart.ts [--gap-seconds <n>]");
    process.exitCode = 2;
  } else {
    process.exitCode = await rollingRestart(
      {
        compose: (args) =>
          new Promise((done) => {
            const child = spawn("docker", composeArgs(args), { cwd: ROOT, stdio: "inherit" });
            child.on("error", () => done(127));
            child.on("close", (code) => done(code ?? 1));
          }),
        fetch,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        now: () => Date.now(),
        print: (line) => console.log(line),
      },
      { gapMs },
    );
  }
}
