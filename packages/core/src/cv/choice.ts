import type { CvTag, JobFacts } from "@jobfilly/schema";
import { fold, languageName, words } from "./text";

// The CV choice per role (F2.3): which of the profile's CVs the app would send for a role, and
// why, in words a person checks at a glance ("German backend role → Backend (DE)"). An editor's
// choice for the role wins. Nothing here is market-specific: languages are ISO 639-1 codes from
// the CV read and the message, role families and seniority are whatever the CV's tags say.

/** What the choice reads of a CV (packages/schema Cv has all of it). */
export interface CvCandidate {
  id: string;
  name: string;
  language: string | null;
  skills: readonly string[];
  roleFamilies: readonly string[];
  seniority: string | null;
  tags: readonly CvTag[];
}

export interface CvChoiceInput {
  role: Pick<JobFacts, "title" | "seniority" | "skills">;
  /** The message's language (ISO 639-1) as the sender stage detected it, or null. */
  language: string | null;
  /** The candidates, oldest first: a tie goes to the older CV. */
  cvs: readonly CvCandidate[];
  /** The CV an editor chose for this role, if any. */
  override: string | null;
}

export interface CvChoiceOutcome {
  cv: CvCandidate | null;
  reason: string;
  source: "auto" | "you";
}

/**
 * The tag that makes a CV the one to use when nothing else tells them apart: it outweighs one
 * matching skill more, not a language or a role family.
 */
const PREFERRED = "preferred";

// A role family the title names outweighs the language (a data engineering CV for a German data
// engineering role beats a German backend CV); both outweigh the preferred tag and the skills.
// A title that shares only one word with a family ("Python Backend Developer", "Data Entry
// Assistant") counts as much as one skill, so the preferred tag outweighs it.
const WEIGHT = {
  family: 5,
  language: 4,
  preferred: 2,
  familyWord: 1,
  skill: 1,
  maxSkills: 3,
  seniority: 1,
};

interface Scored {
  cv: CvCandidate;
  score: number;
  languageMatch: boolean;
  /** The title names one of the CV's role families: every word of it (familyMatches). */
  familyMatch: boolean;
  /** The role's title words that the CV's role families or tags name, in title order. */
  familyWords: string[];
  skills: string[];
  seniority: boolean;
  preferred: boolean;
}

const isPreferred = (cv: CvCandidate) => cv.tags.some((t) => fold(t.label) === PREFERRED);

/**
 * The labels that say what roles a CV is for: its tags, or its role families when untagged,
 * without its language (as code or name), its seniority and "preferred".
 */
function familyLabels(cv: CvCandidate): string[] {
  const skip = new Set([
    PREFERRED,
    fold(cv.language ?? ""),
    fold(languageName(cv.language) ?? ""),
    fold(cv.seniority ?? ""),
  ]);
  const labels = cv.tags.length > 0 ? cv.tags.map((t) => t.label) : [...cv.roleFamilies];
  return labels.filter((l) => !skip.has(fold(l)));
}

/** At least this many letters in common before two words count as forms of one word. */
const MIN_STEM = 5;
/** And at most this many letters after it ("engineer" and "engineering", not "data", "database"). */
const MAX_ENDING = 4;

/** The same word, or two forms of it ("engineer", "engineering"; "entwickler", "entwicklerin"). */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  let common = 0;
  while (common < a.length && a[common] === b[common]) common += 1;
  return common >= MIN_STEM && a.length - common <= MAX_ENDING && b.length - common <= MAX_ENDING;
}

/**
 * Whether the title names a role family: every word of the label is in the title. One word in
 * common isn't enough ("Data Entry Assistant" isn't a data engineering role); a tag of one word
 * ("Backend") matches every title with that word.
 */
function familyMatches(label: string, titleWords: readonly string[]): boolean {
  const wanted = words(label);
  return wanted.length > 0 && wanted.every((w) => titleWords.some((t) => sameWord(w, t)));
}

