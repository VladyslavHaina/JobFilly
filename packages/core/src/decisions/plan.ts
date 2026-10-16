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
