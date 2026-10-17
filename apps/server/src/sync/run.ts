import type { AiClient } from "@jobfilly/ai";
import { loadJobPlatforms, stageOne } from "@jobfilly/core";
import {
  countSyncAnalysisFailures,
  getAiSettings,
  getLatestScan,
  getMailboxConnection,
  getStoredMessages,
  getSyncState,
  listHeldBySync,
  newestStoredUid,
  recordSyncFailure,
  recordSyncSuccess,
  reindexMessages,
  type StoredMailbox,
  type SyncState,
  saveEnvelopes,
} from "@jobfilly/db";
import { type MailClient, MailUnavailableError, UNAVAILABLE_MESSAGES } from "@jobfilly/mail";
import {
  AI_BATCH_SIZE,
  SCAN_WINDOW_DAYS,
  type StoredMessage,
  type SyncedEnvelope,
  type SyncFailureReason,
  type Usage,
} from "@jobfilly/schema";
import { aiClientFor } from "../ai-usage";
import { DAY, MINUTE } from "../clock";
import type { AppDeps } from "../deps";
import type { Logger } from "../log";
import { connectStoredMailbox, MailboxSecretError, ReconnectNeededError } from "../mailbox";
import { type AnalysisRun, analyzeBatch, RunFailed } from "../pipeline/analyze";
import { evaluateMessage, type MailboxSession } from "../pipeline/evaluate";
import type { Stages } from "../pipeline/stages";
import { openAiKey } from "../secrets";

// One sync of one mailbox (F1): the mail.sync job's work. It reads INBOX after the last UID it
// read (fetchSince), so only new mail is fetched, and:
//
// - re-indexes by Message-ID (F1.3): every message the mailbox returns that is stored already
//   gets its new UID, and nothing else changes; after a new UIDVALIDITY that is the whole folder
//   (logged as sync.uidvalidity_changed), and corrections, decisions and drafts stay; mail the
//   cursor was held for is still sorted, under its new UID;
// - sorts the new messages by their headers (stage one) and stores them, then sorts and extracts
//   the likely job mail with the model (pipeline/analyze.ts), and runs each job message through
//   the rest of the pipeline (evaluate.ts: sender check, CV choice and match, reply), so it shows
//   up in the job inbox within one interval, live for everyone (F1.1);
// - moves its cursor past what it read, but not past new mail the model couldn't sort yet (no
//   call left in the run's budget, the provider failing): the next sync tries that one again.
//   Only a message that MAX_SYNC_ANALYSIS_FAILURES syncs tried and failed on is let go, so one
//   the provider keeps failing on can't make every sync re-read the mail after it for ever: it
//   stays "not analyzed", for "Analyze them";
// - on failure records it with an exponential back-off and the status "failing since", logs
//   sync.failed and tells open pages (F1.4); the next sync that works clears it.
//
// The sync starts only once the workspace's first scan has stopped: until then the scan reads the
// mailbox, and the cursor starts where the scan's stored messages end. Every message after a
// known cursor is new, whatever its Date header says. Only when the sync reads the whole folder
// (no cursor yet, or a new UIDVALIDITY) is mail that arrived before the first scan's window left
// out; how old mail is goes by when it arrived (INTERNALDATE), never by the sender's Date header.
// The sync reads INBOX only: the Sent folder feeds the first scan's preferences, not job mail.

/** The folder the sync reads; IMAP names the inbox INBOX on every server (RFC 3501). */
export const SYNC_FOLDER = "INBOX";

/** The longest back-off: a mailbox that keeps failing is tried at least this often. */
const MAX_BACKOFF_MS = 15 * MINUTE;

/**
 * How many syncs may try to have the model sort a message and fail (the provider failing, or no
 * AI set up) while it still holds the cursor: about an hour at the default two-minute interval,
 * so a provider that is down for a while doesn't leave new mail unsorted.
 */
export const MAX_SYNC_ANALYSIS_FAILURES = 30;

/**
 * How long a sync waits after `failures` failures in a row: one interval after the first, then
 * doubling, at most 15 minutes (or one interval, if that is longer).
 */
export function backoffMs(failures: number, intervalMs: number): number {
  const doubled = intervalMs * 2 ** Math.max(0, failures - 1);
  return Math.min(doubled, Math.max(intervalMs, MAX_BACKOFF_MS));
}

/**
 * Whether a mailbox backing off is due at `now`. Ticks come every interval but a sync takes a
 * moment to run, so a next attempt up to half an interval away counts as due: a back-off of one
 * interval then means the very next tick, not the one after.
 */
export function isDue(nextAttemptAt: Date | null, now: Date, intervalMs: number): boolean {
  return nextAttemptAt === null || nextAttemptAt.getTime() - now.getTime() <= intervalMs / 2;
}

