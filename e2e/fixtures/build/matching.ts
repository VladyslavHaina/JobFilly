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

// The place rules of the app's scorer (packages/core/src/match/match.ts), so a regenerated
// fixture records the conflicts the app finds: a role's place is one of yours when the country
// agrees and so does the city, or your place names no city; and a place you take onsite takes a
// hybrid role there too. Remote roles and roles of no stated work mode never conflict on place.
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

type RolePlace = JobFacts["places"][number];
type ProfilePlace = ProfileValues["places"][number];

function samePlace(role: RolePlace, mine: ProfilePlace): boolean {
  if (role.country && role.country !== mine.country) return false;
  if (!role.country && !role.city) return false;
  if (mine.city === null) return role.country === mine.country;
  return role.city !== null && norm(role.city) === norm(mine.city);
}

const modeAccepted = (roleMode: "onsite" | "hybrid", mine: ProfilePlace["mode"]) =>
  roleMode === "hybrid" ? true : mine === "onsite";

function placeConflict(role: JobFacts, profile: ProfileValues): boolean {
  const mode = role.workMode;
  if (mode !== "onsite" && mode !== "hybrid") return false;
  const places = profile.places;
  const rolePlaces = role.places.filter((p) => p.city || p.country);
  // No place named: only a work mode none of the profile's places takes conflicts.
  if (rolePlaces.length === 0) {
    return places.length > 0 && !places.some((p) => modeAccepted(mode, p.mode));
  }
  // A profile with no places refuses a named place only when it looks for remote work alone;
  // with no remote entry either, nothing is known.
  if (places.length === 0) return profile.remote.length > 0;
  return !places.some((p) => modeAccepted(mode, p.mode) && rolePlaces.some((r) => samePlace(r, p)));
}

/** The hard conflicts of a role (F4.2), in the order a match lists them. */
export function hardConflicts(role: JobFacts, profile: ProfileValues): HardConflict[] {
  const out: HardConflict[] = [];
  if (placeConflict(role, profile)) out.push("places");
  const pay = role.pay;
  if (pay?.currency && pay.period && pay.max !== null) {
    const minimum = profile.min_pay.find(
      (m) => m.currency === pay.currency && m.period === pay.period,
    );
    // Below the minimum means even the top of the range is below it, in the same currency and
    // period. A pay with no top stated is unknown to the scorer ("highest pay not stated"), never
    // a conflict.
    if (minimum && pay.max < minimum.amount) out.push("min_pay");
  }
  return out;
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
