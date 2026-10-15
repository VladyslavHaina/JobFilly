import {
  AI_BATCH_SIZE,
  CORE_PROFILE_KEYS,
  type CoreProfileKey,
  type ExtraQuestion,
  type IntakeExtraInput,
  type IntakeProposal,
  isExtraKey,
  MAX_EXTRA_QUESTIONS,
  type StoredMessage,
} from "@jobfilly/schema";

// The input of intake.v1, the one call that proposes the wording of up to five extra questions
// (F6.1, TBD-20): the evidence messages of every answered core question, as the model reads mail,
// and the current answers; and the check of what the model proposes.

/** Message-IDs that back at least one answered core question, each once, in form order. */
export function extraEvidenceIds(proposal: IntakeProposal): string[] {
  const ids = new Set<string>();
  for (const entry of proposal.entries) {
    if (isExtraKey(entry.key)) continue;
    for (const e of entry.evidence) ids.add(e.messageId);
  }
  return [...ids];
}

/**
 * Builds IntakeExtraInput exactly as packages/schema defines it. `messages` are the stored rows of
 * extraEvidenceIds(proposal); the items are those messages newest first, at most 20, each with its
 * stored snippet as the text (bodies are never fetched for this call). The answers are every core
 * entry in core-key order.
 */
export function buildIntakeExtraInput(
  proposal: IntakeProposal,
  messages: readonly StoredMessage[],
): IntakeExtraInput {
  const wanted = new Set(extraEvidenceIds(proposal));
  const items = messages
    .filter((m) => wanted.has(m.envelope.messageId))
    .filter(
      (m, i, all) => all.findIndex((o) => o.envelope.messageId === m.envelope.messageId) === i,
    )
    .sort(
      (a, b) =>
        Date.parse(b.envelope.date) - Date.parse(a.envelope.date) ||
        (a.envelope.messageId < b.envelope.messageId ? 1 : -1),
    )
    .slice(0, AI_BATCH_SIZE)
    .map(({ envelope }) => ({
      messageId: envelope.messageId,
      folder: envelope.folder,
      from: envelope.from,
      date: envelope.date,
      subject: envelope.subject,
      text: envelope.snippet,
    }));
  const byKey = new Map(proposal.entries.map((e) => [e.key, e]));
  const answers = CORE_PROFILE_KEYS.map((key: CoreProfileKey) => {
    const entry = byKey.get(key);
    return { key, value: entry?.value ?? [], confidence: entry?.confidence ?? null };
  });
  return { items, answers };
}

/**
 * The model's extra questions that were found in the mail (F6.1). Each keeps only the evidence it
 * was shown in `input.items`, each Message-ID once; a question left without evidence is dropped,
 * a repeated slug keeps its first question, and at most five remain. So the form never shows a
 * question the mail doesn't back, nor links to a message that doesn't exist.
 */
export function foundExtraQuestions(
  questions: readonly ExtraQuestion[],
  input: IntakeExtraInput,
): ExtraQuestion[] {
  const shown = new Set(input.items.map((i) => i.messageId));
  const slugs = new Set<string>();
  const found: ExtraQuestion[] = [];
  for (const q of questions) {
    const evidence = [...new Set(q.evidence.filter((id) => shown.has(id)))];
    if (evidence.length === 0 || slugs.has(q.slug)) continue;
    slugs.add(q.slug);
    found.push({ ...q, evidence });
  }
  return found.slice(0, MAX_EXTRA_QUESTIONS);
}