export type SyncOutcome =
  | {
      status: "skipped";
      reason: "no_mailbox" | "first_scan_running" | "backing_off" | "reconnect_needed";
    }
  | { status: "synced"; fresh: number; uidValidityChanged: boolean; lastUid: number }
  | { status: "failed"; failures: number };

export interface SyncOptions {
  signal?: AbortSignal;
  /** The pipeline's stages (tests inject recording ones). */
  stages?: Stages;
}

/**
 * The sync couldn't go on; `code` is the log's cause, `reason` the status's code for the UI and
 * `message` the words the status shows.
 */
class SyncFailed extends Error {
  constructor(
    readonly code: string,
    readonly reason: SyncFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "SyncFailed";
  }
}

function connect(deps: AppDeps, mailbox: StoredMailbox): MailClient {
  try {
    return connectStoredMailbox(deps, mailbox);
  } catch (error) {
    if (!(error instanceof MailboxSecretError)) throw error;
    // Sealed under another JOBFILLY_SECRET_KEY: the server's configuration, not the mailbox.
    throw new SyncFailed(
      "secret_error",
      "secret_error",
      "The mailbox password can't be read on this server",
    );
  }
}

/** The workspace's AI client and budget per run, or null when none can be used. */
async function aiFor(
  deps: AppDeps,
  workspaceId: string,
): Promise<{ ai: AiClient; budget: number } | null> {
  const settings = await getAiSettings(deps.db, workspaceId);
  if (!settings) return null;
  try {
    const apiKey = openAiKey(deps.config.secretKey, settings.keyCiphertext);
    const ai = aiClientFor(deps, workspaceId, {
      provider: settings.provider,
      baseUrl: settings.baseUrl,
      models: settings.models,
      apiKey,
    });
    return { ai, budget: settings.budgetPerRun };
  } catch {
    return null;
  }
}

/** Where to read from: the stored cursor, else where the first scan's stored messages end. */
async function cursorOf(
  deps: AppDeps,
  workspaceId: string,
  mailboxId: string,
  state: SyncState | null,
): Promise<{ uidValidity: number | null; lastUid: number }> {
  if (state?.uidValidity != null) {
    return { uidValidity: state.uidValidity, lastUid: state.lastUid ?? 0 };
  }
  const stored = await newestStoredUid(deps.db, workspaceId, SYNC_FOLDER, { mailboxId });
  return stored
    ? { uidValidity: stored.uidValidity, lastUid: stored.uid }
    : { uidValidity: null, lastUid: 0 };
}

const byUid = (a: StoredMessage, b: StoredMessage) => a.envelope.uid - b.envelope.uid;
const waitsForModel = (m: StoredMessage) =>
  (m.stageOne === "likely_job" || m.stageOne === "job_alert") && m.analysisStatus === "pending";

interface Analyzed {
  /** The job messages. */
  jobs: string[];
  /**
   * The messages the model was asked to sort, or couldn't be asked about at all (no AI set up);
   * not those the run's budget or a stop left untouched.
   */
  tried: Set<string>;
}

/**
 * Sorts and extracts the messages with the model, batch by batch within the run's budget. A
 * provider that fails ends the analysis (the messages wait for the next sync); a mailbox that
 * can't be read fails the sync.
 */
async function analyze(
  deps: AppDeps,
  workspaceId: string,
  mail: MailClient,
  messages: StoredMessage[],
  log: Logger,
  signal: AbortSignal | undefined,
): Promise<Analyzed> {
  const ids = (batch: StoredMessage[]) => batch.map((m) => m.envelope.messageId);
  if (messages.length === 0) return { jobs: [], tried: new Set() };
  const setup = await aiFor(deps, workspaceId);
  if (!setup) {
    log.warn("pipeline.stage_failed", {
      stage: "analyze",
      error: "no_ai",
      waiting: messages.length,
    });
    return { jobs: [], tried: new Set(ids(messages)) };
  }
  let calls = 0;
  const run: AnalysisRun = {
    db: deps.db,
    workspaceId,
    scanId: null,
    ai: setup.ai,
    mail,
    callsLeft: () => setup.budget - calls,
    stopRequested: () => signal?.aborted ?? false,
    async call<T extends { usage: Usage[] }>(make: () => Promise<T>): Promise<T> {
      let result: T;
      try {
        result = await make();
      } catch {
        // packages/ai answers provider failures as values; a throw is a fault in JobFilly.
        throw new RunFailed("internal", "ai_client_error");
      }
      calls += result.usage.length;
      return result;
    },
  };
  const jobs: string[] = [];
  const tried = new Set<string>();
  for (let i = 0; i < messages.length; i += AI_BATCH_SIZE) {
    if (run.stopRequested() || run.callsLeft() <= 0) break;
    const batch = messages.slice(i, i + AI_BATCH_SIZE);
    for (const id of ids(batch)) tried.add(id);
    try {
      jobs.push(...(await analyzeBatch(run, batch)).jobs);
    } catch (error) {
      if (error instanceof RunFailed && error.stopCause === "mailbox") {
        throw new SyncFailed(error.code, "unreachable", UNAVAILABLE_MESSAGES.unreachable);
      }
      if (!(error instanceof RunFailed)) throw error;
      log.warn("pipeline.stage_failed", { stage: "analyze", error: error.code });
      break;
    }
  }
  return { jobs, tried };
}

