import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { loadAnswers } from "./fake-ai/answers.ts";
import { PERSONAS } from "./fixtures/format.ts";
import { ACCOUNTS } from "./seed/accounts.ts";
import {
  COMPOSE_FILE,
  type Command,
  fileState,
  INTERRUPTED,
  main,
  projectName,
  READY_TIMEOUT_MS,
  READY_URLS,
  type Result,
  type StackDeps,
} from "./stack.ts";

// The test stack is never started by tests (TBD-24): these check the compose file and the proxy
// config as data, and stack.ts with an injected command runner. Validate runs the real thing.

const ROOT = join(import.meta.dirname, "..");
const E2E = import.meta.dirname;
const readRepo = (path: string) => readFileSync(join(ROOT, path), "utf8");

// biome-ignore lint/suspicious/noExplicitAny: compose data is checked field by field below.
type Service = Record<string, any>;
const compose = parse(readRepo(COMPOSE_FILE), { merge: true }) as {
  services: Record<string, Service>;
  volumes?: Record<string, unknown>;
};
const services = compose.services;

describe("docker/compose.e2e.yaml", () => {
  it("has the services of the test stack", () => {
    expect(Object.keys(services).sort()).toEqual(
      ["app-a", "app-b", "fake-ai", "imap", "postgres", "proxy", "seed"].sort(),
    );
  });

  it("publishes only the proxy, on loopback, at :8080 and the direct ports :8081 and :8082", () => {
    expect(services.proxy?.ports).toEqual([
      "127.0.0.1:8080:8080",
      "127.0.0.1:8081:8081",
      "127.0.0.1:8082:8082",
    ]);
    expect(services.proxy?.image).toMatch(/^haproxy:/);
    expect(services.proxy?.volumes).toEqual([
      "./proxy/haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro",
    ]);
    for (const [name, service] of Object.entries(services)) {
      if (name !== "proxy") expect(service.ports, name).toBeUndefined();
    }
  });

  describe.each(["app-a", "app-b"])("%s", (name) => {
    const app = services[name] ?? {};

    it("is a replica of the production image, named by its hostname", () => {
      expect(app.hostname).toBe(name);
      expect(app.build).toEqual({ context: "..", dockerfile: "docker/Dockerfile" });
      expect(app.image).toBe(services["app-a"]?.image);
    });

    it("runs as a non-root user on a read-only root filesystem with /tmp as tmpfs", () => {
      expect(app.user).toBe("node");
      expect(app.read_only).toBe(true);
      expect(app.tmpfs).toEqual(["/tmp"]);
    });

    it("gets 30 seconds to shut down", () => {
      expect(app.stop_grace_period).toBe("30s");
    });

    it("listens on a non-default PORT, answers as http://127.0.0.1:8080 and allows plain IMAP", () => {
      const env = app.environment;
      expect(env.PORT).toMatch(/^\d+$/);
      expect(env.PORT).not.toBe("8787");
      expect(env.HOST).toBe("0.0.0.0");
      expect(env.PUBLIC_URL).toBe("http://127.0.0.1:8080");
      expect(env.JOBFILLY_ALLOW_INSECURE_MAIL).toBe("true");
      expect(env.DATABASE_URL).toBe(
        `postgres://jobfilly:${services.postgres?.environment.POSTGRES_PASSWORD}@postgres:5432/jobfilly`,
      );
      // The server's own check (apps/server/src/config.ts): 32 bytes, base64, round-tripping.
      const key = Buffer.from(env.JOBFILLY_SECRET_KEY, "base64");
      expect(key).toHaveLength(32);
      expect(key.toString("base64")).toBe(env.JOBFILLY_SECRET_KEY);
    });

    it("starts once the database is healthy", () => {
      expect(app.depends_on).toEqual({ postgres: { condition: "service_healthy" } });
    });
  });

  it("gives both replicas the same configuration", () => {
    const { hostname: _a, ...a } = services["app-a"] ?? {};
    const { hostname: _b, ...b } = services["app-b"] ?? {};
    expect(a).toEqual(b);
  });

  it("checks the database's health and keeps its data in a volume that down removes", () => {
    const postgres = services.postgres ?? {};
    expect(postgres.healthcheck.test).toEqual([
      "CMD-SHELL",
      "pg_isready -h 127.0.0.1 -U jobfilly -d jobfilly",
    ]);
    expect(postgres.environment.POSTGRES_PASSWORD).toMatch(/^E2E-SECRET-/);
    expect(postgres.volumes).toEqual(["pgdata:/var/lib/postgresql/data"]);
    expect(Object.keys(compose.volumes ?? {})).toEqual(["pgdata"]);
  });

  it("runs GreenMail in memory with every persona's account, logging in by address", () => {
    const imap = services.imap ?? {};
    expect(imap.image).toMatch(/^greenmail\/standalone:\d+\.\d+\.\d+$/);
    expect(imap.volumes).toBeUndefined();
    const opts: string[] = imap.environment.GREENMAIL_OPTS.split(/\s+/);
    expect(opts).toContain("-Dgreenmail.setup.test.imap");
    expect(opts).toContain("-Dgreenmail.hostname=0.0.0.0");
    expect(opts).toContain("-Dgreenmail.users.login=email");
    expect(opts).not.toContain("-Dgreenmail.auth.disabled");
    const users = opts
      .find((o) => o.startsWith("-Dgreenmail.users="))
      ?.slice("-Dgreenmail.users=".length)
      .split(",")
      .map((u) => {
        // local:password@domain
        const [local, rest] = u.split(/:(.*)/s);
        const at = (rest ?? "").lastIndexOf("@");
        return { user: `${local}@${rest?.slice(at + 1)}`, password: rest?.slice(0, at) };
      });
    // One account per persona, the one the seed logs in with.
    expect(users).toEqual(PERSONAS.map((p) => ACCOUNTS[p]));
    for (const u of users ?? []) expect(u.password).toMatch(/^E2E-SECRET-/);
  });

  it("builds seed and fake-ai from docker/e2e.Dockerfile", () => {
    for (const name of ["seed", "fake-ai"]) {
      const service = services[name] ?? {};
      expect(service.build, name).toEqual({ context: "..", dockerfile: "docker/e2e.Dockerfile" });
      expect(service.user, name).toBe("node");
    }
  });

  it("runs the seed on demand only, against plain IMAP on the imap service", () => {
    const seed = services.seed ?? {};
    expect(seed.profiles).toEqual(["tools"]);
    expect(seed.entrypoint).toEqual(["node", "e2e/seed/main.ts"]);
    expect(seed.environment).toEqual({
      IMAP_HOST: "imap",
      IMAP_PORT: "3143",
      FIXTURES_DIR: "e2e/fixtures",
    });
    expect(seed.depends_on).toEqual(["imap"]);
  });

  it("starts the fake AI from its entry point on port 8080 with a 300 ms delay", () => {
    const fake = services["fake-ai"] ?? {};
    expect(fake.command).toEqual(["node", "e2e/fake-ai/main.ts"]);
    expect(fake.environment).toEqual({
      PORT: "8080",
      FIXTURES_DIR: "e2e/fixtures",
      FAKE_AI_DELAY_MS: "300",
      // Compose fills it in from the environment: S11 restarts fake-ai with 15000.
      // biome-ignore lint/suspicious/noTemplateCurlyInString: compose interpolation, not JS.
      FAKE_AI_SLOW_TEST_MS: "${FAKE_AI_SLOW_TEST_MS:-0}",
    });
  });
});

