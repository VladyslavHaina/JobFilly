import { Hono } from "hono";
import { requireRole, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { notImplemented } from "./not-implemented";

// Sending one draft (MVP 3, F4): GET /:draftId/send is the confirmation with its token
// (SendPreviewSchema), POST confirms it (SendConfirmSchema) and schedules the send
// SEND_DELAY_SECONDS ahead, DELETE is Undo while it waits. Viewers can't send (F4.5). Built by
// the send slice. Mounted at /api/workspaces/:workspaceId/drafts, closed to a member who sees the
// pipeline only.

export function sendRoutes(_deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get("/:draftId/send", requireRole("editor"), notImplemented)
    .post("/:draftId/send", requireRole("editor"), notImplemented)
    .delete("/:draftId/send", requireRole("editor"), notImplemented);
}
