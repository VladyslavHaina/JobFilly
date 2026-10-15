import type { CvReadOutput, CvTag } from "@jobfilly/schema";
import { containsWord, fold, languageName } from "./text";

// What cv.v1 read, made safe to show (F2.1, F2.2).

export interface SkillCheck {
  /** The skills found in the CV text, as the model wrote them, each once. */
  kept: string[];
  /** The skills the text doesn't contain: never listed, logged as cv.skill_dropped. */
  dropped: string[];
}

/**
 * The skill check (F2.2): a skill is kept only if the CV text contains it as written, matching
 * case and whitespace leniently ("Spring  Boot" matches "spring\nboot"), and only as a word of
 * its own ("Go" isn't found in "Google").
 */
export function checkSkills(skills: readonly string[], text: string): SkillCheck {
  const haystack = fold(text);
  const kept: string[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const skill of skills) {
    const needle = fold(skill);
    if (!needle || seen.has(needle)) continue;
    seen.add(needle);
    if (containsWord(haystack, needle)) kept.push(skill.trim());
    else dropped.push(skill.trim());
  }
  return { kept, dropped };
}

const MAX_TAG = 60;

/**
 * The CV's tags after a read (F2.1): what the model suggested — its language, role families,
 * seniority and format hints — as tags with source ai, replacing earlier ai tags, then every tag
 * the user added, kept as they are. Each label once (case-insensitive).
 */
export function tagsAfterRead(read: CvReadOutput, existing: readonly CvTag[]): CvTag[] {
  const suggested = [
    languageName(read.language),
    ...read.roleFamilies,
    read.seniority,
    ...read.formatHints,
  ];
  const out: CvTag[] = [];
  const seen = new Set<string>();
  const add = (label: string | null, source: CvTag["source"]) => {
    const trimmed = label?.trim().slice(0, MAX_TAG).trim();
    if (!trimmed) return;
    const key = fold(trimmed);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label: trimmed, source });
  };
  for (const label of suggested) add(label, "ai");
  for (const tag of existing) if (tag.source === "you") add(tag.label, "you");
  return out;
}