describe("the e2e image's entry points and fixtures", () => {
  // The e2e image runs from /repo with e2e/ at /repo/e2e, as in the repository (e2e.Dockerfile),
  // so the paths compose gives seed and fake-ai resolve against the repository root.
  const dockerfile = readRepo("docker/e2e.Dockerfile");
  const lastStage = dockerfile.slice(dockerfile.lastIndexOf("\nFROM "));
  const starts: [string, string[] | undefined][] = [
    ["seed", services.seed?.entrypoint],
    ["fake-ai", services["fake-ai"]?.command],
  ];

  it("runs from /repo with e2e/ copied to /repo/e2e", () => {
    expect(lastStage).toMatch(/^WORKDIR \/repo$/m);
    expect(lastStage).toMatch(/^COPY --from=deps \/out \.\/e2e$/m);
  });

  it.each(starts)("starts %s from an entry point that exists", (_name, argv) => {
    expect(argv?.[0]).toBe("node");
    expect(existsSync(join(ROOT, argv?.[1] ?? "(none)")), argv?.[1]).toBe(true);
  });

  // The seed's FIXTURES_DIR: seed/load.test.ts loads every persona's mail from it.
  it("lets the fake AI load every answer from its FIXTURES_DIR", () => {
    const dir = join(ROOT, services["fake-ai"]?.environment.FIXTURES_DIR);
    expect(() => loadAnswers(dir)).not.toThrow();
  });
});

