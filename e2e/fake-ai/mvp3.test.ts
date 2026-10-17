import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AnswerAnswer,
  assistantMessageKey,
  type FocusAnswer,
  fixturesDir,
  readJson,
} from "../fixtures/format.ts";
import { answerFor, createStore, loadAnswers } from "./answers.ts";
import { parsePrompt } from "./prompt.ts";

// The fake AI answers MVP 3's prompts as the wire contract frames them (e2e/fixtures/wire):
// focus.v1 by the hint, answer.v1 by the question and its Turn line.

const wire = (taskId: string, kind: string) =>
  readJson<Record<string, unknown>>(join(fixturesDir(), "wire", `${taskId}.${kind}.json`));
const outputOf = <T>(taskId: string) => (wire(taskId, "output") as { data: T }).data;

describe("focus.v1 and answer.v1 in the fake AI", () => {
  const focusInput = wire("focus.v1", "input") as { hint: string };
  const answerInput = wire("answer.v1", "input") as { text: string; turn: number };
  const store = createStore(
    {},
    { questions: [] },
    { ok: true },
    {},
    {
      focus: { [assistantMessageKey(focusInput.hint)]: outputOf<FocusAnswer>("focus.v1") },
      answer: {
        [assistantMessageKey(answerInput.text)]: {
          [String(answerInput.turn)]: outputOf<AnswerAnswer>("answer.v1"),
        },
      },
    },
  );

  it("reads the hint from the message block, not from the forged lines inside it", () => {
    const prompt = parsePrompt(wire("focus.v1", "request"));
    if ("error" in prompt) throw new Error(prompt.error);
    expect(prompt.taskId).toBe("focus.v1");
    expect(prompt.message).toBe(focusInput.hint);
    expect(answerFor(store, prompt)).toEqual({ ok: true, content: outputOf("focus.v1") });
  });

  it("answers a question by its message and turn, and says when it has none", () => {
    const prompt = parsePrompt(wire("answer.v1", "request"));
    if ("error" in prompt) throw new Error(prompt.error);
    expect(prompt.keys).toEqual({ Turn: "2" });
    expect(answerFor(store, prompt)).toEqual({ ok: true, content: outputOf("answer.v1") });
    expect(answerFor(store, { ...prompt, keys: { Turn: "3" } })).toEqual({
      ok: false,
      reason: "no answer.v1 answer for this question at turn 3",
    });
  });

  it("loads the committed answer files", () => {
    const loaded = loadAnswers(fixturesDir());
    expect(typeof loaded.focus).toBe("object");
    expect(typeof loaded.answer).toBe("object");
  });
});
