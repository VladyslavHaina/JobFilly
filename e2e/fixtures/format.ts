import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The single description of every fixture file of the test stack. The generator
// (e2e/fixtures/build) writes them, the seed and the fake AI read them, and the consistency tests
// check them. e2e imports no package code, so the shapes are written out here, and
// consistency.test.ts checks every file against them.
//
// e2e/fixtures/
//   <persona>/mail/<inbox|sent>/<nnnn>.eml   one RFC 5322 message: multipart/alternative with a
//                                            text and an HTML part, both quoted-printable UTF-8.
//                                            nnnn counts from 0001, newest first per folder.
//   <persona>/envelopes.json                 EnvelopeEntry[], one per .eml, newest first
//   <persona>/expected.json                  ExpectedFile: the ground truth
//   ai/<persona>/classify.json               AnswerFile<ClassifyAnswer>, every message (own
//                                            replies too, though the scan never classifies them)
//   ai/<persona>/extract.json                AnswerFile<ExtractAnswer>, every job-category message
//   ai/<persona>/prefs.json                  AnswerFile<PrefsAnswer>, every Sent message
//   ai/<persona>/intake.json                 IntakeAnswer: the persona's extra questions
//   ai/none/intake.json                      IntakeAnswer for an intake prompt with no Message-ID
//   ai/ai.test.json                          the ai.test.v1 answer
//
//
// From MVP 2 (the e2e-fixtures slice writes these files; this is their contract):
//   <persona>/cvs/<file>.pdf|docx            the persona's CVs: hand-written PDFs and store-only
//                                            DOCX zips, so e2e needs no new dependency
//   <persona>/cvs.json                       CvFixture[]: each file with its name and SHA-256
//   <persona>/deliver/<id>.eml               mail `seed deliver <id>` appends to INBOX during a
//                                            run (over IMAP, never SMTP), dated `minutesAgo`
//   <persona>/deliveries.json                DeliveryEntry[]: one per .eml of deliver/
//   ai/<persona>/cv.json                     AnswerFile<CvAnswer>, keyed by the CV's SHA-256 (the
//                                            prompt's "CV-SHA256:" line)
//   ai/<persona>/match.json                  AnswerFile<MatchAnswer>, keyed by matchKey:
//                                            "<Message-ID>#<position>" ("Message-ID:", "Role:")
//   ai/<persona>/draft.json                  AnswerFile<DraftAnswer>, keyed by draftKey:
//                                            "<Message-ID>#<position>#<attempt>" ("Message-ID:",
//                                            "Role:", "Attempt:")
//   ai/assistant.json                        AssistantAnswerFile: by the user's message text (the
//                                            prompt's "message" block), then by turn ("Turn:")
//   assistant/requests.json                  AssistantRequest[]: the ten requests of the quality
//                                            run (en, de, pt), each with the change it should
//                                            produce
//   <persona>/expected.json                  gains, per message: the sender verdict, per role the
//                                            expected CV and hard conflicts (ExpectedMessageMvp2);
//                                            and the persona's CVs' expected tags (ExpectedCv)
// The prompts' key lines are pinned in packages/ai/src/tasks and e2e/fixtures/wire/wire.test.ts.
//
// Dates are relative: each message is `minutesAgo` old. The .eml Date header holds
// FIXTURE_REFERENCE_TIME minus minutesAgo, so the files never change; the seed rewrites the Date
// header and sets the IMAP internal date from the current time. Every body carries
// BODYSENTINEL-<persona>-<folder>-<nnnn> at least 1,000 characters into its text and its HTML
// part, so no stored snippet can contain it.

/**
 * Every persona of the test stack, the one list of them in e2e: the generator writes their
 * fixtures, the fake AI answers for them, `pnpm e2e:stack up` loads their mail (stack.ts) and the
 * seed logs in to their mailboxes (seed/accounts.ts).
 */
export const PERSONAS = ["maria", "tom"] as const;
export type Persona = (typeof PERSONAS)[number];

export function isPersona(value: string): value is Persona {
  return (PERSONAS as readonly string[]).includes(value);
}

/** Each persona's own address: the From of their replies and their test mailbox's login. */
export const PERSONA_ADDRESSES: Record<Persona, string> = {
  maria: "maria.santos@inbox.example",
  tom: "tom.okafor@inbox.example",
};

export const PERSONA_NAMES: Record<Persona, string> = {
  maria: "Maria Santos",
  tom: "Tom Okafor",
};

export const FOLDERS = ["inbox", "sent"] as const;
export type Folder = (typeof FOLDERS)[number];

/** The IMAP folder each fixture folder is loaded into. */
export const FOLDER_PATHS: Record<Folder, string> = { inbox: "INBOX", sent: "Sent" };