describe("e2e/specs/mvp-1", () => {
  it("runs the F5.3 proof after every scenario spec", () => {
    // Playwright runs a directory's entries in name order (localeCompare) on one worker, and the
    // proof reads the state the MVP 1 scenarios leave behind.
    const entries = readdirSync(join(E2E, "specs", "mvp-1")).sort((a, b) => a.localeCompare(b));
    expect(entries.at(-1)).toBe("99-f5.3-stored-equals-expected.spec.ts");
  });
});

describe("docker/e2e.Dockerfile", () => {
  const dockerfile = readRepo("docker/e2e.Dockerfile");
  const copies = dockerfile.match(/^COPY .*$/gm) ?? [];

  it("copies e2e and the workspace manifests only, never app or package code", () => {
    expect(copies).toEqual([
      "COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./",
      "COPY e2e ./e2e",
      "COPY --from=deps /out ./e2e",
    ]);
    expect(dockerfile).toMatch(/--filter @jobfilly\/e2e/);
  });

  it("runs as a non-root user", () => {
    expect(
      dockerfile
        .trim()
        .split("\n")
        .filter((l) => l.startsWith("USER ")),
    ).toEqual(["USER node"]);
  });
});

/** haproxy.cfg as sections of directive lines, comments dropped. */
function haproxySections(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    if (/^\S/.test(raw)) {
      current = [];
      sections.set(line, current);
    } else {
      current?.push(line.replace(/\s+/g, " "));
    }
  }
  return sections;
}

