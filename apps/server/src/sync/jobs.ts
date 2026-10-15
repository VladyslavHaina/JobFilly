import { listMailboxesToSync } from "@jobfilly/db";
import {
  jobDedupeKey,
  MAIL_SYNC_JOB,
  type MailSyncPayload,
  MailSyncPayloadSchema,
} from "@jobfilly/schema";
import type { AppDeps } from "../deps";
import { defineJob, enqueue, type JobHandler, type JobRegistry } from "../jobs/queue";
import type { Stages } from "../pipeline/stages";
import { isDue, SYNC_FOLDER, syncMailbox } from "./run";

// The mail.sync job (F1): one sync of one mailbox (./run.ts), dedupe key sync:<mailboxId>, so
// across replicas at most one waits and one runs per mailbox (F1.2); a replica that dies mid-sync
// loses its lease and another takes the job over (job.lease_expired), from the same cursor.
// Registered here, spread into jobs/registry.ts.

/** The handler, with the pipeline's stages to use (tests inject recording ones). */
export function createMailSyncHandler(
  options: { stages?: Stages } = {},
): JobHandler<MailSyncPayload> {
  return async (ctx) => {
    await syncMailbox(ctx.deps, ctx.job.workspaceId, ctx.payload.mailboxId, {
      signal: ctx.signal,
      stages: options.stages,
    });
  };
}

export const syncJobs: JobRegistry = {
  [MAIL_SYNC_JOB]: defineJob(MailSyncPayloadSchema, createMailSyncHandler()),
};

/**
 * Enqueues a mail.sync for every mailbox that is due: its workspace's first scan has stopped and
 * it isn't backing off (F1.4). A sync already waiting makes this a no-op for its mailbox, so two
 * replicas ticking together queue one. Returns how many mailboxes were due.
 */
export async function enqueueSyncs(deps: AppDeps): Promise<number> {
  const now = deps.clock.now();
  const intervalMs = deps.config.syncIntervalSeconds * 1000;
  const due = (await listMailboxesToSync(deps.db, SYNC_FOLDER)).filter((m) =>
    isDue(m.nextAttemptAt, now, intervalMs),
  );
  for (const { workspaceId, mailboxId } of due) {
    await enqueue(deps, workspaceId, {
      type: MAIL_SYNC_JOB,
      payload: { mailboxId } satisfies MailSyncPayload,
      dedupeKey: jobDedupeKey.sync(mailboxId),
    });
  }
  return due.length;
}
