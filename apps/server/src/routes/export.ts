import { recordActivity } from "@jobfilly/db";
import { Hono } from "hono";
import { requireRole, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { exportZip } from "../export/zip";

// The workspace as one streamed ZIP (MVP 3, F7.1): GET / (EXPORT_PARTS, ExportManifestSchema).
// Mounted at /api/workspaces/:workspaceId/export, admins only, and closed to a member who sees the
// pipeline only (it holds drafts and every message's metadata, D25).

export function exportRoutes(deps: AppDeps) {
  return new Hono<WorkspaceEnv>().get("/", requireRole("admin"), (c) => {
    const membership = c.get("membership");
    const userId = c.get("user").id;
    const log = c.get("log");
    const day = deps.clock.now().toISOString().slice(0, 10);
    const stream = exportZip(deps, { id: membership.id, name: membership.name }, async () => {
      await recordActivity(
        deps.db,
        membership.id,
        {
          kind: "export.downloaded",
          actor: { kind: "user", userId },
          targetUserId: null,
          refs: {},
        },
        deps.clock.now(),
      );
      log.info("export.completed");
    });
    return c.body(stream, 200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="jobfilly-export-${day}.zip"`,
    });
  });
}
