import type { IntakeInput, JobFacts, Preferences, ScanFocus } from "@jobfilly/schema";
import { mentions, norm } from "../rules/words";

// A re-run of setup's focus (MVP 3, F1.1): what the hint asks for, read by focus.v1 into
// ScanFocus, decides which of the mail the re-run's intake form reads, and which likely job mail
// the re-run reads first. Pure.
//
// Only mail that matches the whole focus is evidence, so the form proposes nothing from outside
// it ("I've moved to Germany, permanent roles only" must not bring back Amsterdam, B2B or a day
// rate from an older reply that also named Berlin). The focus is matched on every one of places
// (countries and cities), work modes and contracts that it names; its other words count as more
// wording of its contracts ("unbefristet" for "permanent"). A focus that names none of those is
// matched on its other words, else on its languages.
//   - A reply matches when, for each of those kinds, it states something and everything it
//     states is in focus: a reply naming Berlin and Amsterdam, or permanent and B2B, is about
//     more than the hint, so none of its answers are proposed.
//   - A job message matches when one of its roles does, each kind by one of its values: a role
//     elsewhere isn't in focus because its contract says "permanent" too.
// A focus that names nothing (no hint, or one that names none of these) keeps all the mail of the
// window. The window is the last 90 days before the re-run started, as the first scan's.

type Kind = "places" | "workModes" | "contracts" | "words" | "languages";

/** The kinds of fact the focus is matched on, all of them; none when it names nothing. */
function kindsOf(focus: ScanFocus): Kind[] {
  const kinds: Kind[] = [];
  if (focus.countries.length > 0 || focus.cities.length > 0) kinds.push("places");
  if (focus.workModes.length > 0) kinds.push("workModes");
  if (focus.contracts.length > 0) kinds.push("contracts");
  if (kinds.length > 0) return kinds;
  if (focus.words.length > 0) return ["words"];
  if (focus.languages.length > 0) return ["languages"];
  return [];
}

const sameWords = (a: string, b: string) => norm(a) === norm(b);
const named = (text: string | null, words: readonly string[]) =>
  !!text && words.some((w) => mentions(text, w));
const contractWords = (focus: ScanFocus) => [...focus.contracts, ...focus.words];

function placeInFocus(place: { country: string | null; city: string | null }, focus: ScanFocus) {
  return (
    (place.country !== null && focus.countries.includes(place.country)) ||
    (place.city !== null && focus.cities.some((c) => sameWords(c, place.city as string)))
  );
}

function roleInFocus(role: JobFacts, focus: ScanFocus, kind: Kind): boolean {
  switch (kind) {
    case "places":
      return role.places.some((p) => placeInFocus(p, focus));
    case "workModes":
      return role.workMode !== null && focus.workModes.includes(role.workMode);
    case "contracts":
      return named(role.contract, contractWords(focus));
    case "words":
      return [role.title, role.company, role.contract, ...role.skills].some((t) =>
        named(t, focus.words),
      );
    case "languages":
      return role.languages.some((l) => focus.languages.some((code) => sameWords(code, l)));
  }
}

/** Something stated, and all of it in focus. */
const allIn = <T>(values: readonly T[], inFocus: (value: T) => boolean) =>
  values.length > 0 && values.every(inFocus);

function replyInFocus(prefs: Preferences, focus: ScanFocus, kind: Kind): boolean {
  const places = prefs.places ?? [];
  switch (kind) {
    case "places": {
      const permits = (prefs.work_permits ?? []).flatMap((w) =>
        w.country === null ? [] : [{ country: w.country, city: null }],
      );
      return allIn([...places, ...permits], (p) => placeInFocus(p, focus));
    }
    case "workModes": {
      const remote = (prefs.remote ?? []).length > 0 ? (["remote"] as const) : [];
      return allIn([...places.map((p) => p.mode), ...remote], (m) => focus.workModes.includes(m));
    }
    case "contracts":
      return allIn(prefs.contracts ?? [], (c) => named(c, contractWords(focus)));
    case "words":
      return [
        ...(prefs.target_roles ?? []),
        ...(prefs.contracts ?? []),
        ...(prefs.deal_breakers ?? []),
        ...Object.values(prefs.extra ?? {}),
      ].some((t) => named(t, focus.words));
    case "languages":
      return (prefs.languages ?? []).some((l) =>
        focus.languages.some((code) => sameWords(code, l)),
      );
  }
}

/**
 * The intake input a re-run's form reads: the mail of its window (dated at or after `since`) that
 * matches the focus. Without a focus, all the mail of the window.
 */
export function focusIntakeInput(
  input: IntakeInput,
  focus: ScanFocus | null,
  since: Date,
): IntakeInput {
  const inWindow = (date: string) => Date.parse(date) >= since.getTime();
  const kinds = focus ? kindsOf(focus) : [];
  if (!focus || kinds.length === 0) {
    return {
      replies: input.replies.filter((r) => inWindow(r.date)),
      jobs: input.jobs.filter((j) => inWindow(j.date)),
    };
  }
  return {
    replies: input.replies.filter(
      (r) => inWindow(r.date) && kinds.every((k) => replyInFocus(r.preferences, focus, k)),
    ),
    jobs: input.jobs.filter(
      (j) =>
        inWindow(j.date) && j.roles.some((role) => kinds.every((k) => roleInFocus(role, focus, k))),
    ),
  };
}

/**
 * Likely job mail with the focus's words in its subject or snippet first (cities, contract words
 * and other words; countries are codes, which mail doesn't spell), each part newest first as
 * given. A focus without such words leaves the order as it is.
 */
export function focusFirst<T>(
  rows: readonly T[],
  focus: ScanFocus | null,
  text: (row: T) => string,
): T[] {
  const words = focus ? [...focus.cities, ...focus.contracts, ...focus.words] : [];
  if (words.length === 0) return [...rows];
  const matches = (row: T) => named(text(row), words);
  return [...rows.filter(matches), ...rows.filter((r) => !matches(r))];
}
