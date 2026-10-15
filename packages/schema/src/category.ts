import { z } from "zod";

// The categories of job mail, apart from messages.ts so the profile and the rules can name them
// without importing the inbox's shapes (which import theirs).

/** The nine categories of F5, in the order the UI lists them. */
export const CATEGORIES = [
  "recruiter_outreach",
  "job_alert",
  "application_update",
  "interview",
  "assessment",
  "offer",
  "rejection",
  "other_job",
  "not_job",
] as const;
export const CategorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof CategorySchema>;

/** The categories that count as job mail: every one except not_job. */
export const JOB_CATEGORIES = CATEGORIES.filter(
  (c): c is Exclude<Category, "not_job"> => c !== "not_job",
);
