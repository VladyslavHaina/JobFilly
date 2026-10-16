import { overrideReason } from "@jobfilly/core";
import { setRoleCvChoice } from "@jobfilly/db";
import type { CvChoice } from "@jobfilly/schema";
import type { AppDeps } from "../deps";
import { requestReevaluation } from "../profile/changes";

// An editor's CV choice for one role (F2.3), behind PUT /messages/:messageId/roles/:position/cv:
// a CV id, or null to go back to the automatic choice. That role is then re-evaluated with it
// (its match uses the chosen CV's skills), within the minute the pipeline takes.

export type CvOverrideResult =
  | { ok: true; cvChoice: CvChoice | null }
  | { ok: false; error: "not_found" | "unknown_cv" };

export async function setCvOverride(
  deps: AppDeps,
  ws: string,
  input: { messageId: string; position: number; cvId: string | null; userId: string },
): Promise<CvOverrideResult> {
  const result = await setRoleCvChoice(deps.db, ws, { ...input, at: deps.clock.now() });
  if (!result.ok) return result;
  const role = { messageId: input.messageId, position: input.position };
  await requestReevaluation(deps, ws, { roles: [role] }, "cv.override");
  return {
    ok: true,
    // Null: back to automatic, which the re-evaluation chooses.
    cvChoice: result.cv
      ? { cvId: result.cv.id, reason: overrideReason(result.cv.name), source: "you" }
      : null,
  };
}
