import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// The test stack's commands (docs/mvp/README.md › The test stack, F7.8). The root scripts run:
//   pnpm e2e                  node e2e/stack.ts run [--mvp <n>]    fresh stack, specs, down
//   pnpm e2e:stack up|down    node e2e/stack.ts stack up|down
//   pnpm e2e:specs            node e2e/stack.ts specs [--mvp <n>]  specs against the running stack
// `up` starts docker/compose.e2e.yaml under a project name of its own, waits until the proxy and
// both replicas answer /api/health/ready, loads every persona's mail, prints the name and keeps
// it in e2e/.stack/project. `down` removes that project's containers (one-off seed runs too),
// networks and volumes, checks nothing is left and removes e2e/.stack. Only one stack runs at a
// time: the proxy's ports are fixed.

const ROOT = resolve(import.meta.dirname, "..");
const E2E_DIR = join(ROOT, "e2e");

export const COMPOSE_FILE = "docker/compose.e2e.yaml";
/** The proxy, then app-a's and app-b's direct ports. */
export const READY_URLS = [
  "http://127.0.0.1:8080/api/health/ready",
  "http://127.0.0.1:8081/api/health/ready",
  "http://127.0.0.1:8082/api/health/ready",
];
/** The personas whose mail every fresh stack starts with (e2e/fixtures/<persona>). */
export const PERSONAS = ["maria", "tom"];
export const READY_TIMEOUT_MS = 180_000;
const READY_POLL_MS = 1_000;

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

  if ((await deps.run(compose(project, ["up", "--build", "--detach"]))).code !== 0) {
    return failed("docker compose up failed");
  }
  const notReady = await waitReady(deps);
  if (notReady) {
    return failed(`${notReady} did not answer 200 within ${READY_TIMEOUT_MS / 1000} s`);
  }
  for (const persona of PERSONAS) {
    if ((await deps.run(compose(project, ["run", "--rm", "seed", "load", persona]))).code !== 0) {
      return failed(`loading ${persona}'s mail failed`);
    }
  }
  deps.print(`Test stack is up: ${project}`);
  deps.print("  App:   http://127.0.0.1:8080 (app-a directly on :8081, app-b on :8082)");
  deps.print(
    `  Logs:  docker compose -p ${project} -f ${COMPOSE_FILE} logs -f --no-log-prefix app-a app-b`,
  );
  deps.print("  Down:  pnpm e2e:stack down");
  return 0;
}

/** Waits for every READY_URLS entry in turn; returns the first one that never got ready. */
async function waitReady(deps: StackDeps): Promise<string | null> {
  const deadline = deps.now().getTime() + READY_TIMEOUT_MS;
  for (const url of READY_URLS) {
    while (!(await deps.ready(url))) {
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
  return result.code;
}

async function runAll(deps: StackDeps, mvp: string | null): Promise<number> {
  const started = await up(deps);
  if (started !== 0) return started;
  let result = 1;
  try {
    result = await specs(deps, mvp);
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
  // Ctrl-C reaches the running child (compose, Playwright) as well; staying alive lets `run`
  // and a failed `up` still take the stack down.
  process.on("SIGINT", () => console.error("Interrupted: waiting for the running command to stop"));
  process.exitCode = await main(process.argv.slice(2), {
    run: runCommand,
    ready: isReady,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => new Date(),
    state: fileState(join(E2E_DIR, ".stack")),
    print: (line) => console.log(line),
    error: (line) => console.error(line),
  });
}