/**
 * The last UID the cursor may move to: the highest read, but before the first message still
 * waiting for the model, so the next sync reads that one again.
 */
function nextLastUid(read: SyncedEnvelope[], waiting: StoredMessage[], from: number): number {
  const firstWaiting = Math.min(...waiting.map((m) => m.envelope.uid));
  const highest = Math.max(from, ...read.map((e) => e.uid));
  return Number.isFinite(firstWaiting) ? Math.min(highest, firstWaiting - 1) : highest;
}

export async function syncMailbox(
  deps: AppDeps,
  workspaceId: string,
  mailboxId: string,
  options: SyncOptions = {},
): Promise<SyncOutcome> {
  const { db } = deps;
  const log = deps.log.child({ workspaceId });
  const mailbox = await getMailboxConnection(db, workspaceId, mailboxId);
  // Disconnected since the job was queued.
  if (!mailbox) return { status: "skipped", reason: "no_mailbox" };
  // MVP 3 (F3.2): Google refused its sign-in; it waits, cursor and all, until the user signs in
  // again.
  if (mailbox.status === "reconnect_needed")
    return { status: "skipped", reason: "reconnect_needed" };
  const firstScan = await getLatestScan(db, workspaceId, "first");
  if (firstScan?.status !== "stopped") {
    return { status: "skipped", reason: "first_scan_running" };
  }

  // The back-off is checked again here, not only when the sync was queued (F1.4): a sync queued
  // while a failing one still hung would otherwise run the moment that one failed.
  const state = await getSyncState(db, workspaceId, mailboxId, SYNC_FOLDER);
  const intervalMs = deps.config.syncIntervalSeconds * 1000;
  if (!isDue(state?.nextAttemptAt ?? null, deps.clock.now(), intervalMs)) {
    return { status: "skipped", reason: "backing_off" };
  }

  log.info("sync.started", { mailboxId });
  let mail: MailClient | null = null;
  try {
    mail = connect(deps, mailbox);
    const client = mail;
    const cursor = await cursorOf(deps, workspaceId, mailboxId, state);
    const result = await client.fetchSince({
      folder: "inbox",
      uidValidity: cursor.uidValidity,
      afterUid: cursor.lastUid,
    });
    if (result.changed) {
      log.info("sync.uidvalidity_changed", {
        mailboxId,
        folder: SYNC_FOLDER,
        previous: cursor.uidValidity,
        current: result.uidValidity,
      });
    }

    // After a new UIDVALIDITY the cursor's UIDs name other messages, so what it is held for (mail
    // an earlier sync stored but the model couldn't sort yet) is found by them before re-indexing.
    const held =
      result.changed && cursor.uidValidity !== null
        ? await listHeldBySync(db, workspaceId, {
            folderPath: SYNC_FOLDER,
            uidValidity: cursor.uidValidity,
            afterUid: cursor.lastUid,
          })
        : [];

    // Stored messages move to their UIDs now; the rest is new. After a known cursor that is
    // every one of them; reading the whole folder, only what arrived within the scan's window.
    const known = await reindexMessages(db, workspaceId, result.messages, { mailboxId });
    const wholeFolder = cursor.uidValidity === null || result.changed;
    const windowStart = Date.parse(firstScan.startedAt) - SCAN_WINDOW_DAYS * DAY;
    const unknown = result.messages.filter((e) => !known.has(e.messageId));
    const fresh = wholeFolder
      ? unknown.filter((e) => Date.parse(e.receivedAt) >= windowStart)
      : unknown;
    const sorted = stageOne(fresh, {
      ownAddresses: [mailbox.address, mailbox.username],
      platforms: loadJobPlatforms(),
    });
    await saveEnvelopes(
      db,
      workspaceId,
      [...sorted.handled, ...sorted.candidates, ...sorted.ownReplies],
      { mailboxId },
    );
    if (fresh.length > 0) await publish(deps, log, workspaceId, "messages.updated");

    // The new likely job mail, and mail an earlier sync stored but couldn't have sorted yet:
    // after a known cursor, every stored message read is after it. After a new UIDVALIDITY the
    // whole folder is read, so of the stored mail only what the cursor was held for is sorted
    // here; the first scan's own mail still waiting is left to "Analyze them".
    const carried = result.changed ? held.filter((id) => known.has(id)) : [...known];
    const candidates = [...fresh.map((e) => e.messageId), ...carried];
    const toAnalyze = (await getStoredMessages(db, workspaceId, candidates))
      .filter(waitsForModel)
      .sort(byUid);
    const { jobs, tried } = await analyze(
      deps,
      workspaceId,
      client,
      toAnalyze,
      log,
      options.signal,
    );

    // Each job message through the rest of the pipeline, over this sync's connection.
    const shared: MailboxSession = { get: async () => client, close: async () => {} };
    for (const messageId of jobs) {
      options.signal?.throwIfAborted();
      await evaluateMessage(deps, workspaceId, messageId, {
        origin: "new",
        stages: options.stages,
        mailbox: shared,
      });
    }

    // Mail still waiting for the model holds the cursor. Each one this sync tried counts a
    // failure; one that has failed MAX_SYNC_ANALYSIS_FAILURES syncs is let go, so a message the
    // provider keeps failing on can't make every sync re-read it for ever: it stays "not
    // analyzed", for "Analyze them". Mail the budget left untouched isn't counted.
    const still = (
      await getStoredMessages(
        db,
        workspaceId,
        toAnalyze.map((m) => m.envelope.messageId),
      )
    ).filter(waitsForModel);
    const failures = await countSyncAnalysisFailures(
      db,
      workspaceId,
      still.map((m) => m.envelope.messageId).filter((id) => tried.has(id)),
    );
    const waiting = still.filter(
      (m) => (failures.get(m.envelope.messageId) ?? 0) < MAX_SYNC_ANALYSIS_FAILURES,
    );
    const lastUid = nextLastUid(result.messages, waiting, result.changed ? 0 : cursor.lastUid);
    await recordSyncSuccess(db, workspaceId, mailboxId, {
      folderPath: SYNC_FOLDER,
      uidValidity: result.uidValidity,
      lastUid,
      at: deps.clock.now(),
    });
    log.info("sync.completed", {
      mailboxId,
      new: fresh.length,
      // Read with the whole folder but arrived before the first scan's window: not stored.
      beforeWindow: unknown.length - fresh.length,
      waiting: waiting.length,
      letGo: still.length - waiting.length,
    });
    await publish(deps, log, workspaceId, "mailbox.updated");
    return {
      status: "synced",
      fresh: fresh.length,
      uidValidityChanged: result.changed,
      lastUid,
    };
  } catch (error) {
    // Shutting down or taken over: the job runs again elsewhere, from the same cursor.
    if (options.signal?.aborted) throw error;
    // Google refused the refresh just now: the mailbox says "Reconnect needed", not failing.
    if (error instanceof ReconnectNeededError) {
      return { status: "skipped", reason: "reconnect_needed" };
    }
    return await recordFailure(deps, log, workspaceId, mailboxId, state, error);
  } finally {
    await mail?.close().catch(() => {});
  }
}

