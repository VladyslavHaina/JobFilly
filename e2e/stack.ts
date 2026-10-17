import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PERSONAS } from "./fixtures/format.ts";
import { MARIA_HOME } from "./fixtures/format-mvp3.ts";

// The test stack's commands (F7.8). The root scripts run:
//   pnpm e2e                  node e2e/stack.ts run [--mvp <n>]    fresh stack, specs, down
//   pnpm e2e:stack up|down    node e2e/stack.ts stack up|down
//   pnpm e2e:specs            node e2e/stack.ts specs [--mvp <n>]  specs against the running stack
// `up` checks that no Docker network holds the stack's fixed subnet, starts
// docker/compose.e2e.yaml under a project name of its own, waits until the proxy and every
// replica answer /api/health/ready, checks from inside app-a that the fixture DNS zones and the
// fake RDAP service answer (MVP 2, F5), loads the mail of every persona of fixtures/format.ts
// and Maria's personal mailbox (MVP 3) with `seed load <name>` (SEED_LOADS), prints the name and keeps it in e2e/.stack/project. `down` removes
// that project's containers (one-off seed runs too), networks and volumes, checks nothing is left
// and removes e2e/.stack. Only one stack runs at a time: the proxy's ports are fixed. Ctrl-C stops
// `up`, `run` and `specs` at the next step (the running child gets it too) and exits 130; `up` and
// `run` take the stack down first.

const ROOT = resolve(import.meta.dirname, "..");
const E2E_DIR = join(ROOT, "e2e");

export const COMPOSE_FILE = "docker/compose.e2e.yaml";
/** What `up` loads with `seed load <name>`, in order: each persona's mailbox, then Maria's other. */
export const SEED_LOADS = [...PERSONAS, MARIA_HOME] as const;
/** The proxy, then app-a's, app-b's and app-c's direct ports. */
export const READY_URLS = [
  "http://127.0.0.1:8080/api/health/ready",
  "http://127.0.0.1:8081/api/health/ready",
  "http://127.0.0.1:8082/api/health/ready",
  "http://127.0.0.1:8083/api/health/ready",
];
export const READY_TIMEOUT_MS = 180_000;
/** The exit code of a run stopped by Ctrl-C (128 + SIGINT). */
export const INTERRUPTED = 130;
const READY_POLL_MS = 1_000;

/**
 * The stack network's subnet in docker/compose.e2e.yaml. It is fixed because the replicas name
 * the dns service by address, so `up` refuses to start while another Docker network overlaps it.
 */
export const STACK_SUBNET = "10.253.53.0/24";

/**
 * Sender domains of the fixtures that app-a must resolve through the fixture zones (e2e/dns) and
 * find in the fake RDAP service before the mail loads. gmail.com's MX in the zone isn't the real
 * one, so an answer from the internet's DNS fails the check too.
 */
export const WIRING_PROBES = [
  { domain: "kiezwerk.example", mx: "mx.kiezwerk.example" },
  { domain: "gmail.com", mx: "mx.gmail.com" },
];

/**
 * Run with `node -e` inside app-a, the domains as arguments: what the app's own resolver and its
 * JOBFILLY_RDAP_URL answer for each, as one JSON line of { domain, mx, rdap, error }.
 */
export const WIRING_SCRIPT = [
  'const { Resolver } = require("node:dns").promises;',
  "const resolver = new Resolver({ timeout: 3000, tries: 2 });",
  "(async () => {",
  "  const out = [];",
  "  for (const domain of process.argv.slice(1)) {",
  "    const row = { domain, mx: null, rdap: null, error: [] };",
  "    try {",
  "      row.mx = (await resolver.resolveMx(domain)).map((r) => r.exchange);",
  "    } catch (e) {",
  '      row.error.push("MX lookup: " + (e.code ?? e.message));',
  "    }",
  "    try {",
  '      const url = new URL("domain/" + domain, process.env.JOBFILLY_RDAP_URL);',
  "      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });",
  "      const body = await res.json().catch(() => ({}));",
  "      row.rdap = { status: res.status, ldhName: body.ldhName ?? null };",
  "    } catch (e) {",
  '      row.error.push("RDAP: " + (e.cause?.code ?? e.message));',
  "    }",
  "    out.push(row);",
  "  }",
  "  console.log(JSON.stringify(out));",
  "})();",
].join("\n");

