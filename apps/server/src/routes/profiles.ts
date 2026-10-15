import { listProfiles, updateProfile } from "@jobfilly/db";
import {
  IdSchema,
  isPolicyKey,
  type Profile,
  type ProfileList,
  ProfilePatchSchema,
} from "@jobfilly/schema";
import { Hono } from "hono";
import { z } from "zod";
import { NOT_FOUND, requireRole, validJson, validParam, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { applyAndReevaluate } from "../profile/changes";

// Profiles: list and edit (F6.5). Confirm (routes/intake.ts) creates the workspace's profile;
// here it is read with every entry's source, renamed, and its answers changed by hand. A changed
// answer is a Change `update` (source "you") through the profile change service, so it is in the
// profile history and every role is re-evaluated (F4.6). The form changes only the questions the
// profile has, and the policy keys (reply_threshold, reply_window_days).
// Mounted once at /api/workspaces/:workspaceId/profiles; each handler applies its own role.

const ProfileParamsSchema = z.object({ profileId: IdSchema });

const NO_SUCH_QUESTION = { error: "invalid", message: "The profile has no such question" } as const;

export function profileRoutes(deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get("/", requireRole("viewer"), async (c) => {
      const items = await listProfiles(deps.db, c.get("workspaceId"));
      return c.json({ items } satisfies ProfileList);
    })
    .patch(
      "/:profileId",
      requireRole("editor"),
      validParam(ProfileParamsSchema),
      validJson(ProfilePatchSchema),
      async (c) => {
        const workspaceId = c.get("workspaceId");
        const { profileId } = c.req.valid("param");
        const patch = c.req.valid("json");
        const current = (await listProfiles(deps.db, workspaceId)).find((p) => p.id === profileId);
        if (!current) return c.json(NOT_FOUND, 404);
        const entries = patch.entries ?? [];
        const known = new Set(current.entries.map((e) => e.key));
        if (entries.some((e) => !known.has(e.key) && !isPolicyKey(e.key))) {
          return c.json(NO_SUCH_QUESTION, 400);
        }
        let profile: Profile = current;
        if (entries.length > 0) {
          const result = await applyAndReevaluate(
            deps,
            workspaceId,
            profileId,
            entries.map((e) => ({ op: "update", target: "entry", key: e.key, value: e.value })),
            { source: "you", userId: c.get("user").id, request: null },
          );
          if (!result) return c.json(NOT_FOUND, 404);
          if (!result.ok) return c.json(NO_SUCH_QUESTION, 400);
          profile = result.profile;
        }
        if (patch.name !== undefined && patch.name !== profile.name) {
          const name = patch.name;
          const renamed = await updateProfile(
            deps.db,
            workspaceId,
            profileId,
            (p) => ({ ok: true, name, entries: p.entries }),
            deps.clock.now(),
          );
          if (!renamed?.ok) return c.json(NOT_FOUND, 404);
          profile = renamed.profile;
        }
        await deps.live.publish(workspaceId, { type: "intake.updated", data: {} });
        return c.json(profile satisfies Profile);
      },
    );
}
