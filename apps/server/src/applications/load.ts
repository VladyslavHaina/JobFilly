import { buildPipeline } from "@jobfilly/core";
import { loadPipelineRows, setRoleStage } from "@jobfilly/db";
import type { Pipeline, PipelineItem, RoleRef, SetStageInput } from "@jobfilly/schema";
import type { AppDeps } from "../deps";
import type { Logger } from "../log";

// The application pipeline (MVP 3, F5): derived on read from the mail, the replies sent and the
// stages set by hand (D15, @jobfilly/core buildPipeline). loadPipeline is what GET /pipeline
// answers, and what the assistant reads (the plan's contract). Only job mail goes in, so a member
// who sees the pipeline only may have all of it (D14).

/** Every role of the workspace by stage. */
export async function loadPipeline(
  deps: Pick<AppDeps, "db" | "clock">,
  workspaceId: string,
): Promise<Pipeline> {
  return buildPipeline(await loadPipelineRows(deps.db, workspaceId), deps.clock.now());
}

function itemOf(pipeline: Pipeline, role: RoleRef): PipelineItem | undefined {
  return pipeline.stages
    .flatMap((s) => s.items)
    .find((i) =>
      i.roles.some((r) => r.messageId === role.messageId && r.position === role.position),
    );
}

/**
 * An editor sets the stage of the item a role is in by hand, or with null goes back to the
 * derived one (F5.1); logged as pipeline.stage_changed. Answers the item as it is now, or null
 * when the pipeline has no such role (none, or not job mail).
 */
export async function setStage(
  deps: AppDeps,
  workspaceId: string,
  input: SetStageInput & { userId: string },
  log: Logger,
): Promise<PipelineItem | null> {
  const item = itemOf(await loadPipeline(deps, workspaceId), input.role);
  if (!item) return null;
  await setRoleStage(deps.db, workspaceId, {
    roles: item.roles,
    role: input.role,
    stage: input.stage,
    userId: input.userId,
    at: deps.clock.now(),
  });
  log.info("pipeline.stage_changed", {
    previousStage: item.stage,
    stage: input.stage ?? "derived",
  });
  await deps.live.publish(workspaceId, { type: "pipeline.updated", data: {} });
  return itemOf(await loadPipeline(deps, workspaceId), input.role) ?? null;
}
