import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import {
  AI_TEST_PATH,
  ANSWER_ANSWERS_PATH,
  type AnswerFile,
  ASSISTANT_ANSWERS_PATH,
  ASSISTANT_REQUESTS_PATH,
  type ClassifyAnswer,
  CORE_KEYS,
  type CoreKey,
  type CvAnswer,
  type CvFixture,
  type DeliveryEntry,
  type DraftAnswer,
  draftKey,
  type EnvelopeEntry,
  type ExpectedCv,
  type ExpectedFileMvp2,
  type ExpectedMessageAll,
  type ExpectedRole,
  type ExtractAnswer,
  FIXTURE_REFERENCE_TIME,
  FOCUS_ANSWERS_PATH,
  FOLDER_PATHS,
  type IntakeAnswer,
  isJobCategory,
  MARIA_KEY_MESSAGES,
  type MatchAnswer,
  matchKey,
  NONE_INTAKE_PATH,
  type PrefsAnswer,
  personaPaths,
  personaPathsMvp2,
  REPLY_WINDOW_MINUTES,
  toJson,
} from "../format.ts";
import { assistantAnswers, assistantRequests } from "./assistant.ts";
import { CVS, type CvSource, checkedSkills, cvBytes, cvNamed, cvTags } from "./cvs.ts";
import { DELIVERIES, type DeliverySource, deliverySpec } from "./deliveries.ts";
import { corefile, domainsFile, zoneFiles } from "./domains.ts";
import { buildEml, toHtml } from "./eml.ts";
import { backendTitleFit, matchAnswer, nursingTitleFit, type PersonaJudge } from "./judge.ts";
import { maria } from "./maria.ts";
import { answerAnswers, focusAnswers } from "./mvp3.ts";
import type { MessageSpec, PersonaSource } from "./spec.ts";
import { tom } from "./tom.ts";

// Derives every fixture file from the personas' sources of truth. buildFixtures maps a path
// relative to e2e/fixtures to the file's exact contents (text, or bytes for the CVs);
// buildStackData does the same for the test stack's domain data, relative to e2e/. main.ts writes
// both and build.test.ts checks that the committed files are exactly this.

const SENTINEL_OFFSET = 1000;

export type FileContent = string | Buffer;

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

/** The .eml text of a message, its Date header FIXTURE_REFERENCE_TIME minus minutesAgo. */
function emlOf(m: MessageSpec, sentinel: string, boundary: string): { eml: string; text: string } {
  const text = composeText(m, sentinel);
  const date = new Date(Date.parse(FIXTURE_REFERENCE_TIME) - m.minutesAgo * 60_000);
  return { eml: buildEml({ ...m, date, text, html: toHtml(text), boundary }), text };
}