/** The time the .eml Date headers are written against (Date = this minus minutesAgo). */
export const FIXTURE_REFERENCE_TIME = "2026-10-01T12:00:00.000Z";

/** The first scan's window (F4.1). Every fixture message is younger than this. */
export const WINDOW_MINUTES = 90 * 24 * 60;

/** The nine categories of F5, as packages/schema names them. */
export const CATEGORIES = [
  "recruiter_outreach",
  "job_alert",
  "application_update",
  "interview",
  "assessment",
  "offer",
  "rejection",
  "other_job",
  "not_job",
] as const;
export type Category = (typeof CATEGORIES)[number];

export function isJobCategory(category: Category): boolean {
  return category !== "not_job";
}

/**
 * Stage one's verdict from the headers alone, as the source of truth records it:
 * - job_alert: sent by one of JOB_ALERT_SENDERS;
 * - own_reply: a Sent message whose In-Reply-To is an Inbox message in the window;
 * - not_job: List-Id, List-Unsubscribe or Precedence bulk/list/junk from a sender that is no job
 *   platform and that the user never replied to;
 * - likely_job: everything else in the Inbox.
 */
export const STAGE_ONE_VERDICTS = ["not_job", "likely_job", "own_reply", "job_alert"] as const;
export type StageOneVerdict = (typeof STAGE_ONE_VERDICTS)[number];

/**
 * The only job-board senders in the fixtures, all of them job-alert addresses. The scan slice's
 * packages/core/data/job-platforms.json must list each domain with its local part in alertSenders.
 */
export const JOB_ALERT_SENDERS = [
  "jobalerts-noreply@linkedin.com",
  "alert@indeed.com",
  "jobagent@stepstone.de",
  "jobs@xing.com",
  "alertas@net-empregos.com",
  "vacaturemail@nationalevacaturebank.nl",
  "alerts@jobs.nhs.uk",
  "jobalerts@totaljobs.com",
] as const;

/** The only applicant-tracking sender domains in the fixtures (a sender may use a subdomain). */
export const ATS_DOMAINS = [
  "greenhouse-mail.io",
  "hire.lever.co",
  "myworkday.com",
  "smartrecruiters.com",
  "personio.de",
  "recruitee.com",
  "teamtailor.com",
  "workablemail.com",
] as const;

/** Every job-platform domain of the fixtures: the alert senders' and the applicant trackers'. */
export const PLATFORM_DOMAINS: readonly string[] = [
  ...JOB_ALERT_SENDERS.map((a) => a.slice(a.indexOf("@") + 1)),
  ...ATS_DOMAINS,
];

/** The core questions of the intake form, as packages/schema names them, in its order. */
export const CORE_KEYS = [
  "target_roles",
  "seniority",
  "places",
  "remote",
  "contracts",
  "min_pay",
  "languages",
  "work_permits",
  "reply_to",
  "deal_breakers",
] as const;
export type CoreKey = (typeof CORE_KEYS)[number];

/** The keys that only the user's replies can answer (aggregation rule 3). */
export const REPLY_ONLY_KEYS: readonly CoreKey[] = ["min_pay", "reply_to", "deal_breakers"];

export interface Address {
  address: string;
  name: string | null;
}

/** One line of envelopes.json: the Envelope of packages/schema without uid, uidValidity, date. */
export interface EnvelopeEntry {
  /** The .eml path relative to <persona>/mail/, e.g. "inbox/0001.eml". */
  file: string;
  messageId: string;
  folder: Folder;
  folderPath: string;
  minutesAgo: number;
  from: Address;
  to: Address[];
  cc: Address[];
  replyTo: Address[];
  inReplyTo: string | null;
  references: string[];
  subject: string;
  listId: string | null;
  listUnsubscribe: string | null;
  precedence: string | null;
  autoSubmitted: string | null;
  /** The first 200 characters of the text part, whitespace collapsed. */
  snippet: string;
}

// Job facts (F5), the JobFacts of packages/schema.
interface Place {
  country: string | null;
  city: string | null;
}
export type WorkMode = "remote" | "hybrid" | "onsite";
export interface TimeZoneRange {
  from: string;
  to: string;
}
export type PayPeriod = "hour" | "day" | "week" | "month" | "year";
export interface Pay {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: PayPeriod | null;
  asWritten: string;
}
export interface JobFacts {
  title: string | null;
  company: string | null;
  agency: { name: string | null; client: string | null } | null;
  places: Place[];
  workMode: WorkMode | null;
  remoteScope: string | null;
  timeZones: TimeZoneRange | null;
  pay: Pay | null;
  contract: string | null;
  seniority: string | null;
  workPermit: string | null;
  skills: string[];
  languages: string[];
  applyUrl: string | null;
  extra: Record<string, string>;
}

