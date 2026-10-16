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
  saveAnalysis,
  savePreferences,
  stopScan,
  updateScanProgress,
  usageTotal,
} from "@jobfilly/db";
import type { MailClient } from "@jobfilly/mail";
import {
  AI_BATCH_SIZE,
  type AiError,
  type AiMailItem,
  type Category,
  type IntakeProposal,
  type LiveEvent,
  type Scan,
  type ScanCheckpoint,
  type ScanCounts,
  type ScanProgress,
  type StopCause,
  type StopReason,
  type StoredMessage,
  type Usage,
} from "@jobfilly/schema";
import type { AppDeps } from "../../deps";
import type { Logger } from "../../log";
import type { JobContext } from "../queue";

// One run of a scan, after the handler has opened the mailbox and the AI client and stage one is
// stored (index.ts). The first scan reads the user's own replies for preferences first (TBD-32),
// then both kinds of run take the likely job mail newest first in batches of 20: one classify call
// per batch for likely_job messages, then one extract call per job message and per job alert
// (TBD-68). Every call counts toward the run's budget, retries included (TBD-17, TBD-66): a retry
// is only allowed while a call is left for it. After every batch the run checkpoints, and the
// confidence tracker says whether it stops (F4.4). Bodies are fetched for the model and never
// stored (F4.9).

/** A message body is cut to this many characters before it goes to the model. */
const MAX_TEXT_LENGTH = 8000;

/** Provider failures that no other message would get past: the run stops as failed. */
const FATAL: readonly AiError["kind"][] = ["auth", "unreachable", "provider_error"];

/** The scan was cancelled, or this replica is shutting down or lost the job: stop quietly. */
class Interrupted extends Error {}

/**
 * The run can't go on; it stops as failed. `stopCause` is what the user is told it ran into
 * (the mailbox, the AI provider, or JobFilly itself); `code` is the log's finer cause.
 */
export class RunFailed extends Error {
  constructor(
    readonly stopCause: StopCause,
    readonly code: string,
  ) {
    super(`scan run failed: ${code}`);
    this.name = "RunFailed";
  }
}

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
  const publish = (event: LiveEvent) =>
    deps.live.publish(workspaceId, event).catch((error) => log.warn("live.error", { error }));

  /** Stores the progress and sends it live; notices a cancel (the scan was stopped meanwhile). */
  const write = async () => {
    const stored = await updateScanProgress(db, workspaceId, scanId, {
      status: "running",
      counts,
      calls,
      inputTokens,
      outputTokens,
    });
    if (!stored) cancelled = true;
    else await publish({ type: "scan.progress", data: progress() });
  };
  // One write at a time. A report asked for while one is under way waits for it and then
  // stores again: the one under way may hold the counts from before a batch finished, and the
  // screen refetches what is stored, so joining it would leave a finished batch unseen until the
  // next tick (F4.6). Callers meanwhile share that one follow-up.
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
  const maxCalls = (): 1 | 2 => (callsLeft() >= 2 ? 2 : 1);

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

  /** What the model reads of each message: its headers and the body, fetched now, never kept. */
  async function itemsFor(rows: StoredMessage[]): Promise<Map<string, AiMailItem>> {
    const items = new Map<string, AiMailItem>();
    for (const { envelope: e } of rows) {
      let body: { text: string } | null;
      try {
        body = await mail.fetchBody({
          folderPath: e.folderPath,
          uidValidity: e.uidValidity,
          uid: e.uid,
        });
      } catch {
        throw new RunFailed("mailbox", "mail_error");
      }
      // A message gone from its folder (UIDVALIDITY changed) is read from its stored snippet.
      const text = (body?.text ?? e.snippet).slice(0, MAX_TEXT_LENGTH);
      items.set(e.messageId, {
        messageId: e.messageId,
        folder: e.folder,
        from: e.from,
        date: e.date,
        subject: e.subject,
        text,
      });
    }
    return items;
  }

  /** The proposal as it stands, and the "answers firming up" count. */
  async function propose(): Promise<IntakeProposal> {
    const proposal = deps.intake.aggregate(await loadIntakeInput(db, workspaceId));
    counts.answersFirm = countFirmAnswers(proposal);
    const snapshot = JSON.stringify(proposal);
    if (lastProposal !== null && snapshot !== lastProposal) {
      await publish({ type: "intake.updated", data: {} });
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
    await publish({ type: "messages.updated", data: {} });
  }

  async function stop(reason: StopReason, failure?: RunFailed) {
    // No progress may go out after the stop.
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
    await publish({
      type: "scan.stopped",
      data: { ...progress(), status: "stopped", stopReason: reason, stopMessage: message },
    });
    await publish({ type: "messages.updated", data: {} });
    await publish({ type: "intake.updated", data: {} });
  }

  /** The user's own replies, read for the preferences they state; null when they are all read. */
  async function readReplies(): Promise<StopReason | null> {
    while (!stopRequested()) {
      const replies = await listPendingOwnReplies(db, workspaceId, { limit: AI_BATCH_SIZE });
      if (replies.length === 0) return null;
      if (callsLeft() <= 0) return "budget";
      const items = await itemsFor(replies);
      const result = await call(() => ai.prefs([...items.values()], { maxCalls: maxCalls() }));
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

  /** One batch of likely job mail: classify, then extract the job mail, saving as it goes. */
  async function analyze(batch: StoredMessage[]) {
    const items = await itemsFor(batch);
    const item = (row: StoredMessage) => items.get(row.envelope.messageId) as AiMailItem;
    const categories = new Map<string, Category>();
    for (const row of batch) {
      // A job alert is sorted already; a person's correction is kept and decides as well.
      if (row.categorySource === "you" && row.category) {
        categories.set(row.envelope.messageId, row.category);
      } else if (row.stageOne === "job_alert") {
        categories.set(row.envelope.messageId, "job_alert");
      }
    }
    const toClassify = batch.filter((row) => !categories.has(row.envelope.messageId));
    if (toClassify.length > 0) {
      if (callsLeft() <= 0) return;
      const result = await call(() => ai.classify(toClassify.map(item), { maxCalls: maxCalls() }));
      for (const r of result.items) {
        if (r.ok) categories.set(r.messageId, r.data.category);
        else if (r.error.kind === "invalid_output") {
          await markAnalysisFailed(db, workspaceId, { messageId: r.messageId, scanId });
          counts.analyzed += 1;
        } else if (FATAL.includes(r.error.kind)) throw new RunFailed("ai", `ai_${r.error.kind}`);
      }
    }
    for (const row of batch) {
      const messageId = row.envelope.messageId;
      if (categories.get(messageId) !== "not_job") continue;
      await saveAnalysis(db, workspaceId, { messageId, scanId, category: "not_job", roles: [] });
      counts.analyzed += 1;
    }
    for (const row of batch) {
      const messageId = row.envelope.messageId;
      const category = categories.get(messageId);
      if (!category || category === "not_job") continue;
      if (stopRequested() || callsLeft() <= 0) return;
      const result = await call(() => ai.extract(item(row), { maxCalls: maxCalls() }));
      if (result.ok) {
        await saveAnalysis(db, workspaceId, {
          messageId,
          scanId,
          category,
          roles: result.data.roles,
        });
        counts.analyzed += 1;
        counts.jobFound += 1;
      } else if (result.error.kind === "invalid_output") {
        await markAnalysisFailed(db, workspaceId, { messageId, scanId });
        counts.analyzed += 1;
      } else if (FATAL.includes(result.error.kind)) {
        throw new RunFailed("ai", `ai_${result.error.kind}`);
      }
    }
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
  }
}
