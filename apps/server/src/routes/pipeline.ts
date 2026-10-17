import { Hono } from "hono";
import { requireRole, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { notImplemented } from "./not-implemented";

// The application pipeline (MVP 3, F5): GET / groups every role by stage (PipelineSchema); PUT
// /stage sets one by hand (SetStageInputSchema), or goes back to the derived stage. Built by the
// applications slice. Mounted at /api/workspaces/:workspaceId/pipeline, open to a member who sees
// the pipeline only.

export function pipelineRoutes(_deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get("/", requireRole("viewer"), notImplemented)
    .put("/stage", requireRole("editor"), notImplemented);
}
