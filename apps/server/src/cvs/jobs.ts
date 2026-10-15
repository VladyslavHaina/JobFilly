import { checkSkills, tagsAfterRead } from "@jobfilly/core";
import { findCvReadByHash, getAiSettings, getCv, markCvReadFailed, saveCvRead } from "@jobfilly/db";
import { CV_READ_JOB, type CvReadOutput, CvReadPayloadSchema } from "@jobfilly/schema";
import { aiClientFor } from "../ai-usage";
import type { AppDeps } from "../deps";
import { defineJob, type JobRegistry } from "../jobs/queue";
import { requestReevaluation } from "../profile/changes";
import { openAiKey } from "../secrets";

// The cv.read job (F2.1, F2.2): reads one uploaded CV with cv.v1, keyed by its content hash
// (dedupe key cv:<cvId>). The same file already read in the workspace is not read again. Every
// skill the model names is checked against the CV text, and one that isn't there is dropped and
// logged as cv.skill_dropped (F2.2). The language, role families, seniority and format hints
// become the CV's suggested tags. A finished read can change every role's CV choice, so the
// profile's roles are re-evaluated. A read that fails leaves the CV marked failed.
// Registered here, spread into jobs/registry.ts.

type CvReadOutcome = "done" | "failed" | "gone";

async function readCv(deps: AppDeps, ws: string, cvId: string): Promise<CvReadOutcome> {
  const log = deps.log.child({ workspaceId: ws, cvId });
  const cv = await getCv(deps.db, ws, cvId);
  if (!cv) return "gone";
  const text = cv.text ?? "";

  let read: CvReadOutput | null = await findCvReadByHash(deps.db, ws, cv.contentHash);
  if (!read) {
    const settings = await getAiSettings(deps.db, ws);
    if (!settings) {
      await markCvReadFailed(deps.db, ws, cvId, deps.clock.now());
      await deps.live.publish(ws, { type: "cvs.updated", data: {} });
      return "failed";
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
      return "failed";
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
  await deps.live.publish(ws, { type: "cvs.updated", data: {} });
  await requestReevaluation(deps, ws, { all: true }, "cv.read");
  return "done";
}

export const cvJobs: JobRegistry = {
  [CV_READ_JOB]: defineJob(CvReadPayloadSchema, async (ctx) => {
    await readCv(ctx.deps, ctx.payload.workspaceId, ctx.payload.cvId);
  }),
};
