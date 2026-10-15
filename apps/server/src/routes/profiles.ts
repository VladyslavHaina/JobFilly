import { type Context, Hono } from "hono";
import { requireRole, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";

// Profiles: list and edit (F6; intake-profile slice).
// Mounted once at /api/workspaces/:workspaceId/profiles; each handler applies its own role.
// The owning slice replaces these 501 answers and keeps the names.

const notBuilt = (c: Context<WorkspaceEnv>) =>
  c.json({ error: "not_implemented", message: "Not available yet" }, 501);

export function profileRoutes(_deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get("/", requireRole("viewer"), notBuilt)
    .patch("/:profileId", requireRole("editor"), notBuilt);
}
