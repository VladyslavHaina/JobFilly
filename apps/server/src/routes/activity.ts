import { Hono } from "hono";
import { requireRole, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { notImplemented } from "./not-implemented";

// The activity log (MVP 3, F9.1): GET / lists outward and sharing actions, newest first
// (ActivityListSchema, ActivityQuerySchema). Built by the workspace-admin slice. Mounted at
// /api/workspaces/:workspaceId/activity, admins only.

export function activityRoutes(_deps: AppDeps) {
  return new Hono<WorkspaceEnv>().get("/", requireRole("admin"), notImplemented);
}
