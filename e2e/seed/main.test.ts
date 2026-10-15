import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { PERSONAS } from "../fixtures/format.ts";
import { COMPOSE_FILE, main, type StackDeps, WIRING_PROBES } from "../stack.ts";
import { ACCOUNTS } from "./accounts.ts";

// The seed's entry point run as the test stack runs it, without Docker: node with the entrypoint
// and environment compose gives the seed service, from the repository root (the e2e image's /repo
// holds e2e/ where the repository does), with the arguments `pnpm e2e:stack up` passes. A stand-in
// IMAP server on loopback refuses every login, so a run that got as far as logging in has read and
// checked every fixture file of its persona (loadPersona reads them all before it connects).

const ROOT = join(import.meta.dirname, "..", "..");
const seed = (
  parse(readFileSync(join(ROOT, COMPOSE_FILE), "utf8"), { merge: true }) as {
    services: { seed: { entrypoint: string[]; environment: Record<string, string> } };
  }
).services.seed;

const WIRED = JSON.stringify(
  WIRING_PROBES.map((p) => ({
    domain: p.domain,
    mx: [p.mx],
    rdap: { status: 200, ldhName: p.domain },
    error: [],
  })),
);

/** The `seed …` arguments of every one-off seed run `stack up` makes, in order. */
async function seedRunsOfStackUp(): Promise<string[][]> {
  const runs: string[][] = [];
  const deps: StackDeps = {
    async run(command) {
      const at = command.args.indexOf("seed");
      if (command.args.includes("run") && at >= 0) runs.push(command.args.slice(at + 1));
      // The wiring check inside app-a: the fixture zones and the fake RDAP service answer.
      return { code: 0, stdout: command.args.includes("exec") ? WIRED : "" };
    },
    ready: async () => true,
    sleep: async () => {},
    now: () => new Date("2026-10-14T21:30:45Z"),
    interrupted: () => false,
    state: { read: () => null, write: () => {}, remove: () => {} },
    print: () => {},
    error: () => {},
  };
  expect(await main(["stack", "up"], deps)).toBe(0);
  return runs;
}

/** A mail server that greets, answers CAPABILITY and refuses every LOGIN, recording the user. */
function refusingImap() {
  const logins: string[] = [];
  const server = createServer((socket) => {
    socket.on("error", () => {});
    socket.write("* OK [CAPABILITY IMAP4rev1] test server ready\r\n");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      for (let end = buffer.indexOf("\r\n"); end >= 0; end = buffer.indexOf("\r\n")) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const [tag, command = ""] = line.split(" ");
        if (command.toUpperCase() === "CAPABILITY") {
          socket.write(`* CAPABILITY IMAP4rev1\r\n${tag} OK done\r\n`);
        } else if (command.toUpperCase() === "LOGIN") {
          logins.push(/^\S+ LOGIN "?([^"\s]+)/i.exec(line)?.[1] ?? "(unreadable)");
          socket.write(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
        } else if (command.toUpperCase() === "LOGOUT") {
          socket.end(`* BYE\r\n${tag} OK bye\r\n`);
        } else {
          socket.write(`${tag} BAD unknown command\r\n`);
        }
      }
    });
  });
  return { server, logins };
}

interface Exit {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** `node <compose entrypoint> <args>` from the repository root, with compose's environment. */
function runSeed(args: string[], env: Record<string, string>): Promise<Exit> {
  const [node, entry] = seed.entrypoint;
  expect(node).toBe("node");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry as string, ...args], {
      cwd: ROOT,
      env: { PATH: process.env.PATH ?? "", ...seed.environment, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const runs = await seedRunsOfStackUp();

// Every case starts a node process, which takes seconds on a busy machine.
describe("the seed entry point", { timeout: 30_000 }, () => {
  const imap = refusingImap();
  let local: Record<string, string> = {};
  beforeAll(async () => {
    await new Promise<void>((resolve) => imap.server.listen(0, "127.0.0.1", resolve));
    const address = imap.server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    local = { IMAP_HOST: "127.0.0.1", IMAP_PORT: String(address.port) };
  });
  afterAll(() => new Promise<void>((resolve) => imap.server.close(() => resolve())));

  it("is run by stack up once for every persona", () => {
    expect(runs).toEqual(PERSONAS.map((p) => ["load", p]));
  });

  it.each(runs.map((args) => ({ args, persona: args[1] as (typeof PERSONAS)[number] })))(
    "reads every fixture of `seed $args` and logs in as the persona",
    async ({ args, persona }) => {
      imap.logins.length = 0;
      const exit = await runSeed(args, local);
      expect(exit.stderr).not.toContain("No fixtures");
      expect(exit.stderr.trim()).toBe(
        "The mail server refused the login: check the persona's account",
      );
      expect(exit.code).toBe(1);
      expect(imap.logins).toEqual([ACCOUNTS[persona].user]);
    },
  );

  // What validation run 1 hit: the stack loaded a persona whose fixtures weren't there.
  it("fails before connecting when a persona's fixtures are missing", async () => {
    const empty = mkdtempSync(join(tmpdir(), "seed-main-"));
    try {
      imap.logins.length = 0;
      const exit = await runSeed(["load", PERSONAS[0]], { ...local, FIXTURES_DIR: empty });
      expect(exit.stderr).toContain(`No fixtures for persona "${PERSONAS[0]}"`);
      expect(exit.code).toBe(1);
      expect(imap.logins).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("names the known personas for an unknown one", async () => {
    const exit = await runSeed(["load", "nobody"], local);
    expect(exit.stderr.trim()).toBe(`Unknown persona "nobody". Known: ${PERSONAS.join(", ")}`);
    expect(exit.code).toBe(2);
  });
});
