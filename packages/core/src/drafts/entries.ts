import {
  type DraftTaskInput,
  type ProfileEntry,
  type ProfileItem,
  type ProfileKey,
  turnsDown,
} from "@jobfilly/schema";
import { extraKey } from "../decisions/answers";
import { applyChanges } from "../profile/changes";

// What a draft may use (F6.2): the profile's entries, plus the answers given for this one role
// only (a decision answered without "Use this answer for similar mail", or turned down). An
// answer's item is added with the same `add` semantics a profile change uses, but only to the
// prompt: the profile itself doesn't change. A no ("No" to "Hybrid in Dublin?", turnsDown) adds
// no item: it is given as the question and its answer, under an extra key named after the
// question's group key, so the reply can say so without anything being written.

/** An answer given for one role, outside the profile. */
export interface DraftAnswer {
  profileKey: ProfileKey;
  groupKey: string;
  question: string;
  value: ProfileItem;
}

const prompted = { profileId: "prompt", source: "decision", userId: null } as const;

/** The profile entries draft.v1 is given for a role. */
export function draftEntries(
  entries: readonly ProfileEntry[],
  answers: readonly DraftAnswer[] = [],
): DraftTaskInput["entries"] {
  let merged: readonly ProfileEntry[] = entries;
  const declined: DraftTaskInput["entries"] = [];
  for (const a of answers) {
    if (turnsDown(a.profileKey, a.value)) {
      const key = extraKey(`answer_${a.groupKey}`);
      if (key) declined.push({ key, label: a.question, value: [String(a.value)] });
      continue;
    }
    const applied = applyChanges(
      { entries: merged, rules: [] },
      [
        {
          op: "add",
          target: "entry",
          key: a.profileKey,
          value: [a.value] as ProfileEntry["value"],
        },
      ],
      { ...prompted, at: new Date(0).toISOString(), newRuleId: () => "prompt" },
    );
    // An answer that doesn't fit its key was refused when it was given; never guess one here.
    if (applied.ok) merged = applied.entries;
  }
  return [...merged.map((e) => ({ key: e.key, label: e.label, value: e.value })), ...declined];
}
