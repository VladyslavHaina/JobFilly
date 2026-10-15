import { Hono } from "hono";
import { requireRole, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { notImplemented } from "./not-implemented";

// The profile history (F8.4): every applied change with who, when, the source and the request,
// and Undo, which restores the previous state through the profile change service. Mounted at
// /api/workspaces/:workspaceId/profiles next to routes/profiles.ts. Pinned by the foundation;
// the assistant slice writes the handlers.

export function historyRoutes(_deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get("/:profileId/history", requireRole("viewer"), notImplemented)
    .post("/:profileId/history/:entryId/undo", requireRole("editor"), notImplemented);
}
