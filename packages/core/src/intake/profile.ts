import type {
  ExtraQuestion,
  IntakeEdit,
  IntakeProposal,
  ProfileEntry,
  ProfileKey,
} from "@jobfilly/schema";

// What Confirm saves (F6.5): the proposal with the user's edits on top, so every entry records
// where it came from: source "scan" for a proposal kept as it was, "you" for an answer the user
// set. Later edits on the profile page are Changes (packages/core/src/profile/changes.ts).

/** The reason an extra question's evidence carries: the mail the question was found in. */
const EXTRA_REASON = "the question was found in this email";

/**
 * The entries of a newly confirmed profile: every core question in form order, then every extra
 * question. An edited answer keeps the evidence of its proposal but no confidence: the user set
 * it, the app no longer estimates it.
 */
export function confirmedEntries(input: {
  proposal: IntakeProposal;
  edits: readonly IntakeEdit[];
  questions: readonly ExtraQuestion[];
  /** When Confirm was pressed, for the entries the scan proposed. */
  at: string;
}): ProfileEntry[] {
  const edits = new Map(input.edits.map((e) => [e.key, e]));
  const fromScan = { source: "scan" as const, updatedAt: input.at, updatedBy: null };
  const set = (edit: IntakeEdit) => ({
    value: edit.value,
    confidence: null,
    source: edit.source,
    updatedAt: edit.updatedAt,
    updatedBy: edit.updatedBy,
  });

  const core = input.proposal.entries.map((p): ProfileEntry => {
    const edit = edits.get(p.key);
    const base = { key: p.key, label: p.label, evidence: p.evidence };
    return edit
      ? { ...base, ...set(edit) }
      : { ...base, value: p.value, confidence: p.confidence, ...fromScan };
  });
  const extras = input.questions.map((q): ProfileEntry => {
    const key: ProfileKey = `extra.${q.slug}`;
    const edit = edits.get(key);
    const base = {
      key,
      label: q.label,
      evidence: q.evidence.map((messageId) => ({ messageId, reason: EXTRA_REASON })),
    };
    return edit ? { ...base, ...set(edit) } : { ...base, value: [], confidence: null, ...fromScan };
  });
  return [...core, ...extras];
}
