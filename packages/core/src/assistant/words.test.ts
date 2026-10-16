import type { Change, Rule, RuleDraft } from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { changeLines, changeSummary, editedSummary, rewordEdited } from "./words";

// A proposal and the profile history in plain words (F8.2, F8.4): the summary of edited changes,
// rule descriptions that follow an edit of their conditions, and before and after lines.

const asia: RuleDraft = {
  description: "Hide roles whose working hours are UTC+5 or later",
  when: [{ fact: "timeZones", op: "within", value: { from: "UTC+05:00", to: "UTC+14:00" } }],
  then: "hide",
  enabled: true,
};

const stored: Rule = {
  ...asia,
  id: "00000000-0000-4000-8000-0000000000e1",
  profileId: "00000000-0000-4000-8000-0000000000f1",
  source: "assistant",
  createdAt: "2026-10-10T12:00:00.000Z",
  createdBy: null,
};

const withRange = (from: string): RuleDraft => ({
  ...asia,
  when: [{ fact: "timeZones", op: "within", value: { from, to: "UTC+14:00" } }],
});

describe("rewordEdited", () => {
  it("rewords a rule whose range was edited but whose words were kept", () => {
    const original: Change[] = [{ op: "add", target: "rule", rule: asia }];
    const [edited] = rewordEdited(original, [
      { op: "add", target: "rule", rule: withRange("UTC+04:00") },
    ]);
    expect(edited?.target === "rule" && edited.op === "add" && edited.rule.description).toBe(
      "Hide roles whose hours are within UTC+4 to UTC+14",
    );
  });

  it("keeps words the user rewrote, and an unchanged rule's", () => {
    const original: Change[] = [{ op: "add", target: "rule", rule: asia }];
    const rewritten = { ...withRange("UTC+04:00"), description: "No Asian hours" };
    expect(rewordEdited(original, [{ op: "add", target: "rule", rule: rewritten }])).toEqual([
      { op: "add", target: "rule", rule: rewritten },
    ]);
    expect(rewordEdited(original, original)).toEqual(original);
  });
});

describe("changeSummary", () => {
  it("says what each change does", () => {
    const changes: Change[] = [
      { op: "add", target: "rule", rule: asia },
      { op: "update", target: "rule", ruleId: stored.id, rule: { ...asia, enabled: false } },
      { op: "remove", target: "rule", ruleId: stored.id },
      { op: "add", target: "entry", key: "languages", value: ["German"] },
      { op: "update", target: "entry", key: "reply_threshold", value: [80] },
      { op: "remove", target: "entry", key: "deal_breakers", value: ["on-call"] },
      { op: "remove", target: "entry", key: "extra.relocation", value: null },
      { op: "remove", target: "entry", key: "extra.notice-period", value: null },
    ];
    expect(changeSummary(changes, [stored])).toBe(
      [
        "Hide roles whose working hours are UTC+5 or later",
        'Switch off the rule "Hide roles whose working hours are UTC+5 or later"',
        'Remove the rule "Hide roles whose working hours are UTC+5 or later"',
        "Add German to Working languages",
        "Set Fit score that gets an automatic reply to 80",
        "Remove on-call from Deal-breakers",
        "Clear relocation",
        // An extra slug reads in words, as in the match panel.
        "Clear notice period",
      ].join("; "),
    );
  });
});

describe("editedSummary", () => {
  const proposal = {
    summary: "Ich blende Rollen in asiatischen Zeitzonen aus",
    changes: [{ op: "add", target: "rule", rule: asia }] satisfies Change[],
  };

  it("keeps the model's words while the changes are as proposed", () => {
    expect(editedSummary(proposal, proposal.changes, [])).toBe(proposal.summary);
  });

  it("says what the edited changes do", () => {
    const rule = { ...withRange("UTC+04:00"), description: "No hours from UTC+4 on" };
    const edited: Change[] = [{ op: "add", target: "rule", rule }];
    expect(editedSummary(proposal, edited, [])).toBe("No hours from UTC+4 on");
  });
});

describe("changeLines", () => {
  it("words entries and rules that come, go and change", () => {
    const lines = changeLines(
      {
        entries: [
          { key: "places", value: [{ country: "NL", city: "Amsterdam", mode: "hybrid" }] },
          { key: "reply_to", value: null },
        ],
        rules: [{ id: stored.id, rule: stored }],
      },
      {
        entries: [
          { key: "places", value: [] },
          { key: "reply_to", value: ["recruiter_outreach", "job_alert"] },
        ],
        rules: [{ id: stored.id, rule: { ...stored, enabled: false } }],
      },
    );
    expect(lines).toEqual([
      {
        target: "entry",
        label: "Places you'd work onsite or hybrid",
        before: "Amsterdam, NL (hybrid)",
        after: "none",
      },
      {
        target: "entry",
        label: "Mail that should get a reply",
        before: null,
        after: "Recruiter outreach; Job alert",
      },
      {
        target: "rule",
        label: "Rule",
        before: "Hide roles whose working hours are UTC+5 or later",
        after: "Hide roles whose working hours are UTC+5 or later (off)",
      },
    ]);
  });

  it("words time-zone ranges, amounts and a new rule", () => {
    const lines = changeLines(
      {
        entries: [
          { key: "languages", value: ["English"] },
          { key: "remote", value: [{ scope: "Worldwide", timeZones: null }] },
          { key: "min_pay", value: null },
        ],
        rules: [{ id: stored.id, rule: null }],
      },
      {
        entries: [
          { key: "languages", value: ["German"] },
          {
            key: "remote",
            value: [
              { scope: "Worldwide", timeZones: null },
              { scope: "EU", timeZones: { from: "UTC-01:00", to: "UTC+03:00" } },
            ],
          },
          {
            key: "min_pay",
            value: [{ amount: 120000, currency: "CHF", period: "year", asWritten: "CHF 120k" }],
          },
        ],
        rules: [{ id: stored.id, rule: stored }],
      },
    );
    expect(lines).toEqual([
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
});
