import { matchRole, matchTaskInput, needsMatchAi } from "@jobfilly/core";
import { getAiSettings, getMatchAnswer, matchInputHash, saveMatchAnswer } from "@jobfilly/db";
import type { MatchAiOutput, MatchTaskInput } from "@jobfilly/schema";
import { aiClientFor } from "../ai-usage";
import { openAiKey } from "../secrets";
import type { MatchStage, StageContext } from "./stages";

// The match stage (F3, F4): the rules engine and the explainable match for one role, with the
// chosen CV from the cv-choice stage.
//
// - The fuzzy parts come from match.v1, called only when no stored answer has the same input
//   hash (match_ai_answers): the role's title and skills, the profile's target roles and skills,
//   and the chosen CV's skills. A rule, pay, policy or decision change leaves the hash alone, so
//   re-scoring makes no model call and never touches the mailbox (F3.5, F4.6).
// - A role with neither a title nor skills has nothing for the model and gets no call.
// - A match.v1 call that gives no answer (no AI set up, the provider failed) fails the stage: the
//   role stays missing or stale for the next sweep, never scored on a guess.
// - Logs match.scored for the role and rule.applied {ruleId, action} for each rule that holds;
//   never the message's words or its Message-ID.

class MatchAiError extends Error {
  constructor(reason: string) {
    super(`match.v1 gave no answer: ${reason}`);
    this.name = "MatchAiError";
  }
}

/** The stored answer for this input, or a fresh one from match.v1 (then stored). */
async function aiAnswer(
  ctx: StageContext,
  input: MatchTaskInput,
  cvId: string | null,
): Promise<{ answer: MatchAiOutput; called: boolean }> {
  const { deps, ws } = ctx;
  const key = {
    messageId: input.messageId,
    position: input.position,
    cvId,
    inputHash: matchInputHash(input),
  };
  const stored = await getMatchAnswer(deps.db, ws, key);
  if (stored) return { answer: stored, called: false };
  const settings = await getAiSettings(deps.db, ws);
  if (!settings) throw new MatchAiError("no AI is set up");
  const client = aiClientFor(deps, ws, {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    models: settings.models,
    apiKey: openAiKey(deps.config.secretKey, settings.keyCiphertext),
  });
  const result = await client.match(input);
  if (!result.ok) throw new MatchAiError(result.error.kind);
  await saveMatchAnswer(deps.db, ws, key, result.data, deps.clock.now());
  return { answer: result.data, called: true };
}

export const matchStage: MatchStage = async ({ message, role, cvChoice }, ctx) => {
  if (!ctx.profile) throw new Error("the match stage needs a confirmed profile");
  const input = matchTaskInput({
    messageId: message.messageId,
    position: role.position,
    facts: role.facts,
    profile: ctx.profile,
    cvSkills: cvChoice.skills,
  });
  const ai = needsMatchAi(input) ? await aiAnswer(ctx, input, cvChoice.cvId) : null;
  const result = matchRole({
    facts: role.facts,
    senderAddress: message.from.address,
    category: message.category,
    profile: ctx.profile,
    rules: ctx.rules,
    cv: { cvId: cvChoice.cvId, skills: cvChoice.skills },
    ai: ai?.answer ?? null,
  });

  ctx.log.info("match.scored", {
    position: role.position,
    score: result.match.score,
    capped: result.match.capped,
    hidden: result.hidden !== null,
    aiCalled: ai?.called ?? false,
  });
  for (const effect of result.ruleEffects) {
    ctx.log.info("rule.applied", { ruleId: effect.ruleId, action: effect.action });
  }
  return {
    position: role.position,
    match: result.match,
    hidden: result.hidden,
    ruleEffects: result.ruleEffects,
    cvChoice: { cvId: cvChoice.cvId, reason: cvChoice.reason, source: cvChoice.source },
  };
};
