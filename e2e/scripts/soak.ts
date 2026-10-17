import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PERSONAS, type Persona } from "../fixtures/format.ts";
import { PROXY_PORT, REPLICAS, type Replica, ROOT } from "../specs/shared.ts";
import { COMPOSE_FILE, fileState } from "../stack.ts";
import { signIn } from "./rolling-restart.ts";

// The soak of MVP 3, F10.3 and F10.4 (run by hand; never in pnpm e2e or CI):
//
//   pnpm e2e:soak [--minutes 20]        node e2e/scripts/soak.ts [--minutes <n>]
//
// It starts a fresh three-replica test stack (`node e2e/stack.ts stack up`), plays MVP 1's
// scenarios S1–S7 (specs/mvp-1/00–07) so Maria and Tom each have a workspace with a mailbox, the
// fake AI and a first scan behind them, and signs both in through the proxy. Then, for the soak's
// minutes, `seed generate --per-minute 1` brings one new job message a minute to each workspace
// (the app's sync picks it up), each persona reads the API every 5 s the way an open job inbox
// does, and every 15 s `docker stats --no-stream` samples each replica's CPU and memory. At the
// end the replicas' log goes to app.log and F10.3 is evaluated into soak.md, both in
// e2e/reports/mvp-3/<UTC timestamp>-soak/ beside memory.csv; the stack is taken down. Exit 0 when
// every check passes, 1 otherwise, 2 for bad arguments.
//
// The checks, over the soak only (not the setup before it):
// - memory: each replica's average between minutes 5 and 10 (a quarter and half of the soak's
//   length, for a shorter self-test) is the baseline; every sample from minute 5 to the end stays
//   within 20% of it;
// - no job failed: no `job.failed` line;
// - p95 API latency under 300 ms, from the `http.request` lines of /api routes, leaving out the
//   proxy's health checks (/api/health/*, one a second per replica) and the live-update streams
//   (…/events), which stay open for as long as the page does.

const DEFAULT_MINUTES = 20;
const PER_MINUTE = 1;
const SAMPLE_MS = 15_000;
const READ_MS = 5_000;
/** The memory check's tolerance around the baseline. */
export const MEMORY_TOLERANCE = 0.2;
export const P95_LIMIT_MS = 300;
const ORIGIN = `http://127.0.0.1:${PROXY_PORT}`;

/** One `docker stats` reading of one replica. */
export interface Sample {
  replica: Replica;
  /** Milliseconds since the soak began. */
  at: number;
  cpuPercent: number;
  memBytes: number;
}

export type LogLine = { time?: unknown; event?: unknown; [field: string]: unknown };

export interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

export interface Usage {
  replica: Replica;
  samples: number;
  cpuAvg: number;
  cpuMax: number;
  memAvg: number;
  memMax: number;
}

export interface Evaluation {
  checks: Check[];
  usage: Usage[];
}

/** `--minutes <n>` (a whole number of at least 4, so the memory window holds samples). */
export function minutesFrom(args: string[]): number | null {
  if (args.length === 0) return DEFAULT_MINUTES;
  const [flag, value] = args;
  const n = Number(value);
  return args.length === 2 && flag === "--minutes" && Number.isInteger(n) && n >= 4 ? n : null;
}

const UNITS: Record<string, number> = {
  B: 1,
  kB: 1e3,
  KB: 1e3,
  MB: 1e6,
  GB: 1e9,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
};

/** "123.4MiB" → bytes; null when it doesn't read. */
export function bytesOf(text: string): number | null {
  const m = /^([\d.]+)\s*([A-Za-z]+)$/.exec(text.trim());
  const unit = m ? UNITS[m[2] as string] : undefined;
  return m && unit ? Number(m[1]) * unit : null;
}

/**
 * The lines of `docker stats --no-stream --format '{{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}'`
 * as samples, the containers named by `replicaOf`; lines that don't read are left out.
 */
export function parseStats(
  stdout: string,
  replicaOf: (container: string) => Replica | undefined,
  at: number,
): Sample[] {
  return stdout.split("\n").flatMap((line) => {
    const [container, cpu, mem] = line.trim().split("\t");
    const replica = container ? replicaOf(container) : undefined;
    const cpuPercent = Number(cpu?.replace("%", ""));
    const memBytes = bytesOf(mem?.split("/")[0] ?? "");
    if (!replica || !Number.isFinite(cpuPercent) || memBytes === null) return [];
    return [{ replica, at, cpuPercent, memBytes }];
  });
}

/** The value at the 95th percentile (nearest rank); null for none. */
export function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1] as number;
}

