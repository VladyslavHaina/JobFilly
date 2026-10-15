import {
  type DecisionChoice,
  groupKeyFor,
  HARD_CONFLICT_CAP,
  type JobFacts,
  type Match,
  type MatchAiOutput,
  type MatchTaskInput,
  type MatchVerdict,
  type NeedSpec,
  type Pay,
  PROFILE_SKILLS_KEY,
  type ProfileEntry,
  type ProfileKey,
  type ProfileValues,
  type Rule,
  type RuleEffect,
  type Verdict,
} from "@jobfilly/schema";
import { comparePay, evaluateRules, type RuleSubject } from "../rules/engine";
import { formatAmount, formatRange, norm, rangeDisjoint, rangeWithin } from "../rules/words";

// The explainable match (F4): one role's facts against the profile's entries and rules, giving
// fits, conflicts or unknown with a reason for each entry and rule that applies, and a fit score
// from 0 to 100. Pure: the score is a function of the facts, the profile, the rules, the chosen
// CV's skills and the stored match.v1 answer, so re-scoring after a rule, pay or policy change
// needs no model call.
//
// - Hard conflicts — a place or work mode not accepted, pay below the minimum in the same
//   currency and period, a deal-breaker, a cap_score rule — cap the score at 40 and are listed
//   first (F4.2).
// - Pay is compared only in the same currency and period; anything else is unknown ("different
//   currency"), never converted (F4.3). That unknown is the one a reply can't go without, so it
//   carries the need "Minimum pay in CHF per year?" (groupKey min_pay:CHF:year).
// - Matched and missing skills come from the chosen CV and the profile; a skill counts as matched
//   only when the CV or the profile lists it (the same words, or its words inside the role's).
//   The model's closeness never makes a missing skill a fit (F4.4); it only explains.
// - The model (match.v1) judges only the fuzzy parts: whether the title fits a target role, and
//   how close the role's skills are. Everything else is compared here.
//
// The score adds up five parts, each worth fits 1, unknown about half, conflicts 0:
//   title against the target roles 35, skills (the share matched) 25, place or remote 20,
//   pay 10, the other entries (contracts, languages, seniority, work permits, deal-breakers) 10.

/** What the match reads of the chosen CV (the cv-choice stage's CvChoiceResult). */
interface MatchCv {
  cvId: string | null;
  skills: readonly string[];
}

export interface MatchRoleInput extends RuleSubject {
  profile: { entries: readonly ProfileEntry[] };
  rules: readonly Rule[];
  cv: MatchCv;
  /** The stored (or fresh) match.v1 answer; null when the role had nothing for the model. */
  ai: MatchAiOutput | null;
}

export interface RoleMatch {
  match: Match;
  hidden: { ruleId: string; reason: string } | null;
  ruleEffects: RuleEffect[];
}

const WEIGHTS = { title: 35, skills: 25, place: 20, pay: 10, other: 10 } as const;
/** What an unknown is worth: a fact the mail doesn't state neither helps nor sinks a role. */
const UNKNOWN_CREDIT = 0.5;
const PAY_UNKNOWN_CREDIT = 0.6;
/** The skills part when the role lists no skills. */
const NO_SKILLS_CREDIT = 0.6;
/** The other-entries part when none of them applies. */
const NO_OTHER_CREDIT = 0.6;

const CREDIT: Record<Verdict, number> = { fits: 1, unknown: UNKNOWN_CREDIT, conflicts: 0 };

type Place = ProfileValues["places"][number];
type Remote = ProfileValues["remote"][number];
type MinPay = ProfileValues["min_pay"][number];
type Permit = ProfileValues["work_permits"][number];

/** The value of a profile entry, [] when the profile doesn't have it. */
function entryValue<T>(profile: MatchRoleInput["profile"], key: ProfileKey): T[] {
  return (profile.entries.find((e) => e.key === key)?.value ?? []) as T[];
}

/** The profile's own skills (PROFILE_SKILLS_KEY); a profile without that entry adds none. */
function profileSkills(profile: MatchRoleInput["profile"]): string[] {
  return entryValue<string>(profile, PROFILE_SKILLS_KEY);
}

/** match.v1's input for one role: exactly what the model sees (and what its answer is keyed by). */
export function matchTaskInput(input: {
  messageId: string;
  position: number;
  facts: JobFacts;
  profile: MatchRoleInput["profile"];
  cvSkills: readonly string[];
}): MatchTaskInput {
  return {
    messageId: input.messageId,
    position: input.position,
    role: { title: input.facts.title, skills: [...input.facts.skills] },
    profile: {
      targetRoles: entryValue<string>(input.profile, "target_roles"),
      skills: profileSkills(input.profile),
    },
    cvSkills: [...input.cvSkills],
  };
}

