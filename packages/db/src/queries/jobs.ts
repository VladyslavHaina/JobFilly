import type { ClaimedJob, JobStatus, StoredJob } from "@jobfilly/schema";
import { and, eq, sql } from "drizzle-orm";
import { type Database, queryRows } from "../client";
import { jobs } from "../tables";

// The job queue (ARCHITECTURE › Background work). Workers claim jobs with FOR UPDATE SKIP LOCKED
// and hold a lease of at most 30 seconds that they renew while working. A running job whose lease
// ran out (its replica died) is claimed again by another worker, which records the previous
// owner and resumes from the last checkpoint. Every write by a worker is guarded by its lease.
// The worker's operations (claim, renew, checkpoint, complete, hand back) take no workspace id on
// purpose: a worker serves every workspace, and the job it holds carries its workspace id.
//
// Dedupe (TBD-178): jobs with the same dedupe key are one piece of work. At most one of them
// waits: enqueueing while one is queued is a no-op (a partial unique index while queued). At most
// one runs: the claim skips a queued job while another job with its key runs under a live lease,
// and takes a per-key advisory lock for its own transaction, so two workers claiming at the same
// moment can't both start one. A job enqueued while its key runs still queues, so a change made
// during a run always gets a later one. A running job whose lease expired is taken over as any
// other.
//
// Delayed jobs (MVP 3, F4.2): a job enqueued with `runAt` is not claimed before that time (a
// send's Undo delay); one without it is due at once.

/** The advisory lock space of the per-key claim lock (the migration lock is a single key). */
const DEDUPE_LOCK_SPACE = 74_617;

/** The longest lease a worker may hold; it renews well before the end. */
export const MAX_LEASE_MS = 30_000;

function leaseUntil(now: Date, leaseMs: number): Date {
  return new Date(now.getTime() + Math.min(Math.max(leaseMs, 1), MAX_LEASE_MS));
}

/**
 * Adds a job to the queue. Pass a transaction to enqueue together with other writes. With a
 * dedupe key, a job with the same key already waiting makes this a no-op: `enqueued` is false and
 * `id` is the waiting job's. With `runAt` it isn't claimed before then.
 */
export async function enqueueJob(
  db: Database,
  workspaceId: string,
  input: { type: string; payload: unknown; now: Date; dedupeKey?: string; runAt?: Date },
): Promise<{ id: string; enqueued: boolean }> {
  const values = {
    type: input.type,
    workspaceId,
    payload: input.payload,
    dedupeKey: input.dedupeKey ?? null,
    runAt: input.runAt ?? null,
    createdAt: input.now,
    updatedAt: input.now,
  };
  if (input.dedupeKey === undefined) {
    const [row] = await db.insert(jobs).values(values).returning({ id: jobs.id });
    if (!row) throw new Error("job insert returned nothing");
    return { id: row.id, enqueued: true };
  }
  for (;;) {
    const [row] = await db
      .insert(jobs)
      .values(values)
      .onConflictDoNothing({
        target: jobs.dedupeKey,
        where: sql`status = 'queued' and dedupe_key is not null`,
      })
      .returning({ id: jobs.id });
    if (row) return { id: row.id, enqueued: true };
    const [waiting] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.dedupeKey, input.dedupeKey), eq(jobs.status, "queued")));
    // The waiting job was claimed in between: try again, it no longer blocks the insert.
    if (waiting) return { id: waiting.id, enqueued: false };
  }
}

/**
 * Claims the oldest queued job of one of `types` that is due (its run_at, if any, has come), or a
 * running one whose lease has expired, and
 * leases it to `owner`. Concurrent workers never claim the same job, and never two jobs with the
 * same dedupe key: a queued job waits while its key runs under a live lease (see the top).
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
          and (
            (status = 'queued' and (run_at is null or run_at <= ${input.now})
              and (dedupe_key is null or not exists (
              select 1 from jobs live
              where live.dedupe_key = jobs.dedupe_key and live.status = 'running'
                and live.lease_expires_at > ${input.now})))
            or (status = 'running' and lease_expires_at <= ${input.now}))
          and (dedupe_key is null
            or pg_try_advisory_xact_lock(${sql.raw(String(DEDUPE_LOCK_SPACE))}, hashtext(dedupe_key)))
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

/**
 * Hands the job back to the queue (graceful shutdown), so another worker resumes it at once. A
 * job whose dedupe key already has another job waiting is not queued a second time: the waiting
 * one does the same work from the start (handlers are idempotent), so this one ends as done.
 */
export async function handBackJob(
  db: Database,
  jobId: string,
  input: { owner: string; now: Date },
): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({
      status: sql`case when ${jobs.dedupeKey} is not null and exists (
        select 1 from jobs waiting
        where waiting.dedupe_key = ${jobs.dedupeKey} and waiting.status = 'queued')
        then 'done' else 'queued' end`,
      leaseOwner: null,
      leaseExpiresAt: null,
      previousOwner: input.owner,
      updatedAt: input.now,
    })
    .where(heldBy(jobId, input.owner))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

/** One job of the workspace, or null. */
export async function getJob(
  db: Database,
  workspaceId: string,
  jobId: string,
): Promise<StoredJob | null> {
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
    .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.id, jobId)));
  return row ?? null;
}
