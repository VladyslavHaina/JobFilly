import type { AiClient } from "@jobfilly/ai";
import { type Database, markAnalysisFailed, saveAnalysis } from "@jobfilly/db";
import type { MailClient } from "@jobfilly/mail";
import type {
  AiError,
  AiMailItem,
  Category,
  StopCause,
  StoredMessage,
  Usage,
} from "@jobfilly/schema";

// Sorting and fact extraction of likely job mail (MVP 1 F3, MVP 2 F1.1): one classify call per
// batch for likely_job messages, then one extract call per job message and per job alert
// (TBD-68). The scan (jobs/scan) runs it on the first scan's window and on "Analyze them"; the
// sync (sync/run.ts) on new mail, before the rest of the pipeline (evaluate.ts). Bodies are
// fetched for the model and never stored (F4.9). Whoever runs it decides how many calls it may
// make and whether to stop; every call counts, retries included (TBD-17, TBD-66): a retry is only
// allowed while a call is left for it.

/** A message body is cut to this many characters before it goes to the model. */
const MAX_TEXT_LENGTH = 8000;

/** Provider failures that no other message would get past: the run stops. */
export const FATAL: readonly AiError["kind"][] = ["auth", "unreachable", "provider_error"];

/**
 * The run can't go on. `stopCause` is what the user is told it ran into (the mailbox, the AI
 * provider, or JobFilly itself); `code` is the log's finer cause, and `detail` adds codes for the
 * log line (a provider's HTTP status and error type), never a message.
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
  mail: MailClient;
  /** How many model calls are left in the run's budget. */
  callsLeft(): number;
  /** The run was cancelled, or the replica is shutting down: no further call is made. */
  stopRequested(): boolean;
  /** Makes one model call (two with a retry) and counts its usage; may throw to stop the run. */
  call<T extends { usage: Usage[] }>(make: () => Promise<T>): Promise<T>;
}

export interface BatchOutcome {
  /** Messages analysed now: stored with their category, or marked "Couldn't analyze". */
  analyzed: number;
  /** The job messages among them (any category but not_job), stored with their roles. */
  jobs: string[];
}

/** Two calls (a retry) while two are left, else one. */
export const maxCalls = (run: Pick<AnalysisRun, "callsLeft">): 1 | 2 =>
  run.callsLeft() >= 2 ? 2 : 1;

/**
 * What the model reads of each message: its headers and the body, fetched now, never kept. A
 * mailbox that can't be read stops the run (RunFailed "mailbox").
 */
export async function mailItems(
  mail: MailClient,
  rows: StoredMessage[],
): Promise<Map<string, AiMailItem>> {
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
    const result = await run.call(() =>
      ai.classify(toClassify.map(item), { maxCalls: maxCalls(run) }),
    );
    for (const r of result.items) {
      if (r.ok) categories.set(r.messageId, r.data.category);
      else if (r.error.kind === "invalid_output") {
        await markAnalysisFailed(db, workspaceId, { messageId: r.messageId, scanId });
        outcome.analyzed += 1;
      } else if (FATAL.includes(r.error.kind)) throw aiFailed(r.error);
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
    const result = await run.call(() => ai.extract(item(row), { maxCalls: maxCalls(run) }));
    if (result.ok) {
      await saveAnalysis(db, workspaceId, {
        messageId,
        scanId,
        category,
        roles: result.data.roles,
      });
      outcome.analyzed += 1;
      outcome.jobs.push(messageId);
    } else if (result.error.kind === "invalid_output") {
      await markAnalysisFailed(db, workspaceId, { messageId, scanId });
      outcome.analyzed += 1;
    } else if (FATAL.includes(result.error.kind)) {
      throw aiFailed(result.error);
    }
  }
  return outcome;
}
