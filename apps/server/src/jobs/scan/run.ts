import type { AiClient } from "@jobfilly/ai";
import { countFirmAnswers, createConfidenceTracker, stopMessage } from "@jobfilly/core";
import {
  countNotAnalyzed,
  countScanAnalysis,
  getScan,
  listPendingCandidates,
  listPendingOwnReplies,
  loadIntakeInput,
  markAnalysisFailed,
  savePreferences,
  stopScan,
  updateScanProgress,
  usageTotal,
} from "@jobfilly/db";
import type { MailClient } from "@jobfilly/mail";
import {
  AI_BATCH_SIZE,
  type IntakeProposal,
  type LiveEvent,
  type Scan,
  type ScanCheckpoint,
  type ScanCounts,
  type ScanProgress,
  type StopReason,
  type StoredMessage,
  type Usage,
} from "@jobfilly/schema";
import type { AppDeps } from "../../deps";
import type { Logger } from "../../log";
import {
  type AnalysisRun,
  analyzeBatch,
  FATAL,
  mailItems,
  maxCalls,
  RunFailed,
} from "../../pipeline/analyze";
import type { JobContext } from "../queue";

// One run of a scan, after the handler has opened the mailbox and the AI client and stage one is
// stored (index.ts). The first scan reads the user's own replies for preferences first (TBD-32),
// then both kinds of run take the likely job mail newest first in batches of 20, sorted and
// extracted by pipeline/analyze.ts, which the sync shares. Every call counts toward the run's
// budget, retries included (TBD-17, TBD-66): a retry is only allowed while a call is left for it.
// After every batch the run checkpoints, and the confidence tracker says whether it stops (F4.4).
// Bodies are fetched for the model and never stored (F4.9).

/** The scan was cancelled, or this replica is shutting down or lost the job: stop quietly. */
class Interrupted extends Error {}

export interface RunInput {
  ctx: JobContext<unknown>;
  scan: Scan;
  checkpoint: ScanCheckpoint;
  ai: AiClient;
  mail: MailClient;
  budget: number;
  log: Logger;
  progressIntervalMs: number;
}

