import { patchEntries } from "@jobfilly/core";
import { listProfiles, updateProfile } from "@jobfilly/db";
import { IdSchema, type Profile, type ProfileList, ProfilePatchSchema } from "@jobfilly/schema";
import { Hono } from "hono";
import { z } from "zod";
import { NOT_FOUND, requireRole, validJson, validParam, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";

// Profiles: list and edit (F6.5). Confirm (routes/intake.ts) creates the workspace's profile;
// here it is read with every entry's source, renamed, and its answers changed by hand, each
// change then recorded as the user's (source "you").
// Mounted once at /api/workspaces/:workspaceId/profiles; each handler applies its own role.

const ProfileParamsSchema = z.object({ profileId: IdSchema });

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
        const patch = c.req.valid("json");
        const now = deps.clock.now();
        const result = await updateProfile(
          deps.db,
          workspaceId,
          c.req.valid("param").profileId,
          (current) => {
            const patched = patchEntries(current.entries, patch.entries ?? [], {
              userId: c.get("user").id,
              at: now.toISOString(),
            });
            if (!patched.ok) return { ok: false, error: patched.unknownKey };
            return { ok: true, name: patch.name ?? current.name, entries: patched.entries };
          },
          now,
        );
        if (!result) return c.json(NOT_FOUND, 404);
        if (!result.ok) {
          return c.json({ error: "invalid", message: "The profile has no such question" }, 400);
        }
        await deps.live.publish(workspaceId, { type: "intake.updated", data: {} });
        return c.json(result.profile satisfies Profile);
      },
    );
}
