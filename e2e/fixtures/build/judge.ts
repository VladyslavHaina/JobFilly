import type { JobFacts, MatchAnswer, Persona } from "../format.ts";
import type { Lang } from "./recruiters.ts";

// How the fixtures judge a role for a persona in MVP 2: the fake AI's match.v1 answer (the fuzzy
// parts: title fit and skill closeness) and the CV the app should choose, both recorded in the
// fixtures. The hard conflicts (F4.2) are not worked out here: the persona sources write them by
// hand next to each role (spec.ts › MessageSpec.hardConflicts), so E2E checks the app's scorer
// against the personas' stories, not against a copy of it.

export interface CvChoiceSource {
  name: string;
  /** The skills cv.v1 reads from it (after the skill check). */
  skills: readonly string[];
}

export interface PersonaJudge {
  persona: Persona;
  /** The CV the app should choose for a role of a message in `language`. */
  cvFor(role: JobFacts, language: Lang): CvChoiceSource;
  titleFit(title: string | null): MatchAnswer["titleFit"];
}

/**
 * The fake AI's match.v1 answer for a role. `close` names skills the CV lacks that the model
 * still calls close (skill → reason); the scorer must list them as missing all the same (F4.4).
 */
export function matchAnswer(
  judge: PersonaJudge,
  role: JobFacts,
  cv: CvChoiceSource,
  close: Readonly<Record<string, string>> = {},
): MatchAnswer {
  const cvSkills = new Set(cv.skills.map((s) => s.toLowerCase()));
  return {
    titleFit: judge.titleFit(role.title),
    skillCloseness: role.skills.map((skill) => {
      if (cvSkills.has(skill.toLowerCase())) {
        return { skill, verdict: "fits", reason: `${skill} is in the CV "${cv.name}"` };
      }
      const closeReason = close[skill];
      return closeReason === undefined
        ? { skill, verdict: "unknown", reason: `${skill} is in neither the CV nor the profile` }
        : { skill, verdict: "fits", reason: closeReason };
    }),
  };
}

const BACKEND = /back-?end|\bgo developer\b|go-entwickler/i;
const NOT_BACKEND = /data engineer|data entry|site reliability|nurse|practitioner/i;

/** Maria wants backend roles: a backend title fits, a data or ops title doesn't. */
export function backendTitleFit(title: string | null): MatchAnswer["titleFit"] {
  if (title === null) return { verdict: "unknown", reason: "The role names no title" };
  if (BACKEND.test(title)) {
    return { verdict: "fits", reason: `"${title}" is a backend role, one of your target roles` };
  }
  if (NOT_BACKEND.test(title)) {
    return { verdict: "conflicts", reason: `"${title}" is not a backend role` };
  }
  return { verdict: "unknown", reason: `"${title}" may or may not be backend work` };
}

/** Tom is a nurse: a nursing title fits, anything else is unknown. */
export function nursingTitleFit(title: string | null): MatchAnswer["titleFit"] {
  if (title === null) return { verdict: "unknown", reason: "The role names no title" };
  return /nurse/i.test(title)
    ? { verdict: "fits", reason: `"${title}" is a nursing role, like the Nurse (EN) CV` }
    : { verdict: "unknown", reason: `"${title}" may or may not be nursing work` };
}
