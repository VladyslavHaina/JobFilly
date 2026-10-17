import { z } from "zod";
import { CountryCodeSchema, IdSchema, IsoDateTimeSchema, TextSchema } from "./common";
import { ScanFocusSchema } from "./focus";
import { EnvelopeSchema } from "./mailbox";
import { StageOneVerdictSchema } from "./messages";
import { IntakeProposalSchema } from "./profile";

/**
 * The first scan, an "Analyze them" run over what a confident stop left unread, or (MVP 3, F1.1)
 * a re-run of setup, steered by the user's hint, whose intake form makes a new profile.
 */
export const ScanKindSchema = z.enum(["first", "analyze_rest", "rerun"]);
export type ScanKind = z.infer<typeof ScanKindSchema>;

export const ScanStatusSchema = z.enum(["queued", "running", "stopped"]);
export type ScanStatus = z.infer<typeof ScanStatusSchema>;

/** Why a run stopped (F4.4); failed covers a run that could not go on (mailbox or AI gone). */
export const StopReasonSchema = z.enum(["confident", "budget", "done", "cancelled", "failed"]);
export type StopReason = z.infer<typeof StopReasonSchema>;

/**
 * What a failed run ran into, so its stop message points to the right place: the mailbox
 * (Settings › Mailbox), the AI provider (Settings › AI), or JobFilly itself, where no setting
 * would help. Null for every other stop.
 */
export const StopCauseSchema = z.enum(["mailbox", "ai", "internal"]);
export type StopCause = z.infer<typeof StopCauseSchema>;

/** The counts the scan screen shows. */
export const ScanCountsSchema = z.object({
  /** Sorted by stage one from the headers alone, without a model call. */
  handledWithoutAi: z.number().int().nonnegative(),
  /** Likely job messages in the window (the Y of "confident after X of Y"). */
  likely: z.number().int().nonnegative(),
  /** Likely job messages the model has read (the X). */
  analyzed: z.number().int().nonnegative(),
  jobFound: z.number().int().nonnegative(),
  /** Intake answers at medium confidence or better. */
  answersFirm: z.number().int().nonnegative(),
  notAnalyzed: z.number().int().nonnegative(),
});
export type ScanCounts = z.infer<typeof ScanCountsSchema>;

export const EMPTY_SCAN_COUNTS: ScanCounts = {
  handledWithoutAi: 0,
  likely: 0,
  analyzed: 0,
  jobFound: 0,
  answersFirm: 0,
  notAnalyzed: 0,
};

/** A scan run as packages/db stores it. */
export const ScanSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  kind: ScanKindSchema,
  status: ScanStatusSchema,
  stopReason: StopReasonSchema.nullable(),
  /** Set only when stopReason is failed. */
  stopCause: StopCauseSchema.nullable(),
  counts: ScanCountsSchema,
  calls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** Null once that account is gone (MVP 3, F7.3). */
  startedBy: z.uuid().nullable(),
  startedAt: IsoDateTimeSchema,
  stoppedAt: IsoDateTimeSchema.nullable(),
  /**
   * MVP 3 (F1.1): a re-run's hint as typed, and what focus.v1 read from it (null until read, or
   * without a hint). Never logged; the API doesn't send them with a scan's progress.
   */
  hint: z.string().nullable().optional(),
  focus: ScanFocusSchema.nullable().optional(),
});
export type Scan = z.infer<typeof ScanSchema>;

/** The progress the scan screen shows, sent live over SSE (scan.progress). */
export const ScanProgressSchema = ScanCountsSchema.extend({
  scanId: z.uuid(),
  kind: ScanKindSchema,
  status: ScanStatusSchema,
  stopReason: StopReasonSchema.nullable(),
  /** Model calls made in this run. */
  calls: z.number().int().nonnegative(),
  /** Input plus output tokens of this run. */
  tokens: z.number().int().nonnegative(),
});
export type ScanProgress = z.infer<typeof ScanProgressSchema>;

/** GET /scans/current: the latest run with its stop message in plain words, if it stopped. */
export const CurrentScanSchema = z.object({
  progress: ScanProgressSchema.nullable(),
  stopMessage: z.string().nullable(),
  /** When the latest run stopped, so a stop reads as that run's and not an earlier one's. */
  stoppedAt: IsoDateTimeSchema.nullable(),
  /** Tokens used by the workspace across every model call so far (F3.6). */
  totalTokens: z.number().int().nonnegative(),
});
export type CurrentScan = z.infer<typeof CurrentScanSchema>;

/** At most this many characters of a re-run's hint ("I've moved to Germany, permanent roles only"). */
export const MAX_SCAN_HINT_LENGTH = 500;

/**
 * POST /scans: the first scan, or a re-run of setup (F1.1) with an optional hint. A re-run is
 * allowed once the first scan has stopped.
 */