/** A failed sync (F1.4): logged, recorded with its back-off, and shown on open pages. */
async function recordFailure(
  deps: AppDeps,
  log: Logger,
  workspaceId: string,
  mailboxId: string,
  state: SyncState | null,
  error: unknown,
): Promise<SyncOutcome> {
  const { code, reason, message } =
    error instanceof SyncFailed
      ? { code: error.code, reason: error.reason, message: error.message }
      : error instanceof MailUnavailableError
        ? { code: "mail_unavailable", reason: error.reason, message: error.message }
        : {
            code: "error",
            reason: "error" as const,
            message: "Something went wrong while syncing the mailbox",
          };
  const now = deps.clock.now();
  const failures = (state?.failures ?? 0) + 1;
  const retryMs = backoffMs(failures, deps.config.syncIntervalSeconds * 1000);
  await recordSyncFailure(deps.db, workspaceId, mailboxId, {
    folderPath: SYNC_FOLDER,
    failures,
    nextAttemptAt: new Date(now.getTime() + retryMs),
    reason,
    message,
    at: now,
  });
  // Unexpected errors are named, never their text: it could hold the server or account.
  log.warn("sync.failed", {
    mailboxId,
    cause: code,
    error: code === "error" && error instanceof Error ? error.name : undefined,
    failures,
    retryInSeconds: Math.round(retryMs / 1000),
  });
  await publish(deps, log, workspaceId, "mailbox.updated");
  return { status: "failed", failures };
}

/** Tells open pages; an event that can't go out is logged and never fails the sync. */
async function publish(
  deps: AppDeps,
  log: Logger,
  workspaceId: string,
  type: "messages.updated" | "mailbox.updated",
) {
  await deps.live
    .publish(workspaceId, { type, data: {} })
    .catch((error: unknown) => log.warn("live.error", { error }));
}
