import { type Context, Hono } from "hono";
import type { WorkspaceEnv } from "../access/env";
import { requireRole } from "../access/membership";
import type { AppDeps } from "../deps";

// The intake form: proposals, answers, confirm (F6; intake-profile slice).
// Mounted once at /api/workspaces/:workspaceId/intake; each handler applies its own role.
// The owning slice replaces these 501 answers and keeps the names.

const notBuilt = (c: Context<WorkspaceEnv>) =>
  c.json({ error: "not_implemented", message: "Not available yet" }, 501);

export function intakeRoutes(_deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get("/", requireRole("viewer"), notBuilt)
    .put("/answers/:key", requireRole("editor"), notBuilt)
    .post("/confirm", requireRole("editor"), notBuilt);
}
