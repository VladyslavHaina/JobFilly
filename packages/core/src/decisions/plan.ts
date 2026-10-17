import type { RuleEffect } from "@jobfilly/schema";
import {
  type ReplyEligibility,
  type ReplyEligibilityInput,
  replyEligibility,
} from "../policy/reply";
import type { RoleNeed } from "./needs";

// Draft, ask or hold (F6.1, F7.1): what the reply stage does with one role. A decision is created
// only for a role replyEligibility would otherwise let through — a good match from a sender that
// isn't high risk, inside the window, never drafted or dismissed — so not every unknown becomes a
// question. An ask_first rule holds the role until its question is answered: its need is the
// question, so it doesn't count as a hold of its own while it is asked, and an answer given for
// the role lifts it.

export interface ReplyPlanInput extends Omit<ReplyEligibilityInput, "openNeeds" | "ruleEffects"> {
  ruleEffects: readonly RuleEffect[];
  /** The role's open needs (roleNeeds); an answered ask_first need is no longer among them. */
  needs: readonly RoleNeed[];
}

export type ReplyPlan =
  | { kind: "draft" }
  | { kind: "ask"; needs: RoleNeed[] }
  | { kind: "hold"; heldBy: ReplyEligibility["heldBy"] };

export function planReply(input: ReplyPlanInput): ReplyPlan {
  const { needs, ...rest } = input;
  // An ask_first rule with a question is asked (or was answered here) instead of holding.
  const ruleEffects = input.ruleEffects.filter((e) => !(e.action === "ask_first" && e.need));
  const base = replyEligibility({ ...rest, ruleEffects, openNeeds: [] });
  if (!base.eligible) return { kind: "hold", heldBy: base.heldBy };
  if (needs.length > 0) return { kind: "ask", needs: [...needs] };
  return { kind: "draft" };
}

const ANOTHER_ROLE = {
  kind: "another_role",
  reason: "Another role in this email already has the reply",
} as const;

/** One role of a message as capAutoDrafts reads it. */
export interface MessageRolePlan {
  position: number;
  /** The role's fit score; null while it has none. */
  score: number | null;
  draftHistory: { hadDraft: boolean; dismissed: boolean };
  plan: ReplyPlan;
}

/**
 * At most one automatic draft per message: of the roles planReply lets through (draft
 * or ask), only the best-scoring one keeps its plan; ties go to the lowest position. A role that
 * waits on a question keeps the place, so the others get no draft meanwhile. Once a role of the
 * message has had a draft or was dismissed, no other role gets one. The others are held with
 * `another_role`; each role comes back with its plan. Draft a reply (F6.5) isn't capped: it stays per role.
 */
export function capAutoDrafts<T extends MessageRolePlan>(roles: readonly T[]): T[] {
  const taken = roles.some((r) => r.draftHistory.hadDraft || r.draftHistory.dismissed);
  let best: T | undefined;
  if (!taken) {
    for (const r of roles) {
      if (r.plan.kind === "hold") continue;
      const score = r.score ?? Number.NEGATIVE_INFINITY;
      const top = best?.score ?? Number.NEGATIVE_INFINITY;
      if (!best || score > top || (score === top && r.position < best.position)) best = r;
    }
  }
  return roles.map((r) =>
    r.plan.kind === "hold" || r === best
      ? r
      : { ...r, plan: { kind: "hold", heldBy: [ANOTHER_ROLE] } },
  );
}
