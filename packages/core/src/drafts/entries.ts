import type { DraftTaskInput, ProfileEntry, ProfileItem, ProfileKey } from "@jobfilly/schema";
import { applyChanges } from "../profile/changes";

// What a draft may use (F6.2): the profile's entries, plus the answers given for this one role
// only (a decision answered without "Use this answer for similar mail"). Those answers are added
// with the same `add` semantics a profile change uses, but only to the prompt: the profile itself
// doesn't change.

/** An answer given for one role, outside the profile. */
export interface DraftAnswer {
  profileKey: ProfileKey;
  value: ProfileItem;
}

/** The profile entries draft.v1 is given for a role. */
export function draftEntries(
  entries: readonly ProfileEntry[],
  answers: readonly DraftAnswer[] = [],
): DraftTaskInput["entries"] {
  let merged: readonly ProfileEntry[] = entries;
  if (answers.length > 0) {
    const applied = applyChanges(
      { entries, rules: [] },
      answers.map((a) => ({
        op: "add",
        target: "entry",
        key: a.profileKey,
        value: [a.value] as ProfileEntry["value"],
      })),
      {
        profileId: "prompt",
        source: "decision",
        userId: null,
        at: new Date(0).toISOString(),
        newRuleId: () => "prompt",
      },
    );
    // An answer that doesn't fit its key was refused when it was given; never guess one here.
    if (applied.ok) merged = applied.entries;
  }
  return merged.map((e) => ({ key: e.key, label: e.label, value: e.value }));
}
