import { type Context, Hono } from "hono";
import type { WorkspaceEnv } from "../access/env";
import { requireRole } from "../access/membership";
import type { AppDeps } from "../deps";

// The job inbox: list, detail, body on demand, category correction (F5; job-inbox slice).
// :messageId is the URL-encoded RFC Message-ID.
// Mounted once at /api/workspaces/:workspaceId/messages; each handler applies its own role.
// The owning slice replaces these 501 answers and keeps the names.

const notBuilt = (c: Context<WorkspaceEnv>) =>
  c.json({ error: "not_implemented", message: "Not available yet" }, 501);

export function messageRoutes(_deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get("/", requireRole("viewer"), notBuilt)
    .get("/:messageId", requireRole("viewer"), notBuilt)
    .get("/:messageId/body", requireRole("viewer"), notBuilt)
    .put("/:messageId/category", requireRole("editor"), notBuilt);
}
