import { existsSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import {
  AI_TEST_PATH,
  type AnswerFile,
  type ClassifyAnswer,
  CORE_KEYS,
  type CoreKey,
  type EnvelopeEntry,
  type ExpectedFile,
  type ExpectedMessage,
  type ExtractAnswer,
  FIXTURE_REFERENCE_TIME,
  FOLDER_PATHS,
  type IntakeAnswer,
  isJobCategory,
  NONE_INTAKE_PATH,
  type PrefsAnswer,
  personaPaths,
  toJson,
} from "../format.ts";
import { buildEml, toHtml } from "./eml.ts";
import { maria } from "./maria.ts";
import type { MessageSpec, PersonaSource } from "./spec.ts";
import { tom } from "./tom.ts";

// Derives every fixture file from the personas' sources of truth. The result is a map from a path
// relative to e2e/fixtures to the file's exact contents; main.ts writes it and build.test.ts
// checks that the committed files are exactly this.

const SENTINEL_OFFSET = 1000;

/** The plain text of a message: its body, footer paragraphs past 1,000 chars, the sentinel. */
export function composeText(spec: MessageSpec, sentinel: string): string {
  let text = spec.body.trimEnd();
  for (let i = 0; text.length < SENTINEL_OFFSET + 10; i++) {
    const paragraph = spec.footer[i % spec.footer.length];
    if (paragraph === undefined) throw new Error(`${spec.messageId} has no footer to pad with`);
    text += `\n\n${paragraph}`;
  }
  return `${text}\n\nRef: ${sentinel}\n`;
}

function snippetOf(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

/** The replies stating `key`, newest first. */
function evidenceOf(source: PersonaSource, key: CoreKey): string[] {
  return source.messages
    .filter((m) => (m.preferences?.[key]?.length ?? 0) > 0)
    .sort((a, b) => a.minutesAgo - b.minutesAgo)
    .map((m) => m.messageId);
}

function personaFiles(source: PersonaSource): Map<string, string> {
  const out = new Map<string, string>();
  const dir = source.persona;
  const reference = Date.parse(FIXTURE_REFERENCE_TIME);
  const sorted = [...source.messages].sort((a, b) => a.minutesAgo - b.minutesAgo);
  const fileOf = new Map<string, string>();
  const counters = { inbox: 0, sent: 0 };
  for (const m of sorted) {
    counters[m.folder] += 1;
    fileOf.set(m.messageId, `${m.folder}/${String(counters[m.folder]).padStart(4, "0")}.eml`);
  }

  const envelopes: EnvelopeEntry[] = [];
  const messages: Record<string, ExpectedMessage> = {};
  const classify: AnswerFile<ClassifyAnswer> = {};
  const extract: AnswerFile<ExtractAnswer> = {};
  const prefs: AnswerFile<PrefsAnswer> = {};
  for (const m of sorted) {
    const file = fileOf.get(m.messageId) as string;
    const sentinel = `BODYSENTINEL-${dir}-${file.replace(".eml", "").replace("/", "-")}`;
    const text = composeText(m, sentinel);
    out.set(
      `${personaPaths(source.persona).mail}/${file}`,
      buildEml({
        ...m,
        date: new Date(reference - m.minutesAgo * 60_000),
        text,
        html: toHtml(text),
        boundary: `=_jf_${dir}_${file.replace(".eml", "").replace("/", "_")}`,
      }),
    );
    envelopes.push({
      file,
      messageId: m.messageId,
      folder: m.folder,
      folderPath: FOLDER_PATHS[m.folder],
      minutesAgo: m.minutesAgo,
      from: m.from,
      to: m.to,
      cc: m.cc,
      replyTo: m.replyTo,
      inReplyTo: m.inReplyTo,
      references: m.references,
      subject: m.subject,
      listId: m.listId,
      listUnsubscribe: m.listUnsubscribe,
      precedence: m.precedence,
      autoSubmitted: null,
      snippet: snippetOf(text),
    });
    messages[m.messageId] = {
      folder: m.folder,
      stageOne: m.stageOne,
      category: m.category,
      facts: m.facts,
      ownReply: m.stageOne === "own_reply",
      invalid: m.invalid,
    };
    classify[m.messageId] = m.invalid ? { invalid: true } : { category: m.category };
    if (isJobCategory(m.category)) {
      extract[m.messageId] = m.invalid ? { invalid: true } : { roles: m.facts ?? [] };
    }
    if (m.folder === "sent") prefs[m.messageId] = { preferences: m.preferences ?? {} };
  }

  const answers = Object.fromEntries(
    CORE_KEYS.map((key) => {
      const values = source.profile[key];
      return [key, { values, evidence: values.length > 0 ? evidenceOf(source, key) : [] }];
    }),
  ) as ExpectedFile["profile"]["answers"];
  const expected: ExpectedFile = {
    persona: source.persona,
    address: source.address,
    messages,
    profile: {
      answers,
      extraQuestions: source.intake.questions.map(({ slug, label }) => ({ slug, label })),
    },
  };

  const paths = personaPaths(source.persona);
  out.set(paths.envelopes, toJson(envelopes));
  out.set(paths.expected, toJson(expected));
  out.set(paths.classify, toJson(classify));
  out.set(paths.extract, toJson(extract));
  out.set(paths.prefs, toJson(prefs));
  out.set(paths.intake, toJson(source.intake));
  return out;
}

const NONE_INTAKE: IntakeAnswer = { questions: [] };

/** Every generated fixture file, by its path relative to e2e/fixtures. */
export function buildFixtures(): Map<string, string> {
  const files = new Map<string, string>();
  for (const source of [maria(), tom()]) {
    for (const [path, content] of personaFiles(source)) files.set(path, content);
  }
  files.set(NONE_INTAKE_PATH, toJson(NONE_INTAKE));
  files.set(AI_TEST_PATH, toJson({ ok: true }));
  return files;
}

/** The directories the generator owns: everything in them comes from buildFixtures. */
const GENERATED_DIRS = ["maria", "tom", "ai"];

/** Every file now in the generated directories, by its path relative to `root`. */
export function generatedFilesOnDisk(root: string): string[] {
  return GENERATED_DIRS.flatMap((dir) => {
    const base = join(root, dir);
    if (!existsSync(base)) return [];
    // Skips OS noise such as .DS_Store; the generator writes no dotfiles.
    return readdirSync(base, { recursive: true, encoding: "utf8" })
      .filter((entry) => !entry.split(sep).some((part) => part.startsWith(".")))
      .filter((entry) => statSync(join(base, entry)).isFile())
      .map((entry) => `${dir}/${entry.split(sep).join("/")}`);
  });
}
