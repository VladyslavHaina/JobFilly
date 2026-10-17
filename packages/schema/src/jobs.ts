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

// The job types of MVP 2 and their payloads. Each worker validates its payload with these when it
// takes the job; the dedupe key keeps at most one of each waiting (and one running).

/** mail.sync: one sync of one mailbox (F1); dedupe key `sync:<mailboxId>`. */
export const MAIL_SYNC_JOB = "mail.sync";
export const MailSyncPayloadSchema = z.object({ mailboxId: z.uuid() });
export type MailSyncPayload = z.infer<typeof MailSyncPayloadSchema>;

/**
 * pipeline.reevaluate: evaluates every job message whose evaluation or sender check is missing or
 * stale, and re-claims drafts to retry; dedupe key `reevaluate:<workspaceId>`.
 */
export const PIPELINE_REEVALUATE_JOB = "pipeline.reevaluate";
export const PipelineReevaluatePayloadSchema = z.object({
  workspaceId: z.uuid(),
  /** Why it was asked for ("sweep", "intake.confirmed", "rule.changed", …), for the logs. */
  reason: z.string().min(1).max(100),
});
export type PipelineReevaluatePayload = z.infer<typeof PipelineReevaluatePayloadSchema>;

/** cv.read: reads one uploaded CV with cv.v1; dedupe key `cv:<cvId>`. */
export const CV_READ_JOB = "cv.read";
export const CvReadPayloadSchema = z.object({ workspaceId: z.uuid(), cvId: z.uuid() });
export type CvReadPayload = z.infer<typeof CvReadPayloadSchema>;

/**
 * draft.create: writes one role's draft and saves it to the mailbox; dedupe key
 * `draft:<workspaceId>:<messageId>:<position>`. `origin` says what asked for it: the pipeline
 * (auto), Draft a reply (on_demand), a decision answer, or the sweep retrying a failed one.
 */
export const DRAFT_CREATE_JOB = "draft.create";
export const DraftOriginSchema = z.enum(["auto", "on_demand", "decision", "retry"]);
export type DraftOrigin = z.infer<typeof DraftOriginSchema>;
export const DraftCreatePayloadSchema = z.object({
  workspaceId: z.uuid(),
  messageId: z.string().min(1),
  position: z.number().int().nonnegative(),
  origin: DraftOriginSchema,
});
export type DraftCreatePayload = z.infer<typeof DraftCreatePayloadSchema>;

/**
 * mail.send (MVP 3, F4.2): sends one confirmed message once its delay is over (the job's run_at);
 * dedupe key `send:<sendId>`. A send cancelled by Undo before it runs does nothing.
 */
export const MAIL_SEND_JOB = "mail.send";
export const MailSendPayloadSchema = z.object({ workspaceId: z.uuid(), sendId: z.uuid() });
export type MailSendPayload = z.infer<typeof MailSendPayloadSchema>;

/** The dedupe key of each job, one place for every caller. */
export const jobDedupeKey = {
  sync: (mailboxId: string) => `sync:${mailboxId}`,
  reevaluate: (workspaceId: string) => `reevaluate:${workspaceId}`,
  cvRead: (cvId: string) => `cv:${cvId}`,
  draft: (workspaceId: string, messageId: string, position: number) =>
    `draft:${workspaceId}:${messageId}:${position}`,
  send: (sendId: string) => `send:${sendId}`,
};
