import type { JobFacts, MatchAnswer, Persona, ProfileValues } from "../format.ts";
import type { Lang } from "./recruiters.ts";

// How the fixtures judge a role against a persona in MVP 2: the fake AI's match.v1 answer (the
// fuzzy parts: title fit and skill closeness), the CV the app should choose, and the hard
// conflicts (F4.2) that cap the score, all recorded in expected.json. The profile is the one the
// persona has when MVP 2 starts: Maria's confirmed intake with Amsterdam removed (MVP 1 S4).

export interface CvChoiceSource {
  name: string;
  /** The skills cv.v1 reads from it (after the skill check). */
  skills: readonly string[];
}

export interface PersonaJudge {
  persona: Persona;
  profile: ProfileValues;
  /** The CV the app should choose for a role of a message in `language`. */
  cvFor(role: JobFacts, language: Lang): CvChoiceSource;
  titleFit(title: string | null): MatchAnswer["titleFit"];
}

/** A hard conflict, named by the profile entry it conflicts with. */
export type HardConflict = "places" | "min_pay";

/** The hard conflicts of a role (F4.2), in the order a match lists them. */
export function hardConflicts(role: JobFacts, profile: ProfileValues): HardConflict[] {
  const out: HardConflict[] = [];
  const accepted = (country: string | null, city: string | null) =>
    profile.places.some(
      (p) => p.mode === role.workMode && p.country === country && (p.city ?? null) === city,
    );
  // A profile with no places accepts none and refuses none: nothing is known about them.
  if (profile.places.length > 0 && (role.workMode === "onsite" || role.workMode === "hybrid")) {
    // A named place conflicts unless the profile accepts it in this mode; with no place named,
    // only a mode the profile never accepts conflicts.
    if (role.places.length > 0 && !role.places.some((p) => accepted(p.country, p.city))) {
      out.push("places");
    } else if (role.places.length === 0 && profile.places.every((p) => p.mode !== role.workMode)) {
      out.push("places");
    }
  }
  const pay = role.pay;
  if (pay?.currency && pay.period) {
    const top = pay.max ?? pay.min;
    const minimum = profile.min_pay.find(
      (m) => m.currency === pay.currency && m.period === pay.period,
    );
    // Below the minimum means the whole range is below it, in the same currency and period.
    if (minimum && top !== null && top < minimum.amount) out.push("min_pay");
  }
  return out;
}

/** The fake AI's match.v1 answer for a role. */
export function matchAnswer(judge: PersonaJudge, role: JobFacts, cv: CvChoiceSource): MatchAnswer {
  const cvSkills = new Set(cv.skills.map((s) => s.toLowerCase()));
  return {
    titleFit: judge.titleFit(role.title),
    skillCloseness: role.skills.map((skill) =>
      cvSkills.has(skill.toLowerCase())
        ? { skill, verdict: "fits", reason: `${skill} is in the CV "${cv.name}"` }
        : { skill, verdict: "unknown", reason: `${skill} is in neither the CV nor the profile` },
    ),
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
