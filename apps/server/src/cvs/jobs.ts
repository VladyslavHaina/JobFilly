import type { JobRegistry } from "../jobs/queue";

// The cv.read job (F2.1): reads one uploaded CV with cv.v1, dedupe key cv:<cvId>. Registered
// here, spread into jobs/registry.ts; the cvs-senders slice adds it.
export const cvJobs: JobRegistry = {};