const USAGE = [
  "Usage:",
  "  pnpm e2e [--mvp <n>]         a fresh stack, the specs, then down (node e2e/stack.ts run)",
  "  pnpm e2e:stack up|down       start a fresh stack, or take it down",
  "  pnpm e2e:specs [--mvp <n>]   the specs against the running stack",
].join("\n");

export interface Command {
  cmd: string;
  args: string[];
  cwd: string;
  /** Added to the inherited environment. */
  env?: Record<string, string>;
  /** Return stdout instead of passing it through. */
  capture?: boolean;
}

export interface Result {
  code: number;
  stdout: string;
}

/** Where the running stack's project name is kept between commands. */
export interface StackState {
  read(): string | null;
  write(project: string): void;
  remove(): void;
}

export interface StackDeps {
  run(command: Command): Promise<Result>;
  /** Whether `url` answers 200 right now. */
  ready(url: string): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  now(): Date;
  /** Whether Ctrl-C was pressed; checked between steps, so a run stops at the next one. */
  interrupted(): boolean;
  state: StackState;
  print(line: string): void;
  error(line: string): void;
}

export async function main(args: string[], deps: StackDeps): Promise<number> {
  const [command, ...rest] = args;
  if (command === "stack" && rest.length === 1 && rest[0] === "up") return up(deps);
  if (command === "stack" && rest.length === 1 && rest[0] === "down") return down(deps);
  if (command === "specs" || command === "run") {
    const mvp = parseMvp(rest);
    if (mvp === undefined) return usage(deps);
    return command === "specs" ? specs(deps, mvp) : runAll(deps, mvp);
  }
  return usage(deps);
}

function usage(deps: StackDeps): number {
  deps.error(USAGE);
  return 2;
}

/** `[]` → null (every MVP), `["--mvp", "2"]` → "2", anything else → undefined. */
function parseMvp(args: string[]): string | null | undefined {
  if (args.length === 0) return null;
  if (args.length === 2 && args[0] === "--mvp" && /^[1-9][0-9]*$/.test(args[1] ?? "")) {
    return args[1];
  }
  return undefined;
}

/** A compose project name for a stack started at `now`, e.g. jobfilly-e2e-20261014-213045. */
export function projectName(now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/\.\d+Z$/, "")
    .replace(/[-:]/g, "")
    .replace("T", "-");
  return `jobfilly-e2e-${stamp}`;
}

function compose(project: string, args: string[]): Command {
  return {
    cmd: "docker",
    args: ["compose", "-p", project, "-f", COMPOSE_FILE, ...args],
    cwd: ROOT,
  };
}

