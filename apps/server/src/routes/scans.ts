import { type Context, Hono } from "hono";
import { requireRole, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";

// Scan runs: current progress, start, cancel, analyze the rest (F4; scan slice).
// Mounted once at /api/workspaces/:workspaceId/scans; each handler applies its own role.
// The owning slice replaces these 501 answers and keeps the names.

const notBuilt = (c: Context<WorkspaceEnv>) =>
  c.json({ error: "not_implemented", message: "Not available yet" }, 501);

export function scanRoutes(_deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get("/current", requireRole("viewer"), notBuilt)
    .post("/", requireRole("admin"), notBuilt)
    .post("/:scanId/cancel", requireRole("admin"), notBuilt)
    .post("/analyze-rest", requireRole("admin"), notBuilt);
}
