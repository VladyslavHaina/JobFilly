import { Hono } from "hono";
import { requireRole, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { notImplemented } from "./not-implemented";

// Reassigning a role to another profile by hand (MVP 3, F1.3): PUT
// /:messageId/roles/:position/profile (RoleProfileInputSchema); matching, CV choice and drafting
// then use that profile. Built by the profiles slice. Mounted at
// /api/workspaces/:workspaceId/messages next to routes/messages.ts (job mail only for a member
// who sees the pipeline only, requireJobMail).

export function assignmentRoutes(_deps: AppDeps) {
  return new Hono<WorkspaceEnv>().put(
    "/:messageId/roles/:position/profile",
    requireRole("editor"),
    notImplemented,
  );
}
