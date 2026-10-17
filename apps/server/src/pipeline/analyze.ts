import type { AiClient } from "@jobfilly/ai";
import { type Database, markAnalysisFailed, saveAnalysis } from "@jobfilly/db";
import { type MailClient, MailError } from "@jobfilly/mail";
import type {
  AiError,
  AiMailItem,
  BatchItemResult,
  BatchResult,
  Category,
  StopCause,
  StoredMessage,
  Usage,
} from "@jobfilly/schema";

// Sorting and fact extraction of likely job mail (MVP 1 F3, MVP 2 F1.1): one classify call per
// batch for likely_job messages, then one extract call per job message and per job alert
//. The scan (jobs/scan) runs it on the first scan's window and on "Analyze them"; the
// sync (sync/run.ts) on new mail, before the rest of the pipeline (evaluate.ts). Bodies are
// fetched for the model and never stored (F4.9). Whoever runs it decides how many calls it may
// make and whether to stop; every call counts, retries included: a retry is only
// allowed while a call is left for it.

/** A message body is cut to this many characters before it goes to the model. */
const MAX_TEXT_LENGTH = 8000;

/** Provider failures that no other message would get past: the run stops. */
const FATAL: readonly AiError["kind"][] = ["auth", "unreachable", "provider_error"];

/**
 * The provider as a whole fails: a refused key, no answer at all, or a rate limit or used-up
 * quota (HTTP 429). Any other error answer (HTTP 500, an answer that couldn't be read) may be one
 * message's doing, as when a provider can't handle one message of a batch.
 */
const providerWide = (error: AiError) =>
  error.kind === "auth" || error.kind === "unreachable" || error.httpStatus === 429;

/** An error answer that may be one message's doing (see providerWide). */
const requestFailed = (error: AiError) => error.kind === "provider_error" && !providerWide(error);

/**
 * Whether a failed item stops the run. In a run that asks again one by one (the scan), only a
 * provider-wide failure does, and any other is the item's: it is marked "Couldn't analyze". The
 * sync stops on every provider failure and tries the mail again on its next run.
 */
export function stopsRun(run: Pick<AnalysisRun, "oneByOne">, error: AiError): boolean {
  return run.oneByOne ? providerWide(error) : FATAL.includes(error.kind);
}

/**
 * The run can't go on. `stopCause` is what the user is told it ran into (the mailbox, the AI
 * provider, or JobFilly itself); `code` is the log's finer cause, and `detail` adds codes for the
 * log line (a provider's HTTP status and error type, a mail server's error code), never a
 * message.
 */
export class RunFailed extends Error {
  constructor(
    readonly stopCause: StopCause,
    readonly code: string,
    readonly detail: Record<string, string | number> = {},
  ) {
    super(`analysis run failed: ${code}`);
    this.name = "RunFailed";
  }
}

/** The run stops on a provider failure; its HTTP status and error type go to the log. */
export function aiFailed(error: AiError): RunFailed {
  const { httpStatus, providerErrorType } = error;
  return new RunFailed("ai", `ai_${error.kind}`, {
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(providerErrorType !== undefined ? { providerErrorType } : {}),
  });
}

/** What one run of the analysis works with, and the limits its owner sets. */
export interface AnalysisRun {
  db: Database;
  workspaceId: string;
  /** The scan run the analysis belongs to; null for the sync. */
  scanId: string | null;
  ai: AiClient;
  /**
   * Where the bodies are read: one mailbox (the sync's), or each message's own (the scan reads
   * every mailbox of the workspace, MVP 3 F3.1).
   */
  mail: MailSource;
  /** How many model calls are left in the run's budget. */
  callsLeft(): number;
  /** The run was cancelled, or the replica is shutting down: no further call is made. */
  stopRequested(): boolean;
  /** Makes one model call (two with a retry) and counts its usage; may throw to stop the run. */
  call<T extends { usage: Usage[] }>(make: () => Promise<T>): Promise<T>;
  /**
   * The scan's (walkthrough I5): a request that failed with an error answer that may be one
   * message's doing is asked again one message at a time (askBatch), and a message that fails
   * again is marked, so one message never stops the run. Off for the sync (see stopsRun).
   */
  oneByOne?: boolean;
}

/**
 * One batched call (classify.v1, prefs.v1), each item's outcome. In a run that asks one by one,
 * the items of a request that failed with an error answer are asked again each alone, once (as
 * F3.4 retries an invalid answer once): an item that fails alone again comes back failed, for
 * the caller to mark. When none of several items gets an answer, together or alone, the
 * provider is failing, and the run stops. An item left without a call for its retry is left out
 * (pending, for a later run).
 */
