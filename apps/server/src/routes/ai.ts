import { type Context, Hono } from "hono";
import { requireRole, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";

// The workspace's AI provider settings: read, save, test (F3; connect slice).
// Mounted once at /api/workspaces/:workspaceId/ai; each handler applies its own role.
// The owning slice replaces these 501 answers and keeps the names.

const notBuilt = (c: Context<WorkspaceEnv>) =>
  c.json({ error: "not_implemented", message: "Not available yet" }, 501);

export function aiRoutes(_deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get("/", requireRole("viewer"), notBuilt)
    .put("/", requireRole("admin"), notBuilt)
    .post("/test", requireRole("admin"), notBuilt);
}