describe("docker/proxy/haproxy.cfg", () => {
  const sections = haproxySections(readRepo("docker/proxy/haproxy.cfg"));
  const port = services["app-a"]?.environment.PORT;
  const frontend = (bind: string) =>
    [...sections].find(([name, lines]) => name.startsWith("frontend ") && lines.includes(bind));
  const backendOf = (bind: string) => {
    const lines = frontend(bind)?.[1] ?? [];
    const name = lines.find((l) => l.startsWith("default_backend "))?.split(" ")[1];
    return sections.get(`backend ${name}`) ?? [];
  };

  it("balances :8080 round-robin over both replicas, checking /api/health/ready", () => {
    const backend = backendOf("bind :8080");
    expect(backend).toContain("balance roundrobin");
    expect(backend).toContain("option httpchk");
    expect(backend).toContain(
      "http-check send meth GET uri /api/health/ready ver HTTP/1.1 hdr Host proxy",
    );
    expect(backend).toContain("http-check expect status 200");
    expect(backend.filter((l) => l.startsWith("server "))).toEqual([
      `server app-a app-a:${port} check inter 1s fall 2 rise 1`,
      `server app-b app-b:${port} check inter 1s fall 2 rise 1`,
    ]);
  });

  it("takes a replica out well inside its 5-second drain", () => {
    for (const line of backendOf("bind :8080").filter((l) => l.startsWith("server "))) {
      const inter = Number(line.match(/inter (\d+)s/)?.[1]);
      const fall = Number(line.match(/fall (\d+)/)?.[1]);
      expect(inter * fall).toBeLessThan(5);
    }
  });

  it("exposes app-a on :8081 and app-b on :8082 directly, passing their own answers through", () => {
    expect(backendOf("bind :8081")).toEqual([`server app-a app-a:${port}`]);
    expect(backendOf("bind :8082")).toEqual([`server app-b app-b:${port}`]);
  });

  it("finds replicas through Docker's DNS, also after a restart, and starts without them", () => {
    expect(sections.get("resolvers docker")).toContain("nameserver dns 127.0.0.11:53");
    expect(sections.get("defaults")).toContain(
      "default-server init-addr last,libc,none resolvers docker",
    );
  });

  it("keeps live-update streams open past their 15-second heartbeat", () => {
    const defaults = sections.get("defaults") ?? [];
    expect(defaults).toContain("mode http");
    for (const side of ["client", "server"]) {
      const seconds = Number(
        defaults
          .find((l) => l.startsWith(`timeout ${side} `))
          ?.split(" ")[2]
          ?.replace("s", ""),
      );
      expect(seconds, side).toBeGreaterThan(15);
    }
  });

  it("logs to stdout", () => {
    expect(sections.get("global")).toContain("log stdout format raw local0 info");
  });
});

// ---------------------------------------------------------------------------------------------
// stack.ts with an injected command runner.

const NOW = new Date("2026-10-14T21:30:45.678Z");
const PROJECT = "jobfilly-e2e-20261014-213045";
const C = ["compose", "-p", PROJECT, "-f", "docker/compose.e2e.yaml"];
const DOWN = ["docker", ...C, "down", "--volumes", "--remove-orphans"];
const LABEL = `label=com.docker.compose.project=${PROJECT}`;
const CHECKS = [
  ["docker", "ps", "--all", "--quiet", "--filter", LABEL],
  ["docker", "ps", "--all", "--quiet", "--filter", LABEL],
  ["docker", "network", "ls", "--quiet", "--filter", LABEL],
  ["docker", "volume", "ls", "--quiet", "--filter", LABEL],
];
const UP = [
  ["docker", ...C, "up", "--build", "--detach"],
  // Every persona of fixtures/format.ts, in its order.
  ...PERSONAS.map((p) => ["docker", ...C, "run", "--rm", "seed", "load", p]),
];
const PW_INSTALL = ["pnpm", "exec", "playwright", "install", "chromium"];
const PW_TEST = ["pnpm", "exec", "playwright", "test", "--config", "playwright.config.ts"];

interface FakeOptions {
  /** Exit code per command line (joined by spaces); 0 otherwise. */
  codes?: Record<string, number>;
  /** stdout per captured command line. */
  stdout?: Record<string, string[]>;
  /** How many polls each URL needs before it answers 200 (Infinity: never). */
  readyAfter?: Record<string, number>;
  project?: string | null;
  /** Ctrl-C while this command line runs; it then exits 130, as a child stopped by SIGINT does. */
  interruptOn?: string;
  /** Ctrl-C after this many readiness polls. */
  interruptAfterPolls?: number;
}

