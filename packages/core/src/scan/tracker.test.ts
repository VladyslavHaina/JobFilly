import type { IntakeProposal, IntakeProposalEntry, TrackerState } from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { createConfidenceTracker, stopMessage } from "./tracker";

function entry(
  key: IntakeProposalEntry["key"],
  value: string[],
  confidence: IntakeProposalEntry["confidence"],
): IntakeProposalEntry {
  return {
    key,
    label: key,
    value,
    confidence: value.length > 0 ? confidence : null,
    evidence:
      value.length > 0 ? [{ messageId: `<${key}@x>`, reason: "from 2 of your replies" }] : [],
    emptyReason: value.length > 0 ? null : "Not enough evidence",
  };
}

const proposal = (...entries: IntakeProposalEntry[]): IntakeProposal => ({ entries });
const firm = proposal(
  entry("target_roles", ["backend engineer"], "high"),
  entry("languages", ["English", "Portuguese"], "medium"),
  entry("deal_breakers", [], null),
);
const state = (p: IntakeProposal, more: Partial<TrackerState> = {}): TrackerState => ({
  proposal: p,
  remaining: 200,
  callsUsed: 10,
  budget: 300,
  ...more,
});

describe("the confidence tracker (F4.4)", () => {
  it("stops a first scan as confident after two batches that changed no answer", () => {
    const tracker = createConfidenceTracker("first");
    tracker.begin(firm);
    expect(tracker.afterBatch(state(firm))).toBeNull();
    expect(tracker.afterBatch(state(firm))).toEqual({ reason: "confident" });
  });

  it("counts again from zero when a batch changes a value or a confidence", () => {
    const tracker = createConfidenceTracker("first");
    tracker.begin(firm);
    expect(tracker.afterBatch(state(firm))).toBeNull();
    const moreLanguages = proposal(
      entry("target_roles", ["backend engineer"], "high"),
      entry("languages", ["English", "Portuguese", "German"], "medium"),
    );
    expect(tracker.afterBatch(state(moreLanguages))).toBeNull();
    const surer = proposal(
      entry("target_roles", ["backend engineer"], "high"),
      entry("languages", ["English", "Portuguese", "German"], "high"),
    );
    expect(tracker.afterBatch(state(surer))).toBeNull();
    expect(tracker.afterBatch(state(surer))).toBeNull();
    expect(tracker.afterBatch(state(surer))).toEqual({ reason: "confident" });
  });

  it("ignores more evidence for the same answer and the order of a value's items", () => {
    const tracker = createConfidenceTracker("first");
    tracker.begin(firm);
    const reordered = proposal(
      { ...entry("languages", ["Portuguese", "English"], "medium"), evidence: [] },
      entry("target_roles", ["backend engineer"], "high"),
      entry("deal_breakers", [], null),
    );
    expect(tracker.afterBatch(state(reordered))).toBeNull();
    expect(tracker.afterBatch(state(reordered))).toEqual({ reason: "confident" });
  });

  it("without a baseline, the first batch counts as a change", () => {
    const tracker = createConfidenceTracker("first");
    expect(tracker.afterBatch(state(firm))).toBeNull();
    expect(tracker.afterBatch(state(firm))).toBeNull();
    expect(tracker.afterBatch(state(firm))).toEqual({ reason: "confident" });
  });

  it("needs at least one answer, every answered core question at medium or better", () => {
    const empty = proposal(entry("target_roles", [], null), entry("min_pay", [], null));
    const weak = proposal(
      entry("target_roles", ["backend engineer"], "high"),
      entry("seniority", ["senior"], "low"),
    );
    for (const p of [empty, weak, proposal()]) {
      const tracker = createConfidenceTracker("first");
      tracker.begin(p);
      for (let i = 0; i < 5; i++) expect(tracker.afterBatch(state(p))).toBeNull();
    }
  });

  it("says done when nothing likely is left, even when confident also holds (done wins)", () => {
    const tracker = createConfidenceTracker("first");
    tracker.begin(firm);
    tracker.afterBatch(state(firm));
    expect(tracker.afterBatch(state(firm, { remaining: 0, callsUsed: 300 }))).toEqual({
      reason: "done",
    });
  });

  it("stops for budget once the run's calls are used up", () => {
    const tracker = createConfidenceTracker("first");
    tracker.begin(proposal());
    expect(tracker.afterBatch(state(proposal(), { callsUsed: 299 }))).toBeNull();
    expect(tracker.afterBatch(state(proposal(), { callsUsed: 300 }))).toEqual({
      reason: "budget",
    });
  });

  it("never stops an Analyze them run as confident", () => {
    const tracker = createConfidenceTracker("analyze_rest");
    tracker.begin(firm);
    for (let i = 0; i < 5; i++) expect(tracker.afterBatch(state(firm))).toBeNull();
    expect(tracker.afterBatch(state(firm, { callsUsed: 5, budget: 5 }))).toEqual({
      reason: "budget",
    });
    expect(tracker.afterBatch(state(firm, { remaining: 0 }))).toEqual({ reason: "done" });
  });

  it("resumes from its memory with the same count of unchanged batches", () => {
    const first = createConfidenceTracker("first");
    first.begin(firm);
    first.afterBatch(state(firm));
    const memory = first.memory();
    expect(memory.unchangedBatches).toBe(1);
    const resumed = createConfidenceTracker("first", memory);
    resumed.begin(proposal());
    expect(resumed.afterBatch(state(firm))).toEqual({ reason: "confident" });
  });
});

describe("stopMessage (F4.4)", () => {
  it("says why the run stopped in plain words", () => {
    expect(stopMessage("confident", 140, 260)).toBe(
      "Stopped: confident after 140 of 260 likely job emails",
    );
    expect(stopMessage("budget", 4, 230)).toBe(
      "Stopped: the AI budget for this run was used up after 4 of 230 likely job emails",
    );
    expect(stopMessage("done", 19, 19)).toBe("Stopped: done, all 19 likely job emails analyzed");
    expect(stopMessage("done", 1, 1)).toBe("Stopped: done, all 1 likely job email analyzed");
    expect(stopMessage("done", 0, 0)).toBe("Stopped: done, no likely job emails to analyze");
    expect(stopMessage("cancelled", 20, 1)).toBe(
      "Stopped: cancelled after 20 of 1 likely job email",
    );
    expect(stopMessage("failed", 0, 12)).toMatch(/^Stopped: couldn't go on after 0 of 12 /);
  });
});
