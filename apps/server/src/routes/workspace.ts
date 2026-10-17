import { deleteWorkspace } from "@jobfilly/db";
import { DeleteWorkspaceInputSchema } from "@jobfilly/schema";
import { Hono } from "hono";
import { NOT_FOUND, requireRole, validJson, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { endAccess } from "./account";

// Deleting a workspace (MVP 3, F7.2): DELETE /api/workspaces/:workspaceId with its name typed in
// (DeleteWorkspaceInputSchema). Only its owner can. Everything it holds in Postgres goes,
// credentials, CV files and the activity log included; drafts and mail in the mailbox stay there.
// Mounted on the workspace's own path, behind the membership check.

export function workspaceRoutes(deps: AppDeps) {
  return new Hono<WorkspaceEnv>().delete(
    "/",
    requireRole("admin"),
    validJson(DeleteWorkspaceInputSchema),
    async (c) => {
      const membership = c.get("membership");
      if (!membership.isOwner) {
        return c.json(
          { error: "not_owner", message: "Only the owner can delete the workspace" },
          403,
        );
      }
      if (c.req.valid("json").name !== membership.name) {
        return c.json(
          { error: "name_mismatch", message: "Type the workspace's name exactly as it is shown" },
          400,
        );
      }
      const workspaceId = c.get("workspaceId");
      const deleted = await deleteWorkspace(deps.db, workspaceId);
      if (!deleted) return c.json(NOT_FOUND, 404);
      c.get("log").info("workspace.deleted");
      await endAccess(deps, [{ workspaceId, userIds: deleted.memberIds }]);
      return c.body(null, 204);
    },
  );
}
