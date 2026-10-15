import { answerChange, answerItem } from "@jobfilly/core";
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
import { applyAndReevaluate, requestReevaluation } from "../profile/changes";

// The decision inbox (F7): list, the open count for the navigation, answer, Not now, Don't ask
// for this message. Viewers see decisions but can't answer them (F7.7). Mounted once at
// /api/workspaces/:workspaceId/decisions.
//
// Answering (F7.4) with "Use this answer for similar mail" writes the answer to the profile as
// one `add` of a single item (source decision) through the profile change service, which
// re-evaluates every role; so the waiting roles are re-matched and drafted, and later mail that
// needs the same answer uses it (F7.6). Without it the answer is kept on the decision for the
// roles waiting now only: they are re-evaluated with it, and the profile doesn't change. A
// decision without a profile key (an ask_first rule) is always answered for its roles only.

const DecisionParamsSchema = z.object({ decisionId: IdSchema });

const view = ({ answer: _a, ...decision }: StoredDecision): Decision => decision;

const NOT_OPEN = { error: "conflict", message: "This decision was answered already" } as const;

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
        const item = answerItem(decision, value);
        if (item === null) {
          const message =
            "That answer doesn't fit this question. Pick one or write it differently.";
          return c.json({ error: "invalid", message }, 400);
        }
        const remember = useForSimilar && decision.profileKey !== null;
        if (remember && decision.profileKey !== null) {
          const profile = (await listProfiles(deps.db, ws)).find((p) => p.confirmedAt !== null);
          if (!profile) {
            const message = "Confirm your profile first, so the answer has somewhere to go";
            return c.json({ error: "conflict", message }, 409);
          }
          const applied = await applyAndReevaluate(
            deps,
            ws,
            profile.id,
            [answerChange(decision.profileKey, item)],
            { source: "decision", userId, request: decision.question },
          );
          if (!applied?.ok) {
            const message =
              "That answer doesn't fit this question. Pick one or write it differently.";
            return c.json({ error: "invalid", message }, 400);
          }
        }
        const answered = await answerDecision(deps.db, ws, decisionId, {
          answer: item,
          userId,
          now: deps.clock.now(),
        });
        if (!answered) return c.json(NOT_OPEN, 409);
        // The waiting roles are re-matched and get their drafts (the reply stage).
        if (answered.roles.length > 0) {
          await requestReevaluation(deps, ws, { roles: answered.roles }, "decision.answered");
        }
        deps.log.info("decision.answered", {
          workspaceId: ws,
          userId,
          decisionId,
          useForSimilar: remember,
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
