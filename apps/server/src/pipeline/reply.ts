import {
  groupNeeds,
  isOpen,
  planReply,
  type RoleNeed,
  replyEligibility,
  roleNeeds,
} from "@jobfilly/core";
import {
  draftHistory,
  getEvaluations,
  getSenderChecks,
  keepWaiting,
  listProfiles,
  loadMessageInputs,
  type RoleDecision,
  recordNeeds,
  roleDecisions,
  roleKey,
} from "@jobfilly/db";
import {
  CHECK_FAILED_SIGNAL,
  type DecisionNeed,
  type DraftOrigin,
  type Profile,
  type RoleEvaluation,
} from "@jobfilly/schema";
import type { AppDeps } from "../deps";
import { requestDraft } from "../drafts/request";
import type { ReplyStage } from "./stages";

// The reply stage (F6.1, F7.1–F7.6): for each evaluated role of the message, a draft, a question
// for the decision inbox, or nothing (planReply in packages/core).
//
// - Needs are read as the match and the rules state them (verdict.need, ruleEffects[].need) plus
//   the questions a draft raised; nothing is worked out of the facts again. A need the profile
//   answers (answeredFor, by group key) or a decision answered for this role is not asked again
//   (F7.6).
// - Only a role replyEligibility would otherwise let through is asked about (F7.1); one that is
//   held (its score dropped, a hide, no_draft or ask_first rule, a risky or unchecked sender)
//   stops waiting on what the match, the rules or an automatic draft raised. Only the questions
//   Draft a reply's draft raised (source draft_on_demand) keep waiting, so they aren't lost to
//   the role's score; once they are answered the held role gets its draft with origin
//   `on_demand`, as Draft a reply asked (F6.5). An answer to an automatic draft's question on a
//   held role makes no draft (F6.1).
// - Needs of every role are grouped by group key and recorded together (F7.3); a new decision
//   logs decision.created once.
// - A role to draft is claimed (claimDraft) and draft.create writes it; the claim makes sure two
//   evaluations racing for a role save one copy (F6.4). After a decision answered for the role its
//   origin is `decision`.
//
// It touches neither the mailbox nor the model: draft.create does, off the evaluation.
//
// A retry (the sweep trying a failed draft, or a claim whose job died, again) is checked against
// the same policy before it is claimed (retryPlan, used by pipeline.reevaluate): origin retry
// keeps every hold but the role's own draft, so a draft whose message left the reply window,
// whose sender is now high risk or that a rule now holds is never saved after all (F1.6, F6.1).

const resolved = (r: RoleDecision) => r.state === "resolved" && r.decisionStatus === "answered";
const fromDraft = (r: RoleDecision) => r.source === "draft" || r.source === "draft_on_demand";
const fromDraftAReply = (r: { source: RoleDecision["source"] }) => r.source === "draft_on_demand";

/**
 * Draft a reply's questions were answered (F6.5, F7.4): the role the policy holds gets the draft
 * the user asked for, as Draft a reply would. Only questions an on_demand claim raised count: an
 * automatic draft's question was asked while the policy let the role through, and answering it
 * once the role is held asks for no draft (F6.1). It is drafted once: never when it has had a
 * draft, or the user chose "Don't ask for this message" on one of those questions (F7.5).
 */
function answeredForDraftAReply(
  mine: readonly RoleDecision[],
  history: { hadDraft: boolean; dismissed: boolean },
): boolean {
  const asked = mine.filter(fromDraftAReply);
  return !history.hadDraft && asked.some(resolved) && !asked.some((r) => r.state === "dismissed");
}

/** A role's open needs (roleNeeds), from its evaluation and its decisions. */
function needsOf(
  mine: readonly RoleDecision[],
  evaluation: Pick<RoleEvaluation, "match" | "ruleEffects">,
  profile: Profile,
) {
  const answeredHere = new Set(mine.filter(resolved).map((r) => r.groupKey));
  const recorded: RoleNeed[] = mine
    .filter((r) => r.state === "waiting" && fromDraft(r) && r.decisionStatus === "open")
    .map((r) => ({
      groupKey: r.groupKey,
      profileKey: r.profileKey,
      question: r.question,
      choices: r.choices,
      source: r.source,
    }));
  const needs = roleNeeds({ evaluation, recorded, profile, answeredHere });
  return { answeredHere, recorded, needs };
}

/**
 * What the sweep does with a draft to retry: try it again; wait for a later sweep while the role
 * has no current evaluation or sender check, or its check failed (the mailbox may be down, the
 * very reason it failed); or hold it for good, with the policy's reasons. A Draft a reply that
 * failed is retried as on_demand, which nothing holds (F6.5).
 */
type RetryPlan = { kind: "retry" } | { kind: "wait" } | { kind: "hold"; reason: string };

