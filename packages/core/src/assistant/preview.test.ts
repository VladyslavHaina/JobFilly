import type {
  Change,
  JobFacts,
  MatchAiOutput,
  ProfileEntry,
  ProfileKey,
  ProfileValue,
  Rule,
  RuleDraft,
  TimeZoneRange,
} from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import type { ChangeContext } from "../profile/changes";
import { type PreviewRole, previewImpact } from "./preview";

// The impact preview (F8.2, F8.5): the change applied with the pinned Change semantics, the real
// rules engine and match over the current roles before and after, with their stored match.v1
// answers (the preview has no model to call), the reply policy with each role's draft history,
// and plain words before and after for each entry and rule.

const NOW = new Date("2026-10-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const PROFILE = "00000000-0000-4000-8000-0000000000f1";
const NEW_RULE = "00000000-0000-4000-8000-0000000000e9";

const entry = (key: ProfileKey, value: ProfileValue): ProfileEntry => ({
  key,
  label: key,
  value,
  confidence: null,
  evidence: [],
  source: "you",
  updatedAt: "2026-10-01T12:00:00.000Z",
  updatedBy: null,
});

const entries = [
  entry("target_roles", ["Backend Engineer"]),
  entry("remote", [{ scope: "Worldwide", timeZones: null }]),
  entry("languages", ["English"]),
];

const facts = (timeZones: TimeZoneRange | null, overrides: Partial<JobFacts> = {}): JobFacts => ({
  title: "Senior Backend Engineer",
  company: "Example Co",
  agency: null,
  places: [],
  workMode: "remote",
  remoteScope: "Worldwide",
  timeZones,
  pay: null,
  contract: null,
  seniority: null,
  workPermit: null,
  skills: ["Go"],
  languages: ["English"],
  applyUrl: null,
  extra: {},
  ...overrides,
});

const fits: MatchAiOutput = {
  titleFit: { verdict: "fits", reason: "a backend role" },
  skillCloseness: [{ skill: "Go", verdict: "fits", reason: "in the CV" }],
};
/** The stored answer of a role whose title doesn't fit: it scores under the threshold of 70. */
const titleOff: MatchAiOutput = { ...fits, titleFit: { verdict: "conflicts", reason: "data" } };

const tz = (offset: string): TimeZoneRange => ({ from: offset, to: offset });

const role = (
  messageId: string,
  timeZones: TimeZoneRange | null,
  overrides: Partial<PreviewRole> = {},
): PreviewRole => ({
  messageId,
  position: 0,
  receivedAt: new Date(NOW.getTime() - DAY),
  category: "recruiter_outreach",
  senderAddress: "anna@example.test",
  facts: facts(timeZones),
  cv: { cvId: null, skills: ["Go"] },
  ai: fits,
  senderVerdict: "looks_fine",
  draft: null,
  draftHistory: { hadDraft: false, dismissed: false },
  ...overrides,
});

/** Maria's roles: three on Asia-Pacific hours, one on CET, one without stated hours. */
const roles: PreviewRole[] = [
  // A good match whose draft is already in the mailbox.
  role("<sg-1@apac.example>", tz("UTC+08:00"), {
    draft: { status: "in_mailbox" },
    draftHistory: { hadDraft: true, dismissed: false },
  }),
  // Under the threshold: it never gets a draft.
  role("<sg-2@apac.example>", tz("UTC+08:00"), { ai: titleOff }),
  // A good match still waiting for its automatic draft.
  role("<syd@apac.example>", tz("UTC+10:00")),
  // A good match whose draft the user discarded: no live draft, but it had one.
  role("<tokyo@apac.example>", tz("UTC+09:00"), {
    draftHistory: { hadDraft: true, dismissed: false },
  }),
  role("<eu@remote.example>", tz("UTC+01:00"), {
    draft: { status: "edited" },
    draftHistory: { hadDraft: true, dismissed: false },
  }),
  role("<anywhere@remote.example>", null),
];

const ctx: ChangeContext = {
  profileId: PROFILE,
  source: "assistant",
  userId: null,
  at: NOW.toISOString(),
  newRuleId: () => NEW_RULE,
};

const asiaRule = (then: RuleDraft["then"] = "hide"): RuleDraft => ({
  description: "Hide roles whose working hours are UTC+5 or later",
  when: [{ fact: "timeZones", op: "within", value: { from: "UTC+05:00", to: "UTC+14:00" } }],
  then,
  enabled: true,
});

const storedRule = (draft: RuleDraft, id: string): Rule => ({
  ...draft,
  id,
  profileId: PROFILE,
  source: "assistant",
  createdAt: "2026-10-10T12:00:00.000Z",
  createdBy: null,
});

const preview = (changes: Change[], rules: Rule[] = [], list = roles) =>
  previewImpact({ content: { entries, rules }, changes, ctx, roles: list, now: NOW });

describe("previewImpact (F8.2, F8.5)", () => {
  it("counts the roles a time-zone rule hides, and the drafts already in the mailbox", () => {
    const result = preview([{ op: "add", target: "rule", rule: asiaRule() }]);
    if (!result.ok) throw new Error("expected a preview");
    expect(result.impact).toEqual({
      hides: 4,
      shows: 0,
      scoreMoves: 0,
      // Sydney was waiting for its draft; Tokyo's was discarded, so it never counts as new.
      draftsNotCreated: 1,
      // Only Singapore's: the CET role's draft is in the mailbox too, but the rule leaves it be.
      draftsInMailbox: 1,
    });
    expect(result.roles.map((r) => r.messageId)).toEqual([
      "<sg-1@apac.example>",
      "<sg-2@apac.example>",
      "<syd@apac.example>",
      "<tokyo@apac.example>",
    ]);
    const sydney = result.roles.find((r) => r.messageId === "<syd@apac.example>");
    expect(sydney).toMatchObject({ hidden: { before: false, after: true }, draftNotCreated: true });
  });

  it("never hides a role whose hours aren't stated (F3.2)", () => {
    const result = preview(
      [{ op: "add", target: "rule", rule: asiaRule() }],
      [],
      [roles[5] as PreviewRole],
    );
    expect(result.ok && result.impact.hides).toBe(0);
  });

  it("counts the roles a removed hide rule shows again", () => {
    const hide = storedRule(asiaRule(), "00000000-0000-4000-8000-0000000000e1");
    const result = preview([{ op: "remove", target: "rule", ruleId: hide.id }], [hide]);
    if (!result.ok) throw new Error("expected a preview");
    expect(result.impact).toMatchObject({ hides: 0, shows: 4, scoreMoves: 0 });
  });

  it("counts the scores that move, with the real match's cap", () => {
    const result = preview([{ op: "add", target: "rule", rule: asiaRule("cap_score") }]);
    if (!result.ok) throw new Error("expected a preview");
    expect(result.impact).toMatchObject({ hides: 0, scoreMoves: 4, draftsNotCreated: 1 });
    for (const r of result.roles) expect(r.score.after).toBeLessThanOrEqual(40);
    const sydney = result.roles.find((r) => r.messageId === "<syd@apac.example>");
    expect(sydney?.score.before).toBeGreaterThanOrEqual(70);
  });

  it("counts a draft that won't be created when a profile entry stops a good match", () => {
    const result = preview([
      { op: "update", target: "entry", key: "reply_threshold", value: [99] },
    ]);
    if (!result.ok) throw new Error("expected a preview");
    // Sydney and the role without stated hours were waiting for drafts; scores don't move.
    expect(result.impact).toMatchObject({ hides: 0, scoreMoves: 0, draftsNotCreated: 2 });
  });

  it("follows the pinned Change semantics: add appends to a list key, update replaces it", () => {
    const added = preview([{ op: "add", target: "entry", key: "languages", value: ["German"] }]);
    const updated = preview([
      { op: "update", target: "entry", key: "languages", value: ["German"] },
    ]);
    if (!added.ok || !updated.ok) throw new Error("expected previews");
    expect(added.after.entries).toEqual([{ key: "languages", value: ["English", "German"] }]);
    expect(updated.after.entries).toEqual([{ key: "languages", value: ["German"] }]);
    // English roles still fit "English, German"; with "German" alone their language conflicts.
    expect(added.impact.scoreMoves).toBe(0);
    expect(updated.impact.scoreMoves).toBe(roles.length);
  });

  it("words each entry and rule before and after", () => {
    const result = preview([
      { op: "add", target: "rule", rule: asiaRule() },
      { op: "update", target: "entry", key: "languages", value: ["German"] },
      {
        op: "add",
        target: "entry",
        key: "remote",
        value: [{ scope: "EU", timeZones: { from: "UTC-01:00", to: "UTC+03:00" } }],
      },
      {
        op: "add",
        target: "entry",
        key: "min_pay",
        value: [{ amount: 120000, currency: "CHF", period: "year", asWritten: "CHF 120k" }],
      },
    ]);
    if (!result.ok) throw new Error("expected a preview");
    expect(result.lines).toEqual([
      { target: "entry", label: "Working languages", before: "English", after: "German" },
      {
        target: "entry",
        label: "Remote work",
        before: "Worldwide",
        after: "Worldwide; EU (UTC−1 to UTC+3)",
      },
      { target: "entry", label: "Minimum pay", before: null, after: "CHF 120,000 per year" },
      {
        target: "rule",
        label: "Rule",
        before: null,
        after: "Hide roles whose working hours are UTC+5 or later",
      },
    ]);
  });

  it("gives back the change's error and no impact when it doesn't apply", () => {
    const result = preview([
      { op: "remove", target: "rule", ruleId: "00000000-0000-4000-8000-0000000000e7" },
    ]);
    expect(result).toEqual({
      ok: false,
      error: { kind: "unknown_rule", ruleId: "00000000-0000-4000-8000-0000000000e7" },
    });
  });

  it("is pure: the same input gives the same preview", () => {
    const changes: Change[] = [{ op: "add", target: "rule", rule: asiaRule() }];
    expect(preview(changes)).toEqual(preview(changes));
  });
});
