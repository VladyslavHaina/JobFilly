import { Hono } from "hono";
import { requireRole, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { notImplemented } from "./not-implemented";

// A profile's rules (F3): list, switch on or off, remove; every change goes through the profile
// change service. Mounted at /api/workspaces/:workspaceId/profiles next to routes/profiles.ts.
// Pinned by the foundation; the rules-match slice writes the handlers.

export function rulesRoutes(_deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get("/:profileId/rules", requireRole("viewer"), notImplemented)
    .patch("/:profileId/rules/:ruleId", requireRole("editor"), notImplemented)
    .delete("/:profileId/rules/:ruleId", requireRole("editor"), notImplemented);
}
