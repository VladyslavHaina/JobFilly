import { randomUUID } from "node:crypto";
import {
  type ImpactPreview,
  matchTaskInput,
  needsMatchAi,
  type PreviewRole,
  previewImpact,
} from "@jobfilly/core";
import {
  listCvs,
  listRoleStates,
  listStoredMatchAnswers,
  matchInputHash,
  roleKey,
} from "@jobfilly/db";
import type { Change, MatchAiOutput, Profile, Rule } from "@jobfilly/schema";
import type { AppDeps } from "../deps";

// The impact preview of a proposal (F8.2, F8.5) on this workspace's current roles: every role's
// facts, sender verdict, live draft and draft history (listRoleStates), the chosen CV's skills,
// and its stored match.v1 answer, handed to packages/core's previewImpact. It reads the database
// only: no model call and no mailbox, so a preview over every role takes one request.

/** Each role's stored answer: the one for exactly what the model would see now, else its latest. */
function storedAnswer(
  answers: Map<string, { cvId: string | null; inputHash: string; answer: MatchAiOutput }[]>,
  key: string,
  cvId: string | null,
  inputHash: string,
): MatchAiOutput | null {
  const mine = (answers.get(key) ?? []).filter((a) => a.cvId === cvId);
  return (mine.find((a) => a.inputHash === inputHash) ?? mine[0])?.answer ?? null;
}

/** The workspace's roles as the preview reads them, scored against `profile`. */
async function previewRoles(deps: AppDeps, ws: string, profile: Profile): Promise<PreviewRole[]> {
  const states = await listRoleStates(deps.db, ws);
  if (states.length === 0) return [];
  const skillsOf = new Map((await listCvs(deps.db, ws)).map((cv) => [cv.id, cv.skills]));
  const stored = await listStoredMatchAnswers(deps.db, ws, [
    ...new Set(states.map((s) => s.messageId)),
  ]);
  const answers = new Map<string, typeof stored>();
  for (const a of stored) {
    const key = roleKey(a);
    answers.set(key, [...(answers.get(key) ?? []), a]);
  }
  return states.map((state) => {
    const cvId = state.evaluation?.cvChoice.cvId ?? null;
    const skills = cvId ? (skillsOf.get(cvId) ?? []) : [];
    const input = matchTaskInput({
      messageId: state.messageId,
      position: state.position,
      facts: state.facts,
      profile,
      cvSkills: skills,
    });
    return {
      messageId: state.messageId,
      position: state.position,
      receivedAt: state.receivedAt,
      category: state.category,
      senderAddress: state.from.address,
      facts: state.facts,
      cv: { cvId, skills },
      ai: needsMatchAi(input)
        ? storedAnswer(answers, roleKey(state), cvId, matchInputHash(input))
        : null,
      senderVerdict: state.sender?.verdict ?? null,
      draft: state.draft,
      draftHistory: state.draftHistory,
    };
  });
}

/** The impact of `changes` on the profile's roles, applied as the assistant's (source assistant). */
export async function previewChanges(
  deps: AppDeps,
  ws: string,
  input: { profile: Profile; rules: Rule[]; changes: readonly Change[]; userId: string },
): Promise<ImpactPreview> {
  const now = deps.clock.now();
  return previewImpact({
    content: { entries: input.profile.entries, rules: input.rules },
    changes: input.changes,
    ctx: {
      profileId: input.profile.id,
      source: "assistant",
      userId: input.userId,
      at: now.toISOString(),
      newRuleId: randomUUID,
    },
    roles: await previewRoles(deps, ws, input.profile),
    now,
  });
}