function score(cv: CvCandidate, input: CvChoiceInput): Scored {
  const languageMatch =
    input.language !== null && cv.language !== null && fold(cv.language) === fold(input.language);
  const labels = familyLabels(cv);
  const titleWords = [...new Set(words(input.role.title ?? ""))];
  const familyMatch = labels.some((l) => familyMatches(l, titleWords));
  const vocabulary = labels.flatMap(words);
  const exact = titleWords.filter((t) => vocabulary.includes(t));
  // The words that describe the role in the reason: those the CV's labels use as they are, or
  // the forms that matched ("engineer") when only those did.
  const familyWords =
    exact.length > 0 || !familyMatch
      ? exact
      : titleWords.filter((t) => vocabulary.some((w) => sameWord(w, t)));
  const cvSkills = new Set(cv.skills.map(fold));
  const skills = input.role.skills.filter((s) => cvSkills.has(fold(s)));
  const seniority =
    cv.seniority !== null &&
    (fold(cv.seniority) === fold(input.role.seniority ?? "") ||
      words(input.role.title ?? "").includes(fold(cv.seniority)));
  const preferred = isPreferred(cv);
  return {
    cv,
    languageMatch,
    familyMatch,
    familyWords,
    skills,
    seniority,
    preferred,
    score:
      (languageMatch ? WEIGHT.language : 0) +
      (familyMatch ? WEIGHT.family : familyWords.length > 0 ? WEIGHT.familyWord : 0) +
      Math.min(skills.length, WEIGHT.maxSkills) * WEIGHT.skill +
      (seniority ? WEIGHT.seniority : 0) +
      (preferred ? WEIGHT.preferred : 0),
  };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "German backend role → Backend (DE)", from what the chosen CV matched. */
function reasonFor(best: Scored, input: CvChoiceInput): string {
  const tagged = best.preferred ? ", tagged preferred" : "";
  const phrase = [
    best.languageMatch ? languageName(input.language) : null,
    best.familyWords.length > 0 ? best.familyWords.join(" ") : null,
  ]
    .filter(Boolean)
    .join(" ");
  if (phrase) return `${capitalize(phrase)} role → ${best.cv.name}${tagged}`;
  if (best.skills.length > 0) {
    return `Role asks for ${best.skills.slice(0, WEIGHT.maxSkills).join(", ")} → ${best.cv.name}${tagged}`;
  }
  if (best.seniority && best.cv.seniority) {
    return `${capitalize(best.cv.seniority)} role → ${best.cv.name}${tagged}`;
  }
  if (best.preferred)
    return `Nothing in this role points to another CV → ${best.cv.name}, tagged preferred`;
  if (input.cvs.length === 1) return `Your only CV → ${best.cv.name}`;
  return `Nothing in this role points to one CV → ${best.cv.name}, your first`;
}

/** Why a role uses the CV an editor chose for it. */
export function overrideReason(name: string): string {
  return `You chose ${name} for this role`;
}

/**
 * The CV for a role: an editor's choice when it is still one of the CVs, otherwise the CV that
 * best fits the role's family (a CV tag or role family the title names), language, skills and
 * seniority, with a CV tagged "preferred" winning a tie or a difference of one skill; a tie
 * left goes to the older CV. Null when there is no CV.
 */
export function chooseCv(input: CvChoiceInput): CvChoiceOutcome {
  if (input.override) {
    const chosen = input.cvs.find((cv) => cv.id === input.override);
    if (chosen) return { cv: chosen, reason: overrideReason(chosen.name), source: "you" };
  }
  if (input.cvs.length === 0) return { cv: null, reason: "No CV uploaded yet", source: "auto" };
  let best: Scored | null = null;
  for (const cv of input.cvs) {
    const s = score(cv, input);
    if (!best || s.score > best.score) best = s;
  }
  if (!best) return { cv: null, reason: "No CV uploaded yet", source: "auto" };
  return { cv: best.cv, reason: reasonFor(best, input), source: "auto" };
}