/** What MVP 2 adds to a persona: how its roles are judged, its CVs, its delivered mail. */
interface PersonaMvp2 {
  judge: PersonaJudge;
  cvs: CvSource[];
  deliveries: readonly DeliverySource[];
  /** The backlog messages whose sender is high risk (the scam). */
  highRisk: readonly string[];
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function personaFiles(source: PersonaSource, mvp2: PersonaMvp2): Map<string, FileContent> {
  const out = new Map<string, FileContent>();
  const dir = source.persona;
  const sorted = [...source.messages].sort((a, b) => a.minutesAgo - b.minutesAgo);
  const fileOf = new Map<string, string>();
  const counters = { inbox: 0, sent: 0 };
  for (const m of sorted) {
    counters[m.folder] += 1;
    fileOf.set(m.messageId, `${m.folder}/${String(counters[m.folder]).padStart(4, "0")}.eml`);
  }

  const envelopes: EnvelopeEntry[] = [];
  const messages: Record<string, ExpectedMessageAll> = {};
  const classify: AnswerFile<ClassifyAnswer> = {};
  const extract: AnswerFile<ExtractAnswer> = {};
  const prefs: AnswerFile<PrefsAnswer> = {};
  const match: Record<string, MatchAnswer> = {};
  const draft: Record<string, DraftAnswer> = {};

  /**
   * Every role's CV, hard conflicts (as the persona source writes them) and match.v1 answer;
   * `draft` says if it gets a draft, `close` which skills the CV lacks that the fake AI still
   * calls close.
   */
  const judgeRoles = (
    m: MessageSpec,
    drafts: (position: number) => boolean,
    close: (position: number) => Readonly<Record<string, string>> | undefined = () => undefined,
  ): ExpectedRole[] =>
    (m.facts ?? []).map((facts, position) => {
      const cv = mvp2.judge.cvFor(facts, m.language);
      match[matchKey(m.messageId, position)] = matchAnswer(mvp2.judge, facts, cv, close(position));
      const conflicts = m.hardConflicts?.[position];
      if (conflicts === undefined) {
        throw new Error(`no hard conflicts written for role ${position} of ${m.messageId}`);
      }
      return { cv: cv.name, hardConflicts: [...conflicts], draft: drafts(position) };
    });

  for (const m of sorted) {
    const file = fileOf.get(m.messageId) as string;
    const name = file.replace(".eml", "");
    const { eml, text } = emlOf(
      m,
      `BODYSENTINEL-${dir}-${name.replace("/", "-")}`,
      `=_jf_${dir}_${name.replace("/", "_")}`,
    );
    out.set(`${personaPaths(source.persona).mail}/${file}`, eml);
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
    const truth: ExpectedMessageAll = {
      folder: m.folder,
      stageOne: m.stageOne,
      category: m.category,
      facts: m.facts,
      ownReply: m.stageOne === "own_reply",
      invalid: m.invalid,
    };
    // The sender check and the match run on job mail the app analysed: not on own replies, never
    // classified, nor on the message the fake AI always answers invalidly. The backlog gets no
    // automatic draft (F1.6): its good matches are older than the reply window.
    if (isJobCategory(m.category) && !truth.ownReply && !m.invalid) {
      truth.sender = {
        verdict: mvp2.highRisk.includes(m.messageId) ? "high_risk" : "looks_fine",
      };
      truth.outsideReplyWindow = m.minutesAgo >= REPLY_WINDOW_MINUTES;
      truth.roles = judgeRoles(m, () => false);
    }
    messages[m.messageId] = truth;
    classify[m.messageId] = m.invalid ? { invalid: true } : { category: m.category };
    if (isJobCategory(m.category)) {
      extract[m.messageId] = m.invalid ? { invalid: true } : { roles: m.facts ?? [] };
    }
    if (m.folder === "sent") prefs[m.messageId] = { preferences: m.preferences ?? {} };
  }

  // The mail `seed deliver` brings in during the run.
  const paths2 = personaPathsMvp2(source.persona);
  const deliveries: DeliveryEntry[] = [];
  const deliveredTruth: Record<string, ExpectedMessageAll> = {};
  for (const d of mvp2.deliveries) {
    const m = deliverySpec(d);
    const file = `${d.id}.eml`;
    const { eml } = emlOf(m, `BODYSENTINEL-${dir}-deliver-${d.id}`, `=_jf_${dir}_deliver_${d.id}`);
    out.set(`${paths2.deliver}/${file}`, eml);
    deliveries.push({
      id: d.id,
      file,
      messageId: m.messageId,
      minutesAgo: m.minutesAgo,
      step: d.step,
    });
    const roles = judgeRoles(
      m,
      (position) => d.roles[position]?.draft ?? false,
      (position) => d.roles[position]?.closeSkills,
    );
    d.roles.forEach((r, position) => {
      Object.assign(roles[position] as ExpectedRole, { fit: r.fit, needs: r.needs });
      for (const [attempt, answer] of Object.entries(r.answers)) {
        draft[draftKey(m.messageId, position, Number(attempt) as 1 | 2)] = answer;
      }
    });
    deliveredTruth[m.messageId] = {
      folder: "inbox",
      stageOne: m.stageOne,
      category: m.category,
      facts: m.facts,
      ownReply: false,
      invalid: false,
      sender: { verdict: d.sender },
      outsideReplyWindow: m.minutesAgo >= REPLY_WINDOW_MINUTES,
      roles,
    };
    classify[m.messageId] = { category: m.category };
    extract[m.messageId] = { roles: m.facts ?? [] };
  }

  // The persona's CVs, keyed by the SHA-256 of their bytes.
  const cvList: CvFixture[] = [];
  const cvAnswers: Record<string, CvAnswer> = {};
  const expectedCvs: ExpectedCv[] = [];
  for (const cv of mvp2.cvs) {
    const bytes = cvBytes(cv);
    const contentHash = sha256(bytes);
    out.set(`${paths2.cvs}/${cv.file}`, bytes);
    cvList.push({ file: cv.file, name: cv.name, mediaType: cv.mediaType, contentHash });
    cvAnswers[contentHash] = cv.answer;
    expectedCvs.push({
      name: cv.name,
      tags: cvTags(cv.answer),
      skills: checkedSkills(cv),
      ...(cv.inventedSkill ? { droppedSkill: cv.inventedSkill } : {}),
    });
  }

  const answers = Object.fromEntries(
    CORE_KEYS.map((key) => {
      const values = source.profile[key];
      return [key, { values, evidence: values.length > 0 ? evidenceOf(source, key) : [] }];
    }),
  ) as ExpectedFileMvp2["profile"]["answers"];
  const expected: ExpectedFileMvp2 = {
    persona: source.persona,
    address: source.address,
    messages,
    profile: {
      answers,
      extraQuestions: source.intake.questions.map(({ slug, label }) => ({ slug, label })),
    },
    cvs: expectedCvs,
    deliveries: deliveredTruth,
  };

  const paths = personaPaths(source.persona);
  out.set(paths.envelopes, toJson(envelopes));
  out.set(paths.expected, toJson(expected));
  out.set(paths.classify, toJson(classify));
  out.set(paths.extract, toJson(extract));
  out.set(paths.prefs, toJson(prefs));
  out.set(paths.intake, toJson(source.intake));
  out.set(paths2.cvList, toJson(cvList));
  out.set(paths2.cv, toJson(cvAnswers));
  out.set(paths2.deliveries, toJson(deliveries));
  out.set(paths2.match, toJson(match));
  out.set(paths2.draft, toJson(draft));
  return out;
}

const NONE_INTAKE: IntakeAnswer = { questions: [] };

/** A CV as a role's choice: its name and the skills left after the skill check. */
const choice = (name: string) => {
  const cv = cvNamed(name);
  return { name: cv.name, skills: checkedSkills(cv) };
};

function sources(): { source: PersonaSource; mvp2: PersonaMvp2 }[] {
  const m = maria();
  const t = tom();
  return [
    {
      source: m,
      mvp2: {
        judge: {
          persona: "maria",
          cvFor: (role, language) =>
            choice(
              /data engineer/i.test(role.title ?? "")
                ? "Data engineering (EN)"
                : language === "de"
                  ? "Backend (DE)"
                  : "Backend (EN)",
            ),
          titleFit: backendTitleFit,
        },
        cvs: CVS.filter((c) => c.persona === "maria"),
        deliveries: DELIVERIES,
        highRisk: [MARIA_KEY_MESSAGES.scam],
      },
    },
    {
      source: t,
      mvp2: {
        judge: {
          persona: "tom",
          cvFor: () => choice("Nurse (EN)"),
          titleFit: nursingTitleFit,
        },
        cvs: CVS.filter((c) => c.persona === "tom"),
        deliveries: [],
        highRisk: [],
      },
    },
  ];
}

/** Every generated fixture file, by its path relative to e2e/fixtures. */
export function buildFixtures(): Map<string, FileContent> {
  const files = new Map<string, FileContent>();
  for (const { source, mvp2 } of sources()) {
    for (const [path, content] of personaFiles(source, mvp2)) files.set(path, content);
  }
  files.set(NONE_INTAKE_PATH, toJson(NONE_INTAKE));
  files.set(AI_TEST_PATH, toJson({ ok: true }));
  files.set(ASSISTANT_ANSWERS_PATH, toJson(assistantAnswers()));
  files.set(ASSISTANT_REQUESTS_PATH, toJson(assistantRequests()));
  files.set(FOCUS_ANSWERS_PATH, toJson(focusAnswers()));
  files.set(ANSWER_ANSWERS_PATH, toJson(answerAnswers()));
  return files;
}

const domainOf = (address: string) => address.slice(address.indexOf("@") + 1).toLowerCase();

/** Every sender domain of the fixtures: both mailboxes and the delivered mail. */
function senderDomains(): string[] {
  const domains = new Set<string>();
  for (const { source, mvp2 } of sources()) {
    for (const m of source.messages) domains.add(domainOf(m.from.address));
    for (const d of mvp2.deliveries) domains.add(domainOf(d.from.address));
  }
  return [...domains].sort();
}

/**
 * The test stack's domain data, by path relative to e2e/: the RDAP data, the DNS zones and the
 * Corefile that serves them.
 */
export function buildStackData(): Map<string, string> {
  const domains = senderDomains();
  const files = new Map<string, string>([["rdap/domains.json", toJson(domainsFile(domains))]]);
  for (const [path, content] of zoneFiles(domains)) files.set(`dns/${path}`, content);
  for (const [path, content] of corefile(domains)) files.set(`dns/${path}`, content);
  return files;
}

/** The directories the generator owns: everything in them comes from buildFixtures. */
const GENERATED_DIRS = ["maria", "tom", "ai", "assistant"];

/** Every file now in the generated directories under `root`, by its path relative to `root`. */
export function generatedFilesOnDisk(root: string, dirs: readonly string[] = GENERATED_DIRS) {
  return dirs.flatMap((dir) => {
    const base = join(root, dir);
    if (!existsSync(base)) return [];
    // Skips OS noise such as .DS_Store; the generator writes no dotfiles.
    return readdirSync(base, { recursive: true, encoding: "utf8" })
      .filter((entry) => !entry.split(sep).some((part) => part.startsWith(".")))
      .filter((entry) => statSync(join(base, entry)).isFile())
      .map((entry) => `${dir}/${entry.split(sep).join("/")}`);
  });
}

/** The directory of the stack data the generator owns, relative to e2e/. */
export const STACK_DATA_DIRS = ["dns/zones"];
