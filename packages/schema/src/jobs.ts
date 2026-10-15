import { z } from "zod";

// The job queue as packages/db hands it to the server's workers (ARCHITECTURE › Background
// work). A job's payload and checkpoint are its type's own business: each worker validates them
// with its own schema (for example ScanRunPayloadSchema) when it takes the job.

export const JobStatusSchema = z.enum(["queued", "running", "done", "failed"]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

/** A job a worker has just claimed, leased to it. */
export const ClaimedJobSchema = z.object({
  id: z.uuid(),
  type: z.string().min(1),
  workspaceId: z.uuid(),
  payload: z.unknown(),
  checkpoint: z.unknown(),
  attempts: z.number().int().positive(),
  /** Who held the job before: the owner whose lease expired, or who handed it back. */
  previousOwner: z.string().nullable(),
  /** True when this claim took the job over from an owner whose lease had expired. */
  leaseExpired: z.boolean(),
});
export type ClaimedJob = z.infer<typeof ClaimedJobSchema>;

/** A job as stored, whatever its state. */
export const StoredJobSchema = z.object({
  id: z.uuid(),
  type: z.string().min(1),
  workspaceId: z.uuid(),
  payload: z.unknown(),
  status: JobStatusSchema,
  leaseOwner: z.string().nullable(),
  leaseExpiresAt: z.date().nullable(),
  previousOwner: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  checkpoint: z.unknown(),
});
export type StoredJob = z.infer<typeof StoredJobSchema>;
