import { listProfiles, loadMessageInputs, setRoleProfileChoice } from "@jobfilly/db";
import { RoleParamsSchema, type RoleProfile, RoleProfileInputSchema } from "@jobfilly/schema";
import { Hono } from "hono";
import { NOT_FOUND, requireRole, validJson, validParam, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { requestReevaluation } from "../profile/changes";

// Reassigning a role to another profile by hand (MVP 3, F1.3): PUT
// /:messageId/roles/:position/profile (RoleProfileInputSchema). The choice is kept
// (role_profile_choices) and wins over the automatic assignment while that profile is on; the
// role is re-evaluated at once, so its match, CV choice and drafting use that profile within a
// minute. Mounted at /api/workspaces/:workspaceId/messages next to routes/messages.ts (job mail
// only for a member who sees the pipeline only, requireJobMail).

const PROFILE_OFF = {
  error: "profile_off",
  message: "That profile is switched off. Switch it on to give it roles.",
} as const;

export function assignmentRoutes(deps: AppDeps) {
  return new Hono<WorkspaceEnv>().put(
    "/:messageId/roles/:position/profile",
    requireRole("editor"),
    validParam(RoleParamsSchema),
    validJson(RoleProfileInputSchema),
    async (c) => {
      const workspaceId = c.get("workspaceId");
      const role = {
        messageId: c.req.param("messageId") ?? "",
        position: c.req.valid("param").position,
      };
      const { profileId } = c.req.valid("json");
      const [message] = await loadMessageInputs(deps.db, workspaceId, [role.messageId]);
      const profile = (await listProfiles(deps.db, workspaceId)).find(
        (p) => p.id === profileId && p.confirmedAt !== null,
      );
      if (!message?.facts[role.position] || !profile) return c.json(NOT_FOUND, 404);
      if (profile.enabled === false) return c.json(PROFILE_OFF, 409);
      await setRoleProfileChoice(deps.db, workspaceId, role, {
        profileId,
        userId: c.get("user").id,
        at: deps.clock.now(),
      });
      c.get("log").info("profile.assigned", {
        position: role.position,
        profileId,
        source: "you",
      });
      await requestReevaluation(deps, workspaceId, { roles: [role] }, "profile.assigned");
      return c.json({
        profileId,
        name: profile.name,
        reason: `Chosen by hand → '${profile.name}'`,
        source: "you",
      } satisfies RoleProfile);
    },
  );
}
