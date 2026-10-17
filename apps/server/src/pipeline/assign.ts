import { type Assignment, assignProfile } from "@jobfilly/core";
import { getEvaluations, listProfiles, listRules, type RoleRef } from "@jobfilly/db";
import type { Category, JobFacts, Profile, Rule } from "@jobfilly/schema";
import type { AppDeps } from "../deps";

// The assign step (MVP 3, F1.3): before a role's cv-choice and match stages, it goes to the best
// profile that is on (packages/core assignProfile), or the one an editor chose for it; matching,
// CV choice and drafting then use that profile and its rules. Profiles that are off get no roles.
// The evaluation stores the profile with its reason (role_evaluations.profile_id), which the inbox
// shows and every later step of the role reads (profileOfRole).

/** The workspace's confirmed profiles, oldest first, the ones that are on, and their rules. */
export interface WorkspaceProfiles {
  confirmed: Profile[];
  on: Profile[];
  rules: Map<string, Rule[]>;
}

export async function loadWorkspaceProfiles(deps: AppDeps, ws: string): Promise<WorkspaceProfiles> {
  const confirmed = (await listProfiles(deps.db, ws)).filter((p) => p.confirmedAt !== null);
  const on = confirmed.filter((p) => p.enabled !== false);
  const rules = new Map<string, Rule[]>();
  for (const profile of confirmed) rules.set(profile.id, await listRules(deps.db, ws, profile.id));
  return { confirmed, on, rules };
}

/** The profile a role goes to now, or null when no profile is on. */
export function assignRole(
  set: WorkspaceProfiles,
  input: {
    facts: JobFacts;
    senderAddress: string;
    category: Category | null;
    chosen: string | null;
  },
): Assignment | null {
  return assignProfile({
    ...input,
    profiles: set.on.map((profile) => ({ profile, rules: set.rules.get(profile.id) ?? [] })),
  });
}

/**
 * The profile a role was evaluated with; for a role evaluated before MVP 3 (or not yet), or whose
 * profile is gone, the first profile that is on, else the first confirmed one. Null without a
 * confirmed profile.
 */
export async function profileOfRole(
  deps: AppDeps,
  ws: string,
  role: RoleRef,
): Promise<Profile | null> {
  const confirmed = (await listProfiles(deps.db, ws)).filter((p) => p.confirmedAt !== null);
  const evaluation = (await getEvaluations(deps.db, ws, [role.messageId])).find(
    (e) => e.position === role.position,
  );
  const own = confirmed.find((p) => p.id === evaluation?.profileId);
  return own ?? confirmed.find((p) => p.enabled !== false) ?? confirmed[0] ?? null;
}
