import { listProfiles, listRules, setProfileEnabled, updateProfile } from "@jobfilly/db";
import {
  type Change,
  isPolicyKey,
  type Profile,
  type ProfileChangeResult,
  type ProfileList,
  ProfileParamsSchema,
  ProfilePatchSchema,
} from "@jobfilly/schema";
import { Hono } from "hono";
import { NOT_FOUND, requireRole, validJson, validParam, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { applyAndReevaluate, requestReevaluation } from "../profile/changes";
import { changedRoles } from "../profile/impact";

// Profiles: list and edit (F6.5; MVP 3 F1.2, F2.1, F2.3). Confirm (routes/intake.ts) creates
// them; here each is read with every entry's source, renamed, switched on or off, and its answers
// changed by hand. A changed answer is a Change `update` (source "you") through the profile change
// service, so it is in the profile history and every role is re-evaluated (F4.6); the answer says
// how many of the profile's roles it changes (profile/impact.ts). The form changes only the
// questions the profile has, and the policy keys (reply_threshold, reply_window_days).
//
// Several profiles can be on; at least one stays on (409 for the last one). A profile that is off
// keeps its entries and rules but gets no roles: switching one on or off re-evaluates every role,
// which moves roles between profiles (pipeline/assign.ts).
// Mounted once at /api/workspaces/:workspaceId/profiles; each handler applies its own role.

const NO_SUCH_QUESTION = { error: "invalid", message: "The profile has no such question" } as const;
const LAST_ON = {
  error: "last_on",
  message: "At least one profile stays on. Switch another one on first.",
} as const;

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
        const userId = c.get("user").id;
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
        let changed = 0;
        if (patch.enabled !== undefined && patch.enabled !== (current.enabled ?? true)) {
          const switched = await setProfileEnabled(
            deps.db,
            workspaceId,
            profileId,
            patch.enabled,
            deps.clock.now(),
          );
          if (!switched) return c.json(NOT_FOUND, 404);
          if (!switched.ok) return c.json(LAST_ON, 409);
          profile = switched.profile;
          c.get("log").info("profile.updated", { profileId, enabled: patch.enabled });
          await requestReevaluation(deps, workspaceId, { all: true }, "profile.enabled");
        }
        if (entries.length > 0) {
          const changes: Change[] = entries.map((e) => ({
            op: "update",
            target: "entry",
            key: e.key,
            value: e.value,
          }));
          changed = await changedRoles(deps, workspaceId, {
            profile,
            rules: await listRules(deps.db, workspaceId, profileId),
            changes,
            userId,
          });
          const result = await applyAndReevaluate(deps, workspaceId, profileId, changes, {
            source: "you",
            userId,
            request: null,
          });
          if (!result) return c.json(NOT_FOUND, 404);
          if (!result.ok) return c.json(NO_SUCH_QUESTION, 400);
          profile = result.profile;
          c.get("log").info("profile.updated", { profileId, keys: entries.length, changed });
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
        await deps.live.publish(workspaceId, { type: "profiles.updated", data: {} });
        return c.json({ ...profile, changed } satisfies ProfileChangeResult);
      },
    );
}
