import type {
  Category,
  DraftOrigin,
  NeedSpec,
  ProfileEntry,
  RuleEffect,
  SenderVerdict,
} from "@jobfilly/schema";
import { FUTURE_SKEW_MS, policyValue, withinReplyWindow } from "./window";

// The reply policy (F6.1, F6.5, F1.6): whether a role gets a draft now, and what holds it
// back. The replies slice asks it before every draft and the assistant's impact preview asks it to
// count drafts that won't be created, so both agree.

/** Why a reply is held back. */
export type HeldKind =
  | "not_reply_to"
  | "outside_window"
  | "below_threshold"
  | "sender_check_pending"
  | "high_risk"
  | "rule_hide"
  | "rule_no_draft"
  | "rule_ask_first"
  | "open_needs"
  | "already_drafted"
  | "dismissed"
  /** Another role of the message has the one automatic draft (capAutoDrafts). */
  | "another_role";

export interface ReplyEligibilityInput {
  /**
   * auto: the pipeline; decision: after a decision answer; on_demand: Draft a reply (F6.5);
   * retry: the sweep trying an automatic draft again (a failed one, or a claim whose job died).
   */
  origin: DraftOrigin;
  category: Category | null;
  receivedAt: Date | string;
  now: Date;
  profile: { entries: readonly ProfileEntry[] } | null;
  /** The role's fit score; null while it has none. */
  score: number | null;
  capped: boolean;
  /** Null while the message has no sender check yet: no draft is made without one. */
  senderVerdict: SenderVerdict | null;
  ruleEffects: readonly Pick<RuleEffect, "ruleId" | "action" | "reason">[];
  /** Needs still unanswered for this role (match verdicts, rule effects, draft questions). */
  openNeeds: readonly Pick<NeedSpec, "question">[];
  draftHistory: { hadDraft: boolean; dismissed: boolean };
}

export interface ReplyEligibility {
  eligible: boolean;
  heldBy: { kind: HeldKind; reason: string }[];
}

/** The categories that get replies while the profile doesn't say (reply_to). */
const DEFAULT_REPLY_TO: readonly Category[] = ["recruiter_outreach"];

function replyTo(profile: ReplyEligibilityInput["profile"]): readonly Category[] {
  const entry = profile?.entries.find((e) => e.key === "reply_to");
  const value = (entry?.value ?? []) as Category[];
  // An empty answer the scan left (the intake has no evidence for it) is "not stated"; an empty
  // list someone set (by hand, a decision, an applied proposal) means "reply to nothing".
  if (!entry || (value.length === 0 && entry.source === "scan")) return DEFAULT_REPLY_TO;
  return value;
}

const RULE_HOLDS: Partial<Record<RuleEffect["action"], HeldKind>> = {
  hide: "rule_hide",
  no_draft: "rule_no_draft",
  ask_first: "rule_ask_first",
};

/**
 * Whether a role gets a draft now. on_demand (Draft a reply) is always eligible, whatever the
 * score, window, rules or history; the route still needs an editor and no live draft. auto and
 * decision are held by: a category outside reply_to (default recruiter outreach), a message
 * outside the reply window, a score under reply_threshold (default 70), a missing sender check,
 * a high-risk sender, a hide, no_draft or ask_first rule, open needs, and a role that had a draft
 * (in the mailbox, discarded or failed) or was dismissed — so a re-evaluation never recreates a
 * draft the user discarded.
 *
 * retry is held by all of those but already_drafted: the draft it tries again is the role's own
 * row, which is what makes hadDraft true. So a failed draft whose message left the reply window,
 * whose sender turned high risk or that a rule now holds is not saved after all (F1.6, F6.1). A
 * Draft a reply that failed is retried as on_demand.
 */
export function replyEligibility(input: ReplyEligibilityInput): ReplyEligibility {
  if (input.origin === "on_demand") return { eligible: true, heldBy: [] };
  const heldBy: ReplyEligibility["heldBy"] = [];
  const hold = (kind: HeldKind, reason: string) => heldBy.push({ kind, reason });

  if (!input.category || !replyTo(input.profile).includes(input.category)) {
    hold("not_reply_to", "This kind of mail doesn't get replies");
  }
  if (!withinReplyWindow(input.receivedAt, input.now, input.profile)) {
    const days = policyValue(input.profile, "reply_window_days");
    const ahead = new Date(input.receivedAt).getTime() - input.now.getTime() > FUTURE_SKEW_MS;
    hold("outside_window", ahead ? "Dated in the future" : `Older than ${days} days`);
  }
  const threshold = policyValue(input.profile, "reply_threshold");
  if (input.score === null || input.score < threshold) {
    hold(
      "below_threshold",
      input.score === null ? "Not scored yet" : `Fit score ${input.score} is below ${threshold}`,
    );
  }
  if (input.senderVerdict === null) {
    hold("sender_check_pending", "The sender check isn't done yet");
  } else if (input.senderVerdict === "high_risk") {
    hold("high_risk", "The sender looks high risk");
  }
  for (const effect of input.ruleEffects) {
    const kind = RULE_HOLDS[effect.action];
    if (kind) hold(kind, effect.reason);
  }
  if (input.openNeeds.length > 0) {
    hold(
      "open_needs",
      `Waiting for your answer: ${input.openNeeds.map((n) => n.question).join("; ")}`,
    );
  }
  if (input.draftHistory.hadDraft && input.origin !== "retry")
    hold("already_drafted", "This role already had a draft");
  if (input.draftHistory.dismissed) hold("dismissed", "You chose not to be asked for this message");
  return { eligible: heldBy.length === 0, heldBy };
}
