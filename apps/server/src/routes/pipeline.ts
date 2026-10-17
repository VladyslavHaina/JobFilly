import { type PipelineItem, SetStageInputSchema } from "@jobfilly/schema";
import { Hono } from "hono";
import { NOT_FOUND, requireRole, validJson, type WorkspaceEnv } from "../access";
import { loadPipeline, setStage } from "../applications/load";
import type { AppDeps } from "../deps";

// The application pipeline (MVP 3, F5): GET / groups every role by stage (PipelineSchema); PUT
// /stage sets the stage of the item a role is in by hand (SetStageInputSchema), or with null
// goes back to the derived stage, and answers the item. Viewers read, editors change. Mounted at
// /api/workspaces/:workspaceId/pipeline, open to a member who sees the pipeline only (D14): it
// holds the roles of job mail only, so a role of other mail is a 404 for everyone.

export function pipelineRoutes(deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get("/", requireRole("viewer"), async (c) =>
      c.json(await loadPipeline(deps, c.get("workspaceId"))),
    )
    .put("/stage", requireRole("editor"), validJson(SetStageInputSchema), async (c) => {
      const ws = c.get("workspaceId");
      const userId = c.get("user").id;
      const item = await setStage(
        deps,
        ws,
        { ...c.req.valid("json"), userId },
        deps.log.child({ workspaceId: ws, userId }),
      );
      if (!item) return c.json(NOT_FOUND, 404);
      return c.json(item satisfies PipelineItem);
    });
}
