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

/** The tag that makes a CV the one to use when nothing else tells them apart. */
const PREFERRED = "preferred";

const WEIGHT = { language: 4, family: 3, skill: 1, maxSkills: 3, seniority: 1, preferred: 1 };

interface Scored {
  cv: CvCandidate;
  score: number;
  languageMatch: boolean;
  /** The role's title words that the CV's role families or tags name, in title order. */
  familyWords: string[];
  skills: string[];
  seniority: boolean;
  preferred: boolean;
}

const isPreferred = (cv: CvCandidate) => cv.tags.some((t) => fold(t.label) === PREFERRED);

/** The words that say what roles a CV is for: its tags, or its role families when untagged. */
function familyVocabulary(cv: CvCandidate): Set<string> {
  const skip = new Set([
    PREFERRED,
    fold(languageName(cv.language) ?? ""),
    fold(cv.seniority ?? ""),
  ]);
  const labels = cv.tags.length > 0 ? cv.tags.map((t) => t.label) : [...cv.roleFamilies];
  return new Set(labels.filter((l) => !skip.has(fold(l))).flatMap(words));
}

function score(cv: CvCandidate, input: CvChoiceInput): Scored {
  const languageMatch =
    input.language !== null && cv.language !== null && fold(cv.language) === fold(input.language);
  const vocabulary = familyVocabulary(cv);
  const familyWords = [...new Set(words(input.role.title ?? ""))].filter((w) => vocabulary.has(w));
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
    familyWords,
    skills,
    seniority,
    preferred,
    score:
      (languageMatch ? WEIGHT.language : 0) +
      (familyWords.length > 0 ? WEIGHT.family : 0) +
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
 * best fits the role's language, role family (the CV's tags), skills and seniority, with a CV
 * tagged "preferred" winning what is otherwise a tie. Null when there is no CV.
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
