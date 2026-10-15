import words from "./data/language-words.json";

// The language of a message body (ISO 639-1), for the phrase lists of the sender check (F5) and
// the CV choice (F2.3). data/language-words.json lists, per language, common function words (to
// tell the language) and negations (so "never pay a fee" in a job board's footer isn't read as
// asking for one). Data, not code: a language is added without a code change.
//
//   {"version": 1, "languages": {"en": {"common": ["the", …], "negations": ["never", …]}, …}}

export interface LanguageWords {
  common: string[];
  negations: string[];
}

type LanguageWordsFile = { version: 1; languages: Record<string, LanguageWords> };

const isWordList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((w) => typeof w === "string" && w === w.toLowerCase() && w !== "");

/** Checks the file's shape once; it never crosses a package boundary, so no shared schema. */
function parse(file: unknown): LanguageWordsFile {
  const f = file as { version?: unknown; languages?: unknown };
  if (f?.version !== 1 || typeof f.languages !== "object" || f.languages === null) {
    throw new Error("language-words.json: expected version 1 with languages");
  }
  for (const [code, lists] of Object.entries(f.languages)) {
    const l = lists as Partial<LanguageWords>;
    if (!/^[a-z]{2}$/.test(code) || !isWordList(l?.common) || !isWordList(l?.negations)) {
      throw new Error(`language-words.json: ${code} needs lower-case common and negations lists`);
    }
  }
  return f as LanguageWordsFile;
}

let cache: LanguageWordsFile | null = null;

/** The word lists of data/language-words.json. */
export function loadLanguageWords(): Record<string, LanguageWords> {
  cache ??= parse(words);
  return cache.languages;
}

/** The words of a text for language detection: lower case, apostrophes kept ("don't"). */
export function tokens(text: string): string[] {
  return (
    text
      .normalize("NFC")
      .toLowerCase()
      .replace(/[’`]/gu, "'")
      .match(/[\p{L}\p{N}]+(?:'[\p{L}]+)*/gu) ?? []
  );
}

/** At least this many common words before a language is named. */
const MIN_HITS = 3;
/** The winner needs this many times the runner-up's hits; otherwise it's too close to tell. */
const MARGIN = 1.25;

/**
 * The body's language: the one whose common words occur most, when it clearly leads. Null when
 * the text is too short or too mixed to tell; a check then can't read its signals (F5.3).
 */
export function detectLanguage(text: string): string | null {
  const counts = new Map<string, number>();
  const lists = Object.entries(loadLanguageWords()).map(
    ([code, l]) => [code, new Set(l.common)] as const,
  );
  for (const token of tokens(text)) {
    for (const [code, common] of lists) {
      if (common.has(token)) counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [first, second] = ranked;
  if (!first || first[1] < MIN_HITS) return null;
  if (second && first[1] < second[1] * MARGIN) return null;
  return first[0];
}