export async function runScan(input: RunInput): Promise<void> {
  const { ctx, scan, ai, mail, budget, log } = input;
  const deps: AppDeps = ctx.deps;
  const { db } = deps;
  const workspaceId = scan.workspaceId;
  const scanId = scan.id;
  let checkpoint = input.checkpoint;
  const tracker = createConfidenceTracker(scan.kind, checkpoint.tracker);

  const usage = await usageTotal(db, workspaceId, scanId);
  let calls = usage.calls;
  let inputTokens = usage.inputTokens;
  let outputTokens = usage.outputTokens;
  const counts: ScanCounts = {
    handledWithoutAi: checkpoint.handledWithoutAi,
    likely: checkpoint.likely,
    ...(await countScanAnalysis(db, workspaceId, scanId)),
    answersFirm: 0,
    notAnalyzed: await countNotAnalyzed(db, workspaceId),
  };
  let cancelled = false;
  let lastProposal: string | null = null;

  const progress = (): ScanProgress => ({
    ...counts,
    scanId,
    kind: scan.kind,
    status: "running",
    stopReason: null,
    calls,
    tokens: inputTokens + outputTokens,
  });
  // Storing and sending live are apart (F4.6): the screen shows what is stored, so a finished
  // batch's counts are stored at once, and nothing in the run waits for an event to go out. The
  // events go out one at a time in the order they were sent, so the stop is always the last
  // word; a scan.progress still waiting its turn gives way to a newer one.
  const outbox: LiveEvent[] = [];
  let sending: Promise<void> | null = null;
  const send = (event: LiveEvent) => {
    if (event.type === "scan.progress" && outbox.at(-1)?.type === "scan.progress") outbox.pop();
    outbox.push(event);
    sending ??= (async () => {
      for (let next = outbox.shift(); next; next = outbox.shift()) {
        await deps.live
          .publish(workspaceId, next)
          .catch((error) => log.warn("live.error", { error }));
      }
      sending = null;
    })();
  };
  /** Settles once every event sent so far has gone out. */
  const sent = async () => {
    while (sending) await sending;
  };

  /** Stores the progress and sends it live; notices a cancel (the scan was stopped meanwhile). */
  const write = async () => {
    // The counts as they are now, sent as they were stored: the run goes on counting meanwhile.
    const data = progress();
    const stored = await updateScanProgress(db, workspaceId, scanId, {
      status: "running",
      counts: { ...counts },
      calls,
      inputTokens,
      outputTokens,
    });
    if (!stored) cancelled = true;
    else send({ type: "scan.progress", data });
  };
  // One write at a time, so what is stored only ever moves forward. A report asked for while one
  // is under way waits for it and then stores again: the one under way may hold the counts from
  // before a batch finished, so joining it would leave a finished batch unseen until the next
  // tick. Callers meanwhile share that one follow-up. Only the database write is waited for.
  let reporting: Promise<void> | null = null;
  let followUp: Promise<void> | null = null;
  const report = (): Promise<void> => {
    if (!reporting) {
      reporting = write().finally(() => {
        reporting = null;
      });
      return reporting;
    }
    followUp ??= reporting
      .catch(() => {})
      .then(() => {
        followUp = null;
        return report();
      });
    return followUp;
  };
  /** Settles once no report is under way or waiting. */
  const reported = async () => {
    while (followUp ?? reporting) await (followUp ?? reporting)?.catch(() => {});
  };
  // Progress goes out at least every few seconds, also while one batch takes long (F4.6).
  const ticker = setInterval(() => {
    report().catch((error) => log.warn("live.error", { error }));
  }, input.progressIntervalMs);

  const stopRequested = () => cancelled || ctx.signal.aborted;

  // The client records each call's usage (ai-usage.ts, scoped to this run); this counts it.
  function spend(result: { usage: Usage[] }) {
    for (const u of result.usage) {
      calls += 1;
      inputTokens += u.inputTokens;
      outputTokens += u.outputTokens;
    }
  }
  const callsLeft = () => budget - calls;

  /** Makes one model call (two with a retry), unless the scan was cancelled meanwhile. */
  async function call<T extends { usage: Usage[] }>(make: () => Promise<T>): Promise<T> {
    if (ctx.signal.aborted) throw new Interrupted();
    if ((await getScan(db, workspaceId, scanId))?.status !== "running") {
      cancelled = true;
      throw new Interrupted();
    }
    let result: T;
    try {
      result = await make();
    } catch {
      // packages/ai answers every provider failure as a value (auth, unreachable, ...); a throw
      // is a fault in JobFilly itself, which no AI setting would fix.
      throw new RunFailed("internal", "ai_client_error");
    }
    spend(result);
    return result;
  }

  const analysis: AnalysisRun = {
    db,
    workspaceId,
    scanId,
    ai,
    mail,
    callsLeft,
    stopRequested: () => stopRequested(),
    call,
  };

  /** The proposal as it stands, and the "answers firming up" count. */
  async function propose(): Promise<IntakeProposal> {
    const proposal = deps.intake.aggregate(await loadIntakeInput(db, workspaceId));
    counts.answersFirm = countFirmAnswers(proposal);
    const snapshot = JSON.stringify(proposal);
    if (lastProposal !== null && snapshot !== lastProposal) {
      send({ type: "intake.updated", data: {} });
    }
    lastProposal = snapshot;
    return proposal;
  }

  async function refreshCounts() {
    Object.assign(counts, await countScanAnalysis(db, workspaceId, scanId));
    counts.notAnalyzed = await countNotAnalyzed(db, workspaceId);
  }

  async function finishBatch(kind: "replies" | "candidates") {
    checkpoint = { ...checkpoint, batches: checkpoint.batches + 1, tracker: tracker.memory() };
    await ctx.saveCheckpoint(checkpoint);
    log.info("scan.batch_completed", {
      scanId,
      batch: checkpoint.batches,
      analyzed: counts.analyzed,
      kind,
      calls,
    });
    await report();
    send({ type: "messages.updated", data: {} });
  }

  async function stop(reason: StopReason, failure?: RunFailed) {
    // No progress may go out after the stop: no tick comes any more, no write is under way, and
    // what they sent goes out before the stop's events, which queue behind it.
    clearInterval(ticker);
    await reported();
    await refreshCounts();
    const stored = await updateScanProgress(db, workspaceId, scanId, {
      status: "running",
      counts,
      calls,
      inputTokens,
      outputTokens,
    });
    const stopCause = failure?.stopCause ?? null;
    if (
      !stored ||
      !(await stopScan(db, workspaceId, scanId, reason, deps.clock.now(), stopCause))
    ) {
      return;
    }
    if (failure) {
      log.warn("scan.stopped", { scanId, reason, cause: failure.code, stopCause, calls });
    } else log.info("scan.stopped", { scanId, reason, analyzed: counts.analyzed, calls });
    const message = stopMessage(reason, counts.analyzed, counts.likely, stopCause);
    send({
      type: "scan.stopped",
      data: { ...progress(), status: "stopped", stopReason: reason, stopMessage: message },
    });
    send({ type: "messages.updated", data: {} });
    send({ type: "intake.updated", data: {} });
  }

  /** The user's own replies, read for the preferences they state; null when they are all read. */
  async function readReplies(): Promise<StopReason | null> {
    while (!stopRequested()) {
      const replies = await listPendingOwnReplies(db, workspaceId, { limit: AI_BATCH_SIZE });
      if (replies.length === 0) return null;
      if (callsLeft() <= 0) return "budget";
      const items = await mailItems(mail, replies);
      const result = await call(() =>
        ai.prefs([...items.values()], { maxCalls: maxCalls(analysis) }),
      );
      let changed = 0;
      for (const item of result.items) {
        if (item.ok) {
          await savePreferences(db, workspaceId, {
            messageId: item.messageId,
            scanId,
            preferences: item.data.preferences,
          });
          changed += 1;
        } else if (item.error.kind === "invalid_output") {
          await markAnalysisFailed(db, workspaceId, { messageId: item.messageId, scanId });
          changed += 1;
        } else if (FATAL.includes(item.error.kind)) {
          throw new RunFailed("ai", `ai_${item.error.kind}`);
        }
      }
      await propose();
      await finishBatch("replies");
      // Items left pending had no call left for their retry: the budget is used up.
      if (changed === 0) return callsLeft() <= 0 ? "budget" : "failed";
    }
    return null;
  }

  /** One batch of likely job mail: classify, then extract the job mail (pipeline/analyze.ts). */
  async function analyze(batch: StoredMessage[]) {
    const outcome = await analyzeBatch(analysis, batch);
    counts.analyzed += outcome.analyzed;
    counts.jobFound += outcome.jobs.length;
  }

  /** Likely job mail, newest first, batch by batch, until the tracker or a cancel stops the run. */
  async function readCandidates(): Promise<StopReason | null> {
    tracker.begin(await propose());
    while (!stopRequested()) {
      const batch = await listPendingCandidates(db, workspaceId, { limit: AI_BATCH_SIZE });
      if (batch.length === 0) return "done";
      if (callsLeft() <= 0) return "budget";
      const before = counts.analyzed;
      await analyze(batch);
      await refreshCounts();
      const proposal = await propose();
      const decision = tracker.afterBatch({
        proposal,
        remaining: counts.notAnalyzed,
        callsUsed: calls,
        budget,
      });
      await finishBatch("candidates");
      if (decision) return decision.reason;
      if (counts.analyzed === before) return "failed";
    }
    return null;
  }

  try {
    await report();
    let reason: StopReason | null = null;
    if (!checkpoint.repliesRead) {
      reason = await readReplies();
      if (!reason && !stopRequested()) {
        checkpoint = { ...checkpoint, repliesRead: true };
        await ctx.saveCheckpoint(checkpoint);
      }
    }
    if (!reason && !stopRequested()) reason = await readCandidates();
    // No progress with calls left: the provider answered nothing usable for a whole batch.
    if (reason && !stopRequested())
      await stop(reason, reason === "failed" ? new RunFailed("ai", "no_progress") : undefined);
  } catch (error) {
    if (error instanceof Interrupted) return;
    if (!(error instanceof RunFailed) || ctx.signal.aborted) throw error;
    await stop("failed", error);
  } finally {
    clearInterval(ticker);
    await reported();
    // The job ends once the events it sent are out, the stop's among them.
    await sent();
  }
}
