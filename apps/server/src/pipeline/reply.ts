import { groupNeeds, planReply, type RoleNeed, roleNeeds } from "@jobfilly/core";
import { keepWaiting, type RoleDecision, recordNeeds, roleDecisions } from "@jobfilly/db";
import type { DecisionNeed } from "@jobfilly/schema";
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
//   held stops waiting on what the match or the rules raised. Questions a draft raised wait for
//   their answer, so Draft a reply's questions aren't lost to the role's score; once they are
//   answered the held role gets its draft with origin `on_demand`, as Draft a reply asked.
// - Needs of every role are grouped by group key and recorded together (F7.3); a new decision
//   logs decision.created once.
// - A role to draft is claimed (claimDraft) and draft.create writes it; the claim makes sure two
//   evaluations racing for a role save one copy (F6.4). After a decision answered for the role its
//   origin is `decision`.
//
// It touches neither the mailbox nor the model: draft.create does, off the evaluation.

const resolved = (r: RoleDecision) => r.state === "resolved" && r.decisionStatus === "answered";

/**
 * Draft a reply's questions were answered (F6.5, F7.4): the role the policy holds gets the draft
 * the user asked for, as Draft a reply would. Only Draft a reply raises questions on such a role,
 * as automatic drafts are made only for roles the policy lets through, and it is drafted once:
 * never when it has had a draft, or the user chose "Don't ask for this message" on one of the
 * draft's questions (F7.5).
 */
function answeredForDraft(
  mine: readonly RoleDecision[],
  history: { hadDraft: boolean; dismissed: boolean },
): boolean {
  const asked = mine.filter((r) => r.source === "draft");
  return !history.hadDraft && asked.some(resolved) && !asked.some((r) => r.state === "dismissed");
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
    const answeredHere = new Set(mine.filter(resolved).map((r) => r.groupKey));
    const recorded: RoleNeed[] = mine
      .filter((r) => r.state === "waiting" && r.source === "draft" && r.decisionStatus === "open")
      .map((r) => ({
        groupKey: r.groupKey,
        profileKey: r.profileKey,
        question: r.question,
        choices: r.choices,
        source: "draft",
      }));
    const needs = roleNeeds({ evaluation, recorded, profile, answeredHere });
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
      const kept = needs.filter((n) => n.source === "draft").map((n) => n.groupKey);
      changed += await keepWaiting(deps.db, ws, role, kept);
      if (kept.length === 0 && answeredForDraft(mine, history)) {
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
