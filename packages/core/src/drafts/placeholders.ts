// The placeholder check (F6.2): a draft that still holds a template slot such as "[Name]",
// "{company}" or "{{first_name}}" is rejected and regenerated once, then marked failed. A slot is
// a bracketed or braced word or few words that starts with a letter, so prices ("[1]"), plain
// text in parentheses and code-like punctuation don't count.
//
// Brackets the original message itself holds are its words, not a slot the model left unfilled:
// a reply to "[External] Backend Engineer" or "[LinkedIn] New role" keeps them in its subject or
// quotes them. So a slot written in the original's subject or body, the same once case and spaces
// are set aside, is never flagged. "[Your name]" or "[Company]" the original doesn't hold still is.

const SLOT = String.raw`\s*[\p{L}_][\p{L}\p{N}_ .'’-]{0,40}?\s*`;
const PATTERNS = [
  new RegExp(String.raw`\[${SLOT}\]`, "gu"),
  new RegExp(String.raw`\{\{${SLOT}\}\}`, "gu"),
  new RegExp(String.raw`\{${SLOT}\}`, "gu"),
];

/** The message a draft replies to: brackets copied from it are not placeholders. */
interface PlaceholderOriginal {
  subject?: string | null;
  text?: string | null;
}

/** Text compared without case or runs of spaces: "[ External ]" is "[external]". */
const loose = (text: string) => text.toLowerCase().replace(/\s+/gu, "");

/**
 * The template placeholders in `text`, in order of appearance; [] when there are none. A slot the
 * `original` message's subject or body holds is its own words and is left out.
 */
export function findPlaceholders(text: string, original: PlaceholderOriginal = {}): string[] {
  const copied = loose(`${original.subject ?? ""}\n${original.text ?? ""}`);
  const found: { at: number; slot: string }[] = [];
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const at = match.index ?? 0;
      // "{{name}}" also contains "{name}": keep the outer one only.
      if (found.some((f) => at >= f.at && at < f.at + f.slot.length)) continue;
      found.push({ at, slot: match[0] });
    }
  }
  return found
    .filter((f) => !copied.includes(loose(f.slot)))
    .sort((a, b) => a.at - b.at)
    .map((f) => f.slot);
}
