import { loadLanguageWords } from "./data";

// The language of a message body (ISO 639-1), for the phrase lists of the sender check (F5) and
// the CV choice (F2.3), told by the common words of data/language-words.json (see ./data.ts).
// Data, not code: a language is added without a code change.

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

/** The language that clearly leads these counts, or null. */
function leader(counts: ReadonlyMap<string, number>): string | null {
  const [first, second] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!first || first[1] < MIN_HITS) return null;
  if (second && first[1] < second[1] * MARGIN) return null;
  return first[0];
}

/**
 * The body's language: the language its own text opens in. The paragraphs are read from the
 * top, counting each language's common words, until one language clearly leads; a job board's
 * or a company's footer, a signature and a quoted earlier message come last, so a German alert
 * with an English footer is German. Null when the text is too short or too mixed to tell; a
 * check then can't read its signals (F5.3).
 */
export function detectLanguage(text: string): string | null {
  const counts = new Map<string, number>();
  const lists = Object.entries(loadLanguageWords().languages).map(
    ([code, l]) => [code, new Set(l.common)] as const,
  );
  for (const paragraph of text.split(/\n\s*\n/u)) {
    for (const token of tokens(paragraph)) {
      for (const [code, common] of lists) {
        if (common.has(token)) counts.set(code, (counts.get(code) ?? 0) + 1);
      }
    }
    const found = leader(counts);
    if (found) return found;
  }
  return null;
}
