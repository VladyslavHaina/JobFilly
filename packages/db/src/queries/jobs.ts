import { and, eq, sql } from "drizzle-orm";
import { type Database, queryRows } from "../client";
import { type JobStatus, jobs } from "../tables";

// The job queue (ARCHITECTURE › Background work). Workers claim jobs with FOR UPDATE SKIP LOCKED
// and hold a lease of at most 30 seconds that they renew while working. A running job whose lease
// ran out (its replica died) is claimed again by another worker, which records the previous
// owner and resumes from the last checkpoint. Every write by a worker is guarded by its lease.

/** The longest lease a worker may hold; it renews well before the end. */
export const MAX_LEASE_MS = 30_000;

export interface ClaimedJob {
  id: string;
  type: string;
  workspaceId: string;
  payload: unknown;
  checkpoint: unknown;
  attempts: number;
  /** Who held the job before: the owner whose lease expired, or who handed it back. */
  previousOwner: string | null;
  /** True when this claim took the job over from an owner whose lease had expired. */
  leaseExpired: boolean;
}

export interface StoredJob {
  id: string;
  type: string;
  workspaceId: string;
  payload: unknown;
  status: JobStatus;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  previousOwner: string | null;
  attempts: number;
  checkpoint: unknown;
}

function leaseUntil(now: Date, leaseMs: number): Date {
  return new Date(now.getTime() + Math.min(Math.max(leaseMs, 1), MAX_LEASE_MS));
}

/** Adds a job to the queue. Pass a transaction to enqueue together with other writes. */
export async function enqueueJob(
  db: Database,
  workspaceId: string,
  input: { type: string; payload: unknown; now: Date },
): Promise<{ id: string }> {
  const [row] = await db
    .insert(jobs)
    .values({
      type: input.type,
      workspaceId,
      payload: input.payload,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning({ id: jobs.id });
  if (!row) throw new Error("job insert returned nothing");
  return row;
}

/**
 * Claims the oldest queued job of one of `types`, or a running one whose lease has expired, and
 * leases it to `owner`. Concurrent workers never claim the same job.
 */
export async function claimJob(
  db: Database,
  input: { owner: string; types: readonly string[]; now: Date; leaseMs: number },
): Promise<ClaimedJob | null> {
  if (input.types.length === 0) return null;
  const types = sql.join(
    input.types.map((t) => sql`${t}`),
    sql`, `,
  );
  const [row] = await queryRows<{
    id: string;
    type: string;
    workspace_id: string;
    payload: unknown;
    checkpoint: unknown;
    attempts: number;
    previous_owner: string | null;
    old_status: JobStatus;
  }>(
    db,
    sql`
      with candidate as (
        select id, status as old_status, lease_owner as old_owner
        from jobs
        where type in (${types})
          and (status = 'queued' or (status = 'running' and lease_expires_at <= ${input.now}))
        order by created_at, id
        limit 1
        for update skip locked
      )
      update jobs set
        status = 'running',
        lease_owner = ${input.owner},
        lease_expires_at = ${leaseUntil(input.now, input.leaseMs)},
        previous_owner = case when candidate.old_status = 'running'
          then candidate.old_owner else jobs.previous_owner end,
        attempts = jobs.attempts + 1,
        updated_at = ${input.now}
      from candidate
      where jobs.id = candidate.id
      returning jobs.id, jobs.type, jobs.workspace_id, jobs.payload, jobs.checkpoint,
        jobs.attempts, jobs.previous_owner, candidate.old_status`,
  );
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    workspaceId: row.workspace_id,
    payload: row.payload,
    checkpoint: row.checkpoint ?? null,
    attempts: Number(row.attempts),
    previousOwner: row.previous_owner,
    leaseExpired: row.old_status === "running",
  };
}

const heldBy = (jobId: string, owner: string) =>
  and(eq(jobs.id, jobId), eq(jobs.leaseOwner, owner), eq(jobs.status, "running"));

/** Extends the lease; false when `owner` no longer holds the job (it was taken over). */
export async function renewLease(
  db: Database,
  jobId: string,
  input: { owner: string; now: Date; leaseMs: number },
): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({ leaseExpiresAt: leaseUntil(input.now, input.leaseMs), updatedAt: input.now })
    .where(heldBy(jobId, input.owner))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

/** Saves the job's checkpoint; false when `owner` no longer holds the job. */
export async function saveJobCheckpoint(
  db: Database,
  jobId: string,
  input: { owner: string; checkpoint: unknown; now: Date },
): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({ checkpoint: input.checkpoint, updatedAt: input.now })
    .where(heldBy(jobId, input.owner))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

/** Marks the job finished; false when `owner` no longer holds it. */
export async function completeJob(
  db: Database,
  jobId: string,
  input: { owner: string; status: "done" | "failed"; now: Date },
): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({ status: input.status, leaseOwner: null, leaseExpiresAt: null, updatedAt: input.now })
    .where(heldBy(jobId, input.owner))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

/** Hands the job back to the queue (graceful shutdown), so another worker resumes it at once. */
export async function handBackJob(
  db: Database,
  jobId: string,
  input: { owner: string; now: Date },
): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({
      status: "queued",
      leaseOwner: null,
      leaseExpiresAt: null,
      previousOwner: input.owner,
      updatedAt: input.now,
    })
    .where(heldBy(jobId, input.owner))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

export async function getJob(db: Database, jobId: string): Promise<StoredJob | null> {
  const [row] = await db
    .select({
      id: jobs.id,
      type: jobs.type,
      workspaceId: jobs.workspaceId,
      payload: jobs.payload,
      status: jobs.status,
      leaseOwner: jobs.leaseOwner,
      leaseExpiresAt: jobs.leaseExpiresAt,
      previousOwner: jobs.previousOwner,
      attempts: jobs.attempts,
      checkpoint: jobs.checkpoint,
    })
    .from(jobs)
    .where(eq(jobs.id, jobId));
  return row ?? null;
}
