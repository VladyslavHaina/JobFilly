import { loadJobPlatforms, stageOne, stopMessage } from "@jobfilly/core";
import {
  countNotAnalyzed,
  getAiSettings,
  getMailboxConnection,
  getScan,
  saveEnvelopes,
  stopScan,
  updateScanProgress,
} from "@jobfilly/db";
import type { MailClient } from "@jobfilly/mail";
import {
  SCAN_WINDOW_DAYS,
  type Scan,
  type ScanCheckpoint,
  ScanCheckpointSchema,
  type ScanRunPayload,
} from "@jobfilly/schema";
import { DAY } from "../../clock";
import type { AppDeps } from "../../deps";
import type { Logger } from "../../log";
import { open } from "../../secrets";
import type { JobContext, JobHandler } from "../queue";
import { runScan } from "./run";

// The 'scan.run' job: the first scan and "Analyze them" runs (F4). Exactly one replica runs a
// scan, because only the lease holder runs its job; it logs scan.started on the first claim and
// scan.resumed when it takes the run over from another instance (F4.7, F4.8). Stage one runs
// once: its outcome is stored and the checkpoint says so, so a resumed run goes straight on with
// the batches. A cancel stops the scan row; the worker notices it and ends without a second stop.

/** How often a running scan sends its progress, at the least (F4.6 asks for every 5 seconds). */
const PROGRESS_INTERVAL_MS = 2000;

const START: Omit<ScanCheckpoint, "likely" | "handledWithoutAi" | "repliesRead"> = {
  batches: 0,
  tracker: { lastAnswers: null, unchangedBatches: 0 },
};

/** Opens a sealed secret; an empty one (a key cleared on purpose) is no key. */
function openSecret(deps: AppDeps, sealed: string | null): string | null {
  if (sealed === null) return null;
  const value = open(deps.config.secretKey, sealed);
  return value === "" ? null : value;
}

/** The first scan's stage one: the window's envelopes sorted by headers and stored (F4.1, F4.2). */
async function sortWindow(
  deps: AppDeps,
  scan: Scan,
  mail: MailClient,
  ownAddresses: string[],
): Promise<ScanCheckpoint> {
  const since = new Date(Date.parse(scan.startedAt) - SCAN_WINDOW_DAYS * DAY);
  const envelopes = [
    ...(await mail.fetchEnvelopes({ folder: "inbox", since })),
    ...(await mail.fetchEnvelopes({ folder: "sent", since })),
  ];
  const outcome = stageOne(envelopes, { ownAddresses, platforms: loadJobPlatforms() });
  await saveEnvelopes(deps.db, scan.workspaceId, [
    ...outcome.handled,
    ...outcome.candidates,
    ...outcome.ownReplies,
  ]);
  return {
    ...START,
    likely: await countNotAnalyzed(deps.db, scan.workspaceId),
    handledWithoutAi: outcome.handled.length,
    repliesRead: false,
  };
}

async function fail(deps: AppDeps, scan: Scan, log: Logger, cause: string) {
  await updateScanProgress(deps.db, scan.workspaceId, scan.id, {
    status: "running",
    counts: scan.counts,
    calls: scan.calls,
    inputTokens: scan.inputTokens,
    outputTokens: scan.outputTokens,
  });
  if (await stopScan(deps.db, scan.workspaceId, scan.id, "failed", deps.clock.now())) {
    log.warn("scan.stopped", { scanId: scan.id, reason: "failed", cause });
    await deps.live.publish(scan.workspaceId, {
      type: "scan.stopped",
      data: {
        ...scan.counts,
        scanId: scan.id,
        kind: scan.kind,
        status: "stopped",
        stopReason: "failed",
        calls: scan.calls,
        tokens: scan.inputTokens + scan.outputTokens,
        stopMessage: stopMessage("failed", scan.counts.analyzed, scan.counts.likely),
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
    const mailbox = await getMailboxConnection(deps.db, scan.workspaceId);
    if (!settings) return fail(deps, scan, log, "no_ai_settings");
    if (!mailbox) return fail(deps, scan, log, "no_mailbox");

    let mail: MailClient;
    let ai: ReturnType<AppDeps["ai"]["client"]>;
    try {
      ai = deps.ai.client({
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        models: settings.models,
        apiKey: openSecret(deps, settings.keyCiphertext),
      });
      mail = deps.mail.connect(
        {
          host: mailbox.host,
          port: mailbox.port,
          tlsMode: mailbox.tlsMode,
          username: mailbox.username,
          password: openSecret(deps, mailbox.secretCiphertext) ?? "",
        },
        { allowInsecure: deps.config.allowInsecureMail },
      );
    } catch {
      return fail(deps, scan, log, "connect_error");
    }

    try {
      const saved = ScanCheckpointSchema.safeParse(ctx.checkpoint);
      let checkpoint: ScanCheckpoint;
      if (saved.success) {
        checkpoint = saved.data;
      } else if (scan.kind === "first") {
        try {
          checkpoint = await sortWindow(deps, scan, mail, [mailbox.address, mailbox.username]);
        } catch (error) {
          if (ctx.signal.aborted) throw error;
          return await fail(deps, scan, log, "stage_one_error");
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
        mail,
        budget: settings.budgetPerRun,
        log,
        progressIntervalMs: options.progressIntervalMs ?? PROGRESS_INTERVAL_MS,
      });
    } catch (error) {
      // Shutting down or taken over: the run goes on elsewhere. Anything else ends the scan as
      // failed, so the workspace can start another one, and the queue logs the job as failed.
      if (!ctx.signal.aborted) {
        const current = await getScan(deps.db, scan.workspaceId, scan.id);
        if (current) await fail(deps, current, log, "error").catch(() => {});
      }
      throw error;
    } finally {
      await mail.close().catch(() => {});
    }
  };
}

export const scanRunHandler = createScanRunHandler();