const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const mib = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MiB`;

/** Whether an http.request line is an API call the latency check counts. */
export function countsForLatency(line: LogLine): boolean {
  const route = typeof line.route === "string" ? line.route : "";
  return (
    line.event === "http.request" &&
    typeof line.durationMs === "number" &&
    route.startsWith("/api/") &&
    !route.startsWith("/api/health") &&
    !route.endsWith("/events")
  );
}

/**
 * F10.3 over a soak of `minutes` that ran from `start` to `end`: the memory window per replica,
 * the job.failed count and the p95 latency of the log lines in between; and the CPU and memory
 * each replica used (F10.4).
 */
export function evaluate(input: {
  minutes: number;
  start: Date;
  end: Date;
  samples: Sample[];
  log: LogLine[];
}): Evaluation {
  const { minutes, samples } = input;
  const windowFrom = (minutes / 4) * 60_000;
  const windowTo = (minutes / 2) * 60_000;
  const during = input.log.filter((l) => {
    const t = typeof l.time === "string" ? Date.parse(l.time) : Number.NaN;
    return t >= input.start.getTime() && t <= input.end.getTime();
  });

  const checks: Check[] = [];
  const window = `minutes ${minutes / 4}–${minutes / 2}`;
  for (const replica of REPLICAS) {
    const mine = samples.filter((s) => s.replica === replica);
    const inWindow = mine.filter((s) => s.at >= windowFrom && s.at < windowTo);
    const name = `Memory of ${replica} within ${MEMORY_TOLERANCE * 100}% of its average in ${window}`;
    if (inWindow.length === 0) {
      checks.push({ name, pass: false, detail: `no samples in ${window}` });
      continue;
    }
    const baseline = average(inWindow.map((s) => s.memBytes));
    const after = mine.filter((s) => s.at >= windowFrom);
    const worst = after.reduce(
      (w, s) => (Math.abs(s.memBytes - baseline) > Math.abs(w.memBytes - baseline) ? s : w),
      after[0] as Sample,
    );
    const off = (worst.memBytes - baseline) / baseline;
    checks.push({
      name,
      pass: Math.abs(off) <= MEMORY_TOLERANCE,
      detail: `average ${mib(baseline)}; furthest ${mib(worst.memBytes)} at minute ${(worst.at / 60_000).toFixed(1)} (${off >= 0 ? "+" : ""}${(off * 100).toFixed(1)}%), over ${after.length} samples`,
    });
  }

  const failed = during.filter((l) => l.event === "job.failed").length;
  checks.push({ name: "No job failed", pass: failed === 0, detail: `${failed} job.failed lines` });

  const durations = during.filter(countsForLatency).map((l) => l.durationMs as number);
  const p = p95(durations);
  checks.push({
    name: `p95 API latency under ${P95_LIMIT_MS} ms`,
    pass: p !== null && p < P95_LIMIT_MS,
    detail: p === null ? "no API requests logged" : `${p} ms over ${durations.length} requests`,
  });

  const usage = REPLICAS.flatMap((replica) => {
    const mine = samples.filter((s) => s.replica === replica);
    if (mine.length === 0) return [];
    const cpu = mine.map((s) => s.cpuPercent);
    const mem = mine.map((s) => s.memBytes);
    return [
      {
        replica,
        samples: mine.length,
        cpuAvg: average(cpu),
        cpuMax: Math.max(...cpu),
        memAvg: average(mem),
        memMax: Math.max(...mem),
      },
    ];
  });
  return { checks, usage };
}

/** memory.csv: one row per sample. */
export function samplesCsv(start: Date, samples: Sample[]): string {
  const rows = samples.map((s) =>
    [
      new Date(start.getTime() + s.at).toISOString(),
      (s.at / 1000).toFixed(0),
      s.replica,
      s.cpuPercent.toFixed(2),
      s.memBytes.toFixed(0),
    ].join(","),
  );
  return `${["time,elapsed_s,replica,cpu_percent,mem_bytes", ...rows].join("\n")}\n`;
}

/** soak.md. */
export function report(input: {
  project: string;
  minutes: number;
  start: Date;
  end: Date;
  evaluation: Evaluation;
  problems: string[];
}): string {
  const { evaluation } = input;
  const pass = evaluation.checks.every((c) => c.pass) && input.problems.length === 0;
  return [
    `# MVP 3 soak (F10.3, F10.4): ${pass ? "PASS" : "FAIL"}`,
    "",
    `- Stack: ${input.project}, three replicas (app-a, app-b, app-c)`,
    `- Soak: ${input.minutes} minutes, ${input.start.toISOString()} to ${input.end.toISOString()}`,
    `- Load: \`seed generate --per-minute ${PER_MINUTE}\` for Maria's and Tom's workspaces; each persona reads the API every ${READ_MS / 1000} s`,
    `- Samples: \`docker stats --no-stream\` every ${SAMPLE_MS / 1000} s (memory.csv); the replicas' log in app.log`,
    "",
    "## F10.3",
    "",
    "| Check | Result | Observed |",
    "| --- | --- | --- |",
    ...evaluation.checks.map((c) => `| ${c.name} | ${c.pass ? "pass" : "FAIL"} | ${c.detail} |`),
    ...(input.problems.length > 0
      ? ["", "Problems during the run:", "", ...input.problems.map((p) => `- ${p}`)]
      : []),
    "",
    "## F10.4: observed resource use per replica",
    "",
    "| Replica | Samples | CPU avg | CPU max | Memory avg | Memory max |",
    "| --- | --- | --- | --- | --- | --- |",
    ...evaluation.usage.map(
      (u) =>
        `| ${u.replica} | ${u.samples} | ${u.cpuAvg.toFixed(1)}% | ${u.cpuMax.toFixed(1)}% | ${mib(u.memAvg)} | ${mib(u.memMax)} |`,
    ),
    "",
    "CPU is `docker stats`' share of one core (100% = one core).",
    "",
  ].join("\n");
}

