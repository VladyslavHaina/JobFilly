import {
  CORE_PROFILE_KEYS,
  type IntakeEdit,
  type IntakeProposal,
  ProfileEntrySchema,
} from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { aggregateIntake } from "./aggregate";
import { confirmedEntries } from "./profile";

// What Confirm saves and how profile edits apply (F6.5): every entry with its source.

const AT = "2026-10-01T10:00:00.000Z";
const EDITED = "2026-10-01T09:58:00.000Z";
const USER = "00000000-0000-4000-8000-000000000001";

function proposal(): IntakeProposal {
  return aggregateIntake({
    replies: [1, 2].map((n) => ({
      messageId: `<r${n}@inbox.example>`,
      date: `2026-09-2${n}T10:00:00.000Z`,
      preferences: {
        places: [
          { country: "DE", city: "Berlin", mode: "hybrid" },
          { country: "NL", city: "Amsterdam", mode: "hybrid" },
        ],
        contracts: ["B2B"],
      },
    })),
    jobs: [],
  });
}

const edit = (key: IntakeEdit["key"], value: IntakeEdit["value"]): IntakeEdit => ({
  key,
  value,
  source: "you",
  updatedBy: USER,
  updatedAt: EDITED,
});

const questions = [
  {
    slug: "relocation",
    label: "Would you relocate within the EU?",
    options: ["Yes", "No"],
    evidence: ["<r1@inbox.example>"],
  },
  { slug: "notice-period", label: "What is your notice period?", options: [], evidence: [] },
];

describe("confirmedEntries", () => {
  it("keeps proposals as the scan's and edits as yours, core questions first, then extras", () => {
    const entries = confirmedEntries({
      proposal: proposal(),
      edits: [
        edit("places", [{ country: "DE", city: "Berlin", mode: "hybrid" }]),
        edit("extra.relocation", ["Yes"]),
      ],
      questions,
      at: AT,
    });
    for (const e of entries) expect(ProfileEntrySchema.parse(e)).toEqual(e);
    expect(entries.map((e) => e.key)).toEqual([
      ...CORE_PROFILE_KEYS,
      "extra.relocation",
      "extra.notice-period",
    ]);
    const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));
    expect(byKey.places).toMatchObject({
      label: "Places you'd work onsite or hybrid",
      value: [{ country: "DE", city: "Berlin", mode: "hybrid" }],
      source: "you",
      confidence: null,
      updatedBy: USER,
      updatedAt: EDITED,
    });
    expect(byKey.places?.evidence.map((e) => e.messageId)).toEqual([
      "<r2@inbox.example>",
      "<r1@inbox.example>",
    ]);
    expect(byKey.contracts).toMatchObject({
      value: ["B2B"],
      source: "scan",
      confidence: "medium",
      updatedBy: null,
      updatedAt: AT,
    });
    expect(byKey.seniority).toMatchObject({ value: [], source: "scan", confidence: null });
    expect(byKey["extra.relocation"]).toMatchObject({
      label: "Would you relocate within the EU?",
      value: ["Yes"],
      source: "you",
      evidence: [{ messageId: "<r1@inbox.example>" }],
    });
    expect(byKey["extra.notice-period"]).toMatchObject({ value: [], source: "scan" });
  });

  it("leaves out edits of extra questions that weren't asked", () => {
    const entries = confirmedEntries({
      proposal: proposal(),
      edits: [edit("extra.unknown", ["x"])],
      questions: [],
      at: AT,
    });
    expect(entries.map((e) => e.key)).toEqual([...CORE_PROFILE_KEYS]);
  });
});
