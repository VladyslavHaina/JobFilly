import { deleteWorkspace } from "@jobfilly/db";
import { DeleteWorkspaceInputSchema } from "@jobfilly/schema";
import { Hono } from "hono";
import { NOT_FOUND, requireRole, validJson, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { endAccess, isOwnPassword, WRONG_PASSWORD } from "./account";

// Deleting a workspace (MVP 3, F7.2): DELETE /api/workspaces/:workspaceId with its name typed in
// and the owner's password, as deleting an account asks (DeleteWorkspaceInputSchema; a wrong one
// answers 403). Only its owner can. Everything it holds in Postgres goes,
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
      const input = c.req.valid("json");
      if (input.name !== membership.name) {
        return c.json(
          { error: "name_mismatch", message: "Type the workspace's name exactly as it is shown" },
          400,
        );
      }
      if (!(await isOwnPassword(deps, c.get("user"), input.password))) {
        return c.json(WRONG_PASSWORD, 403);
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
