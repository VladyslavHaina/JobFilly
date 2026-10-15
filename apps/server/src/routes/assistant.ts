import { Hono } from "hono";
import { requireRole, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { notImplemented } from "./not-implemented";

// The assistant (F8): the user's thread, sending a message, editing a proposal before Apply,
// Apply and Discard. Viewers can chat but can't apply (F8.8): sending and discarding take a
// viewer, editing and applying an editor. Mounted once at /api/workspaces/:workspaceId/assistant.
// Pinned by the foundation; the assistant slice writes the handlers.

export function assistantRoutes(_deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get("/", requireRole("viewer"), notImplemented)
    .post("/", requireRole("viewer"), notImplemented)
    .patch("/proposals/:proposalId", requireRole("editor"), notImplemented)
    .post("/proposals/:proposalId/apply", requireRole("editor"), notImplemented)
    .post("/proposals/:proposalId/discard", requireRole("viewer"), notImplemented);
}
