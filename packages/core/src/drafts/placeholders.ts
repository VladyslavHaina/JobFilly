// The placeholder check (F6.2): a draft that still holds a template slot such as "[Name]",
// "{company}" or "{{first_name}}" is rejected and regenerated once, then marked failed. A slot is
// a bracketed or braced word or few words that starts with a letter, so prices ("[1]"), plain
// text in parentheses and code-like punctuation don't count.

const SLOT = String.raw`\s*[\p{L}_][\p{L}\p{N}_ .'’-]{0,40}?\s*`;
const PATTERNS = [
  new RegExp(String.raw`\[${SLOT}\]`, "gu"),
  new RegExp(String.raw`\{\{${SLOT}\}\}`, "gu"),
  new RegExp(String.raw`\{${SLOT}\}`, "gu"),
];

/** The template placeholders in `text`, in order of appearance; [] when there are none. */
export function findPlaceholders(text: string): string[] {
  const found: { at: number; slot: string }[] = [];
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const at = match.index ?? 0;
      // "{{name}}" also contains "{name}": keep the outer one only.
      if (found.some((f) => at >= f.at && at < f.at + f.slot.length)) continue;
      found.push({ at, slot: match[0] });
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.slot);
}
