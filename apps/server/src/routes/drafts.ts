import { Hono } from "hono";
import { requireRole, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { notImplemented } from "./not-implemented";

// Drafts (F6): list, Draft a reply for a role, read, edit (replaces the mailbox copy), discard
// (deletes it from the mailbox). Viewers read, editors change (F6.7). Mounted once at
// /api/workspaces/:workspaceId/drafts. Pinned by the foundation; the replies slice writes the
// handlers.

export function draftsRoutes(_deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get("/", requireRole("viewer"), notImplemented)
    .post("/", requireRole("editor"), notImplemented)
    .get("/:draftId", requireRole("viewer"), notImplemented)
    .patch("/:draftId", requireRole("editor"), notImplemented)
    .post("/:draftId/discard", requireRole("editor"), notImplemented);
}
