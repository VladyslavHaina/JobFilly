import type { IntakeInput, JobFacts, Preferences, ScanFocus } from "@jobfilly/schema";
import { mentions, norm } from "../rules/words";

// A re-run of setup's focus (MVP 3, F1.1): what the hint asks for, read by focus.v1 into
// ScanFocus, decides which of the mail the re-run's intake form reads, and which likely job mail
// the re-run reads first. Pure.
//
// The focus is matched on its first kind of fact that names something, in this order: places
// (countries and cities), work modes, contract words, other words, languages. A hint that names a
// country is about where the user works: a role elsewhere isn't in focus because its contract says
// "permanent" too. A reply is in focus when its preferences name it, a job message when one of its
// roles does. A focus that names nothing (no hint, or one that names none of these) keeps all the
// mail of the window. The window is the last 90 days before the re-run started, as the first scan's.

type Kind = "places" | "workModes" | "contracts" | "words" | "languages";

/** The kind of fact the focus is matched on, or null when it names nothing. */
function anchorOf(focus: ScanFocus): Kind | null {
  if (focus.countries.length > 0 || focus.cities.length > 0) return "places";
  if (focus.workModes.length > 0) return "workModes";
  if (focus.contracts.length > 0) return "contracts";
  if (focus.words.length > 0) return "words";
  if (focus.languages.length > 0) return "languages";
  return null;
}

const sameWords = (a: string, b: string) => norm(a) === norm(b);
const named = (text: string | null, words: readonly string[]) =>
  !!text && words.some((w) => mentions(text, w));

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
      return named(role.contract, focus.contracts);
    case "words":
      return [role.title, role.company, role.contract, ...role.skills].some((t) =>
        named(t, focus.words),
      );
    case "languages":
      return role.languages.some((l) => focus.languages.some((code) => sameWords(code, l)));
  }
}

function replyInFocus(prefs: Preferences, focus: ScanFocus, kind: Kind): boolean {
  switch (kind) {
    case "places":
      return (
        (prefs.places ?? []).some((p) => placeInFocus(p, focus)) ||
        (prefs.work_permits ?? []).some(
          (w) => w.country !== null && focus.countries.includes(w.country),
        )
      );
    case "workModes":
      return (
        (prefs.places ?? []).some((p) => focus.workModes.includes(p.mode)) ||
        (focus.workModes.includes("remote") && (prefs.remote ?? []).length > 0)
      );
    case "contracts":
      return (prefs.contracts ?? []).some((c) => named(c, focus.contracts));
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
 * is in focus. Without a focus, all the mail of the window.
 */
export function focusIntakeInput(
  input: IntakeInput,
  focus: ScanFocus | null,
  since: Date,
): IntakeInput {
  const inWindow = (date: string) => Date.parse(date) >= since.getTime();
  const kind = focus ? anchorOf(focus) : null;
  return {
    replies: input.replies.filter(
      (r) => inWindow(r.date) && (!focus || !kind || replyInFocus(r.preferences, focus, kind)),
    ),
    jobs: input.jobs.filter(
      (j) =>
        inWindow(j.date) &&
        (!focus || !kind || j.roles.some((role) => roleInFocus(role, focus, kind))),
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
