import { join } from "node:path";
import {
  AI_TEST_PATH,
  type AnswerFile,
  ASSISTANT_ANSWERS_PATH,
  ASSISTANT_ANY_TURN,
  type AssistantAnswerFile,
  assistantMessageKey,
  type ClassifyAnswer,
  type CvAnswer,
  type DraftAnswer,
  draftKey,
  type ExtractAnswer,
  type IntakeAnswer,
  isInvalid,
  type JobFacts,
  type MatchAnswer,
  matchKey,
  NONE_INTAKE_PATH,
  PERSONAS,
  type PrefsAnswer,
  personaPaths,
  personaPathsMvp2,
  readJson,
} from "../fixtures/format.ts";
import type { Prompt } from "./prompt.ts";

// The fake AI's canned answers, from e2e/fixtures/ai, and how a prompt maps to one. A task gets
// an answer only when every Message-ID it names has one; anything else is a missing fixture,
// which the server turns into HTTP 500 so it is never silent. MVP 2's tasks are answered by their
// key lines: cv.v1 by the CV's SHA-256, match.v1 by Message-ID and role position, draft.v1 also
// by attempt, assistant.v1 by the user's message and the turn.

export interface PersonaAnswers {
  classify: AnswerFile<ClassifyAnswer>;
  extract: AnswerFile<ExtractAnswer>;
  prefs: AnswerFile<PrefsAnswer>;
  intake: IntakeAnswer;
  /** By the CV's SHA-256. */
  cv: Record<string, CvAnswer>;
  /** By matchKey: "<Message-ID>#<position>". */
  match: Record<string, MatchAnswer>;
  /** By draftKey: "<Message-ID>#<position>#<attempt>". */
  draft: Record<string, DraftAnswer>;
}

export interface AnswerStore {
  personas: Map<string, PersonaAnswers>;
  /** Which persona each Message-ID belongs to. */
  owner: Map<string, string>;
  none: IntakeAnswer;
  aiTest: unknown;
  assistant: AssistantAnswerFile;
}

export function createStore(
  personas: Record<string, PersonaAnswers>,
  none: IntakeAnswer,
  aiTest: unknown,
  assistant: AssistantAnswerFile,
): AnswerStore {
  const owner = new Map<string, string>();
  for (const [name, a] of Object.entries(personas)) {
    for (const file of [a.classify, a.extract, a.prefs]) {
      for (const id of Object.keys(file)) owner.set(id, name);
    }
    // A role's answers are keyed "<Message-ID>#<position>[#<attempt>]".
    for (const key of [...Object.keys(a.match), ...Object.keys(a.draft)]) {
      owner.set(key.replace(/(#\d+){1,2}$/, ""), name);
    }
  }
  return { personas: new Map(Object.entries(personas)), owner, none, aiTest, assistant };
}

/** Every answer under `fixturesDir` (e2e/fixtures). */
export function loadAnswers(fixturesDir: string): AnswerStore {
  const read = <T>(path: string) => readJson<T>(join(fixturesDir, path));
  const personas = Object.fromEntries(
    PERSONAS.map((p) => {
      const paths = personaPaths(p);
      const paths2 = personaPathsMvp2(p);
      const answers: PersonaAnswers = {
        classify: read(paths.classify),
        extract: read(paths.extract),
        prefs: read(paths.prefs),
        intake: read(paths.intake),
        cv: read(paths2.cv),
        match: read(paths2.match),
        draft: read(paths2.draft),
      };
      return [p, answers];
    }),
  );
  return createStore(
    personas,
    read(NONE_INTAKE_PATH),
    read(AI_TEST_PATH),
    read(ASSISTANT_ANSWERS_PATH),
  );
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

/**
 * A role as a model writes it (JobFactsAnswerSchema in packages/schema): the text facts the mail
 * doesn't state as "", where the fixtures hold null as the app stores them, and `extra` as a list.
 */
function roleAsWritten(role: JobFacts) {
  const text = (value: string | null) => value ?? "";
  return withExtraAsList({
    ...role,
    title: text(role.title),
    company: text(role.company),
    agency: role.agency && { name: text(role.agency.name), client: text(role.agency.client) },
    places: role.places.map((place) => ({ ...place, city: text(place.city) })),
    remoteScope: text(role.remoteScope),
    contract: text(role.contract),
    seniority: text(role.seniority),
    workPermit: text(role.workPermit),
    applyUrl: text(role.applyUrl),
  });
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

/** cv.v1: by the CV-SHA256 line, in any persona's answers. */
function cvAnswer(store: AnswerStore, prompt: Prompt): Answer {
  const hash = prompt.keys["CV-SHA256"];
  if (!hash) return missing("cv.v1 has no CV-SHA256 line");
  for (const persona of store.personas.values()) {
    const answer = persona.cv[hash];
    if (answer) return { ok: true, content: answer };
  }
  return missing(`no cv.v1 answer for CV-SHA256 ${hash}`);
}

/** match.v1 and draft.v1: by the Message-ID and Role lines, draft.v1 also by Attempt. */
function roleAnswer(store: AnswerStore, prompt: Prompt): Answer {
  const id = prompt.keys["Message-ID"];
  const role = Number(prompt.keys.Role);
  if (!id || prompt.keys.Role === undefined || !Number.isInteger(role) || role < 0) {
    return missing(`${prompt.taskId} has no Message-ID and Role lines`);
  }
  const persona = store.personas.get(store.owner.get(id) ?? "");
  if (prompt.taskId === "match.v1") {
    const key = matchKey(id, role);
    const answer = persona?.match[key];
    return answer ? { ok: true, content: answer } : missing(`no match.v1 answer for ${key}`);
  }
  const attempt = Number(prompt.keys.Attempt);
  if (attempt !== 1 && attempt !== 2) return missing("draft.v1 has no Attempt line of 1 or 2");
  const key = draftKey(id, role, attempt);
  const answer = persona?.draft[key];
  return answer ? { ok: true, content: answer } : missing(`no draft.v1 answer for ${key}`);
}

/** assistant.v1: by the user's message (assistantMessageKey), then by the Turn line or any turn. */
function assistantAnswer(store: AnswerStore, prompt: Prompt): Answer {
  const turn = prompt.keys.Turn;
  if (!turn || prompt.message === null) {
    return missing("assistant.v1 has no Turn line or no message block");
  }
  const byTurn = store.assistant[assistantMessageKey(prompt.message)];
  const answer = byTurn?.[turn] ?? byTurn?.[ASSISTANT_ANY_TURN];
  // The reason names the turn only: the user's words are never logged (F8.10), and the app may
  // log a provider's error message.
  return answer
    ? { ok: true, content: answer }
    : missing(`no assistant.v1 answer for this message at turn ${turn}`);
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
          roles: a === "invalid" ? INVALID_VALUE : a.roles.map(roleAsWritten),
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
    case "cv.v1":
      return cvAnswer(store, prompt);
    case "match.v1":
    case "draft.v1":
      return roleAnswer(store, prompt);
    case "assistant.v1":
      return assistantAnswer(store, prompt);
    default:
      return missing(`no answers for task ${prompt.taskId}`);
  }
}
