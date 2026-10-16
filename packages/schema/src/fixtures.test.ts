import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ChangeSchema, TASK_OUTPUT_SCHEMAS } from "./index";

// The test stack's canned model answers and the assistant requests' expected Changes
// (e2e/fixtures) against the schemas the app validates them with. The direction is from here to
// the fixtures, as in wire.test.ts: e2e imports no package code, so a schema change that breaks a
// canned answer, or an answer the generator gets wrong, fails here rather than in a test-stack
// run. Answers marked {invalid: true} are the fake AI's cue to send a schema-violating item on
// purpose, so they are skipped.

const FIXTURES = fileURLToPath(new URL("../../../e2e/fixtures/", import.meta.url));
const readJson = (path: string): unknown => JSON.parse(readFileSync(`${FIXTURES}${path}`, "utf8"));

// Every persona has a mailbox with ground truth (<persona>/expected.json).
const PERSONAS = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(`${FIXTURES}${d.name}/expected.json`))
  .map((d) => d.name)
  .sort();

const isInvalid = (answer: unknown): boolean =>
  typeof answer === "object" &&
  answer !== null &&
  (answer as { invalid?: unknown }).invalid === true;

const FILES = { cv: "cv.v1", match: "match.v1", draft: "draft.v1" } as const;

describe("the e2e fixtures", () => {
  it("have both personas", () => {
    expect(PERSONAS).toEqual(["maria", "tom"]);
  });

  // Tom gets no draft, so a file may be empty for one persona, but not for all of them.
  it.each(Object.entries(FILES))(
    "answer ai/<persona>/%s.json with %s's output schema",
    (file, taskId) => {
      let parsed = 0;
      for (const persona of PERSONAS) {
        const answers = readJson(`ai/${persona}/${file}.json`) as Record<string, unknown>;
        for (const [key, answer] of Object.entries(answers)) {
          if (isInvalid(answer)) continue;
          const result = TASK_OUTPUT_SCHEMAS[taskId].safeParse(answer);
          expect(result.error?.issues, `ai/${persona}/${file}.json ${key}`).toBeUndefined();
          parsed += 1;
        }
      }
      expect(parsed).toBeGreaterThan(0);
    },
  );

  it("answer every turn of ai/assistant.json with assistant.v1's output schema", () => {
    const answers = readJson("ai/assistant.json") as Record<string, Record<string, unknown>>;
    const turns = Object.entries(answers).flatMap(([message, byTurn]) =>
      Object.entries(byTurn).map(([turn, answer]) => ({ where: `${message} @${turn}`, answer })),
    );
    expect(turns.length).toBeGreaterThan(0);
    for (const { where, answer } of turns) {
      const result = TASK_OUTPUT_SCHEMAS["assistant.v1"].safeParse(answer);
      expect(result.error?.issues, where).toBeUndefined();
    }
  });

  it("expect only Changes ChangeSchema accepts in assistant/requests.json", () => {
    // `expected` is null for a request that should only get a clarifying question.
    const requests = readJson("assistant/requests.json") as {
      text: string;
      expected: unknown[] | null;
    }[];
    const changes = requests.flatMap((r) =>
      (r.expected ?? []).map((change) => ({ text: r.text, change })),
    );
    expect(changes.length).toBeGreaterThan(0);
    for (const { text, change } of changes) {
      const result = ChangeSchema.safeParse(change);
      expect(result.error?.issues, text).toBeUndefined();
    }
  });
});
