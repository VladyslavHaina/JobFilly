import type { CvChoice } from "@jobfilly/schema";
import type { AppDeps } from "../deps";

// An editor's CV choice for one role (F2.3), behind PUT /messages/:messageId/roles/:position/cv:
// a CV id, or null to go back to the automatic choice; the role is then re-evaluated. Written by
// the cvs-senders slice; until then it answers not_implemented (501).

export type CvOverrideResult =
  | { ok: true; cvChoice: CvChoice | null }
  | { ok: false; error: "not_found" | "unknown_cv" | "not_implemented" };

export async function setCvOverride(
  _deps: AppDeps,
  _ws: string,
  _input: { messageId: string; position: number; cvId: string | null; userId: string },
): Promise<CvOverrideResult> {
  return { ok: false, error: "not_implemented" };
}
