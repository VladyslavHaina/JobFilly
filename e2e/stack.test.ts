import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { loadAnswers } from "./fake-ai/answers.ts";
import { F53_PROOF_NEEDS, F53_PROOF_SPEC } from "./fixtures/f53-proof.ts";
import {
  type EnvelopeEntry,
  type ExpectedFile,
  fixturesDir,
  MARIA_KEY_MESSAGES,
  PERSONAS,
  personaPaths,
  readJson,
} from "./fixtures/format.ts";
import { readDomains } from "./rdap/domains.ts";
import { ACCOUNTS, EXTRA_ACCOUNTS } from "./seed/accounts.ts";
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
  STACK_SUBNET,
  type StackDeps,
  subnetsOverlap,
  WIRING_PROBES,
  WIRING_SCRIPT,
  wiringProblems,
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
  networks?: Record<string, Service>;
  volumes?: Record<string, unknown>;
};
const services = compose.services;

describe("docker/compose.e2e.yaml", () => {
  it("has the services of the test stack", () => {
    expect(Object.keys(services).sort()).toEqual(
      [
        "app-a",
        "app-b",
        "dns",
        "fake-ai",
        "imap",
        "oauth",
        "postgres",
        "proxy",
        "rdap",
        "seed",
      ].sort(),
    );
  });

  it("publishes only the proxy, on loopback, at :8080, the direct ports :8081 and :8082, and the fake OAuth server's :8084", () => {
    expect(services.proxy?.ports).toEqual([
      "127.0.0.1:8080:8080",
      "127.0.0.1:8081:8081",
      "127.0.0.1:8082:8082",
      "127.0.0.1:8084:8084",
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

    it("starts once the database is healthy and the DNS, RDAP and OAuth services have started", () => {
      expect(app.depends_on).toEqual({
        postgres: { condition: "service_healthy" },
        dns: { condition: "service_started" },
        rdap: { condition: "service_started" },
        oauth: { condition: "service_started" },
      });
    });

    it("signs in with Google against the fake authorisation server (MVP 3, F3.3)", () => {
      const env = app.environment;
      expect(env.JOBFILLY_GOOGLE_CLIENT_ID).toBe(services.oauth?.environment.OAUTH_CLIENT_ID);
      expect(env.JOBFILLY_GOOGLE_CLIENT_SECRET).toBe(
        services.oauth?.environment.OAUTH_CLIENT_SECRET,
      );
      expect(env.JOBFILLY_GOOGLE_CLIENT_SECRET).toMatch(/^E2E-SECRET-/);
      // The browser goes through the proxy, the app straight to the service.
      expect(env.JOBFILLY_GOOGLE_AUTHORIZE_URL).toBe("http://127.0.0.1:8084/authorize");
      expect(env.JOBFILLY_GOOGLE_TOKEN_URL).toBe("http://oauth:8080/token");
      expect(env.JOBFILLY_GOOGLE_IMAP_HOST).toBe("imap://imap:3143");
      expect(env.JOBFILLY_GOOGLE_SMTP_HOST).toBe("smtp://imap:3025");
    });

    it("syncs every 15 seconds and reads domain ages from the fake RDAP service (MVP 2)", () => {
      expect(app.environment.JOBFILLY_SYNC_INTERVAL_SECONDS).toBe("15");
      expect(app.environment.JOBFILLY_RDAP_URL).toBe("http://rdap:8080");
      expect(services.rdap?.environment.PORT).toBe("8080");
    });

    it("resolves through the dns service, at its fixed address", () => {
      expect(app.dns).toEqual([services.dns?.networks.default.ipv4_address]);
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
    // The REST API the seed's inspect smtp and reset-uidvalidity use, on every address.
    expect(opts).toContain("-Dgreenmail.api.hostname=0.0.0.0");
    expect(opts).toContain("-Dgreenmail.api.port=8080");
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
    // One account per persona, the one the seed logs in with, then Maria's other mailboxes.
    expect(users).toEqual([...PERSONAS.map((p) => ACCOUNTS[p]), ...Object.values(EXTRA_ACCOUNTS)]);
    for (const u of users ?? []) expect(u.password).toMatch(/^E2E-SECRET-/);
  });

  it("builds seed, fake-ai and rdap from docker/e2e.Dockerfile", () => {
    for (const name of ["seed", "fake-ai", "rdap"]) {
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
      GREENMAIL_API_URL: "http://imap:8080",
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

describe("the dns service (MVP 2)", () => {
  const dns = services.dns ?? {};
  const subnet = compose.networks?.default?.ipam?.config?.[0]?.subnet as string;

  it("runs a pinned CoreDNS with the Corefile and the fixture zones, read-only", () => {
    expect(dns.image).toMatch(/^coredns\/coredns:\d+\.\d+\.\d+$/);
    expect(dns.command).toEqual(["-conf", "/etc/coredns/Corefile"]);
    expect(dns.read_only).toBe(true);
    expect(dns.volumes).toEqual([
      "../e2e/dns/Corefile:/etc/coredns/Corefile:ro",
      "../e2e/dns/zones:/zones:ro",
    ]);
    expect(existsSync(join(E2E, "dns", "Corefile"))).toBe(true);
    expect(readdirSync(join(E2E, "dns", "zones")).length).toBeGreaterThan(0);
  });

  it("serves the zones from the directory the Corefile names and forwards everything else", () => {
    const corefile = readFileSync(join(E2E, "dns", "Corefile"), "utf8");
    expect(corefile).toContain("directory /zones");
    expect(corefile).toMatch(/forward \. \/etc\/resolv\.conf/);
  });

  it("has a fixed address inside the stack network's own subnet", () => {
    const ip = dns.networks?.default?.ipv4_address as string;
    expect(subnet).toMatch(/^\d+\.\d+\.\d+\.0\/24$/);
    expect(ip.split(".").slice(0, 3)).toEqual(subnet.split(".").slice(0, 3));
    expect(ip.endsWith(".0") || ip.endsWith(".255") || ip.endsWith(".1")).toBe(false);
  });
});

describe("the rdap service (MVP 2)", () => {
  it("starts the fake RDAP service from e2e/rdap/main.ts on port 8080, unpublished", () => {
    const rdap = services.rdap ?? {};
    expect(rdap.command).toEqual(["node", "e2e/rdap/main.ts"]);
    expect(rdap.environment).toEqual({ PORT: "8080" });
    expect(rdap.read_only).toBe(true);
    expect(rdap.ports).toBeUndefined();
  });
});

describe("the oauth service (MVP 3)", () => {
  it("starts the fake Google authorisation server for Maria's Gmail test account, unpublished", () => {
    const oauth = services.oauth ?? {};
    expect(oauth.command).toEqual(["node", "e2e/oauth/main.ts"]);
    expect(oauth.build).toEqual({ context: "..", dockerfile: "docker/e2e.Dockerfile" });
    expect(oauth.read_only).toBe(true);
    expect(oauth.ports).toBeUndefined();
    // The access token it hands out is that account's mail password, for XOAUTH2.
    expect(oauth.environment.OAUTH_EMAIL).toBe(EXTRA_ACCOUNTS["maria-gmail"].user);
    expect(oauth.environment.OAUTH_ACCESS_TOKEN).toBe(EXTRA_ACCOUNTS["maria-gmail"].password);
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
    ["rdap", services.rdap?.command],
    ["oauth", services.oauth?.command],
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

/** A codified scenario spec: NN-sN-<slug>.spec.ts, NN the scenario number. */
const SCENARIO_SPEC = /^(\d{2})-s(\d+)-[a-z0-9-]+\.spec\.ts$/;

/** The scenario numbers the specs of one MVP's directory codify. */
const codifiedScenarios = (entries: readonly string[]) =>
  entries.flatMap((name) => {
    const scenario = SCENARIO_SPEC.exec(name)?.[2];
    return scenario ? [Number(scenario)] : [];
  });

/** What a spec takes from specs/shared.ts instead of copying it. */
const SHARED_HELPERS = [
  "E2E-SECRET-maria-login",
  "E2E-SECRET-tom-login",
  "E2E-SECRET-ai-key",
  "--no-log-prefix",
  "fileState(",
  '"app-a": 8081',
  "Roles you're looking for",
  'getByRole("button", { name: "Sign in", exact: true })',
];

/** The addresses a spec's source types with page.goto, besides the start URL "/". */
const typedAddresses = (text: string) =>
  [...text.matchAll(/\.goto\(([^)]*)\)/g)].map((m) => m[1]).filter((url) => url !== '"/"');

const byName = (names: readonly string[]) => [...names].sort((a, b) => a.localeCompare(b));

describe("e2e/specs/mvp-1", () => {
  // The specs run only against a live stack (pnpm e2e), but what they are can be read here, so
  // pnpm check fails a run that would play only part of MVP 1 (and leave MVP 2 without the state
  // it starts from), a spec that skips, or one that moves around the app by typed addresses.
  const PROOF = F53_PROOF_SPEC;
  const SPECS = join(E2E, "specs", "mvp-1");
  const entries = readdirSync(SPECS);
  const specs = entries.filter((name) => name.endsWith(".spec.ts"));
  const source = (name: string) => readFileSync(join(SPECS, name), "utf8");

  it("codifies every scenario of docs/mvp/MVP-1.md as a spec of its own, and no other", () => {
    const doc = readRepo("docs/mvp/MVP-1.md");
    const scenarios = [...doc.matchAll(/^\| S(\d+) \| \*\*/gm)].map((m) => Number(m[1]));
    expect(scenarios.length).toBeGreaterThan(0);
    const codified = codifiedScenarios(entries);
    expect(scenarios.filter((n) => !codified.includes(n)).map((n) => `S${n}`)).toEqual([]);
    expect(codified.filter((n) => !scenarios.includes(n)).map((n) => `S${n}`)).toEqual([]);
    expect(new Set(codified).size).toBe(codified.length);
  });

  it("holds only the stack check, the scenario specs, the proof and nothing that skips", () => {
    // A skipped spec is not a passed one (docs/mvp/README.md › Sign-off): no spec here skips,
    // is marked fixme, or runs alone.
    for (const name of specs) {
      expect(name === "00-stack.spec.ts" || name === PROOF || SCENARIO_SPEC.test(name), name).toBe(
        true,
      );
      expect(source(name).match(/\.(skip|fixme|only)\(/g), name).toBeNull();
    }
    expect(entries.filter((name) => !name.endsWith(".spec.ts"))).toEqual([]);
  });

  it("types no address but the start URL, besides the direct-port view S3 asks for", () => {
    // docs/mvp/README.md › Walk it like a person: the only URLs typed by hand are the start URL
    // and invite links. S3 opens the scan screen a second time through the other replica's
    // direct port, as its scenario says.
    expect(typedAddresses(readFileSync(join(E2E, "specs", "shared.ts"), "utf8"))).toEqual([]);
    const elsewhere = Object.fromEntries(
      specs
        .map((name) => [name, typedAddresses(source(name))] as const)
        .filter(([, urls]) => urls.length),
    );
    expect(elsewhere).toEqual({
      "03-s3-first-scan.spec.ts": [expect.stringMatching(/^`http:\/\/127\.0\.0\.1:\$\{DIRECT_/)],
    });
  });

  it("takes the stack, log and sign-in helpers from specs/shared.ts instead of copying them", () => {
    for (const name of specs) {
      expect(
        SHARED_HELPERS.filter((copy) => source(name).includes(copy)),
        name,
      ).toEqual([]);
    }
  });

  it("gives S5's Offer filter a row: the offer is among what a confident first scan reads", () => {
    // A first scan stops as confident after two batches of 20 in a row change no answer, so it
    // has read at least the newest 40 likely job candidates (alerts included) when S5 runs.
    const dir = fixturesDir();
    const envelopes = readJson<EnvelopeEntry[]>(`${dir}${personaPaths("maria").envelopes}`);
    const expected = readJson<ExpectedFile>(`${dir}${personaPaths("maria").expected}`);
    const newest40 = envelopes
      .filter((e) =>
        ["likely_job", "job_alert"].includes(expected.messages[e.messageId]?.stageOne ?? ""),
      )
      .sort((a, b) => a.minutesAgo - b.minutesAgo)
      .slice(0, 40)
      .map((e) => e.messageId);
    expect(expected.messages[MARIA_KEY_MESSAGES.offer]?.category).toBe("offer");
    expect(newest40).toContain(MARIA_KEY_MESSAGES.offer);
  });

  it("runs the F5.3 proof after every scenario spec", () => {
    // Playwright runs a directory's entries in name order (localeCompare) on one worker, and the
    // proof reads the state the MVP 1 scenarios leave behind.
    expect(byName(entries).at(-1)).toBe(PROOF);
    expect(byName(["00-stack.spec.ts", PROOF, ...F53_PROOF_NEEDS]).at(-1)).toBe(PROOF);
  });

  it("makes the proof depend on exactly the scenario specs that create its state", () => {
    // S1 registers Maria, S3 and S7 are the first scans, S5 and S6 correct categories (and S6
    // registers Tom), S8 and S9 analyse the rest. S2, S4, S10 and S11 add nothing it reads.
    expect(F53_PROOF_NEEDS).toEqual([
      "01-s1-maria-registers.spec.ts",
      "03-s3-first-scan.spec.ts",
      "05-s5-job-inbox.spec.ts",
      "06-s6-inviting-tom.spec.ts",
      "07-s7-toms-thin-inbox.spec.ts",
      "08-s8-budget-stop.spec.ts",
      "09-s9-replica-dies.spec.ts",
    ]);
    for (const name of F53_PROOF_NEEDS) {
      const [, order, scenario] = SCENARIO_SPEC.exec(name) ?? [];
      expect(Number(order), name).toBe(Number(scenario));
    }
  });

  it("names every scenario spec NN-sN-<slug>, and the ones the proof needs as it lists them", () => {
    // So the specs run in the scenarios' order, and the proof's list names the files there are.
    const needed = new Map(F53_PROOF_NEEDS.map((name) => [SCENARIO_SPEC.exec(name)?.[2], name]));
    for (const entry of entries) {
      if (entry === "00-stack.spec.ts" || entry === PROOF) continue;
      const [, order, scenario] = SCENARIO_SPEC.exec(entry) ?? [];
      expect(scenario, `${entry} is named NN-sN-<slug>.spec.ts`).toBeDefined();
      expect(Number(order), entry).toBe(Number(scenario));
      if (needed.has(scenario)) expect(entry).toBe(needed.get(scenario));
    }
    for (const name of F53_PROOF_NEEDS) expect(entries, name).toContain(name);
  });

  it("has the proof require every compared message to be stored and analysed", () => {
    expect(source(PROOF)).toContain("compareWithExpected(persona, stored, { complete: true })");
  });
});

describe("e2e/specs/mvp-2", () => {
  // MVP 2's scenarios start from the state MVP 1's leave behind (docs/mvp/README.md › The test
  // stack) and from each other's: S2 delivers the mail S3 to S11 open. So they run after every
  // MVP 1 spec, in the scenarios' order, and none skips.
  const SPECS = join(E2E, "specs", "mvp-2");
  const entries = readdirSync(SPECS);
  const source = (name: string) => readFileSync(join(SPECS, name), "utf8");

  it("codifies every scenario of docs/mvp/MVP-2.md as a spec of its own, but the regression", () => {
    // The regression scenario is MVP 1's own specs, which run first on the same stack.
    const doc = readRepo("docs/mvp/MVP-2.md");
    const rows = [...doc.matchAll(/^\| S(\d+) \| \*\*([^*]+)\*\*/gm)];
    expect(rows.filter((m) => m[2] === "Regression")).toHaveLength(1);
    const scenarios = rows.filter((m) => m[2] !== "Regression").map((m) => Number(m[1]));
    expect(scenarios.length).toBeGreaterThan(0);
    const codified = codifiedScenarios(entries);
    expect(scenarios.filter((n) => !codified.includes(n)).map((n) => `S${n}`)).toEqual([]);
    expect(codified.filter((n) => !scenarios.includes(n)).map((n) => `S${n}`)).toEqual([]);
    expect(new Set(codified).size).toBe(codified.length);
  });

  it("holds only scenario specs named NN-sN-<slug>, NN the scenario, and nothing that skips", () => {
    for (const name of entries) {
      const [, order, scenario] = SCENARIO_SPEC.exec(name) ?? [];
      expect(scenario, `${name} is named NN-sN-<slug>.spec.ts`).toBeDefined();
      expect(Number(order), name).toBe(Number(scenario));
      expect(source(name).match(/\.(skip|fixme|only)\(/g), name).toBeNull();
    }
  });

  it("runs after every MVP 1 spec, in the scenarios' order", () => {
    // Playwright runs files in path order on one worker (playwright.config.ts).
    const dirs = readdirSync(join(E2E, "specs")).filter((name) => /^mvp-\d+$/.test(name));
    expect(byName(dirs).indexOf("mvp-1")).toBeLessThan(byName(dirs).indexOf("mvp-2"));
    const scenarios = byName(entries).map((name) => Number(SCENARIO_SPEC.exec(name)?.[2]));
    expect(scenarios).toEqual([...scenarios].sort((a, b) => a - b));
  });

  it("types no address but the start URL", () => {
    const typed = entries.filter((name) => typedAddresses(source(name)).length > 0);
    expect(typed).toEqual([]);
  });

  it("takes the stack, log and sign-in helpers from specs/shared.ts instead of copying them", () => {
    for (const name of entries) {
      expect(
        SHARED_HELPERS.filter((copy) => source(name).includes(copy)),
        name,
      ).toEqual([]);
    }
  });
});

describe("e2e/specs locators", () => {
  // Playwright matches a role's name as a case-insensitive substring unless it is exact. MVP 1's
  // run once stopped at S2 because { name: "AI" } also found the Settings tab "Mailbox"
  // (m-ai-lbox), and every scenario after it ran without an AI. So every role a spec finds by a
  // written name it finds exactly (a /regex/ says itself what it matches), and Settings tabs open
  // through openSettingsTab in specs/shared.ts. Every MVP's specs, not only MVP 1's.
  const SPECS = join(E2E, "specs");
  const files = readdirSync(SPECS, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".spec.ts") || f === "shared.ts")
    .map((f) => [f, readFileSync(join(SPECS, f), "utf8")] as const);

  it("tells an exact role name from one that can match a sibling", () => {
    expect(inexactRoleNames('nav.getByRole("link", { name: "AI" }).click();')).toEqual([1]);
    expect(inexactRoleNames('getByRole("link", { name: "AI", exact: false })')).toEqual([1]);
    // A spec's template name, as the spec's source text has it.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: source text, not a template
    const chip = "`Remove ${chip}`";
    expect(inexactRoleNames(`getByRole("button", {\n  name: ${chip},\n})`)).toEqual([1]);
    expect(inexactRoleNames('getByRole("heading", { name: subject, level: 2 })')).toEqual([1]);
    expect(inexactRoleNames('getByRole("link", { name: "AI", exact: true })')).toEqual([]);
    expect(inexactRoleNames(`getByRole("button", { name: ${chip}, exact: true })`)).toEqual([]);
    expect(inexactRoleNames('getByRole("button", { name: /^Remove / })')).toEqual([]);
    expect(inexactRoleNames('getByRole("link")')).toEqual([]);
    // The shorthand names the role by a variable too.
    expect(inexactRoleNames('getByRole("link", { name })')).toEqual([1]);
    expect(inexactRoleNames('getByRole("link", { level: 2, name })')).toEqual([1]);
    expect(inexactRoleNames('getByRole("link", { name, exact: true })')).toEqual([]);
    expect(inexactRoleNames('getByRole("link", { exact: true, name })')).toEqual([]);
    // Quotes, braces and "name" inside a string or a comment count for nothing, and a quote
    // that never closes still ends the scan (it once restarted from the top, forever).
    expect(inexactRoleNames(`getByRole("button", { name: 'a"b' })`)).toEqual([1]);
    expect(inexactRoleNames(`getByRole("button", { name: 'a"b', exact: true })`)).toEqual([]);
    expect(inexactRoleNames('getByRole("button", { name: "a}b", exact: true })')).toEqual([]);
    expect(inexactRoleNames('getByRole("row", { level: 1, x: "name, y" })')).toEqual([]);
    expect(
      inexactRoleNames('getByRole("button", {\n  // don\'t, name }\n  name: "Save",\n})'),
    ).toEqual([1]);
    expect(
      inexactRoleNames('getByRole("button", { name: "a })\ngetByRole("link", { name: "b" })'),
    ).toEqual([1, 2]);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: source text, not a template
    expect(inexactRoleNames("getByRole(\"button\", { name: `a ${'}'} b")).toEqual([1]);
  });

  it("finds every role named by a string, template or variable by its exact name", () => {
    expect(files.map(([f]) => f)).toContain("shared.ts");
    expect(files.length).toBeGreaterThan(10);
    const inexact = files.flatMap(([f, text]) => inexactRoleNames(text).map((n) => `${f}:${n}`));
    expect(inexact).toEqual([]);
  });

  it("opens Settings tabs only through openSettingsTab", () => {
    const settingsNav = /getByRole\(\s*"navigation"\s*,\s*\{\s*name:\s*"Settings"/;
    const elsewhere = files.filter(([f, text]) => f !== "shared.ts" && settingsNav.test(text));
    expect(elsewhere.map(([f]) => f)).toEqual([]);
    expect(readFileSync(join(SPECS, "shared.ts"), "utf8")).toMatch(settingsNav);
  });
});

/**
 * The lines of the `getByRole` calls in `text` that name the role by a string, template or
 * variable (`name: x` or the shorthand `{ name }`) without `exact: true`: Playwright would match
 * that name as a substring.
 */
function inexactRoleNames(text: string): number[] {
  const lines: number[] = [];
  for (const m of text.matchAll(/getByRole\(\s*"[a-z]+"\s*,\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    // The options object up to its own closing brace, with what its strings and comments say
    // blanked out, so a brace, a quote or a "name" inside one counts for nothing. A string that
    // never closes runs to the end of its line (a template to the end of the text): the scan
    // always moves forward and ends.
    let options = "";
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      const c = text[i];
      if (c === '"' || c === "'" || c === "`") {
        const close = closingQuote(text, i);
        options += `${c}${" ".repeat(Math.max(0, close - i - 1))}${c}`;
        i = close;
      } else if (c === "/" && text[i + 1] === "/") {
        const eol = text.indexOf("\n", i);
        i = eol === -1 ? text.length : eol - 1;
      } else if (c === "{") {
        depth++;
        options += c;
      } else if (c === "}" && --depth === 0) {
        break;
      } else {
        options += c;
      }
    }
    // The first `name` property: `name: <value>`, or the shorthand `name` (a variable).
    const prop = /(?<![\w$.])name\s*(?::\s*(\S)|(?=[,}]|\s*$))/.exec(options.slice(1));
    const value = prop ? (prop[1] ?? "shorthand") : undefined;
    if (value && value !== "/" && !/\bexact:\s*true\b/.test(options)) {
      lines.push(text.slice(0, m.index).split("\n").length);
    }
  }
  return lines;
}

/**
 * The index of the quote that closes the string opening at `start` ('…', "…" or `…`), past
 * backslash escapes and a template's balanced ${…}. Unclosed, it is the end of the line for
 * '…' and "…" and the end of the text for `…`.
 */
function closingQuote(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") i += 2;
    else if (c === quote) return i;
    else if (c === "\n" && quote !== "`") return i - 1;
    else if (quote === "`" && c === "$" && text[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < text.length && depth > 0) {
        const d = text[i];
        if (d === '"' || d === "'" || d === "`") i = closingQuote(text, i);
        else if (d === "{") depth++;
        else if (d === "}") depth--;
        i++;
      }
    } else i++;
  }
  return text.length - 1;
}

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

describe("e2e's own code", () => {
  // e2e imports no app or package code (e2e/package.json), and reads none of their files either:
  // a check that needs both, such as the sender data against the fixtures, lives in the package
  // and reads e2e/fixtures from there (packages/core/src/sender/fixtures.test.ts).
  const sources = readdirSync(E2E, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts") && !/^(node_modules|\.stack|reports)\//.test(f))
    .map((f) => [f, readFileSync(join(E2E, f), "utf8")] as const);

  it("imports nothing from @jobfilly/ and names no path into packages/ or apps/", () => {
    expect(sources.length).toBeGreaterThan(20);
    for (const [file, text] of sources) {
      expect(text, file).not.toMatch(/from\s+["']@jobfilly\//);
      expect(text, file).not.toMatch(/["'`](?:\.\.\/)+(?:packages|apps)\//);
    }
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

  it("passes :8084 to the fake OAuth server, for the browser's sign-in (MVP 3)", () => {
    expect(backendOf("bind :8084")).toEqual([
      `server oauth oauth:${services.oauth?.environment.PORT}`,
    ]);
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
const NETWORKS = ["docker", "network", "ls", "--quiet"];
const COMPOSE_UP = ["docker", ...C, "up", "--build", "--detach"];
const WIRING = [
  "docker",
  ...C,
  "exec",
  "-T",
  "app-a",
  "node",
  "-e",
  WIRING_SCRIPT,
  "kiezwerk.example",
  "gmail.com",
];
// Each persona's mail, then Maria's personal mailbox (MVP 3).
const SEEDS = [...PERSONAS, "maria-home"].map((p) => [
  "docker",
  ...C,
  "run",
  "--rm",
  "seed",
  "load",
  p,
]);
const FIRST_SEED = SEEDS[0] as string[];
const LAST_SEED = SEEDS.at(-1) as string[];
const UP = [NETWORKS, COMPOSE_UP, WIRING, ...SEEDS];
const LOGS = ["docker", ...C, "logs", "--no-color", "--tail", "100"];
/** What app-a answers when the fixture zones and the fake RDAP service are wired up. */
const wired = (over: Record<string, unknown> = {}) =>
  JSON.stringify(
    WIRING_PROBES.map((p) => ({
      domain: p.domain,
      mx: [p.mx],
      rdap: { status: 200, ldhName: p.domain },
      error: [],
      ...over,
    })),
  );
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
  // app-a reaches the fixture DNS and RDAP unless a test says otherwise.
  const stdoutQueues = new Map(
    Object.entries({ [WIRING.join(" ")]: [wired()], ...options.stdout }),
  );
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
    for (const c of f.commands) expect(c.cwd).toBe(ROOT);
    // The network listing and the wiring check are read; compose's own output passes through.
    expect(f.commands.map((c) => c.capture ?? false)).toEqual([
      true,
      false,
      true,
      ...SEEDS.map(() => false),
    ]);
    // The wiring check and the seed run only after everything answered ready.
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

    expect(f.lines()).toEqual([NETWORKS, COMPOSE_UP, LOGS, DOWN, ...CHECKS]);
    expect(f.elapsed()).toBe(READY_TIMEOUT_MS);
    expect(f.err[0]).toBe(
      "The test stack did not come up: http://127.0.0.1:8080/api/health/ready did not answer 200 within 180 s",
    );
    expect(f.project()).toBeNull();
  });

  it("takes the stack down again when compose up fails", async () => {
    const f = fake({ codes: { [COMPOSE_UP.join(" ")]: 1 } });
    expect(await main(["stack", "up"], f.deps)).toBe(1);
    expect(f.lines()).toEqual([NETWORKS, COMPOSE_UP, LOGS, DOWN, ...CHECKS]);
    expect(f.polls).toEqual([]);
    expect(f.project()).toBeNull();
  });

  it("takes the stack down again when loading a persona's mail fails", async () => {
    const f = fake({ codes: { [FIRST_SEED.join(" ")]: 1 } });
    expect(await main(["stack", "up"], f.deps)).toBe(1);
    expect(f.lines()).toEqual([NETWORKS, COMPOSE_UP, WIRING, FIRST_SEED, LOGS, DOWN, ...CHECKS]);
    expect(f.err[0]).toBe("The test stack did not come up: loading maria's mail failed");
    expect(f.project()).toBeNull();
  });

  it("checks from inside app-a, with the app's resolver and RDAP URL, before loading any mail", async () => {
    const f = fake({
      stdout: { [WIRING.join(" ")]: [wired({ mx: ["gmail-smtp-in.l.google.com"] })] },
    });
    expect(await main(["stack", "up"], f.deps)).toBe(1);
    expect(f.lines()).toEqual([NETWORKS, COMPOSE_UP, WIRING, LOGS, DOWN, ...CHECKS]);
    expect(f.err[0]).toBe(
      "The test stack did not come up: app-a doesn't reach the fixture DNS zones and RDAP: " +
        "kiezwerk.example: MX gmail-smtp-in.l.google.com, not the fixture zone's mx.kiezwerk.example; " +
        "gmail.com: MX gmail-smtp-in.l.google.com, not the fixture zone's mx.gmail.com",
    );
    expect(f.project()).toBeNull();
  });

  it("takes the stack down again when the wiring check itself fails", async () => {
    const f = fake({ codes: { [WIRING.join(" ")]: 1 } });
    expect(await main(["stack", "up"], f.deps)).toBe(1);
    expect(f.lines()).toEqual([NETWORKS, COMPOSE_UP, WIRING, LOGS, DOWN, ...CHECKS]);
    expect(f.err[0]).toBe(
      "The test stack did not come up: app-a doesn't reach the fixture DNS zones and RDAP: the check exited 1",
    );
  });

  it("starts nothing while another Docker network overlaps the stack's subnet", async () => {
    const format = "{{.Name}}{{range .IPAM.Config}} {{.Subnet}}{{end}}";
    const inspect = ["docker", "network", "inspect", "--format", format, "n1", "n2"];
    const f = fake({
      stdout: {
        [NETWORKS.join(" ")]: ["n1\nn2\n"],
        [inspect.join(" ")]: ["bridge 172.17.0.0/16\nold-e2e_default fd00::/64 10.253.0.0/16\n"],
      },
    });
    expect(await main(["stack", "up"], f.deps)).toBe(1);
    expect(f.lines()).toEqual([NETWORKS, inspect]);
    expect(f.err).toEqual([
      `The test stack can't start: Docker network old-e2e_default uses 10.253.0.0/16, which overlaps the stack's fixed ${STACK_SUBNET}. Take down the stack that owns it, or remove it with "docker network rm old-e2e_default".`,
    ]);
    expect(f.project()).toBeNull();
  });

  it("starts beside networks that don't overlap the stack's subnet", async () => {
    const format = "{{.Name}}{{range .IPAM.Config}} {{.Subnet}}{{end}}";
    const inspect = ["docker", "network", "inspect", "--format", format, "n1", "n2"];
    const f = fake({
      stdout: {
        [NETWORKS.join(" ")]: ["n1 n2"],
        [inspect.join(" ")]: ["bridge 172.17.0.0/16\nnear 10.253.54.0/24\n"],
      },
    });
    expect(await main(["stack", "up"], f.deps)).toBe(0);
    expect(f.lines()).toEqual([NETWORKS, inspect, ...UP.slice(1)]);
  });

  it("starts nothing when Docker can't list its networks", async () => {
    const f = fake({ codes: { [NETWORKS.join(" ")]: 1 } });
    expect(await main(["stack", "up"], f.deps)).toBe(1);
    expect(f.lines()).toEqual([NETWORKS]);
    expect(f.err[0]).toMatch(/^The test stack can't start: could not list Docker's networks/);
    expect(f.project()).toBeNull();
  });

  it("stops on Ctrl-C during the readiness wait: no mail, the stack down, exit 130", async () => {
    const f = fake({
      readyAfter: { [READY_URLS[1] as string]: Infinity },
      interruptAfterPolls: 6,
    });
    expect(await main(["stack", "up"], f.deps)).toBe(INTERRUPTED);
    // Stopped at the poll after Ctrl-C, long before the 180-second timeout; no logs dumped.
    expect(f.lines()).toEqual([NETWORKS, COMPOSE_UP, DOWN, ...CHECKS]);
    expect(f.polls).toHaveLength(6);
    expect(f.elapsed()).toBe(4_000);
    expect(f.err).toEqual(["Interrupted: the test stack did not come up"]);
    expect(f.out).not.toContain(`Test stack is up: ${PROJECT}`);
    expect(f.project()).toBeNull();
  });

  it("stops on Ctrl-C during compose up without waiting for readiness", async () => {
    const f = fake({ interruptOn: COMPOSE_UP.join(" ") });
    expect(await main(["stack", "up"], f.deps)).toBe(INTERRUPTED);
    expect(f.lines()).toEqual([NETWORKS, COMPOSE_UP, DOWN, ...CHECKS]);
    expect(f.polls).toEqual([]);
    expect(f.err).toEqual(["Interrupted: the test stack did not come up"]);
    expect(f.project()).toBeNull();
  });

  it("stops on Ctrl-C during the wiring check: no mail, no logs dumped", async () => {
    const f = fake({ interruptOn: WIRING.join(" ") });
    expect(await main(["stack", "up"], f.deps)).toBe(INTERRUPTED);
    expect(f.lines()).toEqual([NETWORKS, COMPOSE_UP, WIRING, DOWN, ...CHECKS]);
    expect(f.err).toEqual(["Interrupted: the test stack did not come up"]);
  });

  it("stops on Ctrl-C during a seed run before the next persona's", async () => {
    const f = fake({ interruptOn: FIRST_SEED.join(" ") });
    expect(await main(["stack", "up"], f.deps)).toBe(INTERRUPTED);
    expect(f.lines()).toEqual([NETWORKS, COMPOSE_UP, WIRING, FIRST_SEED, DOWN, ...CHECKS]);
    expect(f.project()).toBeNull();
  });
});

describe("wiringProblems", () => {
  it("finds nothing wrong when every probe has its zone's MX and its RDAP registration", () => {
    expect(wiringProblems(wired())).toEqual([]);
    // Resolvers may answer with the root's dot and in upper case; the last line is the result.
    const dotted = JSON.stringify(
      WIRING_PROBES.map((p) => ({
        domain: p.domain,
        mx: [`${p.mx.toUpperCase()}.`],
        rdap: { status: 200, ldhName: p.domain },
        error: [],
      })),
    );
    expect(wiringProblems(`a warning\n${dotted}\n`)).toEqual([]);
  });

  it("names a failed lookup, a 404 and a probe that is missing", () => {
    const rows = [
      {
        domain: "kiezwerk.example",
        mx: null,
        rdap: { status: 404, ldhName: null },
        error: ["MX lookup: ENOTFOUND"],
      },
    ];
    expect(wiringProblems(JSON.stringify(rows))).toEqual([
      "kiezwerk.example: RDAP answered 404, not its registration",
      "kiezwerk.example: MX lookup: ENOTFOUND",
      "gmail.com: not checked",
    ]);
  });

  it("says so when the check prints no result", () => {
    expect(wiringProblems("")).toEqual(['the check printed no result ("")']);
  });

  it("probes fixture domains whose zone and RDAP entry the generator writes", () => {
    const zones = readdirSync(join(E2E, "dns", "zones"));
    const domains = readDomains().domains;
    for (const probe of WIRING_PROBES) {
      const zone = zones.find((z) => {
        const origin = z.replace(/^db\./, "");
        return probe.domain === origin || probe.domain.endsWith(`.${origin}`);
      });
      expect(zone, probe.domain).toBeDefined();
      const text = readFileSync(join(E2E, "dns", "zones", zone as string), "utf8");
      const origin = (zone as string).replace(/^db\./, "");
      const label = probe.domain === origin ? "@" : probe.domain.slice(0, -origin.length - 1);
      expect(text.split("\n"), probe.domain).toContain(`${label} IN MX 10 ${probe.mx}.`);
      expect(domains[probe.domain], probe.domain).toBeDefined();
    }
  });
});

describe("subnetsOverlap", () => {
  it("compares IPv4 ranges and never matches IPv6", () => {
    expect(subnetsOverlap("10.253.53.0/24", STACK_SUBNET)).toBe(true);
    expect(subnetsOverlap("10.0.0.0/8", STACK_SUBNET)).toBe(true);
    expect(subnetsOverlap("10.253.53.128/25", STACK_SUBNET)).toBe(true);
    expect(subnetsOverlap("10.253.52.0/24", STACK_SUBNET)).toBe(false);
    expect(subnetsOverlap("172.17.0.0/16", STACK_SUBNET)).toBe(false);
    expect(subnetsOverlap("fd00::/64", STACK_SUBNET)).toBe(false);
  });

  it("is the subnet of the compose file's network", () => {
    expect(compose.networks?.default?.ipam?.config?.[0]?.subnet).toBe(STACK_SUBNET);
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
    expect(f.commands.find((c) => c.args.includes("test"))?.env).toEqual({
      JOBFILLY_E2E_PROJECT: PROJECT,
      JOBFILLY_E2E_MVP: "1",
    });
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
    const f = fake({ codes: { [COMPOSE_UP.join(" ")]: 1 } });
    expect(await main(["run"], f.deps)).toBe(1);
    expect(f.lines().some((l) => l[0] === "pnpm")).toBe(false);
    expect(f.project()).toBeNull();
  });

  it("stops on Ctrl-C during the readiness wait: no mail, no specs, the stack down", async () => {
    const f = fake({ readyAfter: { [READY_URLS[0] as string]: Infinity }, interruptAfterPolls: 3 });
    expect(await main(["run"], f.deps)).toBe(INTERRUPTED);
    expect(f.lines()).toEqual([NETWORKS, COMPOSE_UP, DOWN, ...CHECKS]);
    expect(f.polls).toHaveLength(3);
    expect(f.project()).toBeNull();
  });

  it("stops on Ctrl-C during the last seed run: no specs, the stack down", async () => {
    const f = fake({ interruptOn: LAST_SEED.join(" ") });
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
