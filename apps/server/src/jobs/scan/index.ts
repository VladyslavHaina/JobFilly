import type { AiClient } from "@jobfilly/ai";
import { loadJobPlatforms, stageOne, stopMessage } from "@jobfilly/core";
import {
  countNotAnalyzed,
  countScanAnalysis,
  getAiSettings,
  getMessageMailbox,
  getScan,
  listMailboxes,
  type StoredMailbox,
  saveEnvelopes,
  saveScanFocus,
  stopScan,
  updateScanProgress,
  usageTotal,
} from "@jobfilly/db";
import type { MailClient } from "@jobfilly/mail";
import {
  SCAN_WINDOW_DAYS,
  type Scan,
  type ScanCheckpoint,
  ScanCheckpointSchema,
  type ScanFocus,
  type ScanRunPayload,
  type StopCause,
  type StoredMessage,
} from "@jobfilly/schema";
import { aiClientFor } from "../../ai-usage";
import { DAY } from "../../clock";
import type { AppDeps } from "../../deps";
import type { Logger } from "../../log";
import { connectStoredMailbox, MailboxSecretError } from "../../mailbox";
import { aiFailed, RunFailed } from "../../pipeline/analyze";
import { openAiKey } from "../../secrets";
import type { JobContext, JobHandler } from "../queue";
import { runScan } from "./run";

// The 'scan.run' job: the first scan and "Analyze them" runs (F4). Exactly one replica runs a
// scan, because only the lease holder runs its job; it logs scan.started on the first claim and
// scan.resumed when it takes the run over from another instance (F4.7, F4.8). Stage one runs
// once: its outcome is stored and the checkpoint says so, so a resumed run goes straight on with
// the batches. A cancel stops the scan row; the worker notices it and ends without a second stop.
// A run that can't go on stops as failed with what it ran into (StopCause): the mailbox, the AI
// provider, or JobFilly itself (anything unexpected), so its stop message points the right way.
//
// MVP 3: a scan reads every mailbox of the workspace (F3.1): stage one sorts each one's window
// and files what it stores under it, and the model reads each message from its own mailbox. A
// re-run of setup (F1.1) runs stage one again over the last 90 days, so mail that came since the
// first scan (and the user's newer replies, which the sync doesn't read) is in; before that, its
// hint is read into a focus (focus.v1) once and stored with the scan. A focus.v1 call that gives
// no answer stops the run as failed, like any other call the run can't do without.

/** How often a running scan sends its progress, at the least (F4.6 asks for every 5 seconds). */
const PROGRESS_INTERVAL_MS = 2000;

const START: Omit<ScanCheckpoint, "likely" | "handledWithoutAi" | "repliesRead"> = {
  batches: 0,
  tracker: { lastAnswers: null, unchangedBatches: 0 },
};

/**
 * Stage one of the first scan and of a re-run: each mailbox's window sorted by headers and stored
 * under it (F4.1, F4.2). Every mailbox's addresses are the user's own.
 */
async function sortWindow(
  deps: AppDeps,
  scan: Scan,
  mailboxes: { mailbox: StoredMailbox; mail: MailClient }[],
): Promise<ScanCheckpoint> {
  const since = new Date(Date.parse(scan.startedAt) - SCAN_WINDOW_DAYS * DAY);
  const ownAddresses = mailboxes.flatMap(({ mailbox }) => [mailbox.address, mailbox.username]);
  let handledWithoutAi = 0;
  for (const { mailbox, mail } of mailboxes) {
    let envelopes: Awaited<ReturnType<MailClient["fetchEnvelopes"]>>;
    try {
      envelopes = [
        ...(await mail.fetchEnvelopes({ folder: "inbox", since })),
        ...(await mail.fetchEnvelopes({ folder: "sent", since })),
      ];
    } catch {
      throw new RunFailed("mailbox", "stage_one_error");
    }
    const outcome = stageOne(envelopes, { ownAddresses, platforms: loadJobPlatforms() });
    await saveEnvelopes(
      deps.db,
      scan.workspaceId,
      [...outcome.handled, ...outcome.candidates, ...outcome.ownReplies],
      { mailboxId: mailbox.mailboxId, now: deps.clock.now() },
    );
    handledWithoutAi += outcome.handled.length;
  }
  return {
    ...START,
    likely: await countNotAnalyzed(deps.db, scan.workspaceId),
    handledWithoutAi,
    repliesRead: false,
  };
}

/** A re-run's hint read into its focus (focus.v1), stored with the scan; null without a hint. */
async function readFocus(deps: AppDeps, scan: Scan, ai: AiClient): Promise<ScanFocus | null> {
  if (scan.focus) return scan.focus;
  if (!scan.hint) return null;
  let result: Awaited<ReturnType<AiClient["focus"]>>;
  try {
    result = await ai.focus({ hint: scan.hint }, { maxCalls: 2 });
  } catch {
    throw new RunFailed("internal", "ai_client_error");
  }
  if (!result.ok) throw aiFailed(result.error);
  await saveScanFocus(deps.db, scan.workspaceId, scan.id, result.data);
  return result.data;
}

/**
 * Stops the scan as failed, unless it stopped already. The scan row may lag behind the run (it is
 * written after every batch), so the stop counts the run's calls and tokens from ai_usage and its
 * analysis from the messages: every model call the run made shows, also when it failed mid-batch.
 */
