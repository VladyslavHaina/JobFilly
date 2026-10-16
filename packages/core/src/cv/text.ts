// Lenient text comparison for CVs: case, Unicode forms and runs of whitespace don't matter, and a
// word only counts where it stands on its own (not inside a longer word).

/** Lower case, NFKC, every run of whitespace one space, trimmed. */
export function fold(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Where `needle` occurs in `haystack` on its own: neither side touches another letter or digit,
 * so "Go" is not found in "Google" but "C++" is found in "C++, Rust". Both must be folded.
 */
export function wordIndices(haystack: string, needle: string): number[] {
  const found: number[] = [];
  if (!needle) return found;
  const startsWord = WORD_CHAR.test(needle[0] ?? "");
  const endsWord = WORD_CHAR.test(needle.at(-1) ?? "");
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    const before = haystack[at - 1];
    const after = haystack[at + needle.length];
    const freeBefore = !startsWord || before === undefined || !WORD_CHAR.test(before);
    const freeAfter = !endsWord || after === undefined || !WORD_CHAR.test(after);
    if (freeBefore && freeAfter) found.push(at);
  }
  return found;
}

/** Whether `needle` occurs in `haystack` on its own (see wordIndices). */
export function containsWord(haystack: string, needle: string): boolean {
  return wordIndices(haystack, needle).length > 0;
}

/** The words of a text: folded, without diacritics, split on anything that isn't a letter or digit. */
export function words(text: string): string[] {
  return fold(text)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2);
}

/** The English name of an ISO 639-1 code ("de" → "German"), or null when it isn't one. */
export function languageName(code: string | null): string | null {
  if (!code) return null;
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" }).of(code);
    return name ?? null;
  } catch {
    return null;
  }
}