// Profile values (F6), one shape per core key, as ProfileEntry values in packages/schema.
interface ProfilePlace {
  country: string;
  city: string | null;
  mode: "onsite" | "hybrid";
}
interface RemotePreference {
  scope: string;
  timeZones: TimeZoneRange | null;
}
interface MinPay {
  amount: number;
  currency: string;
  period: PayPeriod;
  asWritten: string;
}
interface WorkPermit {
  country: string | null;
  text: string;
}
export interface ProfileValues {
  target_roles: string[];
  seniority: string[];
  places: ProfilePlace[];
  remote: RemotePreference[];
  contracts: string[];
  min_pay: MinPay[];
  languages: string[];
  work_permits: WorkPermit[];
  reply_to: Category[];
  deal_breakers: string[];
}

/** What one of the user's replies states (prefs.v1): only the keys it mentions. */
export type Preferences = Partial<ProfileValues> & { extra?: Record<string, string> };

/** The ground truth of one message. */
export interface ExpectedMessage {
  folder: Folder;
  /** The verdict the stage-one rules give from the headers alone. */
  stageOne: StageOneVerdict;
  /**
   * What the message is; own replies are other_job (about a role) or not_job. The scan never
   * classifies an own reply (TBD-37: its row keeps category null and only gets its preferences
   * read), so for own replies this is a description, never compared: see comparedForF53.
   */
  category: Category;
  /**
   * Every role the message describes; [] for job mail naming none, null for not_job. No own reply
   * names a role, so leaving them out of extraction loses no fact.
   */
  facts: JobFacts[] | null;
  /** One of the user's own replies, read for preferences (prefs.v1) and never classified. */
  ownReply: boolean;
  /** The fake AI answers it with a schema-violating item every time ("Couldn't analyze"). */
  invalid: boolean;
}

/**
 * The messages whose stored category and facts F5.3 compares with `category` and `facts`
 * (compareWithExpected in compare.ts), and that the real-AI quality figures are counted over.
 * Every other message is checked another way:
 * - an own reply is never classified or extracted (TBD-37): its row ends with category null and
 *   preferences read, and F6.6 checks those through the profile answers;
 * - the invalid message ends "Couldn't analyze" with category null, which S5 checks.
 * Everything else, the not_job mail stage one sorts out included, must equal expected.json.
 */
export function comparedForF53(m: ExpectedMessage): boolean {
  return !m.ownReply && !m.invalid;
}

/**
 * The expected intake answer of a core key. `values` are worded as in the newest reply stating
 * each one, in the order they first appear going through the stating replies newest first;
 * `evidence` is the Message-IDs it comes from, newest first. Empty: {values: [], evidence: []}.
 */
export interface ExpectedAnswer<K extends CoreKey = CoreKey> {
  values: ProfileValues[K];
  evidence: string[];
}

export interface ExpectedFile {
  persona: Persona;
  address: string;
  messages: Record<string, ExpectedMessage>;
  profile: {
    answers: { [K in CoreKey]: ExpectedAnswer<K> };
    extraQuestions: { slug: string; label: string }[];
  };
}

// The fake AI's answers, keyed by Message-ID. {invalid: true} makes it answer that message with a
// schema-violating item.
export interface InvalidAnswer {
  invalid: true;
}
export interface ClassifyAnswer {
  category: Category;
}
export interface ExtractAnswer {
  roles: JobFacts[];
}
export interface PrefsAnswer {
  preferences: Preferences;
}
export type AnswerFile<T> = Record<string, T | InvalidAnswer>;

/** intake.v1's answer: the extra questions (at most five), as IntakeExtraOutput. */
export interface IntakeAnswer {
  questions: { slug: string; label: string; options: string[]; evidence: string[] }[];
}

export function isInvalid(answer: object): answer is InvalidAnswer {
  return "invalid" in answer && answer.invalid === true;
}

/** Messages the scenarios open by name (S5 and the confident-stop test), by Message-ID. */
export const MARIA_KEY_MESSAGES = {
  germanRecruiter: "<maria-0001@talentbruecke.example>",
  multiRoleAlert: "<maria-0002@linkedin.com>",
  interviewInvite: "<maria-0003@nordlicht-pay.example>",
  promptInjection: "<maria-0004@hirewave.example>",
  alwaysInvalid: "<maria-0005@polder-talent.example>",
  scam: "<maria-0006@globalcareers-mail.example>",
  offer: "<maria-0007@kanaalstraat.example>",
  rejection: "<maria-0008@hire.lever.co>",
} as const;

