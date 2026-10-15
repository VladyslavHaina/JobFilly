import { IdSchema, type ProfileHistoryList } from "@jobfilly/schema";
import { Hono } from "hono";
import { z } from "zod";
import { NOT_FOUND, requireRole, validParam, type WorkspaceEnv } from "../access";
import { listHistory, undoChange } from "../assistant/history";
import type { AppDeps } from "../deps";

// The profile history (F8.4): every applied change with who, when, the source and the request,
// and Undo, which restores the previous state through the profile change service. Mounted at
// /api/workspaces/:workspaceId/profiles next to routes/profiles.ts. Viewers read it; Undo takes
// an editor.

const ProfileParamsSchema = z.object({ profileId: IdSchema });
const EntryParamsSchema = z.object({ profileId: IdSchema, entryId: IdSchema });

export function historyRoutes(deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get(
      "/:profileId/history",
      requireRole("viewer"),
      validParam(ProfileParamsSchema),
      async (c) => {
        const items = await listHistory(deps, c.get("workspaceId"), c.req.valid("param").profileId);
        if (!items) return c.json(NOT_FOUND, 404);
        return c.json({ items } satisfies ProfileHistoryList);
      },
    )
    .post(
      "/:profileId/history/:entryId/undo",
      requireRole("editor"),
      validParam(EntryParamsSchema),
      async (c) => {
        const result = await undoChange(
          deps,
          c.get("workspaceId"),
          c.get("user"),
          c.req.valid("param"),
          c.get("log"),
        );
        return result.ok ? c.json(result.data) : c.json(result.body, result.status);
      },
    );
}
