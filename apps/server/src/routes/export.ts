import { Hono } from "hono";
import { requireRole, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { notImplemented } from "./not-implemented";

// The workspace as one streamed ZIP (MVP 3, F7.1): GET / (EXPORT_PARTS, ExportManifestSchema).
// Built by the workspace-admin slice. Mounted at /api/workspaces/:workspaceId/export, closed to a
// member who sees the pipeline only (it holds drafts and every message's metadata).

export function exportRoutes(_deps: AppDeps) {
  return new Hono<WorkspaceEnv>().get("/", requireRole("admin"), notImplemented);
}
