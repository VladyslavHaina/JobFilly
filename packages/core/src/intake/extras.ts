import {
  AI_BATCH_SIZE,
  CORE_PROFILE_KEYS,
  type CoreProfileKey,
  type IntakeExtraInput,
  type IntakeProposal,
  isExtraKey,
  type StoredMessage,
} from "@jobfilly/schema";

// The input of intake.v1, the one call that proposes the wording of up to five extra questions
// (F6.1, TBD-20): the evidence messages of every answered core question, as the model reads mail,
// and the current answers.

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
