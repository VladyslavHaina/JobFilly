import {
  CoreProfileKeySchema,
  type IntakeProposal,
  type ScanKind,
  type StopCause,
  type StopReason,
  type TrackerMemory,
  type TrackerState,
} from "@jobfilly/schema";

// The confidence tracker and the stop rules of F4.4. After every batch of likely job mail the
// worker hands it the intake proposal as it stands, what is left and the calls used; it answers
// why the run stops now, or null to go on:
//
//   done       nothing likely is left in the window (it wins over every other reason);
//   confident  the first scan and a re-run of setup (MVP 3, F1.1) only: two batches in a row
//              changed no intake answer, at least one core question is answered, and every
//              answered one is at least medium confidence;
//   budget     the run's model-call budget is used up.
//
// The user's replies are read before the first batch, and the proposal they give is the
// baseline the first batch is compared with (begin), so a scan can stop after 40 messages when
// the replies already said everything. Cancelling is the worker's business, not the tracker's.

/** Batches in a row that must change no answer before a first scan may stop as confident. */
const CONFIDENT_AFTER_UNCHANGED_BATCHES = 2;

export interface ConfidenceTracker {
  /** Takes the proposal the run starts from as the baseline, unless one is remembered already. */
  begin(proposal: IntakeProposal): void;
  /** Called after every batch; says why the run stops now, or null to go on. */
  afterBatch(state: TrackerState): { reason: StopReason } | null;
  /** What to keep in the checkpoint, so a run taken over by another replica goes on the same. */
  memory(): TrackerMemory;
}

const isCoreKey = (key: string) => CoreProfileKeySchema.safeParse(key).success;

/**
 * The answers as one comparable string: each key's value and confidence. Evidence is left out
 * (more mail saying the same thing changes no answer), and so is the order of a value's items.
 */
function snapshot(proposal: IntakeProposal): string {
  const answers = proposal.entries
    .map((e) => [e.key, e.value.map((v) => JSON.stringify(v)).sort(), e.confidence] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(answers);
}

const answered = (proposal: IntakeProposal) =>
  proposal.entries.filter((e) => isCoreKey(e.key) && e.value.length > 0);
const isFirm = (e: IntakeProposal["entries"][number]) =>
  e.confidence === "medium" || e.confidence === "high";

/** At least one core question answered, and every answered one at medium or high confidence. */
function firm(proposal: IntakeProposal): boolean {
  const answers = answered(proposal);
  return answers.length > 0 && answers.every(isFirm);
}

/** The core questions answered at medium or high confidence: the scan screen's "answers firm". */
export function countFirmAnswers(proposal: IntakeProposal): number {
  return answered(proposal).filter(isFirm).length;
}

export function createConfidenceTracker(
  kind: ScanKind,
  memory: TrackerMemory = { lastAnswers: null, unchangedBatches: 0 },
): ConfidenceTracker {
  let lastAnswers = memory.lastAnswers;
  let unchangedBatches = memory.unchangedBatches;
  return {
    begin(proposal) {
      lastAnswers ??= snapshot(proposal);
    },
    afterBatch(state) {
      const answers = snapshot(state.proposal);
      unchangedBatches = lastAnswers === answers ? unchangedBatches + 1 : 0;
      lastAnswers = answers;
      if (state.remaining === 0) return { reason: "done" };
      if (
        kind !== "analyze_rest" &&
        unchangedBatches >= CONFIDENT_AFTER_UNCHANGED_BATCHES &&
        firm(state.proposal)
      ) {
        return { reason: "confident" };
      }
      if (state.callsUsed >= state.budget) return { reason: "budget" };
      return null;
    },
    memory: () => ({ lastAnswers, unchangedBatches }),
  };
}

const emails = (n: number) => `${n} likely job email${n === 1 ? "" : "s"}`;

/** Why a failed run couldn't go on, and where to look, by what it ran into. */
const FAILED: Record<StopCause, (progress: string) => string> = {
  mailbox: (progress) =>
    `Stopped: couldn't read your mailbox ${progress}. Check Settings › Mailbox, then try again.`,
  ai: (progress) =>
    `Stopped: the AI provider couldn't be used ${progress}. Check Settings › AI, then try again.`,
  internal: (progress) =>
    `Stopped: something went wrong on JobFilly's side ${progress}. Your settings don't need changing; trying again later may help.`,
};

/**
 * The stop in plain words, e.g. "Stopped: confident after 140 of 260 likely job emails". A failed
 * run names what it ran into (`cause`); one stored without a cause only says it couldn't go on.
 */
export function stopMessage(
  reason: StopReason,
  analyzed: number,
  likely: number,
  cause: StopCause | null = null,
): string {
  const progress = `after ${analyzed} of ${emails(likely)}`;
  switch (reason) {
    case "confident":
      return `Stopped: confident ${progress}`;
    case "budget":
      return `Stopped: the AI budget for this run was used up ${progress}`;
    case "done":
      return likely === 0
        ? "Stopped: done, no likely job emails to analyze"
        : `Stopped: done, all ${emails(likely)} analyzed`;
    case "cancelled":
      return `Stopped: cancelled ${progress}`;
    case "failed":
      return cause ? FAILED[cause](progress) : `Stopped: couldn't go on ${progress}. Try again.`;
  }
}
