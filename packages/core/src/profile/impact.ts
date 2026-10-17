import type { Change, NeedSpec, ProfileEntry, Rule } from "@jobfilly/schema";
import type { PreviewRole } from "../assistant/preview";
import { matchRole } from "../match/match";
import { replyEligibility } from "../policy/reply";
import { answeredFor, applyChanges, type ChangeContext, type ProfileContent } from "./changes";

// How many roles a change by hand changes (MVP 3, F2.3), said at once: each of the profile's
// current roles is scored before and after with the rules engine, the match and the reply policy,
// with its stored match.v1 answer (the same both times), so it takes no model call and no mailbox.
// A role changes when it is hidden or shown, its score moves, a rule's effect on it changes, or
// whether a reply would be drafted for it does. The re-evaluation that follows makes it so within
// a minute.

function outcome(
  role: PreviewRole,
  entries: readonly ProfileEntry[],
  rules: readonly Rule[],
  now: Date,
) {
  const profile = { entries };
  const result = matchRole({
    facts: role.facts,
    senderAddress: role.senderAddress,
    category: role.category,
    profile,
    rules,
    cv: role.cv,
    ai: role.ai,
  });
  const openNeeds = [...result.match.verdicts, ...result.ruleEffects]
    .map((v) => v.need)
    .filter((n): n is NeedSpec => n !== null)
    .filter((n) => n.profileKey === null || answeredFor(profile, n.groupKey) === null);
  const eligibility = replyEligibility({
    origin: "auto",
    category: role.category,
    receivedAt: role.receivedAt,
    now,
    profile,
    score: result.match.score,
    capped: result.match.capped,
    senderVerdict: role.senderVerdict,
    ruleEffects: result.ruleEffects,
    openNeeds,
    draftHistory: role.draftHistory,
  });
  return JSON.stringify([
    result.hidden !== null,
    result.match.score,
    result.ruleEffects.map((e) => [e.ruleId, e.action]),
    eligibility.eligible,
  ]);
}

/** The roles `changes` would change; the change's error when it doesn't apply. */
export function countChangedRoles(input: {
  content: ProfileContent;
  changes: readonly Change[];
  ctx: ChangeContext;
  roles: readonly PreviewRole[];
  now: Date;
}): { ok: true; changed: number } | { ok: false } {
  const applied = applyChanges(input.content, input.changes, input.ctx);
  if (!applied.ok) return { ok: false };
  let changed = 0;
  for (const role of input.roles) {
    const was = outcome(role, input.content.entries, input.content.rules, input.now);
    const will = outcome(role, applied.entries, applied.rules, input.now);
    if (was !== will) changed += 1;
  }
  return { ok: true, changed };
}
