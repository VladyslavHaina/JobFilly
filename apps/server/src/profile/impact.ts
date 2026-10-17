import { randomUUID } from "node:crypto";
import { countChangedRoles, matchTaskInput, needsMatchAi, type PreviewRole } from "@jobfilly/core";
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

// "N roles changed" for a change by hand (MVP 3, F2.3, D20): the profile's current roles, each
// with its facts, sender verdict, draft history, chosen CV's skills and its stored match.v1 answer
// (picked by the hash of what match.v1 would see now, as the match stage picks it), scored before
// and after the change by packages/core's countChangedRoles. It reads the database only: no model
// call and no mailbox, so the answer comes at once; the re-evaluation that follows updates the
// roles within a minute. A profile's roles are those last evaluated with it; one evaluated before
// MVP 3 counts for the first profile that is on.

async function profileRoles(deps: AppDeps, ws: string, profile: Profile): Promise<PreviewRole[]> {
  const firstOn = (await loadWorkspaceProfiles(deps, ws)).on[0]?.id ?? null;
  const states = (await listRoleStates(deps.db, ws)).filter(
    (s) => s.evaluation !== null && (s.profileId ?? firstOn) === profile.id,
  );
  if (states.length === 0) return [];
  const skillsOf = new Map((await listCvs(deps.db, ws)).map((cv) => [cv.id, cv.skills]));
  const stored = await listStoredMatchAnswers(deps.db, ws, [
    ...new Set(states.map((s) => s.messageId)),
  ]);
  const key = (role: string, cvId: string | null, hash: string) =>
    JSON.stringify([role, cvId, hash]);
  const answers = new Map(stored.map((a) => [key(roleKey(a), a.cvId, a.inputHash), a.answer]));
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
        ? (answers.get(key(roleKey(state), cvId, matchInputHash(input))) ?? null)
        : null,
      senderVerdict: state.sender?.verdict ?? null,
      draft: state.draft,
      draftHistory: state.draftHistory,
    };
  });
}

/** How many of the profile's roles `changes` (by hand) change; 0 when they don't apply. */
export async function changedRoles(
  deps: AppDeps,
  ws: string,
  input: { profile: Profile; rules: Rule[]; changes: readonly Change[]; userId: string },
): Promise<number> {
  const now = deps.clock.now();
  const result = countChangedRoles({
    content: { entries: input.profile.entries, rules: input.rules },
    changes: input.changes,
    ctx: {
      profileId: input.profile.id,
      source: "you",
      userId: input.userId,
      at: now.toISOString(),
      newRuleId: randomUUID,
    },
    roles: await profileRoles(deps, ws, input.profile),
    now,
  });
  return result.ok ? result.changed : 0;
}
