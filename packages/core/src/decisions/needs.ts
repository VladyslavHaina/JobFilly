import {
  type DecisionChoice,
  type DecisionNeed,
  type DraftOutput,
  type NeedSpec,
  type ProfileEntry,
  type RoleEvaluation,
  turnsDown,
} from "@jobfilly/schema";
import { answeredFor } from "../profile/changes";
import { itemFromText, questionKeys } from "./answers";
import { isNo } from "./words";

// Where decisions come from (F7.1, F7.3, F7.6). A need is a question a reply can't go without,
// stated by whoever knows why: a match verdict (verdict.need, "pay in another currency"), an
// ask_first rule (its effect's need), or a draft's questions (draft.v1). Nothing here works facts
// out again. A need is open until the profile answers its group key (answeredFor) or a decision
// answered it for this role alone; similar needs share a group key and become one decision.

export type NeedSource = DecisionNeed["source"];

/** A need of one role, with what raised it. */
export type RoleNeed = NeedSpec & { source: NeedSource };

export interface RoleNeedsInput {
  evaluation: Pick<RoleEvaluation, "match" | "ruleEffects">;
  /** Needs a draft's questions raised for this role, still waiting on their decision. */
  recorded: readonly RoleNeed[];
  profile: { entries: readonly ProfileEntry[] } | null;
  /** Group keys a decision answered for this role alone (no profile entry was written). */
  answeredHere: ReadonlySet<string>;
}

/** Whether a need still waits for an answer. */
export function isOpen(
  need: Pick<NeedSpec, "groupKey" | "profileKey">,
  profile: RoleNeedsInput["profile"],
  answeredHere: ReadonlySet<string>,
): boolean {
  if (answeredHere.has(need.groupKey)) return false;
  // An ask_first need has no profile key: only a decision answers it, per role.
  if (need.profileKey === null) return true;
  return answeredFor(profile ?? { entries: [] }, need.groupKey) === null;
}

/**
 * The open needs of one role, one per group key: from its match verdicts, its rule effects and
 * the questions its draft raised, minus what the profile or a decision already answers.
 */
export function roleNeeds(input: RoleNeedsInput): RoleNeed[] {
  const all: RoleNeed[] = [
    ...(input.evaluation.match?.verdicts ?? []).flatMap((v) =>
      v.need ? [{ ...v.need, source: "match" as const }] : [],
    ),
    ...input.evaluation.ruleEffects.flatMap((e) =>
      e.need ? [{ ...e.need, source: "rule" as const }] : [],
    ),
    ...input.recorded,
  ];
  const out: RoleNeed[] = [];
  for (const need of all) {
    if (out.some((n) => n.groupKey === need.groupKey)) continue;
    if (isOpen(need, input.profile, input.answeredHere)) out.push(need);
  }
  return out;
}

/**
 * A draft's questions (draft.v1) as needs. Each writes a profile key under a group key its answer
 * answers (questionKeys), so answeredFor tells later that it is answered and the question isn't
 * asked again (F7.6). Its choices stay answers to click, and a click never writes what its label
 * doesn't say: a choice that makes an item of the key adds that item ("Yes" to
 * "places:IE:Dublin:hybrid" adds Dublin hybrid); a no to a question whose items are objects
 * turns it down for the waiting roles and writes nothing (its value is its words, turnsDown);
 * any other choice is left out, as the free-text option is always there. Two choices that would
 * add the same item are one.
 */
export function needsFromQuestions(questions: DraftOutput["questions"]): NeedSpec[] {
  const out: NeedSpec[] = [];
  for (const q of questions) {
    const { profileKey, groupKey } = questionKeys(q);
    if (out.some((n) => n.groupKey === groupKey)) continue;
    const choices: DecisionChoice[] = [];
    for (const label of q.choices) {
      const item = itemFromText(profileKey, groupKey, label);
      const value = item ?? (isNo(label) && turnsDown(profileKey, label) ? label : null);
      if (value === null) continue;
      const same = choices.some((c) => JSON.stringify(c.value) === JSON.stringify(value));
      if (!same) choices.push({ label, value });
    }
    out.push({ groupKey, profileKey, question: q.question, choices });
  }
  return out;
}

/** Needs grouped by group key: one decision per key, listing every role waiting on it (F7.3). */
export interface NeedGroup extends NeedSpec {
  waiting: { messageId: string; position: number; source: NeedSource }[];
}

export function groupNeeds(needs: readonly DecisionNeed[]): NeedGroup[] {
  const groups = new Map<string, NeedGroup>();
  for (const { source, messageId, position, ...spec } of needs) {
    const group = groups.get(spec.groupKey) ?? { ...spec, waiting: [] };
    groups.set(spec.groupKey, group);
    const known = group.waiting.some((w) => w.messageId === messageId && w.position === position);
    if (!known) group.waiting.push({ messageId, position, source });
  }
  return [...groups.values()];
}
