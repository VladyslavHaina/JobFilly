import { Hono } from "hono";
import { requireRole, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { notImplemented } from "./not-implemented";

// Sender marks (F5.4): an editor marks an address or a domain trusted or blocked, or clears it.
// Mounted once at /api/workspaces/:workspaceId/senders. Pinned by the foundation; the cvs-senders
// slice writes the handler.

export function sendersRoutes(_deps: AppDeps) {
  return new Hono<WorkspaceEnv>().put("/marks", requireRole("editor"), notImplemented);
}
