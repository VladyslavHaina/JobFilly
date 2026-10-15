import type { AiClient } from "@jobfilly/ai";
import {
  type AiError,
  type AiTask,
  type AssistantAnswer,
  AssistantAnswerSchema,
  type BatchResult,
  type Category,
  type CvReadOutput,
  type DraftOutput,
  type IntakeExtraOutput,
  type JobFacts,
  type MatchAiOutput,
  type Preferences,
  type TaskId,
  type TaskResult,
  type Usage,
} from "@jobfilly/schema";
import type { ZodType } from "zod";
import type { AiPort } from "../deps";

// A fake AI behind the AiPort, keyed like the test stack's fake AI (tests only): classify,
// extract and prefs by Message-ID, cv.v1 by the CV's content hash, match.v1 by
// "<Message-ID>#<position>", draft.v1 by "<Message-ID>#<position>#<attempt>", assistant.v1 by
// the user's text (or "<turn>#<text>" for one turn). A call it has no answer for fails the way a
// provider does (provider_error), so a missing answer is never silent; an assistant.v1 answer
// that doesn't fit AssistantAnswerSchema, the check packages/ai makes, fails as invalid_output.
// One Usage per call; per-task call counts; failNext(task) fails that task's next call once.

export interface FakeAiAnswers {
  classify?: Record<string, Category>;
  extract?: Record<string, JobFacts[]>;
  prefs?: Record<string, Preferences>;
  intake?: IntakeExtraOutput;
  cv?: Record<string, CvReadOutput>;
  match?: Record<string, MatchAiOutput>;
  draft?: Record<string, DraftOutput>;
  assistant?: Record<string, AssistantAnswer>;
}

export interface FakeAiClient {
  port: AiPort;
  /** The answers it gives; tests may add to them at any time. */
  answers: Required<FakeAiAnswers>;
  calls: Record<AiTask | "test", number>;
  /** Every call, in order: the task id and the key it was answered by. */
  log: { task: TaskId; key: string }[];
  /** The next call of `task` fails once with `kind` (default provider_error). */
  failNext(task: AiTask, kind?: AiError["kind"]): void;
}

const NO_ANSWER: AiError = {
  kind: "provider_error",
  message: "The fake AI has no answer for this",
};

export function createFakeAi(answers: FakeAiAnswers = {}): FakeAiClient {
  const failing = new Map<AiTask, AiError["kind"]>();
  const all: Required<FakeAiAnswers> = {
    classify: {},
    extract: {},
    prefs: {},
    intake: { questions: [] },
    cv: {},
    match: {},
    draft: {},
    assistant: {},
    ...answers,
  };
  const fake: FakeAiClient = {
    answers: all,
    calls: {
      classify: 0,
      extract: 0,
      prefs: 0,
      intake: 0,
      cv: 0,
      match: 0,
      draft: 0,
      assistant: 0,
      test: 0,
    },
    log: [],
    failNext(task, kind = "provider_error") {
      failing.set(task, kind);
    },
    port: { client: () => client },
  };

  const usage = (task: TaskId): Usage[] => [{ task, inputTokens: 100, outputTokens: 20 }];

  /** One call of a single-answer task; an answer that fails `check` is invalid_output. */
  function single<T>(
    task: AiTask,
    taskId: TaskId,
    key: string,
    answer: T | undefined,
    check?: ZodType,
  ) {
    fake.calls[task] += 1;
    fake.log.push({ task: taskId, key });
    const failed = failing.get(task);
    failing.delete(task);
    const invalid = answer !== undefined && check && !check.safeParse(answer).success;
    const kind = failed ?? (invalid ? "invalid_output" : undefined);
    if (kind) {
      return Promise.resolve<TaskResult<T>>({
        ok: false,
        error: { kind, message: "fake failure" },
        usage: usage(taskId),
      });
    }
    return Promise.resolve<TaskResult<T>>(
      answer === undefined
        ? { ok: false, error: NO_ANSWER, usage: usage(taskId) }
        : { ok: true, data: structuredClone(answer), usage: usage(taskId) },
    );
  }

  /** One call of a batched task, one answer per Message-ID. */
  function batch<T>(
    task: AiTask,
    taskId: TaskId,
    ids: string[],
    answer: (id: string) => T | undefined,
  ): Promise<BatchResult<T>> {
    fake.calls[task] += 1;
    fake.log.push({ task: taskId, key: ids.join(",") });
    const kind = failing.get(task);
    if (kind) failing.delete(task);
    return Promise.resolve({
      items: ids.map((messageId) => {
        const data = kind ? undefined : answer(messageId);
        return data === undefined
          ? { messageId, ok: false as const, error: kind ? { kind, message: "fake" } : NO_ANSWER }
          : { messageId, ok: true as const, data };
      }),
      usage: usage(taskId),
    });
  }

  const client: AiClient = {
    classify: (items) =>
      batch(
        "classify",
        "classify.v1",
        items.map((i) => i.messageId),
        (id) => {
          const category = all.classify[id];
          return category === undefined ? undefined : { category };
        },
      ),
    prefs: (items) =>
      batch(
        "prefs",
        "prefs.v1",
        items.map((i) => i.messageId),
        (id) => {
          const preferences = all.prefs[id];
          return preferences === undefined ? undefined : { preferences };
        },
      ),
    extract: (item) => {
      const roles = all.extract[item.messageId];
      return single(
        "extract",
        "extract.v1",
        item.messageId,
        roles === undefined ? undefined : { messageId: item.messageId, roles },
      );
    },
    intake: () => single("intake", "intake.v1", "", all.intake),
    test: () => {
      fake.calls.test += 1;
      return Promise.resolve({ ok: true, data: { ok: true }, usage: usage("ai.test.v1") });
    },
    readCv: (input) => single("cv", "cv.v1", input.contentHash, all.cv[input.contentHash]),
    match: (input) => {
      const key = `${input.messageId}#${input.position}`;
      return single("match", "match.v1", key, all.match[key]);
    },
    draft: (input) => {
      const key = `${input.mail.messageId}#${input.position}#${input.attempt}`;
      return single("draft", "draft.v1", key, all.draft[key]);
    },
    assistant: (input) => {
      const turnKey = `${input.turn}#${input.text}`;
      const answer = all.assistant[turnKey] ?? all.assistant[input.text];
      // Checked like packages/ai checks it: an answer the real client would reject (after its
      // retry) fails here too, so no test reaches a state production can't.
      return single("assistant", "assistant.v1", turnKey, answer, AssistantAnswerSchema);
    },
  };
  return fake;
}
