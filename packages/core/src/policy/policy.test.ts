import type { ProfileEntry, SenderVerdict } from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { type HeldKind, type ReplyEligibilityInput, replyEligibility } from "./reply";
import { policyValue, withinReplyWindow } from "./window";

const now = new Date("2026-10-15T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

const entry = (key: ProfileEntry["key"], value: ProfileEntry["value"]): ProfileEntry => ({
  key,
  label: key,
  value,
  confidence: null,
  evidence: [],
  source: "you",
  updatedAt: now.toISOString(),
  updatedBy: null,
});

describe("the reply window (F1.6)", () => {
  it("is 14 days by default, inclusive", () => {
    expect(withinReplyWindow(daysAgo(14), now, null)).toBe(true);
    expect(withinReplyWindow(daysAgo(14.01), now, null)).toBe(false);
    expect(withinReplyWindow(daysAgo(30).toISOString(), now, { entries: [] })).toBe(false);
  });

  it("holds mail dated past a day ahead, which would otherwise stay in the window for good", () => {
    expect(withinReplyWindow(daysAgo(-0.5), now, null)).toBe(true);
    expect(withinReplyWindow(daysAgo(-30), now, null)).toBe(false);
    expect(withinReplyWindow("not a date", now, null)).toBe(false);
    expect(replyEligibility({ ...base, receivedAt: daysAgo(-30) }).heldBy).toEqual([
      { kind: "outside_window", reason: "Dated in the future" },
    ]);
  });

  it("follows reply_window_days", () => {
    const profile = { entries: [entry("reply_window_days", [30])] };
    expect(withinReplyWindow(daysAgo(29), now, profile)).toBe(true);
    expect(policyValue(profile, "reply_window_days")).toBe(30);
    expect(policyValue(profile, "reply_threshold")).toBe(70);
  });
});

const base: ReplyEligibilityInput = {
  origin: "auto",
  category: "recruiter_outreach",
  receivedAt: daysAgo(2),
  now,
  profile: { entries: [] },
  score: 75,
  capped: false,
  senderVerdict: "looks_fine",
  ruleEffects: [],
  openNeeds: [],
  draftHistory: { hadDraft: false, dismissed: false },
};

const RULE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const discarded = { hadDraft: true, dismissed: false };

const cases: [string, Partial<ReplyEligibilityInput>, HeldKind[]][] = [
  ["a good recent match from a recruiter", {}, []],
  ["the score exactly at the threshold", { score: 70 }, []],
  ["a job alert", { category: "job_alert" }, ["not_reply_to"]],
  [
    "a job alert the profile asks to reply to",
    { category: "job_alert", profile: { entries: [entry("reply_to", ["job_alert"])] } },
    [],
  ],
  [
    "an empty reply_to the scan left (not stated)",
    { profile: { entries: [{ ...entry("reply_to", []), source: "scan" }] } },
    [],
  ],
  [
    "an empty reply_to someone set (reply to nothing)",
    { profile: { entries: [{ ...entry("reply_to", []), source: "assistant" }] } },
    ["not_reply_to"],
  ],
  ["mail older than the window (the backlog)", { receivedAt: daysAgo(20) }, ["outside_window"]],
  ["a score below the threshold", { score: 69 }, ["below_threshold"]],
  ["no score yet", { score: null }, ["below_threshold"]],
  [
    "a raised threshold",
    { profile: { entries: [entry("reply_threshold", [80])] } },
    ["below_threshold"],
  ],
  ["a capped score", { score: 40, capped: true }, ["below_threshold"]],
  ["no sender check yet", { senderVerdict: null }, ["sender_check_pending"]],
  ["a high-risk sender", { senderVerdict: "high_risk" as SenderVerdict }, ["high_risk"]],
  ["a caution sender", { senderVerdict: "caution" as SenderVerdict }, []],
  [
    "hide, no_draft and ask_first rules",
    {
      ruleEffects: [
        { ruleId: RULE, action: "hide", reason: "Hidden by your rule" },
        { ruleId: RULE, action: "no_draft", reason: "No drafts by your rule" },
        { ruleId: RULE, action: "ask_first", reason: "Ask first by your rule" },
        { ruleId: RULE, action: "cap_score", reason: "Capped by your rule" },
      ],
    },
    ["rule_hide", "rule_no_draft", "rule_ask_first"],
  ],
  ["an open need", { openNeeds: [{ question: "Minimum pay in CHF per year?" }] }, ["open_needs"]],
  ["a role drafted before (discarded or failed)", { draftHistory: discarded }, ["already_drafted"]],
  [
    "a role dismissed for its decision",
    { draftHistory: { hadDraft: false, dismissed: true } },
    ["dismissed"],
  ],
  [
    "after a discard, answering a decision",
    { origin: "decision", draftHistory: discarded },
    ["already_drafted"],
  ],
];

describe("replyEligibility (F6.1, F6.5, TBD-193)", () => {
  it.each(cases)("%s", (_name, overrides, held) => {
    const result = replyEligibility({ ...base, ...overrides });
    expect(result.heldBy.map((h) => h.kind)).toEqual(held);
    expect(result.eligible).toBe(held.length === 0);
  });

  it("makes Draft a reply eligible whatever holds an automatic one back", () => {
    const everything: Partial<ReplyEligibilityInput> = {
      origin: "on_demand",
      category: "job_alert",
      receivedAt: daysAgo(60),
      score: 10,
      senderVerdict: null,
      ruleEffects: [{ ruleId: RULE, action: "no_draft", reason: "r" }],
      openNeeds: [{ question: "q" }],
      draftHistory: { hadDraft: true, dismissed: true },
    };
    expect(replyEligibility({ ...base, ...everything })).toEqual({ eligible: true, heldBy: [] });
  });

  it("lets a retry of the role's own draft through inside the window, and keeps every other hold", () => {
    const retry = { ...base, origin: "retry" as const, draftHistory: discarded };
    expect(replyEligibility(retry)).toEqual({ eligible: true, heldBy: [] });
    const held: [Partial<ReplyEligibilityInput>, HeldKind][] = [
      [{ receivedAt: daysAgo(20) }, "outside_window"],
      [{ senderVerdict: "high_risk" }, "high_risk"],
      [{ ruleEffects: [{ ruleId: RULE, action: "no_draft", reason: "r" }] }, "rule_no_draft"],
      [{ ruleEffects: [{ ruleId: RULE, action: "hide", reason: "r" }] }, "rule_hide"],
      [{ ruleEffects: [{ ruleId: RULE, action: "ask_first", reason: "r" }] }, "rule_ask_first"],
      [{ openNeeds: [{ question: "q" }] }, "open_needs"],
      [{ draftHistory: { hadDraft: true, dismissed: true } }, "dismissed"],
      [{ score: 55 }, "below_threshold"],
      [{ category: "job_alert" }, "not_reply_to"],
      [{ senderVerdict: null }, "sender_check_pending"],
    ];
    for (const [overrides, kind] of held) {
      expect(replyEligibility({ ...retry, ...overrides }), kind).toMatchObject({
        eligible: false,
        heldBy: [expect.objectContaining({ kind })],
      });
    }
    expect(replyEligibility({ ...retry, receivedAt: daysAgo(20) }).heldBy).toEqual([
      { kind: "outside_window", reason: "Older than 14 days" },
    ]);
  });

  it("says why in plain words", () => {
    expect(replyEligibility({ ...base, score: 55 }).heldBy).toEqual([
      { kind: "below_threshold", reason: "Fit score 55 is below 70" },
    ]);
  });
});
