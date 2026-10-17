import { checkSkills, tagsAfterRead } from "@jobfilly/core";
import { findCvReadByHash, getAiSettings, getCv, markCvReadFailed, saveCvRead } from "@jobfilly/db";
import { CV_READ_JOB, type CvReadOutput, CvReadPayloadSchema } from "@jobfilly/schema";
import { aiClientFor } from "../ai-usage";
import type { AppDeps } from "../deps";
import { defineJob, type JobRegistry } from "../jobs/queue";
import { failureFields } from "../log";
import { requestReevaluation } from "../profile/changes";
import { openAiKey } from "../secrets";

// The cv.read job (F2.1, F2.2): reads one uploaded CV with cv.v1, keyed by its content hash
// (dedupe key cv:<cvId>). The same file already read in the workspace is not read again. Every
// skill the model names is checked against the CV text, and one that isn't there is dropped and
// logged as cv.skill_dropped (F2.2). The language, role families and seniority become the CV's
// suggested tags; the skills and format hints are edited as lists of their own. A finished read
// can change every role's CV choice, so the profile's roles are re-evaluated. A read that fails
// leaves the CV marked failed, and so does a job that throws before the read is saved (a database
// error, an AI client that throws): a failed job isn't retried, and a CV left pending would show
// "Reading…" for good, where a failed one tells the user to upload it again. Once the read is
// saved the CV stays read, and its re-evaluation is asked for once more if asking fails.
// Registered here, spread into jobs/registry.ts.

/** Reads the CV and saves what was read; true when it was saved (so it is to be re-evaluated). */
async function readCv(deps: AppDeps, ws: string, cvId: string): Promise<boolean> {
  const log = deps.log.child({ workspaceId: ws, cvId });
  const cv = await getCv(deps.db, ws, cvId);
  if (!cv) return false;
  const text = cv.text ?? "";

  let read: CvReadOutput | null = await findCvReadByHash(deps.db, ws, cv.contentHash);
  if (!read) {
    const settings = await getAiSettings(deps.db, ws);
    if (!settings) {
      await markCvReadFailed(deps.db, ws, cvId, deps.clock.now());
      await deps.live.publish(ws, { type: "cvs.updated", data: {} });
      return false;
    }
    const client = aiClientFor(deps, ws, {
      provider: settings.provider,
      baseUrl: settings.baseUrl,
      models: settings.models,
      apiKey: openAiKey(deps.config.secretKey, settings.keyCiphertext),
    });
    const result = await client.readCv({
      contentHash: cv.contentHash,
      fileName: cv.fileName,
      text,
    });
    if (!result.ok) {
      await markCvReadFailed(deps.db, ws, cvId, deps.clock.now());
      await deps.live.publish(ws, { type: "cvs.updated", data: {} });
      return false;
    }
    read = result.data;
  }

  const { kept, dropped } = checkSkills(read.skills, text);
  // Neither the skills nor the CV's text are logged (ARCHITECTURE › Logs): only how many.
  if (dropped.length > 0) log.warn("cv.skill_dropped", { dropped: dropped.length });
  const checked: CvReadOutput = { ...read, skills: kept };
  await saveCvRead(deps.db, ws, cvId, {
    metadata: checked,
    tags: tagsAfterRead(checked, cv.tags),
    at: deps.clock.now(),
  });
  return true;
}

/** What a saved read asks for: the CV list refreshed, and every role re-evaluated. */
async function afterRead(deps: AppDeps, ws: string): Promise<void> {
  await deps.live.publish(ws, { type: "cvs.updated", data: {} });
  await requestReevaluation(deps, ws, { all: true }, "cv.read");
}

export const cvJobs: JobRegistry = {
  [CV_READ_JOB]: defineJob(CvReadPayloadSchema, async ({ deps, payload, signal }) => {
    const { workspaceId: ws, cvId } = payload;
    const log = deps.log.child({ workspaceId: ws, cvId });
    let saved: boolean;
    try {
      saved = await readCv(deps, ws, cvId);
    } catch (error) {
      // Stopped by a shutdown or a lost lease, the job runs again: the CV is still being read.
      if (!signal.aborted) {
        log.warn("cv.read_failed", { ...failureFields(error) });
        try {
          await markCvReadFailed(deps.db, ws, cvId, deps.clock.now());
          await deps.live.publish(ws, { type: "cvs.updated", data: {} });
        } catch {
          // The database is gone too; the job's own failure (job.failed) is logged below.
        }
      }
      throw error;
    }
    if (!saved) return;
    try {
      await afterRead(deps, ws);
    } catch (error) {
      log.warn("cv.read_failed", { ...failureFields(error), step: "reevaluate" });
      await afterRead(deps, ws);
    }
  }),
};
