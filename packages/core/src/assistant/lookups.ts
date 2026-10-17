import type { AnswerSource, AnswerToolResult, JobFacts, RoleRef } from "@jobfilly/schema";

// The pure parts of the assistant's read-only lookups (MVP 3, F8.2–F8.4): how a role is named in
// a lookup result and an answer's refs, which roles a few words find, how mail text is quoted as
// untrusted lines, and which of an answer's refs are kept (only those the lookups returned, so an
// answer never links to anything made up).

/** A role as an answer's refs name it: "<Message-ID>#<position>". */
export const roleRef = (role: RoleRef): string => `${role.messageId}#${role.position}`;

/** The role a "<Message-ID>#<position>" ref names, or null when it isn't one. */
export function parseRoleRef(ref: string): RoleRef | null {
  const hash = ref.lastIndexOf("#");
  if (hash <= 0) return null;
  const position = ref.slice(hash + 1);
  if (!/^\d{1,6}$/.test(position)) return null;
  return { messageId: ref.slice(0, hash), position: Number(position) };
}

/** Everything of a role's facts a search can find it by: title, company, agency and places. */
function searchText(facts: JobFacts): string {
  return [
    facts.title,
    facts.company,
    facts.agency?.name,
    facts.agency?.client,
    facts.remoteScope,
    ...facts.places.flatMap((p) => [p.city, p.country]),
  ]
    .filter((s): s is string => typeof s === "string" && s !== "")
    .join(" ")
    .toLocaleLowerCase();
}

/**
 * Whether a role's facts hold every one of the words (in any case, anywhere in its title,
 * company, agency or places). No words finds every role.
 */
export function matchesWords(facts: JobFacts, words: string | null): boolean {
  const wanted = (words ?? "").toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (wanted.length === 0) return true;
  const text = searchText(facts);
  return wanted.every((w) => text.includes(w));
}

// Every kind of line break a reader could take as a new line: CR, LF, NEL and the Unicode line
// and paragraph separators (as packages/ai's framing splits untrusted text).
const SEPARATORS = String.fromCharCode(0x85, 0x2028, 0x2029);
const LINE_BREAK = new RegExp(`\\r\\n|[\\r\\n${SEPARATORS}]`);

/**
 * Mail text quoted in a lookup result (F8.4): every line starts with "| ", so nothing in it can
 * pass for a line the app wrote, and the text is cut at `max` characters.
 */
export function quotedLines(text: string, max: number): string[] {
  const cut = text.length > max ? `${text.slice(0, max)} […]` : text;
  return cut.split(LINE_BREAK).map((line) => `| ${line}`);
}

const sourceKey = (s: AnswerSource) => `${s.kind} ${s.ref}`;

/** An answer's refs that the lookups returned, each once, in the answer's order (F8.2). */
export function knownSources(
  sources: readonly AnswerSource[],
  results: readonly AnswerToolResult[],
): AnswerSource[] {
  const returned = new Set(results.flatMap((r) => r.sources.map(sourceKey)));
  const seen = new Set<string>();
  return sources.filter((s) => {
    const key = sourceKey(s);
    if (!returned.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
