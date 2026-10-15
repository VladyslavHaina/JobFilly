import { type Context, Hono } from "hono";
import { requireRole, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";

// The workspace's mailbox: presets, test, connect, disconnect (F2; connect slice).
// Mounted once at /api/workspaces/:workspaceId/mailboxes; each handler applies its own role.
// The owning slice replaces these 501 answers and keeps the names.

const notBuilt = (c: Context<WorkspaceEnv>) =>
  c.json({ error: "not_implemented", message: "Not available yet" }, 501);

export function mailboxRoutes(_deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get("/", requireRole("viewer"), notBuilt)
    .get("/presets", requireRole("viewer"), notBuilt)
    .post("/test", requireRole("admin"), notBuilt)
    .post("/", requireRole("admin"), notBuilt)
    .delete("/:mailboxId", requireRole("admin"), notBuilt);
}
