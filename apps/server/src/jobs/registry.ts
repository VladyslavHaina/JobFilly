import { SCAN_RUN_JOB } from "@jobfilly/db";
import { ScanRunPayloadSchema } from "@jobfilly/schema";
import { defineJob, type JobRegistry } from "./queue";
import { scanRunHandler } from "./scan/index";

// Every job type the queue runs, with its payload schema and handler.
export const jobRegistry: JobRegistry = {
  [SCAN_RUN_JOB]: defineJob(ScanRunPayloadSchema, scanRunHandler),
};
