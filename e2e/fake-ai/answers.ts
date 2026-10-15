import { join } from "node:path";
import {
  AI_TEST_PATH,
  type AnswerFile,
  type ClassifyAnswer,
  type ExtractAnswer,
  type IntakeAnswer,
  isInvalid,
  NONE_INTAKE_PATH,
  PERSONAS,
  type PrefsAnswer,
  personaPaths,
  readJson,
} from "../fixtures/format.ts";
import type { Prompt } from "./prompt.ts";

// The fake AI's canned answers, from e2e/fixtures/ai, and how a prompt maps to one. A task gets
// an answer only when every Message-ID it names has one; anything else is a missing fixture,
// which the server turns into HTTP 500 so it is never silent.

export interface PersonaAnswers {
  classify: AnswerFile<ClassifyAnswer>;
  extract: AnswerFile<ExtractAnswer>;
  prefs: AnswerFile<PrefsAnswer>;
  intake: IntakeAnswer;
}

export interface AnswerStore {
  personas: Map<string, PersonaAnswers>;
  /** Which persona each Message-ID belongs to. */
  owner: Map<string, string>;
  none: IntakeAnswer;
  aiTest: unknown;
}

export function createStore(
  personas: Record<string, PersonaAnswers>,
  none: IntakeAnswer,
  aiTest: unknown,
): AnswerStore {
  const owner = new Map<string, string>();
  for (const [name, a] of Object.entries(personas)) {
    for (const file of [a.classify, a.extract, a.prefs]) {
      for (const id of Object.keys(file)) owner.set(id, name);
    }
  }
  return { personas: new Map(Object.entries(personas)), owner, none, aiTest };
}

/** Every answer under `fixturesDir` (e2e/fixtures). */
export function loadAnswers(fixturesDir: string): AnswerStore {
  const read = <T>(path: string) => readJson<T>(join(fixturesDir, path));
  const personas = Object.fromEntries(
    PERSONAS.map((p) => {
      const paths = personaPaths(p);
      const answers: PersonaAnswers = {
        classify: read(paths.classify),
        extract: read(paths.extract),
        prefs: read(paths.prefs),
        intake: read(paths.intake),
      };
      return [p, answers];
    }),
  );
  return createStore(personas, read(NONE_INTAKE_PATH), read(AI_TEST_PATH));
}

/** A value no output schema accepts, standing in for a model's invalid answer. */
export const INVALID_VALUE = "fake-ai: invalid on purpose";

export type Answer = { ok: true; content: unknown } | { ok: false; reason: string };

const missing = (reason: string): Answer => ({ ok: false, reason });

/**
 * The fixtures hold `extra` as the app stores it, a { key: value } record; a model writes it as a
 * list of { key, value } (ExtraAnswerSchema in packages/schema), so the answer is sent that way.
 */
function withExtraAsList<T extends { extra?: Record<string, string> }>(
  value: T,
): Omit<T, "extra"> & { extra?: { key: string; value: string }[] } {
  if (value.extra === undefined) return value as Omit<T, "extra">;
  return {
    ...value,
    extra: Object.entries(value.extra).map(([key, v]) => ({ key, value: v })),
  };
}

function lookup<T>(
  store: AnswerStore,
  id: string,
  file: (a: PersonaAnswers) => AnswerFile<T>,
): T | "invalid" | null {
  const persona = store.personas.get(store.owner.get(id) ?? "");
  const answer = persona ? file(persona)[id] : undefined;
  if (answer === undefined) return null;
  return isInvalid(answer as object) ? "invalid" : (answer as T);
}

/** The JSON the model would answer `prompt` with, or why there is none. */
export function answerFor(store: AnswerStore, prompt: Prompt): Answer {
  const ids = prompt.messageIds;
  switch (prompt.taskId) {
    case "classify.v1":
    case "prefs.v1": {
      if (ids.length === 0) return missing(`${prompt.taskId} names no Message-ID`);
      const items: unknown[] = [];
      for (const id of ids) {
        if (prompt.taskId === "classify.v1") {
          const a = lookup(store, id, (p) => p.classify);
          if (a === null) return missing(`no classify.v1 answer for ${id}`);
          items.push({ messageId: id, category: a === "invalid" ? INVALID_VALUE : a.category });
        } else {
          const a = lookup(store, id, (p) => p.prefs);
          if (a === null) return missing(`no prefs.v1 answer for ${id}`);
          items.push({
            messageId: id,
            preferences: a === "invalid" ? INVALID_VALUE : withExtraAsList(a.preferences),
          });
        }
      }
      return { ok: true, content: { items } };
    }
    case "extract.v1": {
      if (ids.length !== 1) return missing(`extract.v1 names ${ids.length} Message-IDs, not 1`);
      const id = ids[0] as string;
      const a = lookup(store, id, (p) => p.extract);
      if (a === null) return missing(`no extract.v1 answer for ${id}`);
      return {
        ok: true,
        content: {
          messageId: id,
          roles: a === "invalid" ? INVALID_VALUE : a.roles.map(withExtraAsList),
        },
      };
    }
    case "intake.v1": {
      const owners = new Set<string>();
      for (const id of ids) {
        const owner = store.owner.get(id);
        if (owner === undefined) return missing(`no intake.v1 answer: unknown Message-ID ${id}`);
        owners.add(owner);
      }
      if (owners.size > 1)
        return missing(`intake.v1 names Message-IDs of ${[...owners].join(" and ")}`);
      const [owner] = owners;
      const intake = owner === undefined ? store.none : store.personas.get(owner)?.intake;
      return { ok: true, content: intake };
    }
    case "ai.test.v1":
      return { ok: true, content: store.aiTest };
    default:
      return missing(`no answers for task ${prompt.taskId}`);
  }
}
