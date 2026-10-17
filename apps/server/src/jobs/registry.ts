import { SCAN_RUN_JOB } from "@jobfilly/db";
import {
  PIPELINE_REEVALUATE_JOB,
  PipelineReevaluatePayloadSchema,
  ScanRunPayloadSchema,
} from "@jobfilly/schema";
import { cvJobs } from "../cvs/jobs";
import { draftJobs } from "../drafts/jobs";
import { pipelineReevaluateHandler } from "../pipeline/reevaluate";
import { sendJobs } from "../send/jobs";
import { syncJobs } from "../sync/jobs";
import { defineJob, type JobRegistry } from "./queue";
import { scanRunHandler } from "./scan/index";

// Every job type the queue runs, with its payload schema and handler. The slices register theirs
// in their own module (sync/jobs.ts, cvs/jobs.ts, drafts/jobs.ts; MVP 3: send/jobs.ts), spread in
// here.
export const jobRegistry: JobRegistry = {
  [SCAN_RUN_JOB]: defineJob(ScanRunPayloadSchema, scanRunHandler),
  [PIPELINE_REEVALUATE_JOB]: defineJob(PipelineReevaluatePayloadSchema, pipelineReevaluateHandler),
  ...syncJobs,
  ...cvJobs,
  ...draftJobs,
  ...sendJobs,
};