/** Whether a role has anything for the model to judge: a title or skills. */
export function needsMatchAi(input: MatchTaskInput): boolean {
  return (
    (input.role.title !== null && input.role.title.trim() !== "") || input.role.skills.length > 0
  );
}

const verdict = (
  entryKey: ProfileKey | null,
  v: Verdict,
  reason: string,
  options: { hard?: boolean; need?: NeedSpec | null } = {},
): MatchVerdict => ({
  entryKey,
  ruleId: null,
  verdict: v,
  reason,
  hard: options.hard ?? false,
  need: options.need ?? null,
});

const quoted = (words: readonly string[]) => words.map((w) => `'${w}'`).join(", ");

// Title (the model's titleFit).

function titleVerdict(input: MatchRoleInput): MatchVerdict {
  const targets = entryValue<string>(input.profile, "target_roles");
  const title = input.facts.title;
  if (!title || title.trim() === "") return verdict("target_roles", "unknown", "title not stated");
  if (targets.length === 0) {
    return verdict("target_roles", "unknown", "Your profile names no roles you're looking for");
  }
  if (!input.ai) return verdict("target_roles", "unknown", `"${title}" wasn't compared yet`);
  const { verdict: v, reason } = input.ai.titleFit;
  return verdict("target_roles", v, `"${title}" — ${reason}`);
}

// Skills: matched only when the CV or the profile lists them.