export async function retryPlan(
  deps: AppDeps,
  ws: string,
  draft: { messageId: string; position: number; origin: DraftOrigin },
  now: Date,
): Promise<RetryPlan> {
  if (draft.origin === "on_demand") return { kind: "retry" };
  const role = { messageId: draft.messageId, position: draft.position };
  const [message] = await loadMessageInputs(deps.db, ws, [draft.messageId]);
  // A role gone from the message fails in draft.create, with its own reason.
  if (!message?.facts[draft.position]) return { kind: "retry" };
  const profile = (await listProfiles(deps.db, ws)).find((p) => p.confirmedAt !== null);
  const [check] = await getSenderChecks(deps.db, ws, [draft.messageId]);
  const evaluation = (await getEvaluations(deps.db, ws, [draft.messageId])).find(
    (e) => e.position === draft.position && !e.stale,
  );
  // A check whose stage failed isn't one (F5.3): the retry waits for a real one, as the reply
  // stage does (sender_check_pending).
  const checkFailed = check?.reasons.some((r) => r.signal === CHECK_FAILED_SIGNAL);
  if (!profile || !evaluation || !check || check.stale || checkFailed) return { kind: "wait" };
  const { needs } = needsOf(await roleDecisions(deps.db, ws, [role]), evaluation, profile);
  const history = (await draftHistory(deps.db, ws, [role])).get(roleKey(role));
  const eligibility = replyEligibility({
    origin: "retry",
    category: message.category,
    receivedAt: message.receivedAt,
    now,
    profile,
    score: evaluation.match?.score ?? null,
    capped: evaluation.match?.capped ?? false,
    senderVerdict: check.verdict,
    // An ask_first rule's question is among the needs while it is open, as in planReply.
    ruleEffects: evaluation.ruleEffects.filter((e) => !(e.action === "ask_first" && e.need)),
    openNeeds: needs,
    draftHistory: history ?? { hadDraft: true, dismissed: false },
  });
  if (eligibility.eligible) return { kind: "retry" };
  return { kind: "hold", reason: eligibility.heldBy.map((h) => h.reason).join("; ") };
}

export const replyStage: ReplyStage = async (input, ctx) => {
  const { deps, ws, profile } = ctx;
  if (!profile) return;
  const { message } = input;
  const decided = await roleDecisions(
    deps.db,
    ws,
    input.evaluations.map((e) => ({ messageId: message.messageId, position: e.position })),
  );
  const asked: DecisionNeed[] = [];
  const toDraft: { position: number; origin: "auto" | "decision" | "on_demand" }[] = [];
  let changed = 0;

  for (const evaluation of input.evaluations) {
    const role = { messageId: message.messageId, position: evaluation.position };
    const mine = decided.filter((r) => r.position === evaluation.position);
    const { answeredHere, recorded, needs } = needsOf(mine, evaluation, profile);
    const history = input.draftHistory.get(evaluation.position) ?? {
      hadDraft: false,
      dismissed: false,
    };
    const plan = planReply({
      origin: mine.some(resolved) ? "decision" : "auto",
      category: message.category,
      receivedAt: message.receivedAt,
      now: ctx.now,
      profile,
      score: evaluation.match?.score ?? null,
      capped: evaluation.match?.capped ?? false,
      senderVerdict: input.sender?.verdict ?? null,
      ruleEffects: evaluation.ruleEffects,
      needs,
      draftHistory: history,
    });

    if (plan.kind === "hold") {
      // Read from what was recorded, not `needs`: a match need with the same group key would
      // stand in for Draft a reply's question there.
      const kept = recorded
        .filter((n) => fromDraftAReply(n) && isOpen(n, profile, answeredHere))
        .map((n) => n.groupKey);
      changed += await keepWaiting(deps.db, ws, role, kept);
      if (kept.length === 0 && answeredForDraftAReply(mine, history)) {
        toDraft.push({ position: evaluation.position, origin: "on_demand" });
      }
      continue;
    }
    changed += await keepWaiting(
      deps.db,
      ws,
      role,
      needs.map((n) => n.groupKey),
    );
    if (plan.kind === "ask") {
      asked.push(...plan.needs.map((n) => ({ ...n, ...role })));
      continue;
    }
    toDraft.push({
      position: evaluation.position,
      origin: mine.some(resolved) ? "decision" : "auto",
    });
  }

  if (asked.length > 0) {
    const { created, added } = await recordNeeds(deps.db, ws, groupNeeds(asked), ctx.now);
    for (const d of created) {
      ctx.log.info("decision.created", { decisionId: d.id, source: "pipeline" });
    }
    changed += added;
  }
  if (changed > 0) await deps.live.publish(ws, { type: "decisions.updated", data: {} });

  for (const { position, origin } of toDraft) {
    await requestDraft(deps, ws, { messageId: message.messageId, position }, { origin });
  }
};
