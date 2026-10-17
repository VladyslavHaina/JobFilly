import { answerChange, answerOf } from "@jobfilly/core";
import {
  answerDecision,
  countOpenDecisions,
  dismissDecisionRole,
  getDecision,
  listDecisions,
  listProfiles,
  type StoredDecision,
} from "@jobfilly/db";
import {
  type Decision,
  DecisionAnswerSchema,
  type DecisionCount,
  DecisionDismissSchema,
  type DecisionList,
  IdSchema,
} from "@jobfilly/schema";
import { Hono } from "hono";
import { z } from "zod";
import { NOT_FOUND, requireRole, validJson, validParam, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { profileOfRole } from "../pipeline/assign";
import { afterProfileChanges, requestReevaluation, writeProfileChanges } from "../profile/changes";

// The decision inbox (F7): list, the open count for the navigation, answer, Not now, Don't ask
// for this message. Viewers see decisions but can't answer them (F7.7). Mounted once at
// /api/workspaces/:workspaceId/decisions.
//
// Answering (F7.4) with "Use this answer for similar mail" writes the answer to the profile as
// one `add` of a single item (source decision) through the profile change service, in the
// transaction that claims the decision, which then re-evaluates every role; so the waiting roles
// are re-matched and drafted, and later mail that needs the same answer uses it (F7.6). Without
// it the answer is kept on the decision for the roles waiting now only: they are re-evaluated
// with it, and the profile doesn't change. A decision without a profile key (an ask_first rule)
// is answered for its roles only: the rule asks for each message, so the UI says so instead of
// offering "Use this answer for similar mail", and the flag is ignored for it. So is every
// answer that makes no item (answerOf, which reads no yes or no from words in any language): a
// choice the model said declines ("No" to "Hybrid in Dublin?"), a choice whose words can't
// complete the item, and typed words that don't state it in a form every language shares
// ("Dublin doesn't work for me", "120k euros" for CHF per year, "Ні"). Those answer the waiting
// roles only: nothing is written to the profile or its history, their drafts are told the
// words, and later mail is asked again, so nothing the user turned down is ever written and
// such words are never used for similar mail (F6.2, F7.6). Words that make no item of a key
// whose items are words or numbers are refused.

const DecisionParamsSchema = z.object({ decisionId: IdSchema });

const view = ({ answer: _a, ...decision }: StoredDecision): Decision => decision;

const NOT_OPEN = { error: "conflict", message: "This decision was answered already" } as const;
const DOESNT_FIT = {
  error: "invalid",
  message: "That answer doesn't fit this question. Pick one or write it differently.",
} as const;

export function decisionsRoutes(deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get("/", requireRole("viewer"), async (c) => {
      const items = await listDecisions(deps.db, c.get("workspaceId"));
      return c.json({ items: items.map(view) } satisfies DecisionList);
    })
    .get("/count", requireRole("viewer"), async (c) => {
      const open = await countOpenDecisions(deps.db, c.get("workspaceId"));
      return c.json({ open } satisfies DecisionCount);
    })
    .post(
      "/:decisionId/answer",
      requireRole("editor"),
      validParam(DecisionParamsSchema),
      validJson(DecisionAnswerSchema),
      async (c) => {
        const ws = c.get("workspaceId");
        const userId = c.get("user").id;
        const { decisionId } = c.req.valid("param");
        const { value, useForSimilar } = c.req.valid("json");
        const decision = await getDecision(deps.db, ws, decisionId);
        if (!decision) return c.json(NOT_FOUND, 404);
        if (decision.status !== "open") return c.json(NOT_OPEN, 409);
        const answer = answerOf(decision, value);
        if (answer === null) return c.json(DOESNT_FIT, 400);
        const item = answer.kind === "item" ? answer.item : answer.words;
        const profileKey = useForSimilar && answer.kind === "item" ? decision.profileKey : null;
        // The answer goes into the waiting role's profile (MVP 3, F1.3); a decision no role
        // waits on any more goes to the first profile.
        const waiting = decision.waiting[0];
        const profile =
          profileKey === null
            ? null
            : waiting
              ? await profileOfRole(deps, ws, waiting)
              : (await listProfiles(deps.db, ws)).find((p) => p.confirmedAt !== null);
        if (profileKey !== null && !profile) {
          const message = "Confirm your profile first, so the answer has somewhere to go";
          return c.json({ error: "conflict", message }, 409);
        }
        // The decision is claimed first, and the profile entry is written in that same
        // transaction: of two answers racing, only the one that claims it reaches the profile,
        // and a refused entry leaves the decision open.
        const answered = await answerDecision(
          deps.db,
          ws,
          decisionId,
          { answer: item, userId, now: deps.clock.now() },
          profileKey !== null && profile
            ? async (tx) => {
                const written = await writeProfileChanges(
                  deps,
                  tx,
                  ws,
                  profile.id,
                  [answerChange(profileKey, item)],
                  { source: "decision", userId, request: decision.question },
                );
                return { keep: written?.ok === true, value: written };
              }
            : undefined,
        );
        if (answered.status === "not_open") return c.json(NOT_OPEN, 409);
        if (answered.status === "refused") return c.json(DOESNT_FIT, 400);
        const remember = answered.written?.ok === true;
        if (answered.written?.ok) {
          await afterProfileChanges(deps, ws, answered.written, "decision");
        }
        // The waiting roles are re-matched and get their drafts (the reply stage).
        if (answered.roles.length > 0) {
          await requestReevaluation(deps, ws, { roles: answered.roles }, "decision.answered");
        }
        deps.log.info("decision.answered", {
          workspaceId: ws,
          userId,
          decisionId,
          useForSimilar: remember,
          declined: answer.kind === "words" && answer.declines,
          waitingOnly: answer.kind === "words",
          roles: answered.roles.length,
        });
        await deps.live.publish(ws, { type: "decisions.updated", data: {} });
        const after = await getDecision(deps.db, ws, decisionId);
        return c.json(after ? view(after) : view(decision));
      },
    )
    .post(
      "/:decisionId/not-now",
      requireRole("editor"),
      validParam(DecisionParamsSchema),
      async (c) => {
        // Not now keeps the decision as it is (F7.5): nothing is answered or closed.
        const decision = await getDecision(
          deps.db,
          c.get("workspaceId"),
          c.req.valid("param").decisionId,
        );
        if (!decision) return c.json(NOT_FOUND, 404);
        if (decision.status !== "open") return c.json(NOT_OPEN, 409);
        return c.json(view(decision));
      },
    )
    .post(
      "/:decisionId/dismiss",
      requireRole("editor"),
      validParam(DecisionParamsSchema),
      validJson(DecisionDismissSchema),
      async (c) => {
        const ws = c.get("workspaceId");
        const { decisionId } = c.req.valid("param");
        const role = c.req.valid("json");
        const dismissed = await dismissDecisionRole(
          deps.db,
          ws,
          decisionId,
          role,
          deps.clock.now(),
        );
        if (!dismissed) return c.json(NOT_FOUND, 404);
        await deps.live.publish(ws, { type: "decisions.updated", data: {} });
        const decision = await getDecision(deps.db, ws, decisionId);
        return decision ? c.json(view(decision)) : c.json(NOT_FOUND, 404);
      },
    );
}
