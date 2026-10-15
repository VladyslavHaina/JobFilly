import { Hono } from "hono";
import { requireRole, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { notImplemented } from "./not-implemented";

// The decision inbox (F7): list, the open count for the navigation, answer, Not now, Don't ask
// for this message. Viewers see decisions but can't answer them (F7.7). Mounted once at
// /api/workspaces/:workspaceId/decisions. Pinned by the foundation; the replies slice writes the
// handlers.

export function decisionsRoutes(_deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get("/", requireRole("viewer"), notImplemented)
    .get("/count", requireRole("viewer"), notImplemented)
    .post("/:decisionId/answer", requireRole("editor"), notImplemented)
    .post("/:decisionId/not-now", requireRole("editor"), notImplemented)
    .post("/:decisionId/dismiss", requireRole("editor"), notImplemented);
}
