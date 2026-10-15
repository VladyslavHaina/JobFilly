import { getRule, listProfiles, listRules } from "@jobfilly/db";
import {
  type Change,
  IdSchema,
  type Rule,
  type RuleList,
  RuleToggleSchema,
} from "@jobfilly/schema";
import { Hono } from "hono";
import { z } from "zod";
import { NOT_FOUND, requireRole, validJson, validParam, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { applyAndReevaluate } from "../profile/changes";

// A profile's rules (F3): list them, switch one on or off, remove one. Every change is a Change
// through the profile change service (applyAndReevaluate, source you), so it is in the profile
// history and every role is re-evaluated: switching a rule off or removing it re-scores the
// affected roles within a minute, and until then their scores are stale, never shown as current
// (F3.5, F4.6). Mounted at /api/workspaces/:workspaceId/profiles next to routes/profiles.ts.

const ProfileParamsSchema = z.object({ profileId: IdSchema });
const RuleParamsSchema = z.object({ profileId: IdSchema, ruleId: IdSchema });

export function rulesRoutes(deps: AppDeps) {
  const hasProfile = async (workspaceId: string, profileId: string) =>
    (await listProfiles(deps.db, workspaceId)).some((p) => p.id === profileId);

  /** The rule, if it is this profile's in this workspace. */
  const ruleOf = async (workspaceId: string, profileId: string, ruleId: string) => {
    const rule = await getRule(deps.db, workspaceId, ruleId);
    return rule?.profileId === profileId ? rule : null;
  };

  return new Hono<WorkspaceEnv>()
    .get("/:profileId/rules", requireRole("viewer"), validParam(ProfileParamsSchema), async (c) => {
      const workspaceId = c.get("workspaceId");
      const { profileId } = c.req.valid("param");
      if (!(await hasProfile(workspaceId, profileId))) return c.json(NOT_FOUND, 404);
      const items = await listRules(deps.db, workspaceId, profileId);
      return c.json({ items } satisfies RuleList);
    })
    .patch(
      "/:profileId/rules/:ruleId",
      requireRole("editor"),
      validParam(RuleParamsSchema),
      validJson(RuleToggleSchema),
      async (c) => {
        const workspaceId = c.get("workspaceId");
        const { profileId, ruleId } = c.req.valid("param");
        const { enabled } = c.req.valid("json");
        const rule = await ruleOf(workspaceId, profileId, ruleId);
        if (!rule) return c.json(NOT_FOUND, 404);
        const change: Change = {
          op: "update",
          target: "rule",
          ruleId,
          rule: { description: rule.description, when: rule.when, then: rule.then, enabled },
        };
        const result = await applyAndReevaluate(deps, workspaceId, profileId, [change], {
          source: "you",
          userId: c.get("user").id,
          request: null,
        });
        const updated = result?.ok ? result.rules.find((r) => r.id === ruleId) : undefined;
        if (!updated) return c.json(NOT_FOUND, 404);
        return c.json(updated satisfies Rule);
      },
    )
    .delete(
      "/:profileId/rules/:ruleId",
      requireRole("editor"),
      validParam(RuleParamsSchema),
      async (c) => {
        const workspaceId = c.get("workspaceId");
        const { profileId, ruleId } = c.req.valid("param");
        if (!(await ruleOf(workspaceId, profileId, ruleId))) return c.json(NOT_FOUND, 404);
        const result = await applyAndReevaluate(
          deps,
          workspaceId,
          profileId,
          [{ op: "remove", target: "rule", ruleId }],
          { source: "you", userId: c.get("user").id, request: null },
        );
        if (!result?.ok) return c.json(NOT_FOUND, 404);
        return c.body(null, 204);
      },
    );
}