// --- The run on the real stack ---

interface Child {
  done: Promise<number>;
  stop(): void;
}

function start(
  cmd: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; stdout?: number } = {},
): Child {
  const child = spawn(cmd, args, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", options.stdout ?? "inherit", "inherit"],
  });
  const done = new Promise<number>((resolve) => {
    child.on("error", () => resolve(127));
    child.on("close", (code) => resolve(code ?? 1));
  });
  return { done, stop: () => child.kill("SIGTERM") };
}

const run = (cmd: string, args: string[], options?: Parameters<typeof start>[2]) =>
  start(cmd, args, options).done;

function capture(cmd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("error", () => resolve({ code: 127, stdout }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The UTC run folder name, e.g. 20261017-101500-soak. */
export function runFolderName(now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/\.\d+Z$/, "")
    .replace(/[-:]/g, "")
    .replace("T", "-");
  return `${stamp}-soak`;
}

async function soak(minutes: number, interrupted: () => boolean): Promise<number> {
  const runDir = join(ROOT, "e2e", "reports", "mvp-3", runFolderName(new Date()));
  mkdirSync(runDir, { recursive: true });
  console.log(`Soak of ${minutes} minutes; run folder ${runDir}`);

  if ((await run("node", ["e2e/stack.ts", "stack", "up"])) !== 0) {
    console.error("The test stack did not come up: no soak");
    return 1;
  }
  const project = fileState(join(ROOT, "e2e", ".stack")).read() ?? "";
  const compose = (args: string[]) => ["compose", "-p", project, "-f", COMPOSE_FILE, ...args];
  const problems: string[] = [];
  let result = 1;
  try {
    result = await soakOn(project, compose, minutes, runDir, problems, interrupted);
  } finally {
    const down = await run("node", ["e2e/stack.ts", "stack", "down"]);
    if (down !== 0) {
      console.error("The soak stack was not fully taken down");
      result = 1;
    }
  }
  return result;
}

async function soakOn(
  project: string,
  compose: (args: string[]) => string[],
  minutes: number,
  runDir: string,
  problems: string[],
  interrupted: () => boolean,
): Promise<number> {
  // MVP 1's S1–S7: both workspaces with a mailbox, the fake AI and a first scan.
  const setupEnv = { JOBFILLY_E2E_PROJECT: project, JOBFILLY_E2E_MVP: "1" };
  const e2eDir = join(ROOT, "e2e");
  const browser = await run("pnpm", ["exec", "playwright", "install", "chromium"], {
    cwd: e2eDir,
  });
  const setup =
    browser === 0
      ? await run(
          "pnpm",
          ["exec", "playwright", "test", "--config", "playwright.config.ts", "mvp-1/0[0-7]-"],
          { cwd: e2eDir, env: setupEnv },
        )
      : browser;
  if (setup !== 0 || interrupted()) {
    console.error("Setting up Maria's and Tom's workspaces (MVP 1 S1–S7) failed: no soak");
    return 1;
  }

  const sessions = new Map<Persona, { cookie: string; workspaceId: string }>();
  for (const persona of PERSONAS) {
    const cookie = await signIn({ fetch }, persona);
    const workspaces = cookie
      ? await fetch(`${ORIGIN}/api/workspaces`, { headers: { Origin: ORIGIN, cookie } })
          .then((r) => r.json() as Promise<{ items: { id: string; isOwner: boolean }[] }>)
          .catch(() => null)
      : null;
    const own = workspaces?.items.find((w) => w.isOwner);
    if (!cookie || !own) {
      console.error(`${persona} could not sign in or has no workspace of their own: no soak`);
      return 1;
    }
    sessions.set(persona, { cookie, workspaceId: own.id });
  }

  const containers = new Map<string, Replica>();
  for (const replica of REPLICAS) {
    const id = (await capture("docker", compose(["ps", "--quiet", replica]))).stdout.trim();
    if (id) containers.set(id, replica);
  }
  const replicaOf = (container: string) =>
    containers.get(container) ??
    [...containers].find(([id]) => id.startsWith(container) || container.startsWith(id))?.[1];

  const startedAt = new Date();
  const until = startedAt.getTime() + minutes * 60_000;
  const running = () => Date.now() < until && !interrupted();
  console.log(`Soak started at ${startedAt.toISOString()}`);
  const generator = start(
    "docker",
    compose([
      "run",
      "--rm",
      "seed",
      "generate",
      "--per-minute",
      String(PER_MINUTE),
      "--minutes",
      String(minutes),
    ]),
  );

  const reader = (async () => {
    while (running()) {
      for (const { cookie, workspaceId } of sessions.values()) {
        for (const path of [
          "/api/auth/me",
          "/api/workspaces",
          `/api/workspaces/${workspaceId}/messages`,
        ]) {
          await fetch(`${ORIGIN}${path}`, {
            headers: { Origin: ORIGIN, cookie },
            signal: AbortSignal.timeout(10_000),
          })
            .then((r) => r.body?.cancel())
            .catch(() => undefined);
        }
      }
      await sleep(READ_MS);
    }
  })();

  const samples: Sample[] = [];
  while (running()) {
    const at = Date.now() - startedAt.getTime();
    const stats = await capture("docker", [
      "stats",
      "--no-stream",
      "--format",
      "{{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}",
      ...containers.keys(),
    ]);
    const read = parseStats(stats.stdout, replicaOf, at);
    if (read.length < REPLICAS.length) {
      problems.push(
        `minute ${(at / 60_000).toFixed(1)}: docker stats read ${read.length} replicas`,
      );
    }
    samples.push(...read);
    console.log(
      `+${(at / 60_000).toFixed(1)} min ${read.map((s) => `${s.replica} ${mib(s.memBytes)} ${s.cpuPercent.toFixed(1)}%`).join(", ")}`,
    );
    const next = startedAt.getTime() + (Math.floor(at / SAMPLE_MS) + 1) * SAMPLE_MS;
    while (running() && Date.now() < next) await sleep(Math.min(1_000, next - Date.now()));
  }
  await reader;
  const endedAt = new Date();
  if (interrupted()) {
    generator.stop();
    problems.push("interrupted before the soak's end");
  }
  const generated = await generator.done;
  if (generated !== 0 && !interrupted()) problems.push(`seed generate exited ${generated}`);

  const logFile = join(runDir, "app.log");
  const fd = openSync(logFile, "w");
  try {
    await run("docker", compose(["logs", "--no-color", "--no-log-prefix", ...REPLICAS]), {
      stdout: fd,
    });
  } finally {
    closeSync(fd);
  }
  const log = readFileSync(logFile, "utf8")
    .split("\n")
    .flatMap((line) => {
      try {
        return line.startsWith("{") ? [JSON.parse(line) as LogLine] : [];
      } catch {
        return [];
      }
    });

  writeFileSync(join(runDir, "memory.csv"), samplesCsv(startedAt, samples));
  const evaluation = evaluate({ minutes, start: startedAt, end: endedAt, samples, log });
  const text = report({ project, minutes, start: startedAt, end: endedAt, evaluation, problems });
  writeFileSync(join(runDir, "soak.md"), text);
  console.log(text);
  console.log(`Written to ${runDir}`);
  return evaluation.checks.every((c) => c.pass) && problems.length === 0 ? 0 : 1;
}

if (import.meta.main) {
  const minutes = minutesFrom(process.argv.slice(2));
  if (minutes === null) {
    console.error("Usage: node e2e/scripts/soak.ts [--minutes <n>]   (n ≥ 4, default 20)");
    process.exitCode = 2;
  } else {
    // Ctrl-C reaches the children too; the soak stops at its next step and takes the stack down.
    let interrupt = false;
    process.on("SIGINT", () => {
      interrupt = true;
      console.error("Interrupted: stopping the soak and taking the stack down");
    });
    process.exitCode = await soak(minutes, () => interrupt);
  }
}