async function up(deps: StackDeps): Promise<number> {
  const running = deps.state.read();
  if (running) {
    deps.error(
      `A test stack is already up: ${running}. Take it down first with "pnpm e2e:stack down".`,
    );
    return 1;
  }
  // Before anything starts: compose would fail on an overlapping pool with a vaguer message.
  const clash = await subnetClash(deps);
  if (clash) {
    deps.error(`The test stack can't start: ${clash}`);
    return 1;
  }
  const project = projectName(deps.now());
  // Kept before anything starts, so `down` can clean up even after an interrupted `up`.
  deps.state.write(project);
  deps.print(`Starting test stack ${project}`);

  const failed = async (reason: string): Promise<number> => {
    deps.error(`The test stack did not come up: ${reason}`);
    await deps.run(compose(project, ["logs", "--no-color", "--tail", "100"]));
    await down(deps);
    return 1;
  };
  // Checked after every step before its result: a child stopped by Ctrl-C fails too, and that
  // failure is the interrupt, not a broken stack.
  const stopped = async (): Promise<number> => {
    deps.error("Interrupted: the test stack did not come up");
    await down(deps);
    return INTERRUPTED;
  };

  const started = await deps.run(compose(project, ["up", "--build", "--detach"]));
  if (deps.interrupted()) return stopped();
  if (started.code !== 0) return failed("docker compose up failed");
  const notReady = await waitReady(deps);
  if (deps.interrupted()) return stopped();
  if (notReady) {
    return failed(`${notReady} did not answer 200 within ${READY_TIMEOUT_MS / 1000} s`);
  }
  const probed = await deps.run({
    ...compose(project, [
      "exec",
      "-T",
      "app-a",
      "node",
      "-e",
      WIRING_SCRIPT,
      ...WIRING_PROBES.map((p) => p.domain),
    ]),
    capture: true,
  });
  if (deps.interrupted()) return stopped();
  const wiring =
    probed.code === 0 ? wiringProblems(probed.stdout) : [`the check exited ${probed.code}`];
  if (wiring.length > 0) {
    return failed(`app-a doesn't reach the fixture DNS zones and RDAP: ${wiring.join("; ")}`);
  }
  for (const name of SEED_LOADS) {
    const seeded = await deps.run(compose(project, ["run", "--rm", "seed", "load", name]));
    if (deps.interrupted()) return stopped();
    if (seeded.code !== 0) return failed(`loading ${name}'s mail failed`);
  }
  deps.print(`Test stack is up: ${project}`);
  deps.print(
    "  App:   http://127.0.0.1:8080 (app-a directly on :8081, app-b on :8082, app-c on :8083)",
  );
  deps.print(
    `  Logs:  docker compose -p ${project} -f ${COMPOSE_FILE} logs -f --no-log-prefix app-a app-b app-c`,
  );
  deps.print("  Down:  pnpm e2e:stack down");
  return 0;
}

/** The first and last address of an IPv4 CIDR as numbers; null for anything else (IPv6). */
function ipv4Range(cidr: string): [number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(cidr.trim());
  if (!m) return null;
  const [a, b, c, d, bits] = m.slice(1).map(Number) as [number, number, number, number, number];
  if ([a, b, c, d].some((n) => n > 255) || bits > 32) return null;
  const address = ((a * 256 + b) * 256 + c) * 256 + d;
  const size = 2 ** (32 - bits);
  const first = Math.floor(address / size) * size;
  return [first, first + size - 1];
}

/** Whether two IPv4 CIDRs share an address. */
export function subnetsOverlap(x: string, y: string): boolean {
  const a = ipv4Range(x);
  const b = ipv4Range(y);
  return a !== null && b !== null && a[0] <= b[1] && b[0] <= a[1];
}

const NETWORK_SUBNETS = "{{.Name}}{{range .IPAM.Config}} {{.Subnet}}{{end}}";

/** Why the stack's subnet is taken: the Docker network overlapping it; null when it is free. */
async function subnetClash(deps: StackDeps): Promise<string | null> {
  const docker = (args: string[]) => deps.run({ cmd: "docker", args, cwd: ROOT, capture: true });
  const listed = await docker(["network", "ls", "--quiet"]);
  if (listed.code !== 0) {
    return `could not list Docker's networks to check that ${STACK_SUBNET} is free (is Docker running?)`;
  }
  const ids = listed.stdout.split(/\s+/).filter(Boolean);
  if (ids.length === 0) return null;
  // A network removed since the listing makes inspect fail; the others are still printed.
  const inspected = await docker(["network", "inspect", "--format", NETWORK_SUBNETS, ...ids]);
  for (const line of inspected.stdout.split("\n")) {
    const [name, ...subnets] = line.trim().split(/\s+/);
    const taken = subnets.find((s) => subnetsOverlap(s, STACK_SUBNET));
    if (name && taken) {
      return (
        `Docker network ${name} uses ${taken}, which overlaps the stack's fixed ${STACK_SUBNET}. ` +
        `Take down the stack that owns it, or remove it with "docker network rm ${name}".`
      );
    }
  }
  return null;
}