export async function askBatch<T>(
  run: AnalysisRun,
  items: AiMailItem[],
  ask: (items: AiMailItem[], options: { maxCalls: 1 | 2 }) => Promise<BatchResult<T>>,
): Promise<BatchItemResult<T>[]> {
  const result = await run.call(() => ask(items, { maxCalls: maxCalls(run) }));
  const failed = (r: BatchItemResult<T>) => !r.ok && requestFailed(r.error);
  if (!run.oneByOne || !result.items.some(failed)) return result.items;
  const outcomes: BatchItemResult<T>[] = [];
  let everyRetried = true;
  for (const r of result.items) {
    const item = items.find((i) => i.messageId === r.messageId);
    if (!failed(r) || !item) outcomes.push(r);
    else if (run.stopRequested() || run.callsLeft() <= 0) everyRetried = false;
    else outcomes.push(...(await run.call(() => ask([item], { maxCalls: maxCalls(run) }))).items);
  }
  const error = outcomes.find((r) => !r.ok)?.error;
  if (items.length > 1 && everyRetried && error && outcomes.every(failed)) throw aiFailed(error);
  return outcomes;
}

export interface BatchOutcome {
  /** Messages analysed now: stored with their category, or marked "Couldn't analyze". */
  analyzed: number;
  /** The job messages among them (any category but not_job), stored with their roles. */
  jobs: string[];
}

/** One mailbox, or the mailbox each message lives in. */
export type MailSource = MailClient | ((row: StoredMessage) => Promise<MailClient>);

/** Two calls (a retry) while two are left, else one. */
const maxCalls = (run: Pick<AnalysisRun, "callsLeft">): 1 | 2 => (run.callsLeft() >= 2 ? 2 : 1);

/**
 * What the model reads of each message: its headers and the body, fetched now, never kept. A
 * mailbox that can't be read stops the run (RunFailed "mailbox").
 */
export async function mailItems(
  source: MailSource,
  rows: StoredMessage[],
): Promise<Map<string, AiMailItem>> {
  const items = new Map<string, AiMailItem>();
  for (const row of rows) {
    const e = row.envelope;
    let body: { text: string } | null;
    try {
      const mail = typeof source === "function" ? await source(row) : source;
      body = await mail.fetchBody({
        folderPath: e.folderPath,
        uidValidity: e.uidValidity,
        uid: e.uid,
      });
    } catch (error) {
      // The log gets the reason and the mail server's error code, never its words.
      const detail =
        error instanceof MailError
          ? { mailReason: error.reason, ...(error.code ? { mailCode: error.code } : {}) }
          : {};
      throw new RunFailed("mailbox", "mail_error", detail);
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

/**
 * One batch of likely job mail: classify, then extract the job mail, saving as it goes. A
 * message left pending (no call left for it, or the run stopped) is analysed by a later run.
 */
export async function analyzeBatch(
  run: AnalysisRun,
  batch: StoredMessage[],
): Promise<BatchOutcome> {
  const { db, workspaceId, scanId, ai } = run;
  const outcome: BatchOutcome = { analyzed: 0, jobs: [] };
  const items = await mailItems(run.mail, batch);
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
    if (run.callsLeft() <= 0) return outcome;
    const results = await askBatch(run, toClassify.map(item), (items, options) =>
      ai.classify(items, options),
    );
    for (const r of results) {
      if (r.ok) categories.set(r.messageId, r.data.category);
      else if (stopsRun(run, r.error)) throw aiFailed(r.error);
      else if (r.error.kind !== "not_retried") {
        await markAnalysisFailed(db, workspaceId, { messageId: r.messageId, scanId });
        outcome.analyzed += 1;
      }
    }
  }
  for (const row of batch) {
    const messageId = row.envelope.messageId;
    if (categories.get(messageId) !== "not_job") continue;
    await saveAnalysis(db, workspaceId, { messageId, scanId, category: "not_job", roles: [] });
    outcome.analyzed += 1;
  }
  for (const row of batch) {
    const messageId = row.envelope.messageId;
    const category = categories.get(messageId);
    if (!category || category === "not_job") continue;
    if (run.stopRequested() || run.callsLeft() <= 0) return outcome;
    const extract = () => run.call(() => ai.extract(item(row), { maxCalls: maxCalls(run) }));
    let result = await extract();
    // Asked again once after an error answer, in a run that asks one by one (askBatch); left
    // pending when no call is left for it.
    if (run.oneByOne && !result.ok && requestFailed(result.error)) {
      if (run.stopRequested() || run.callsLeft() <= 0) return outcome;
      result = await extract();
    }
    if (result.ok) {
      await saveAnalysis(db, workspaceId, {
        messageId,
        scanId,
        category,
        roles: result.data.roles,
      });
      outcome.analyzed += 1;
      outcome.jobs.push(messageId);
    } else if (stopsRun(run, result.error)) {
      throw aiFailed(result.error);
    } else if (result.error.kind !== "not_retried") {
      await markAnalysisFailed(db, workspaceId, { messageId, scanId });
      outcome.analyzed += 1;
    }
  }
  return outcome;
}
