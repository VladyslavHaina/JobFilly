import { Hono } from "hono";
import { requireRole, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { notImplemented } from "./not-implemented";

// CVs (F2): list, upload (multipart, at most 5 MB, PDF or DOCX), tags, delete, download.
// Mounted once at /api/workspaces/:workspaceId/cvs; viewers read, editors change. The routes and
// their guards are pinned by the foundation; the cvs-senders slice writes the handlers.

export function cvsRoutes(_deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get("/", requireRole("viewer"), notImplemented)
    .post("/", requireRole("editor"), notImplemented)
    .patch("/:cvId", requireRole("editor"), notImplemented)
    .delete("/:cvId", requireRole("editor"), notImplemented)
    .get("/:cvId/file", requireRole("viewer"), notImplemented);
}