function fake(options: FakeOptions = {}) {
  const commands: Command[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const polls: string[] = [];
  let project = options.project ?? null;
  let clock = NOW.getTime();
  let interrupt = false;
  const stdoutQueues = new Map(Object.entries(options.stdout ?? {}));
  const deps: StackDeps = {
    async run(command): Promise<Result> {
      commands.push(command);
      const line = [command.cmd, ...command.args].join(" ");
      const queued = stdoutQueues.get(line);
      if (line === options.interruptOn) {
        interrupt = true;
        return { code: INTERRUPTED, stdout: "" };
      }
      return { code: options.codes?.[line] ?? 0, stdout: queued?.shift() ?? "" };
    },
    async ready(url) {
      polls.push(url);
      if (polls.length === options.interruptAfterPolls) interrupt = true;
      const need = options.readyAfter?.[url] ?? 0;
      return polls.filter((u) => u === url).length > need;
    },
    async sleep(ms) {
      clock += ms;
    },
    now: () => new Date(clock),
    interrupted: () => interrupt,
    state: {
      read: () => project,
      write: (p) => {
        project = p;
      },
      remove: () => {
        project = null;
      },
    },
    print: (line) => out.push(line),
    error: (line) => err.push(line),
  };
  const lines = () => commands.map((c) => [c.cmd, ...c.args]);
  return {
    deps,
    commands,
    lines,
    out,
    err,
    polls,
    project: () => project,
    elapsed: () => clock - NOW.getTime(),
  };
}

describe("projectName", () => {
  it("names a stack by the UTC second it started", () => {
    expect(projectName(NOW)).toBe(PROJECT);
    expect(projectName(NOW)).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
  });
});

describe("stack up", () => {
  it("starts a fresh stack, waits for the proxy and both replicas, loads the mail, prints the name", async () => {
    const f = fake({ readyAfter: { [READY_URLS[0] as string]: 3 } });
    expect(await main(["stack", "up"], f.deps)).toBe(0);

    expect(f.lines()).toEqual(UP);
    for (const c of f.commands) {
      expect(c.cwd).toBe(ROOT);
      expect(c.capture).toBeUndefined();
    }
    // The seed runs only after everything answered ready.
    expect(f.polls).toEqual([
      "http://127.0.0.1:8080/api/health/ready",
      "http://127.0.0.1:8080/api/health/ready",
      "http://127.0.0.1:8080/api/health/ready",
      "http://127.0.0.1:8080/api/health/ready",
      "http://127.0.0.1:8081/api/health/ready",
      "http://127.0.0.1:8082/api/health/ready",
    ]);
    expect(f.elapsed()).toBe(3_000);
    expect(f.out).toContain(`Test stack is up: ${PROJECT}`);
    expect(f.out).toContain(
      `  Logs:  docker compose -p ${PROJECT} -f docker/compose.e2e.yaml logs -f --no-log-prefix app-a app-b`,
    );
    expect(f.project()).toBe(PROJECT);
  });

  it("refuses to start a second stack", async () => {
    const f = fake({ project: "jobfilly-e2e-20261014-100000" });
    expect(await main(["stack", "up"], f.deps)).toBe(1);
    expect(f.commands).toEqual([]);
    expect(f.err).toEqual([
      'A test stack is already up: jobfilly-e2e-20261014-100000. Take it down first with "pnpm e2e:stack down".',
    ]);
  });

  it("takes the stack down again when the proxy never gets ready", async () => {
    const f = fake({ readyAfter: { [READY_URLS[0] as string]: Infinity } });
    expect(await main(["stack", "up"], f.deps)).toBe(1);

    expect(f.lines()).toEqual([
      ["docker", ...C, "up", "--build", "--detach"],
      ["docker", ...C, "logs", "--no-color", "--tail", "100"],
      DOWN,
      ...CHECKS,
    ]);
    expect(f.elapsed()).toBe(READY_TIMEOUT_MS);
    expect(f.err[0]).toBe(
      "The test stack did not come up: http://127.0.0.1:8080/api/health/ready did not answer 200 within 180 s",
    );
    expect(f.project()).toBeNull();
  });

  it("takes the stack down again when compose up fails", async () => {
    const f = fake({ codes: { [["docker", ...C, "up", "--build", "--detach"].join(" ")]: 1 } });
    expect(await main(["stack", "up"], f.deps)).toBe(1);
    expect(f.lines()).toEqual([
      ["docker", ...C, "up", "--build", "--detach"],
      ["docker", ...C, "logs", "--no-color", "--tail", "100"],
      DOWN,
      ...CHECKS,
    ]);
    expect(f.polls).toEqual([]);
    expect(f.project()).toBeNull();
  });

  it("takes the stack down again when loading a persona's mail fails", async () => {
    const f = fake({ codes: { [UP[1]?.join(" ") as string]: 1 } });
    expect(await main(["stack", "up"], f.deps)).toBe(1);
    expect(f.lines()).toEqual([
      UP[0],
      UP[1],
      ["docker", ...C, "logs", "--no-color", "--tail", "100"],
      DOWN,
      ...CHECKS,
    ]);
    expect(f.err[0]).toBe("The test stack did not come up: loading maria's mail failed");
    expect(f.project()).toBeNull();
  });

  it("stops on Ctrl-C during the readiness wait: no mail, the stack down, exit 130", async () => {
    const f = fake({
      readyAfter: { [READY_URLS[1] as string]: Infinity },
      interruptAfterPolls: 6,
    });
    expect(await main(["stack", "up"], f.deps)).toBe(INTERRUPTED);
    // Stopped at the poll after Ctrl-C, long before the 180-second timeout; no logs dumped.
    expect(f.lines()).toEqual([UP[0], DOWN, ...CHECKS]);
    expect(f.polls).toHaveLength(6);
    expect(f.elapsed()).toBe(4_000);
    expect(f.err).toEqual(["Interrupted: the test stack did not come up"]);
    expect(f.out).not.toContain(`Test stack is up: ${PROJECT}`);
    expect(f.project()).toBeNull();
  });

  it("stops on Ctrl-C during compose up without waiting for readiness", async () => {
    const f = fake({ interruptOn: UP[0]?.join(" ") });
    expect(await main(["stack", "up"], f.deps)).toBe(INTERRUPTED);
    expect(f.lines()).toEqual([UP[0], DOWN, ...CHECKS]);
    expect(f.polls).toEqual([]);
    expect(f.err).toEqual(["Interrupted: the test stack did not come up"]);
    expect(f.project()).toBeNull();
  });

  it("stops on Ctrl-C during a seed run before the next persona's", async () => {
    const f = fake({ interruptOn: UP[1]?.join(" ") });
    expect(await main(["stack", "up"], f.deps)).toBe(INTERRUPTED);
    expect(f.lines()).toEqual([UP[0], UP[1], DOWN, ...CHECKS]);
    expect(f.project()).toBeNull();
  });
});

describe("stack down", () => {
  it("removes the project with its volumes and orphans, checks nothing is left, forgets it", async () => {
    const f = fake({ project: PROJECT });
    expect(await main(["stack", "down"], f.deps)).toBe(0);
    expect(f.lines()).toEqual([DOWN, ...CHECKS]);
    expect(f.commands.slice(1).every((c) => c.capture)).toBe(true);
    expect(f.out).toContain(
      `Test stack ${PROJECT} removed: no containers, networks or volumes left`,
    );
    expect(f.project()).toBeNull();
  });

  it("removes one-off containers compose down leaves behind, then the project again", async () => {
    const f = fake({
      project: PROJECT,
      stdout: { [CHECKS[0]?.join(" ") as string]: ["abc123\ndef456\n", ""] },
    });
    expect(await main(["stack", "down"], f.deps)).toBe(0);
    expect(f.lines()).toEqual([
      DOWN,
      CHECKS[0],
      ["docker", "rm", "--force", "--volumes", "abc123", "def456"],
      DOWN,
      ...CHECKS.slice(1),
    ]);
    expect(f.project()).toBeNull();
  });

  it("fails and keeps the name when something of the stack remains", async () => {
    const f = fake({
      project: PROJECT,
      stdout: { [CHECKS[3]?.join(" ") as string]: ["jobfilly-e2e-20261014-213045_pgdata\n"] },
    });
    expect(await main(["stack", "down"], f.deps)).toBe(1);
    expect(f.err).toEqual([
      `Test stack ${PROJECT} was not fully removed: volumes jobfilly-e2e-20261014-213045_pgdata`,
    ]);
    expect(f.project()).toBe(PROJECT);
  });

  it("fails and keeps the name when docker can't say what is left", async () => {
    const f = fake({ project: PROJECT, codes: { [CHECKS[2]?.join(" ") as string]: 1 } });
    expect(await main(["stack", "down"], f.deps)).toBe(1);
    expect(f.err).toEqual([`Could not check what is left of test stack ${PROJECT}: docker failed`]);
    expect(f.project()).toBe(PROJECT);
  });

  it("says so when no stack is up", async () => {
    const f = fake();
    expect(await main(["stack", "down"], f.deps)).toBe(1);
    expect(f.commands).toEqual([]);
    expect(f.err[0]).toMatch(/^No test stack is up/);
  });
});

describe("specs", () => {
  it("runs every spec against the running stack, naming its project", async () => {
    const f = fake({ project: PROJECT });
    expect(await main(["specs"], f.deps)).toBe(0);
    expect(f.lines()).toEqual([PW_INSTALL, PW_TEST]);
    expect(f.commands.map((c) => c.cwd)).toEqual([E2E, E2E]);
    expect(f.commands[1]?.env).toEqual({ JOBFILLY_E2E_PROJECT: PROJECT });
  });

  it("runs one MVP's specs with --mvp", async () => {
    const f = fake({ project: PROJECT });
    expect(await main(["specs", "--mvp", "2"], f.deps)).toBe(0);
    expect(f.commands[1]?.env).toEqual({ JOBFILLY_E2E_PROJECT: PROJECT, JOBFILLY_E2E_MVP: "2" });
  });

  it("passes the specs' exit code on", async () => {
    const f = fake({ project: PROJECT, codes: { [PW_TEST.join(" ")]: 3 } });
    expect(await main(["specs"], f.deps)).toBe(3);
  });

  it("stops on Ctrl-C during the browser install without running the specs", async () => {
    const f = fake({ project: PROJECT, interruptOn: PW_INSTALL.join(" ") });
    expect(await main(["specs"], f.deps)).toBe(INTERRUPTED);
    expect(f.lines()).toEqual([PW_INSTALL]);
    // The stack belongs to whoever ran `up`: it stays up.
    expect(f.project()).toBe(PROJECT);
  });

  it("exits 130 when Ctrl-C stops the specs", async () => {
    const f = fake({ project: PROJECT, interruptOn: PW_TEST.join(" ") });
    expect(await main(["specs"], f.deps)).toBe(INTERRUPTED);
    expect(f.lines()).toEqual([PW_INSTALL, PW_TEST]);
  });

  it("needs a running stack", async () => {
    const f = fake();
    expect(await main(["specs"], f.deps)).toBe(1);
    expect(f.commands).toEqual([]);
    expect(f.err).toEqual(['No test stack is up. Start one with "pnpm e2e:stack up".']);
  });
});

describe("run (pnpm e2e)", () => {
  it("starts a fresh stack, runs the specs and takes the stack down", async () => {
    const f = fake();
    expect(await main(["run", "--mvp", "1"], f.deps)).toBe(0);
    expect(f.lines()).toEqual([...UP, PW_INSTALL, PW_TEST, DOWN, ...CHECKS]);
    expect(f.commands[4]?.env).toEqual({ JOBFILLY_E2E_PROJECT: PROJECT, JOBFILLY_E2E_MVP: "1" });
    expect(f.project()).toBeNull();
  });

  it("takes the stack down after failing specs and reports the failure", async () => {
    const f = fake({ codes: { [PW_TEST.join(" ")]: 1 } });
    expect(await main(["run"], f.deps)).toBe(1);
    expect(f.lines()).toEqual([...UP, PW_INSTALL, PW_TEST, DOWN, ...CHECKS]);
    expect(f.project()).toBeNull();
  });

  it("takes the stack down when the spec runner throws", async () => {
    const f = fake();
    const run = f.deps.run;
    f.deps.run = async (command) => {
      if (command.args.includes("test")) throw new Error("spawn pnpm ENOENT");
      return run(command);
    };
    await expect(main(["run"], f.deps)).rejects.toThrow("spawn pnpm ENOENT");
    expect(f.lines().slice(-5)).toEqual([DOWN, ...CHECKS]);
    expect(f.project()).toBeNull();
  });

  it("fails when the stack could not be removed, even if the specs passed", async () => {
    const f = fake({ stdout: { [CHECKS[2]?.join(" ") as string]: ["net1\n"] } });
    expect(await main(["run"], f.deps)).toBe(1);
  });

  it("runs no specs when the stack did not come up", async () => {
    const f = fake({ codes: { [UP[0]?.join(" ") as string]: 1 } });
    expect(await main(["run"], f.deps)).toBe(1);
    expect(f.lines().some((l) => l[0] === "pnpm")).toBe(false);
    expect(f.project()).toBeNull();
  });

  it("stops on Ctrl-C during the readiness wait: no mail, no specs, the stack down", async () => {
    const f = fake({ readyAfter: { [READY_URLS[0] as string]: Infinity }, interruptAfterPolls: 3 });
    expect(await main(["run"], f.deps)).toBe(INTERRUPTED);
    expect(f.lines()).toEqual([UP[0], DOWN, ...CHECKS]);
    expect(f.polls).toHaveLength(3);
    expect(f.project()).toBeNull();
  });

  it("stops on Ctrl-C during the last seed run: no specs, the stack down", async () => {
    const f = fake({ interruptOn: UP[2]?.join(" ") });
    expect(await main(["run"], f.deps)).toBe(INTERRUPTED);
    expect(f.lines()).toEqual([...UP, DOWN, ...CHECKS]);
    expect(f.project()).toBeNull();
  });

  it("takes the stack down and exits 130 when Ctrl-C stops the specs", async () => {
    const f = fake({ interruptOn: PW_TEST.join(" ") });
    expect(await main(["run"], f.deps)).toBe(INTERRUPTED);
    expect(f.lines()).toEqual([...UP, PW_INSTALL, PW_TEST, DOWN, ...CHECKS]);
    expect(f.project()).toBeNull();
  });
});

describe("arguments", () => {
  it.each([
    [[]],
    [["stack"]],
    [["stack", "sideways"]],
    [["specs", "--mvp"]],
    [["specs", "--mvp", "x"]],
    [["run", "--mvp", "0"]],
  ])("prints the usage for %j", async (args) => {
    const f = fake({ project: PROJECT });
    expect(await main(args, f.deps)).toBe(2);
    expect(f.commands).toEqual([]);
    expect(f.err[0]).toMatch(/^Usage:/);
  });
});

describe("fileState", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("keeps the project name in <dir>/project and removes the folder", () => {
    const base = mkdtempSync(join(tmpdir(), "stack-"));
    dirs.push(base);
    const dir = join(base, ".stack");
    const state = fileState(dir);
    expect(state.read()).toBeNull();
    state.write(PROJECT);
    expect(readFileSync(join(dir, "project"), "utf8")).toBe(`${PROJECT}\n`);
    expect(state.read()).toBe(PROJECT);
    state.remove();
    expect(state.read()).toBeNull();
    state.remove();
  });
});

describe("root scripts", () => {
  it("run stack.ts with the subcommands it understands", () => {
    const scripts = JSON.parse(readRepo("package.json")).scripts;
    expect(scripts.e2e).toBe("node e2e/stack.ts run");
    expect(scripts["e2e:stack"]).toBe("node e2e/stack.ts stack");
    expect(scripts["e2e:specs"]).toBe("node e2e/stack.ts specs");
  });

  it("keep e2e/.stack out of git", () => {
    expect(readRepo(".gitignore").split("\n")).toContain("e2e/.stack/");
  });
});