/** Where each file of a persona lives, relative to the fixtures directory. */
export function personaPaths(persona: Persona) {
  return {
    mail: `${persona}/mail`,
    envelopes: `${persona}/envelopes.json`,
    expected: `${persona}/expected.json`,
    classify: `ai/${persona}/classify.json`,
    extract: `ai/${persona}/extract.json`,
    prefs: `ai/${persona}/prefs.json`,
    intake: `ai/${persona}/intake.json`,
  };
}
export const NONE_INTAKE_PATH = "ai/none/intake.json";
export const AI_TEST_PATH = "ai/ai.test.json";

/** The fixtures directory: FIXTURES_DIR, or this file's own directory. */
export function fixturesDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.FIXTURES_DIR ?? fileURLToPath(new URL(".", import.meta.url));
  return dir.endsWith("/") ? dir : `${dir}/`;
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** JSON as the generator writes it: two-space indent and a final newline. */
export function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// --- MVP 2 ------------------------------------------------------------------------------------

/** @public One CV file of a persona (<persona>/cvs.json). */
export interface CvFixture {
  /** The file under <persona>/cvs/. */
  file: string;
  /** The name shown in the app ("Backend (DE)"). */
  name: string;
  mediaType: "pdf" | "docx";
  /** SHA-256 of the file's bytes, lower-case hex: the key of ai/<persona>/cv.json. */
  contentHash: string;
}

/** @public One message `seed deliver <id>` delivers (<persona>/deliveries.json). */
export interface DeliveryEntry {
  /** The id passed to `seed deliver`. */
  id: string;
  /** The .eml path relative to <persona>/deliver/. */
  file: string;
  messageId: string;
  /** How old the message is when delivered (all within the 14-day reply window). */
  minutesAgo: number;
}

/** @public cv.v1's answer (CvReadOutput). */
export interface CvAnswer {
  language: string | null;
  skills: string[];
  roleFamilies: string[];
  seniority: string | null;
  countryHints: string[];
  formatHints: string[];
}

type FitVerdict = "fits" | "conflicts" | "unknown";

/** @public match.v1's answer (MatchAiOutput). */
export interface MatchAnswer {
  titleFit: { verdict: FitVerdict; reason: string };
  skillCloseness: { skill: string; verdict: FitVerdict; reason: string }[];
}

/** @public draft.v1's answer (DraftOutput). */
export interface DraftAnswer {
  subject: string;
  body: string;
  language: string;
  usedEntries: string[];
  attachCv: boolean;
  questions: { profileKey: string | null; groupKey: string; question: string; choices: string[] }[];
}

/** @public assistant.v1's answer (AssistantOutput); `changes` are packages/schema Changes. */
export interface AssistantAnswer {
  reply: string;
  clarify: { question: string; choices: string[] } | null;
  proposal: { summary: string; changes: unknown[] } | null;
}

/** @public ai/assistant.json: by the user's message text, then by turn ("1", "2", …). */
export type AssistantAnswerFile = Record<string, Record<string, AssistantAnswer>>;

/** @public One request of assistant/requests.json. */
export interface AssistantRequest {
  language: "en" | "de" | "pt";
  text: string;
  /** The Changes it should produce (packages/schema), or null when it should only clarify. */
  expected: unknown[] | null;
}

/** The key of ai/<persona>/match.json. */
export function matchKey(messageId: string, position: number): string {
  return `${messageId}#${position}`;
}

/** The key of ai/<persona>/draft.json. */
export function draftKey(messageId: string, position: number, attempt: 1 | 2): string {
  return `${messageId}#${position}#${attempt}`;
}

/** @public What expected.json adds to a message in MVP 2. */
export interface ExpectedMessageMvp2 {
  sender?: { verdict: "looks_fine" | "caution" | "high_risk" };
  /** Per role, in position order. */
  roles?: { cv: string | null; hardConflicts: string[]; draft: boolean }[];
}

/** @public What expected.json adds per CV in MVP 2. */
export interface ExpectedCv {
  name: string;
  tags: string[];
  /** A skill the fake AI's answer invents, which the skill check drops (F2.2). */
  droppedSkill?: string;
}

/** @public Where each MVP 2 file of a persona lives, relative to the fixtures directory. */
export function personaPathsMvp2(persona: Persona) {
  return {
    cvs: `${persona}/cvs`,
    cvList: `${persona}/cvs.json`,
    deliver: `${persona}/deliver`,
    deliveries: `${persona}/deliveries.json`,
    cv: `ai/${persona}/cv.json`,
    match: `ai/${persona}/match.json`,
    draft: `ai/${persona}/draft.json`,
  };
}
/** @public */
export const ASSISTANT_ANSWERS_PATH = "ai/assistant.json";
/** @public */
export const ASSISTANT_REQUESTS_PATH = "assistant/requests.json";
