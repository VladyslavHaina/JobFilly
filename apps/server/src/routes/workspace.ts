import { Hono } from "hono";
import { requireRole, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { notImplemented } from "./not-implemented";

// Deleting a workspace (MVP 3, F7.2): DELETE /api/workspaces/:workspaceId with its name typed in
// (DeleteWorkspaceInputSchema). Built by the workspace-admin slice. Mounted on the workspace's own
// path, behind the membership check.

export function workspaceRoutes(_deps: AppDeps) {
  return new Hono<WorkspaceEnv>().delete("/", requireRole("admin"), notImplemented);
}