interface WiringRow {
  domain: string;
  mx: string[] | null;
  rdap: { status: number; ldhName: string | null } | null;
  error: string[];
}

/** What is wrong with WIRING_SCRIPT's output against WIRING_PROBES; [] when nothing is. */
export function wiringProblems(stdout: string): string[] {
  let rows: WiringRow[];
  try {
    rows = JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as WiringRow[];
  } catch {
    return [`the check printed no result (${JSON.stringify(stdout.trim().slice(0, 200))})`];
  }
  const problems: string[] = [];
  for (const probe of WIRING_PROBES) {
    const row = Array.isArray(rows) ? rows.find((r) => r.domain === probe.domain) : undefined;
    if (!row) {
      problems.push(`${probe.domain}: not checked`);
      continue;
    }
    // A lookup that threw has no answer and says why in `error`.
    const errors = (row.error ?? []).map((e) => `${probe.domain}: ${e}`);
    const mx = row.mx?.map((h) => h.toLowerCase().replace(/\.$/, ""));
    if (mx && !mx.includes(probe.mx)) {
      const got = mx.join(", ") || "none";
      problems.push(`${probe.domain}: MX ${got}, not the fixture zone's ${probe.mx}`);
    }
    if (row.rdap && (row.rdap.status !== 200 || row.rdap.ldhName !== probe.domain)) {
      problems.push(`${probe.domain}: RDAP answered ${row.rdap.status}, not its registration`);
    }
    if ((!mx || !row.rdap) && errors.length === 0) problems.push(`${probe.domain}: no answer`);
    problems.push(...errors);
  }
  return problems;
}

/**
 * Waits for every READY_URLS entry in turn; returns the first one that never got ready. Returns
 * null early on Ctrl-C, which the caller checks.
 */
async function waitReady(deps: StackDeps): Promise<string | null> {
  const deadline = deps.now().getTime() + READY_TIMEOUT_MS;
  for (const url of READY_URLS) {
    while (!(await deps.ready(url))) {
      if (deps.interrupted()) return null;
      if (deps.now().getTime() >= deadline) return url;
      await deps.sleep(READY_POLL_MS);
    }
  }
  return null;
}

async function down(deps: StackDeps): Promise<number> {
  const project = deps.state.read();
  if (!project) {
    deps.error(
      'No test stack is up (e2e/.stack has no project). Start one with "pnpm e2e:stack up".',
    );
    return 1;
  }
  const label = `label=com.docker.compose.project=${project}`;
  let unchecked = false;
  const ids = async (args: string[]) => {
    const result = await deps.run({ cmd: "docker", args, cwd: ROOT, capture: true });
    if (result.code !== 0) unchecked = true;
    return result.stdout.split(/\s+/).filter(Boolean);
  };
  const removeProject = () => deps.run(compose(project, ["down", "--volumes", "--remove-orphans"]));

  deps.print(`Taking down test stack ${project}`);
  await removeProject();
  // compose down leaves one-off containers (an interrupted `run seed …`) and with them the
  // network and volumes they hold: remove those containers, then take the project down again.
  const leftover = await ids(["ps", "--all", "--quiet", "--filter", label]);
  if (leftover.length > 0) {
    await deps.run({ cmd: "docker", args: ["rm", "--force", "--volumes", ...leftover], cwd: ROOT });
    await removeProject();
  }
  const remaining = {
    containers: await ids(["ps", "--all", "--quiet", "--filter", label]),
    networks: await ids(["network", "ls", "--quiet", "--filter", label]),
    volumes: await ids(["volume", "ls", "--quiet", "--filter", label]),
  };
  if (unchecked) {
    deps.error(`Could not check what is left of test stack ${project}: docker failed`);
    return 1;
  }
  const left = Object.entries(remaining).filter(([, list]) => list.length > 0);
  if (left.length > 0) {
    const what = left.map(([kind, list]) => `${kind} ${list.join(" ")}`).join("; ");
    deps.error(`Test stack ${project} was not fully removed: ${what}`);
    return 1;
  }
  deps.state.remove();
  deps.print(`Test stack ${project} removed: no containers, networks or volumes left`);
  return 0;
}

