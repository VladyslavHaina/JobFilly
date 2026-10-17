import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AnswerAnswer,
  assistantMessageKey,
  type DeliveryEntry,
  type FocusAnswer,
  fixturesDir,
  MARIA_KEY_MESSAGES,
  personaPaths,
  personaPathsMvp2,
  readJson,
} from "../fixtures/format.ts";
import {
  type AssistantQuestion,
  type ExpectedFileMvp3,
  type ExpectedMvp3,
  MARIA_RERUN_HINT,
  MVP3_PATHS,
} from "../fixtures/format-mvp3.ts";
import { soakAnswers, soakMessageId } from "../fixtures/soak.ts";
import { answerFor, createStore, loadAnswers } from "./answers.ts";
import { parsePrompt } from "./prompt.ts";

// The fake AI answers MVP 3's prompts as the wire contract frames them (e2e/fixtures/wire):
// focus.v1 by the hint, answer.v1 by the question and its Turn line; MVP 3's new mail from the
// fixtures like MVP 2's, and the soak's generated mail from its templates (fixtures/soak.ts).

describe("MVP 3's new mail in the fake AI", () => {
  const store = loadAnswers(fixturesDir());
  const dir = fixturesDir();
  const expected = readJson<ExpectedFileMvp3>(join(dir, personaPaths("maria").expected));
  const mvp3 = expected.mvp3 as ExpectedMvp3;
  const s1s6 = readJson<DeliveryEntry[]>(join(dir, personaPathsMvp2("maria").deliveries)).filter(
    (d) => d.step === "S1" || d.step === "S6",
  );
  const sent = readJson<DeliveryEntry[]>(join(dir, MVP3_PATHS.sentDeliveries));
  const ask = (taskId: string, ids: string[], keys: Record<string, string> = {}) =>
    answerFor(store, { taskId, messageIds: ids, keys, message: null });

  it("classifies, extracts and matches what S1 and S6 deliver and the second mailbox holds", () => {
    const mail = [
      ...s1s6.map((d) => [d.messageId, expected.deliveries[d.messageId]] as const),
      ...Object.entries(mvp3.home.messages),
    ];
    expect(mail.length).toBeGreaterThan(15);
    for (const [id, truth] of mail) {
      expect(ask("classify.v1", [id]), id).toMatchObject({ ok: true });
      if (truth?.category === "not_job") continue;
      expect(ask("extract.v1", [id]), id).toMatchObject({ ok: true });
      (truth?.facts ?? []).forEach((_, i) => {
        const keys = { "Message-ID": id, Role: String(i) };
        expect(ask("match.v1", [id], keys), id).toMatchObject({ ok: true });
      });
    }
  });

  it("drafts every S1 role at both attempts, and reads the replies delivered to Sent", () => {
    for (const d of s1s6.filter((x) => x.step === "S1")) {
      for (const attempt of ["1", "2"]) {
        const keys = { "Message-ID": d.messageId, Role: "0", Attempt: attempt };
        expect(ask("draft.v1", [d.messageId], keys), d.id).toMatchObject({ ok: true });
      }
    }
    expect(
      ask(
        "prefs.v1",
        sent.map((d) => d.messageId),
      ),
    ).toMatchObject({ ok: true });
  });

  it("answers the re-run's intake over old and new mail as Maria's", () => {
    const ids = [
      MARIA_KEY_MESSAGES.germanRecruiter,
      s1s6[0]?.messageId as string,
      ...sent.map((d) => d.messageId),
    ];
    expect(ask("intake.v1", ids)).toEqual({
      ok: true,
      content: store.personas.get("maria")?.intake,
    });
  });

  it("answers S1's hint and every question of assistant/questions.json, at any turn", () => {
    expect(store.focus[assistantMessageKey(MARIA_RERUN_HINT)]).toEqual(mvp3.rerun.focus);
    const questions = readJson<AssistantQuestion[]>(join(dir, MVP3_PATHS.questions));
    for (const q of questions) {
      const message = `${q.text} E2E-CHAT-7`;
      const keys = { Turn: "4" };
      const asked = answerFor(store, { taskId: "assistant.v1", messageIds: [], keys, message });
      expect(asked, q.id).toMatchObject({ ok: true, content: { lookups: q.lookups } });
      const answered = answerFor(store, { taskId: "answer.v1", messageIds: [], keys, message });
      expect(answered, q.id).toMatchObject({ ok: true });
    }
  });
});

describe("the soak's generated mail in the fake AI", () => {
  const store = createStore({}, { questions: [] }, { ok: true }, {});
  const id = soakMessageId("tom", "k3x9", 12);
  const ask = (taskId: string, keys: Record<string, string> = {}) =>
    answerFor(store, { taskId, messageIds: [id], keys, message: null });

  it("answers every task of a generated message from its template", () => {
    expect(ask("classify.v1")).toEqual({
      ok: true,
      content: { items: [{ messageId: id, category: "recruiter_outreach" }] },
    });
    expect(ask("extract.v1")).toMatchObject({
      ok: true,
      content: { messageId: id, roles: [{ title: "Registered General Nurse (agency shifts)" }] },
    });
    expect(ask("match.v1", { "Message-ID": id, Role: "0" })).toMatchObject({
      ok: true,
      content: { titleFit: { verdict: "fits" } },
    });
    for (const attempt of ["1", "2"]) {
      expect(ask("draft.v1", { "Message-ID": id, Role: "0", Attempt: attempt })).toMatchObject({
        ok: true,
        content: { subject: "Re: Agency shifts in Manchester (list 12)", questions: [] },
      });
    }
  });

  it("knows only the soak's own ids, each with one role", () => {
    expect(soakAnswers("<soak-maria-run-x@isarwerk.example>")).toBeNull();
    expect(soakAnswers(soakMessageId("maria", "k3x9", 3))?.extract.roles).toHaveLength(1);
    expect(ask("match.v1", { "Message-ID": id, Role: "1" })).toMatchObject({ ok: false });
    const other = { taskId: "classify.v1", messageIds: ["<x@y.example>"], keys: {}, message: null };
    expect(answerFor(store, other)).toMatchObject({ ok: false });
  });
});

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