async function fail(deps: AppDeps, scan: Scan, log: Logger, stopCause: StopCause, code: string) {
  const { db } = deps;
  const usage = await usageTotal(db, scan.workspaceId, scan.id);
  const counts = {
    ...scan.counts,
    ...(await countScanAnalysis(db, scan.workspaceId, scan.id)),
    notAnalyzed: await countNotAnalyzed(db, scan.workspaceId),
  };
  await updateScanProgress(db, scan.workspaceId, scan.id, {
    status: "running",
    counts,
    calls: usage.calls,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });
  if (await stopScan(db, scan.workspaceId, scan.id, "failed", deps.clock.now(), stopCause)) {
    log.warn("scan.stopped", {
      scanId: scan.id,
      reason: "failed",
      cause: code,
      stopCause,
      calls: usage.calls,
    });
    await deps.live.publish(scan.workspaceId, {
      type: "scan.stopped",
      data: {
        ...counts,
        scanId: scan.id,
        kind: scan.kind,
        status: "stopped",
        stopReason: "failed",
        calls: usage.calls,
        tokens: usage.inputTokens + usage.outputTokens,
        stopMessage: stopMessage("failed", counts.analyzed, counts.likely, stopCause),
      },
    });
  }
}

export function createScanRunHandler(
  options: { progressIntervalMs?: number } = {},
): JobHandler<ScanRunPayload> {
  return async (ctx: JobContext<ScanRunPayload>) => {
    const { deps, payload } = ctx;
    const log = deps.log.child({ workspaceId: payload.workspaceId, scanId: payload.scanId });
    const scan = await getScan(deps.db, payload.workspaceId, payload.scanId);
    // Cancelled before it ran, or already finished: nothing to do.
    if (!scan || scan.status === "stopped") return;

    if (ctx.previousInstance === null) {
      log.info("scan.started", { scanId: scan.id, kind: scan.kind });
    } else {
      log.info("scan.resumed", { scanId: scan.id, previousInstance: ctx.previousInstance });
    }

    const settings = await getAiSettings(deps.db, scan.workspaceId);
    const stored = await listMailboxes(deps.db, scan.workspaceId);
    if (!settings) return fail(deps, scan, log, "ai", "no_ai_settings");
    if (stored.length === 0) return fail(deps, scan, log, "mailbox", "no_mailbox");

    // A stored secret that won't open was sealed with another JOBFILLY_SECRET_KEY: the server's
    // configuration, not the user's settings. The mail password is opened by connectStoredMailbox.
    let apiKey: string | null;
    try {
      apiKey = openAiKey(deps.config.secretKey, settings.keyCiphertext);
    } catch {
      return fail(deps, scan, log, "internal", "secret_error");
    }
    let ai: AiClient;
    try {
      ai = aiClientFor(
        deps,
        scan.workspaceId,
        {
          provider: settings.provider,
          baseUrl: settings.baseUrl,
          models: settings.models,
          apiKey,
        },
        { scanId: scan.id },
      );
    } catch {
      return fail(deps, scan, log, "ai", "ai_setup_error");
    }
    const mailboxes: { mailbox: StoredMailbox; mail: MailClient }[] = [];
    const closeAll = () => Promise.all(mailboxes.map(({ mail }) => mail.close().catch(() => {})));
    try {
      for (const mailbox of stored) {
        mailboxes.push({ mailbox, mail: connectStoredMailbox(deps, mailbox) });
      }
    } catch (error) {
      await closeAll();
      if (error instanceof MailboxSecretError) {
        return fail(deps, scan, log, "internal", "secret_error");
      }
      return fail(deps, scan, log, "mailbox", "mail_setup_error");
    }
    const first = mailboxes[0] as { mailbox: StoredMailbox; mail: MailClient };
    // Each message is read from its own mailbox; mail stored without one is the first's.
    const mailOf = async (row: StoredMessage): Promise<MailClient> => {
      const id = await getMessageMailbox(deps.db, scan.workspaceId, row.envelope.messageId);
      return mailboxes.find((m) => m.mailbox.mailboxId === id)?.mail ?? first.mail;
    };

    try {
      const saved = ScanCheckpointSchema.safeParse(ctx.checkpoint);
      let checkpoint: ScanCheckpoint;
      let focus: ScanFocus | null = null;
      if (scan.kind === "rerun") {
        try {
          focus = await readFocus(deps, scan, ai);
        } catch (error) {
          if (ctx.signal.aborted || !(error instanceof RunFailed)) throw error;
          return await fail(deps, scan, log, error.stopCause, error.code);
        }
      }
      if (saved.success) {
        checkpoint = saved.data;
      } else if (scan.kind === "first" || scan.kind === "rerun") {
        try {
          checkpoint = await sortWindow(deps, scan, mailboxes);
        } catch (error) {
          if (ctx.signal.aborted || !(error instanceof RunFailed)) throw error;
          return await fail(deps, scan, log, error.stopCause, error.code);
        }
        await ctx.saveCheckpoint(checkpoint);
      } else {
        checkpoint = {
          ...START,
          likely: await countNotAnalyzed(deps.db, scan.workspaceId),
          handledWithoutAi: 0,
          repliesRead: true,
        };
        await ctx.saveCheckpoint(checkpoint);
      }
      if (ctx.signal.aborted) return;
      await runScan({
        ctx,
        scan,
        checkpoint,
        ai,
        mail: mailOf,
        focus,
        budget: settings.budgetPerRun,
        log,
        progressIntervalMs: options.progressIntervalMs ?? PROGRESS_INTERVAL_MS,
      });
    } catch (error) {
      // Shutting down or taken over: the run goes on elsewhere. Anything else ends the scan as
      // failed, so the workspace can start another one, and the queue logs the job as failed.
      if (!ctx.signal.aborted) {
        const current = await getScan(deps.db, scan.workspaceId, scan.id);
        if (current) await fail(deps, current, log, "internal", "error").catch(() => {});
      }
      throw error;
    } finally {
      await closeAll();
    }
  };
}

export const scanRunHandler = createScanRunHandler();