async function specs(deps: StackDeps, mvp: string | null): Promise<number> {
  const project = deps.state.read();
  if (!project) {
    deps.error('No test stack is up. Start one with "pnpm e2e:stack up".');
    return 1;
  }
  // The browser the specs drive; a no-op once it is installed.
  const browser = await deps.run({
    cmd: "pnpm",
    args: ["exec", "playwright", "install", "chromium"],
    cwd: E2E_DIR,
  });
  if (deps.interrupted()) return interrupted(deps);
  if (browser.code !== 0) {
    deps.error("Installing the Playwright browser failed");
    return browser.code;
  }
  const env: Record<string, string> = { JOBFILLY_E2E_PROJECT: project };
  if (mvp) env.JOBFILLY_E2E_MVP = mvp;
  const result = await deps.run({
    cmd: "pnpm",
    args: ["exec", "playwright", "test", "--config", "playwright.config.ts"],
    cwd: E2E_DIR,
    env,
  });
  if (deps.interrupted()) return interrupted(deps);
  return result.code;
}

function interrupted(deps: StackDeps): number {
  deps.error("Interrupted");
  return INTERRUPTED;
}

async function runAll(deps: StackDeps, mvp: string | null): Promise<number> {
  const started = await up(deps);
  if (started !== 0) return started;
  let result = 1;
  try {
    // A Ctrl-C while `up` printed its summary still runs no spec.
    result = deps.interrupted() ? interrupted(deps) : await specs(deps, mvp);
  } finally {
    const removed = await down(deps);
    if (result === 0) result = removed;
  }
  return result;
}

/** e2e/.stack/project, git-ignored. */
export function fileState(dir: string): StackState {
  const file = join(dir, "project");
  return {
    read() {
      try {
        return readFileSync(file, "utf8").trim() || null;
      } catch {
        return null;
      }
    },
    write(project) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, `${project}\n`);
    },
    remove() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function runCommand(command: Command): Promise<Result> {
  return new Promise((done) => {
    const child = spawn(command.cmd, command.args, {
      cwd: command.cwd,
      env: { ...process.env, ...command.env },
      stdio: ["inherit", command.capture ? "pipe" : "inherit", "inherit"],
    });
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("error", (error) => {
      console.error(`${command.cmd}: ${error.message}`);
      done({ code: 127, stdout });
    });
    child.on("close", (code) => done({ code: code ?? 1, stdout }));
  });
}

async function isReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    await response.body?.cancel();
    return response.status === 200;
  } catch {
    return false;
  }
}

if (import.meta.main) {
  // Ctrl-C reaches the running child (compose, Playwright) as well. Instead of exiting at once,
  // the run stops at the next step, so `up` and `run` still take the stack down.
  let interrupt = false;
  process.on("SIGINT", () => {
    interrupt = true;
    console.error("Interrupted: stopping after the running command");
  });
  process.exitCode = await main(process.argv.slice(2), {
    run: runCommand,
    ready: isReady,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => new Date(),
    interrupted: () => interrupt,
    state: fileState(join(E2E_DIR, ".stack")),
    print: (line) => console.log(line),
    error: (line) => console.error(line),
  });
}
