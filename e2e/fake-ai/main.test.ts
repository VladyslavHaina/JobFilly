import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  type EnvelopeEntry,
  type ExpectedFile,
  PERSONAS,
  personaPaths,
  readJson,
} from "../fixtures/format.ts";
import { COMPOSE_FILE } from "../stack.ts";

// The fake AI's entry point started as the test stack starts it, without Docker: node with the
// command and environment compose gives the fake-ai service, from the repository root (the e2e
// image's /repo holds e2e/ where the repository does). Only PORT (any free port) and the delays
// differ. It must come up, answer for every persona from compose's FIXTURES_DIR and stop on
// SIGTERM.

const ROOT = join(import.meta.dirname, "..", "..");
const fakeAi = (
  parse(readFileSync(join(ROOT, COMPOSE_FILE), "utf8"), { merge: true }) as {
    services: { "fake-ai": { command: string[]; environment: Record<string, string> } };
  }
).services["fake-ai"];
const fixtures = join(ROOT, fakeAi.environment.FIXTURES_DIR as string);

interface LogLine {
  level?: string;
  event?: string;
  port?: number;
  signal?: string;
}

/** A classify.v1 request for `ids`, in the wire contract's shape (e2e/fixtures/wire). */
function classify(ids: string[]) {
  const items = ids
    .map((id, i) => `=== item ${i + 1} ===\nMessage-ID: ${id}\n=== end item ${i + 1} ===\n\n`)
    .join("");
  return {
    model: "fixture-model",
    messages: [
      { role: "system", content: "task: classify.v1\nInstructions." },
      { role: "user", content: `task: classify.v1\nitems: ${ids.length}\n\n${items}` },
    ],
  };
}

// Starting a node process takes seconds on a busy machine.
describe("the fake AI's entry point", { timeout: 30_000 }, () => {
  let child: ChildProcessWithoutNullStreams;
  const lines: LogLine[] = [];
  let stderr = "";
  let base = "";
  let exited: Promise<number | null>;

  beforeAll(async () => {
    const [node, entry, ...rest] = fakeAi.command;
    expect(node).toBe("node");
    child = spawn(process.execPath, [entry as string, ...rest], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH ?? "",
        ...fakeAi.environment,
        PORT: "0",
        FAKE_AI_DELAY_MS: "0",
        FAKE_AI_SLOW_TEST_MS: "0",
      },
    });
    exited = new Promise((resolve) => child.on("close", (code) => resolve(code)));
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    const ready = new Promise<number>((resolve, reject) => {
      let buffer = "";
      child.stdout.on("data", (d) => {
        buffer += d;
        for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
          const line = JSON.parse(buffer.slice(0, end)) as LogLine;
          buffer = buffer.slice(end + 1);
          lines.push(line);
          if (line.event === "fake_ai.ready") resolve(line.port as number);
        }
      });
      child.on("close", (code) => reject(new Error(`fake AI exited ${code}: ${stderr}`)));
    });
    base = `http://127.0.0.1:${await ready}`;
  }, 30_000);

  afterAll(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });

  it("comes up and answers its health check", async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it.each(PERSONAS)("answers for %s from the fixtures compose points it at", async (persona) => {
    const paths = personaPaths(persona);
    const expected = readJson<ExpectedFile>(join(fixtures, paths.expected));
    // The newest Inbox message the fake AI answers validly.
    const newest = readJson<EnvelopeEntry[]>(join(fixtures, paths.envelopes)).find(
      (e) => e.folder === "inbox" && expected.messages[e.messageId]?.invalid === false,
    ) as EnvelopeEntry;
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(classify([newest.messageId])),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { choices: { message: { content: string } }[] };
    expect(JSON.parse(body.choices[0]?.message.content as string)).toEqual({
      items: [
        {
          messageId: newest.messageId,
          category: expected.messages[newest.messageId]?.category,
        },
      ],
    });
  });

  it("stops cleanly on SIGTERM", async () => {
    child.kill("SIGTERM");
    expect(await exited).toBe(0);
    expect(lines.map((l) => l.event)).toContain("fake_ai.stopping");
    expect(stderr).toBe("");
  });
});