export const StartScanInputSchema = z.object({
  kind: z.enum(["first", "rerun"]).default("first"),
  hint: TextSchema.trim().max(MAX_SCAN_HINT_LENGTH).optional(),
});
export type StartScanInput = z.input<typeof StartScanInputSchema>;

/** POST /scans/:scanId/cancel. */
export const ScanParamsSchema = z.object({ scanId: IdSchema });

/** The payload of a 'scan.run' job in the queue. */
export const ScanRunPayloadSchema = z.object({ scanId: z.uuid(), workspaceId: z.uuid() });
export type ScanRunPayload = z.infer<typeof ScanRunPayloadSchema>;

/** The first scan covers the last 90 days of Inbox and Sent (F4.1). */
export const SCAN_WINDOW_DAYS = 90;

/**
 * packages/core/data/job-platforms.json: known job boards and applicant-tracking systems.
 * `domain` is a lowercase hostname matched as the sender's domain or any subdomain of it;
 * `countries` is empty for international platforms; `alertSenders` are the local parts that send
 * job alerts.
 */
export const JobPlatformsFileSchema = z.object({
  version: z.literal(1),
  entries: z.array(
    z.object({
      domain: z
        .string()
        .regex(
          /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/,
          "a lowercase hostname",
        ),
      kind: z.enum(["job_board", "ats"]),
      countries: z.array(CountryCodeSchema),
      alertSenders: z.array(z.string().min(1)),
    }),
  ),
});
export type JobPlatformsFile = z.infer<typeof JobPlatformsFileSchema>;

/** What stage one needs besides the envelopes (packages/core › stageOne). */
export const StageOneContextSchema = z.object({
  /** The mailbox's own addresses, to recognise the user's replies and who they replied to. */
  ownAddresses: z.array(z.string()),
  platforms: JobPlatformsFileSchema,
});
export type StageOneContext = z.infer<typeof StageOneContextSchema>;

/**
 * One envelope with stage one's verdict: what packages/core's stageOne decides and what
 * packages/db's saveEnvelopes stores, in one shape.
 */
export const StageOneResultSchema = z.object({
  envelope: EnvelopeSchema,
  verdict: StageOneVerdictSchema,
  /** Why stage one decided so, in a few words (no subject or address). */
  reason: z.string().nullable(),
});
export type StageOneResult = z.infer<typeof StageOneResultSchema>;

/**
 * Stage one's sorting of a set of envelopes. Every envelope is in exactly one of the three lists,
 * so `[...handled, ...candidates, ...ownReplies]` is what saveEnvelopes takes.
 */
export const StageOneOutcomeSchema = z.object({
  /** Sorted without a model call. */
  handled: z.array(
    StageOneResultSchema.extend({
      verdict: StageOneVerdictSchema.extract(["not_job", "job_alert"]),
    }),
  ),
  /** Likely job messages for the model. */
  candidates: z.array(StageOneResultSchema.extend({ verdict: z.literal("likely_job") })),
  /** The user's own replies, read for preferences. */
  ownReplies: z.array(StageOneResultSchema.extend({ verdict: z.literal("own_reply") })),
});
export type StageOneOutcome = z.infer<typeof StageOneOutcomeSchema>;

/** What the confidence tracker looks at after every batch (F4.4). */
export const TrackerStateSchema = z.object({
  proposal: IntakeProposalSchema,
  /** Likely messages still unread in the window. */
  remaining: z.number().int().nonnegative(),
  callsUsed: z.number().int().nonnegative(),
  budget: z.number().int().nonnegative(),
});
export type TrackerState = z.infer<typeof TrackerStateSchema>;

/**
 * What the confidence tracker remembers between batches, so a run taken over by another replica
 * resumes with the same count of unchanged batches (it is kept in the scan job's checkpoint).
 */
export const TrackerMemorySchema = z.object({
  /** The answers (each key's value and confidence) after the last batch; null before the first. */
  lastAnswers: z.string().nullable(),
  /** How many batches in a row changed no answer. */
  unchangedBatches: z.number().int().nonnegative(),
});
export type TrackerMemory = z.infer<typeof TrackerMemorySchema>;

/**
 * What a 'scan.run' job saves after every batch, so a replica that takes the run over resumes it
 * where the last batch ended: stage one is not redone, finished batches are not redone and their
 * numbers are not reused, and the confidence tracker keeps its count of unchanged batches.
 */
export const ScanCheckpointSchema = z.object({
  /** Likely job emails waiting when the run began: the Y of "after X of Y". */
  likely: z.number().int().nonnegative(),
  /** Sorted by stage one without a model call (0 for an "Analyze them" run). */
  handledWithoutAi: z.number().int().nonnegative(),
  /** The user's own replies have been read for preferences (the first scan reads them first). */
  repliesRead: z.boolean(),
  /** Batches finished so far, replies and likely job mail together; the next is batches + 1. */
  batches: z.number().int().nonnegative(),
  tracker: TrackerMemorySchema,
});
export type ScanCheckpoint = z.infer<typeof ScanCheckpointSchema>;
