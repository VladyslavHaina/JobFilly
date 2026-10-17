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
import type { Change, Profile, Rule } from "@jobfilly/schema";
import type { AppDeps } from "../deps";
import { loadWorkspaceProfiles } from "../pipeline/assign";

// The impact preview of a proposal (F8.2, F8.5) on this workspace's current roles: every role's
// facts, sender verdict, live draft and draft history (listRoleStates), the chosen CV's skills,
// and its stored match.v1 answer, handed to packages/core's previewImpact. It reads the database
// only: no model call and no mailbox, so a preview over every role takes one request.
//
// A role's answer is the one stored under the hash of exactly what match.v1 would see now, as the
// match stage picks it. A role without one (its target roles or skills changed and the
// re-evaluation hasn't asked the model yet) is previewed with no answer, its title "not compared
// yet": never with an older answer the pipeline would no longer use.
//
// With several profiles (MVP 3, F1.3) a proposal changes one, so only that profile's roles are
// previewed: those last evaluated with it; one evaluated before MVP 3, or not yet, counts for the
// first profile that is on (profileOfRole's default). With one profile that is every role.

/** Where a stored answer is looked up: its role, the CV the model saw and its input hash. */
const answerKey = (role: string, cvId: string | null, inputHash: string) =>
  JSON.stringify([role, cvId, inputHash]);

/** The profile's roles as the preview reads them, scored against `profile`. */
async function previewRoles(deps: AppDeps, ws: string, profile: Profile): Promise<PreviewRole[]> {
  const firstOn = (await loadWorkspaceProfiles(deps, ws)).on[0]?.id ?? null;
  const states = (await listRoleStates(deps.db, ws)).filter(
    (s) => (s.profileId ?? firstOn) === profile.id,
  );
  if (states.length === 0) return [];
  const skillsOf = new Map((await listCvs(deps.db, ws)).map((cv) => [cv.id, cv.skills]));
  const stored = await listStoredMatchAnswers(deps.db, ws, [
    ...new Set(states.map((s) => s.messageId)),
  ]);
  const answers = new Map(
    stored.map((a) => [answerKey(roleKey(a), a.cvId, a.inputHash), a.answer]),
  );
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
        ? (answers.get(answerKey(roleKey(state), cvId, matchInputHash(input))) ?? null)
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