const tokens = (s: string) =>
  norm(s)
    .split(/[^\p{L}\p{N}+#.]+/u)
    .filter(Boolean);
const bare = (s: string) => norm(s).replace(/[^\p{L}\p{N}+#]/gu, "");

/** Whether `have` (a CV or profile skill) is the role's `want`: the same words, or its words. */
function sameSkill(want: string, have: string): boolean {
  if (bare(want) !== "" && bare(want) === bare(have)) return true;
  const w = tokens(want);
  const h = tokens(have);
  return h.length > 0 && h.every((t) => w.includes(t));
}

function skillsPart(input: MatchRoleInput): {
  matched: string[];
  missing: string[];
  credit: number;
  verdict: MatchVerdict;
} {
  const have = [...input.cv.skills, ...profileSkills(input.profile)];
  const matched: string[] = [];
  const missing: string[] = [];
  for (const skill of input.facts.skills) {
    (have.some((h) => sameSkill(skill, h)) ? matched : missing).push(skill);
  }
  const where = input.cv.cvId === null ? "your profile" : "your CV or profile";
  const total = input.facts.skills.length;
  if (total === 0) {
    return {
      matched,
      missing,
      credit: NO_SKILLS_CREDIT,
      verdict: verdict(null, "unknown", "skills not stated"),
    };
  }
  const share = matched.length / total;
  const parts = [`${matched.length} of ${total} skills in ${where}`];
  if (matched.length > 0) parts.push(`matched: ${matched.join(", ")}`);
  if (missing.length > 0) parts.push(`missing: ${missing.join(", ")}`);
  let reason = parts.join("; ");
  const close = missing.filter((skill) =>
    input.ai?.skillCloseness.some((c) => norm(c.skill) === norm(skill) && c.verdict === "fits"),
  );
  if (close.length > 0) {
    // The model's closeness explains a gap; it never fills one (F4.4).
    reason += `. Close to your skills, but not listed in ${where}: ${close.join(", ")}`;
  }
  return {
    matched,
    missing,
    credit: share,
    verdict: verdict(null, share >= 0.5 ? "fits" : "conflicts", reason),
  };
}

// Place, work mode and remote hours.

const placeWords = (p: { city: string | null; country: string | null }) =>
  p.city ?? p.country ?? "somewhere";

const samePlace = (role: JobFacts["places"][number], mine: Place) => {
  if (role.country && role.country !== mine.country) return false;
  if (!role.country && !role.city) return false;
  if (mine.city === null) return role.country === mine.country;
  return role.city !== null && norm(role.city) === norm(mine.city);
};

/** Whether a place you accept in `mode` takes a role in `roleMode` (onsite also takes hybrid). */
const modeAccepted = (roleMode: "onsite" | "hybrid", mine: Place["mode"]) =>
  roleMode === "hybrid" ? true : mine === "onsite";

/** Whether one of your remote scopes plainly covers the role's: all its words are in the role's. */
const scopeCovered = (roleScope: string, remote: readonly Remote[]) =>
  remote.some((r) => {
    const mine = tokens(r.scope);
    const theirs = tokens(roleScope);
    return mine.length > 0 && mine.every((t) => theirs.includes(t));
  });

/**
 * Whether you plainly take a remote role stated for `place`: it is one of your places, or one of
 * your remote scopes names its country code or its city ("DE", "Lisbon").
 */
function remotePlaceCovered(
  place: JobFacts["places"][number],
  remote: readonly Remote[],
  places: readonly Place[],
): boolean {
  if (places.some((p) => samePlace(place, p))) return true;
  return remote.some((r) => {
    const words = tokens(r.scope);
    const city = place.city ? tokens(place.city) : [];
    return (
      (place.country !== null && words.includes(norm(place.country))) ||
      (city.length > 0 && city.every((t) => words.includes(t)))
    );
  });
}

/**
 * A remote role fits only when nothing it states contradicts your remote entry. Hours outside
 * yours conflict. A scope or place it states that your remote scopes don't plainly cover ("US
 * only" against your 'EU') is unknown: free words are never guessed into a fit.
 */
function remoteVerdict(input: MatchRoleInput, remote: Remote[], places: Place[]): MatchVerdict {
  if (remote.length === 0) {
    return places.length === 0
      ? verdict("remote", "unknown", "Remote — your profile doesn't say where or how you work")
      : verdict("remote", "unknown", "Remote — your profile doesn't say whether you work remotely");
  }
  const scopes = quoted(remote.map((r) => r.scope));
  const hours = remoteHoursVerdict(input, remote);
  if (hours && hours.verdict !== "fits") return hours;
  const scope = input.facts.remoteScope?.trim() || null;
  const rolePlaces = input.facts.places.filter((p) => p.city || p.country);
  const uncovered = [
    ...(scope !== null && !scopeCovered(scope, remote) ? [scope] : []),
    ...rolePlaces.filter((p) => !remotePlaceCovered(p, remote, places)).map(placeWords),
  ];
  if (uncovered.length > 0) {
    return verdict(
      "remote",
      "unknown",
      `Remote, ${uncovered.join(", ")} — not compared with your remote ${scopes}`,
    );
  }
  if (hours) return hours;
  return verdict(
    "remote",
    "fits",
    `Remote${scope ? `, ${scope}` : ""} — fits your remote ${scopes}`,
  );
}

/** The hours part of a remote verdict; null when there are no hours to compare. */
function remoteHoursVerdict(input: MatchRoleInput, remote: readonly Remote[]): MatchVerdict | null {
  const hours = input.facts.timeZones;
  const ranges = remote.filter((r) => r.timeZones !== null);
  if (!hours || ranges.length === 0) return null;
  const within = ranges.find((r) => r.timeZones && rangeWithin(hours, r.timeZones));
  if (within?.timeZones) {
    return verdict(
      "remote",
      "fits",
      `Remote, ${formatRange(hours)} — fits your remote '${within.scope}' (${formatRange(within.timeZones)})`,
    );
  }
  const yours = ranges.map((r) => formatRange(r.timeZones as NonNullable<Remote["timeZones"]>));
  if (ranges.every((r) => r.timeZones && rangeDisjoint(hours, r.timeZones))) {
    return verdict(
      "remote",
      "conflicts",
      `Remote, ${formatRange(hours)} — outside your remote hours (${yours.join(", ")})`,
    );
  }
  return verdict(
    "remote",
    "unknown",
    `Remote, ${formatRange(hours)} — partly outside your remote hours (${yours.join(", ")})`,
  );
}

function placeVerdict(input: MatchRoleInput): MatchVerdict {
  const places = entryValue<Place>(input.profile, "places");
  const remote = entryValue<Remote>(input.profile, "remote");
  const mode = input.facts.workMode;
  if (mode === "remote") return remoteVerdict(input, remote, places);
  const rolePlaces = input.facts.places.filter((p) => p.city || p.country);
  if (rolePlaces.length === 0) {
    if (!mode) return verdict("places", "unknown", "place not stated");
    // No place named: only a work mode none of your places takes is known to conflict.
    if (places.length > 0 && !places.some((p) => modeAccepted(mode, p.mode))) {
      const modes = [...new Set(places.map((p) => p.mode))].join(" or ");
      const yours = quoted(places.map((p) => `${placeWords(p)}, ${p.mode}`));
      return verdict("places", "conflicts", `${cap(mode)} — you accept only ${modes} (${yours})`, {
        hard: true,
      });
    }
    return verdict("places", "unknown", `${cap(mode)} — place not stated`);
  }
  const where = rolePlaces.map(placeWords).join(" or ");
  const yours = places.map((p) => `${placeWords(p)}, ${p.mode}`);
  if (mode === null) {
    const same = places.find((p) => rolePlaces.some((r) => samePlace(r, p)));
    if (same) {
      return verdict(
        "places",
        "fits",
        `${where} — one of your places ('${placeWords(same)}, ${same.mode}'); work mode not stated`,
      );
    }
    return verdict("places", "unknown", `${where} — work mode not stated`);
  }
  if (places.length === 0) {
    if (remote.length > 0) {
      return verdict(
        "places",
        "conflicts",
        `${where}, ${mode} — you look only for remote work (${quoted(remote.map((r) => r.scope))})`,
        { hard: true },
      );
    }
    return verdict("places", "unknown", `${where}, ${mode} — your profile names no places`);
  }
  const samePlaces = places.filter((p) => rolePlaces.some((r) => samePlace(r, p)));
  const accepted = samePlaces.find((p) => modeAccepted(mode, p.mode));
  if (accepted) {
    return verdict(
      "places",
      "fits",
      `${where}, ${mode} — fits your '${placeWords(accepted)}, ${accepted.mode}'`,
    );
  }
  if (samePlaces.length > 0) {
    return verdict(
      "places",
      "conflicts",
      `${where}, ${mode} — you accept ${quoted(samePlaces.map((p) => `${placeWords(p)}, ${p.mode}`))} only`,
      { hard: true },
    );
  }
  return verdict(
    "places",
    "conflicts",
    `${where}, ${mode} — not one of your places (${quoted(yours)})`,
    { hard: true },
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Pay: only in the same currency and period.

function payChoices(pay: Pay, currency: string, period: MinPay["period"]): DecisionChoice[] {
  const amounts = [...new Set([pay.min, pay.max].filter((n): n is number => n !== null))];
  return amounts.map((amount) => {
    const label = formatAmount(amount, currency, period);
    return { label, value: { amount, currency, period, asWritten: label } };
  });
}

function payVerdict(input: MatchRoleInput): { credit: number; verdict: MatchVerdict | null } {
  const minimums = entryValue<MinPay>(input.profile, "min_pay");
  if (minimums.length === 0) return { credit: PAY_UNKNOWN_CREDIT, verdict: null };
  const unknown = (reason: string, need: NeedSpec | null = null) => ({
    credit: PAY_UNKNOWN_CREDIT,
    verdict: verdict("min_pay", "unknown", reason, { need }),
  });
  const pay = input.facts.pay;
  if (!pay) return unknown("pay not stated");
  const written = pay.asWritten.trim() || "The pay";
  const { currency, period } = pay;
  if (!currency || !period) {
    return unknown(
      `${written} — ${!currency ? "pay currency not stated" : "pay period not stated"}`,
    );
  }
  const same = minimums.find((m) => m.currency === currency && m.period === period);
  if (!same) {
    const why = minimums.some((m) => m.currency === currency)
      ? "different period"
      : "different currency";
    const need: NeedSpec = {
      groupKey: groupKeyFor("min_pay", [currency, period]),
      profileKey: "min_pay",
      question: `Minimum pay in ${currency} per ${period}?`,
      choices: payChoices(pay, currency, period),
    };
    return unknown(`${written} — ${why}`, need);
  }
  const compared = comparePay(pay, same);
  if (compared.state === "unknown") return unknown(`${written} — ${compared.why}`);
  if (compared.top < same.amount) {
    return {
      credit: 0,
      verdict: verdict(
        "min_pay",
        "conflicts",
        `${written} — below your minimum of ${same.asWritten}`,
        { hard: true },
      ),
    };
  }
  return {
    credit: 1,
    verdict: verdict("min_pay", "fits", `${written} — meets your minimum of ${same.asWritten}`),
  };
}

// The other entries: contracts, languages, seniority, work permits, deal-breakers.

const mentions = (haystack: string, needle: string) =>
  norm(needle) !== "" && norm(haystack).includes(norm(needle));

function contractVerdict(input: MatchRoleInput): MatchVerdict | null {
  const contracts = entryValue<string>(input.profile, "contracts");
  if (contracts.length === 0) return null;
  const contract = input.facts.contract;
  if (!contract) return verdict("contracts", "unknown", "contract not stated");
  const same = contracts.find((c) => mentions(contract, c));
  if (same) return verdict("contracts", "fits", `"${contract}" — fits your '${same}'`);
  return verdict(
    "contracts",
    "unknown",
    `"${contract}" — not worded like your contracts (${quoted(contracts)})`,
  );
}

function languageVerdict(input: MatchRoleInput): MatchVerdict | null {
  const mine = entryValue<string>(input.profile, "languages");
  const asked = input.facts.languages;
  if (mine.length === 0 || asked.length === 0) return null;
  const other = asked.filter((l) => !mine.some((m) => norm(m) === norm(l)));
  if (other.length === 0) {
    return verdict("languages", "fits", `${asked.join(", ")} — among your working languages`);
  }
  return verdict(
    "languages",
    "conflicts",
    `Asks for ${other.join(", ")} — not among your working languages (${quoted(mine)})`,
  );
}

function seniorityVerdict(input: MatchRoleInput): MatchVerdict | null {
  const mine = entryValue<string>(input.profile, "seniority");
  const stated = input.facts.seniority;
  if (mine.length === 0 || !stated) return null;
  const same = mine.find((s) => mentions(stated, s));
  if (same) return verdict("seniority", "fits", `"${stated}" — fits your '${same}'`);
  return verdict("seniority", "unknown", `"${stated}" — not worded like your ${quoted(mine)}`);
}

function permitVerdict(input: MatchRoleInput): MatchVerdict | null {
  const mine = entryValue<Permit>(input.profile, "work_permits");
  const asked = input.facts.workPermit;
  if (mine.length === 0 || !asked) return null;
  const same = mine.find((p) => mentions(asked, p.text) || mentions(p.text, asked));
  if (same) return verdict("work_permits", "fits", `"${asked}" — fits your '${same.text}'`);
  return verdict(
    "work_permits",
    "unknown",
    `Asks for "${asked}" — check it against your work permits (${quoted(mine.map((p) => p.text))})`,
  );
}

/** Every word the role's facts state, where a deal-breaker would show. */
function factWords(facts: JobFacts): string[] {
  return [
    facts.title,
    facts.company,
    facts.agency?.name ?? null,
    facts.agency?.client ?? null,
    facts.remoteScope,
    facts.contract,
    facts.seniority,
    facts.workPermit,
    facts.pay?.asWritten ?? null,
    ...facts.skills,
    ...facts.languages,
    ...Object.values(facts.extra),
  ].filter((w): w is string => !!w);
}

function dealBreakerVerdict(input: MatchRoleInput): MatchVerdict | null {
  const breakers = entryValue<string>(input.profile, "deal_breakers");
  if (breakers.length === 0) return null;
  const words = factWords(input.facts);
  const hit = breakers.find((b) => words.some((w) => mentions(w, b)));
  if (hit) {
    return verdict("deal_breakers", "conflicts", `Mentions '${hit}', one of your deal-breakers`, {
      hard: true,
    });
  }
  return verdict("deal_breakers", "fits", "None of your deal-breakers is mentioned in the role");
}

/** The fit score and every verdict for one role, with what its rules do to it. */
export function matchRole(input: MatchRoleInput): RoleMatch {
  const title = titleVerdict(input);
  const skills = skillsPart(input);
  const place = placeVerdict(input);
  const pay = payVerdict(input);
  const others = [
    contractVerdict(input),
    languageVerdict(input),
    seniorityVerdict(input),
    permitVerdict(input),
    dealBreakerVerdict(input),
  ].filter((v): v is MatchVerdict => v !== null);
  const rules = evaluateRules(input.rules, input);

  const other =
    others.length === 0
      ? NO_OTHER_CREDIT
      : others.reduce((sum, v) => sum + CREDIT[v.verdict], 0) / others.length;
  const raw =
    WEIGHTS.title * CREDIT[title.verdict] +
    WEIGHTS.skills * skills.credit +
    WEIGHTS.place * CREDIT[place.verdict] +
    WEIGHTS.pay * pay.credit +
    WEIGHTS.other * other;

  const all = [
    title,
    skills.verdict,
    place,
    ...(pay.verdict ? [pay.verdict] : []),
    ...others,
    ...rules.verdicts,
  ];
  const verdicts = [...all.filter((v) => v.hard), ...all.filter((v) => !v.hard)];
  const capped = verdicts.some((v) => v.hard);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return {
    match: {
      score: capped ? Math.min(score, HARD_CONFLICT_CAP) : score,
      verdicts,
      skills: { matched: skills.matched, missing: skills.missing },
      cvId: input.cv.cvId,
      capped,
    },
    hidden: rules.hidden,
    ruleEffects: rules.effects,
  };
}
