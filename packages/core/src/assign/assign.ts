import type {
  Category,
  JobFacts,
  ProfileEntry,
  ProfileValues,
  RoleProfileSource,
  Rule,
} from "@jobfilly/schema";
import { evaluateRules } from "../rules/engine";
import { mentions, norm, saysPlainly } from "../rules/words";

// Which profile a role belongs to (MVP 3, F1.3): the best of the profiles that are on, by the
// role's places, title, languages and contract and the profile's rules, with the reason in plain
// words ("Munich role, German, permanent → 'Germany permanent'"). Pure: the same role and profiles
// always give the same profile, so the assignment is explainable and re-evaluating changes it
// only when the role or a profile changed.
//
// Each profile scores the role:
//   - an onsite or hybrid role in a place the profile names: +2 for the country, and +2 more for
//     the same city, or +1 when the profile's place names no city (anywhere in that country);
//     only the best of the profile's places counts;
//   - a remote role, when the profile says how it works remotely (its "remote" entry): +3. A
//     remote role's places are where the employer is, not where the user works, so they don't
//     count;
//   - the role's title naming one of the profile's target roles, or the other way round: +1;
//   - a working language of the role the profile lists: +1;
//   - a contract the profile lists, said plainly by the role: +1;
//   - an enabled hide rule of the profile that holds for the role: −10, so a profile that would
//     hide the role gets it only when every profile would.
// The highest score wins; a tie goes to the oldest profile (the first given). An editor's choice
// of a profile that is on wins over all of it (source you).

/** A profile that is on, with its rules, oldest first. */
export interface ProfileCandidate {
  profile: { id: string; name: string; entries: readonly ProfileEntry[] };
  rules: readonly Rule[];
}

export interface AssignInput {
  facts: JobFacts;
  /** The message's From address and category, which rules may test. */
  senderAddress: string;
  category: Category | null;
  /** The profiles that are on, oldest first. */
  profiles: readonly ProfileCandidate[];
  /** The profile an editor chose for the role, if any. */
  chosen: string | null;
}

export interface Assignment {
  profileId: string;
  name: string;
  reason: string;
  source: RoleProfileSource;
}

const HIDE_PENALTY = -10;

function valuesOf<K extends keyof ProfileValues>(
  entries: readonly ProfileEntry[],
  key: K,
): ProfileValues[K] {
  return (entries.find((e) => e.key === key)?.value ?? []) as ProfileValues[K];
}

const same = (a: string | null, b: string | null) => !!a && !!b && norm(a) === norm(b);

interface Score {
  points: number;
  /** What matched, in words, in the order of the reason. */
  parts: string[];
}

function placePoints(facts: JobFacts, entries: readonly ProfileEntry[]): Score {
  if (facts.workMode === "remote") {
    return valuesOf(entries, "remote").length > 0
      ? { points: 3, parts: ["Remote role"] }
      : { points: 0, parts: [] };
  }
  let best: Score = { points: 0, parts: [] };
  for (const place of facts.places) {
    if (!place.country) continue;
    for (const wanted of valuesOf(entries, "places")) {
      if (wanted.country !== place.country) continue;
      const points = 2 + (wanted.city === null ? 1 : same(wanted.city, place.city) ? 2 : 0);
      if (points > best.points) {
        best = { points, parts: [`${place.city ?? place.country} role`] };
      }
    }
  }
  return best;
}

function score(input: AssignInput, candidate: ProfileCandidate): Score {
  const { facts } = input;
  const { entries } = candidate.profile;
  const total = placePoints(facts, entries);
  const add = (part: string) => {
    total.points += 1;
    total.parts.push(part);
  };
  const title = facts.title;
  if (
    title &&
    valuesOf(entries, "target_roles").some((t) => mentions(title, t) || mentions(t, title))
  ) {
    add(title);
  }
  const language = facts.languages.find((l) =>
    valuesOf(entries, "languages").some((w) => same(w, l)),
  );
  if (language) add(language);
  const contract = facts.contract;
  const wanted = contract
    ? valuesOf(entries, "contracts").find((c) => saysPlainly(contract, c))
    : undefined;
  if (wanted) add(wanted);
  const hidden = evaluateRules(
    candidate.rules.filter((r) => r.enabled),
    { facts, senderAddress: input.senderAddress, category: input.category },
  ).hidden;
  if (hidden) total.points += HIDE_PENALTY;
  return total;
}

/** The profile the role belongs to, or null when no profile is on. */
export function assignProfile(input: AssignInput): Assignment | null {
  const chosen = input.profiles.find((p) => p.profile.id === input.chosen);
  if (chosen) {
    const { id, name } = chosen.profile;
    return { profileId: id, name, reason: `Chosen by hand → '${name}'`, source: "you" };
  }
  let best: { candidate: ProfileCandidate; score: Score } | null = null;
  for (const candidate of input.profiles) {
    const s = score(input, candidate);
    if (!best || s.points > best.score.points) best = { candidate, score: s };
  }
  if (!best) return null;
  const { id, name } = best.candidate.profile;
  const why =
    best.score.points > 0 && best.score.parts.length > 0
      ? best.score.parts.join(", ")
      : input.profiles.length === 1
        ? "The only profile that is on"
        : "No other profile fits it better";
  return { profileId: id, name, reason: `${why} → '${name}'`, source: "auto" };
}
