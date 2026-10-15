import type {
  Envelope,
  JobPlatformsFile,
  ScanKind,
  StageOneContext,
  StageOneOutcome,
  StopReason,
  TrackerState,
} from "@jobfilly/schema";

// The first scan's decisions without I/O: stage-one sorting from headers, candidate order,
// batches, and the confidence tracker with its stop rules (F4). The scan slice implements this
// module; the names and types below are the contract.

/** The job boards and applicant-tracking senders of packages/core/data/job-platforms.json. */
export function loadJobPlatforms(): JobPlatformsFile {
  return { version: 1, entries: [] };
}

/**
 * Sorts envelopes from their headers alone (F4.2). Every envelope comes back once, with its
 * verdict and reason, in the shape packages/db's saveEnvelopes stores (StageOneOutcomeSchema).
 */
export function stageOne(_envelopes: Envelope[], _ctx: StageOneContext): StageOneOutcome {
  throw new Error("stageOne is not built yet (scan slice)");
}

/** Newest first; ties broken by Message-ID so the order is stable. */
export function orderNewestFirst(_envelopes: readonly Envelope[]): Envelope[] {
  throw new Error("orderNewestFirst is not built yet (scan slice)");
}

/** Splits items into batches of `size` (20 by default, F4), keeping their order. */
export function toBatches<T>(_items: readonly T[], _size = 20): T[][] {
  throw new Error("toBatches is not built yet (scan slice)");
}

export interface ConfidenceTracker {
  /** Called after every batch; says why the run stops now, or null to go on. */
  afterBatch(state: TrackerState): { reason: StopReason } | null;
}

export function createConfidenceTracker(_kind: ScanKind): ConfidenceTracker {
  throw new Error("createConfidenceTracker is not built yet (scan slice)");
}

/** The stop in plain words, e.g. "Stopped: confident after 140 of 260 likely job emails". */
export function stopMessage(_reason: StopReason, _analyzed: number, _likely: number): string {
  throw new Error("stopMessage is not built yet (scan slice)");
}
