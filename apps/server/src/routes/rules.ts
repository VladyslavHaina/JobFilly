import { getRule, listProfiles, listRules } from "@jobfilly/db";
import {
  type Change,
  IdSchema,
  type Profile,
  type RuleChangeResult,
  RuleCreateSchema,
  type RuleList,
  RulePatchSchema,
} from "@jobfilly/schema";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { NOT_FOUND, requireRole, validJson, validParam, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { applyAndReevaluate } from "../profile/changes";
import { changedRoles } from "../profile/impact";

// A profile's rules (F3, MVP 3 F2.1): list them, make one by hand, change its words, conditions
// and action, switch it on or off, remove it. Every change is a Change through the profile change
// service (applyAndReevaluate, source you), so it is in the profile history and every role is
// re-evaluated: the affected roles are re-scored within a minute, and until then their scores are
// stale, never shown as current (F3.5, F4.6). Making and changing a rule answers how many of the
// profile's roles it changes (F2.3, profile/impact.ts), counted at once without the model.
// Mounted at /api/workspaces/:workspaceId/profiles next to routes/profiles.ts.

const ProfileParamsSchema = z.object({ profileId: IdSchema });
const RuleParamsSchema = z.object({ profileId: IdSchema, ruleId: IdSchema });

export function rulesRoutes(deps: AppDeps) {
  const profileOf = async (workspaceId: string, profileId: string) =>
    (await listProfiles(deps.db, workspaceId)).find((p) => p.id === profileId) ?? null;

  /** The rule, if it is this profile's in this workspace. */
  const ruleOf = async (workspaceId: string, profileId: string, ruleId: string) => {
    const rule = await getRule(deps.db, workspaceId, ruleId);
    return rule?.profileId === profileId ? rule : null;
  };

  /**
   * Applies one rule change by hand and answers the rule it leaves with the count of changed
   * roles, or 404 when the rule isn't there (any more).
   */
  async function change(
    c: Context<WorkspaceEnv>,
    profile: Profile,
    change: Change,
    pick: (rules: RuleChangeResult[]) => RuleChangeResult | undefined,
    status: 200 | 201,
  ) {
    const workspaceId = c.get("workspaceId");
    const userId = c.get("user").id;
    const changed = await changedRoles(deps, workspaceId, {
      profile,
      rules: await listRules(deps.db, workspaceId, profile.id),
      changes: [change],
      userId,
    });
    const result = await applyAndReevaluate(deps, workspaceId, profile.id, [change], {
      source: "you",
      userId,
      request: null,
    });
    const rule = result?.ok ? pick(result.rules.map((r) => ({ ...r, changed }))) : undefined;
    if (!rule) return c.json(NOT_FOUND, 404);
    return c.json(rule satisfies RuleChangeResult, status);
  }

  return new Hono<WorkspaceEnv>()
    .get("/:profileId/rules", requireRole("viewer"), validParam(ProfileParamsSchema), async (c) => {
      const workspaceId = c.get("workspaceId");
      const { profileId } = c.req.valid("param");
      if (!(await profileOf(workspaceId, profileId))) return c.json(NOT_FOUND, 404);
      const items = await listRules(deps.db, workspaceId, profileId);
      return c.json({ items } satisfies RuleList);
    })
    .post(
      "/:profileId/rules",
      requireRole("editor"),
      validParam(ProfileParamsSchema),
      validJson(RuleCreateSchema),
      async (c) => {
        const workspaceId = c.get("workspaceId");
        const profile = await profileOf(workspaceId, c.req.valid("param").profileId);
        if (!profile) return c.json(NOT_FOUND, 404);
        const before = new Set(
          (await listRules(deps.db, workspaceId, profile.id)).map((r) => r.id),
        );
        const { description, ...rule } = c.req.valid("json");
        // Blank words are stored as the words of its conditions (packages/core describeRule).
        const add: Change = {
          op: "add",
          target: "rule",
          rule: { ...rule, description: description ?? "" },
        };
        return change(c, profile, add, (rules) => rules.find((r) => !before.has(r.id)), 201);
      },
    )
    .patch(
      "/:profileId/rules/:ruleId",
      requireRole("editor"),
      validParam(RuleParamsSchema),
      validJson(RulePatchSchema),
      async (c) => {
        const workspaceId = c.get("workspaceId");
        const { profileId, ruleId } = c.req.valid("param");
        const profile = await profileOf(workspaceId, profileId);
        const rule = profile ? await ruleOf(workspaceId, profileId, ruleId) : null;
        if (!profile || !rule) return c.json(NOT_FOUND, 404);
        const patch = c.req.valid("json");
        const update: Change = {
          op: "update",
          target: "rule",
          ruleId,
          rule: {
            description: patch.description ?? rule.description,
            when: patch.when ?? rule.when,
            then: patch.then ?? rule.then,
            enabled: patch.enabled ?? rule.enabled,
          },
        };
        return change(c, profile, update, (rules) => rules.find((r) => r.id === ruleId), 200);
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
