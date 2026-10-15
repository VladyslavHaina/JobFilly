import {
  CORE_PROFILE_KEYS,
  type Envelope,
  type ExtraQuestion,
  IntakeExtraInputSchema,
  type IntakeInput,
  type StoredMessage,
} from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { aggregateIntake } from "./aggregate";
import { buildIntakeExtraInput, extraEvidenceIds, foundExtraQuestions } from "./extras";

// The input of intake.v1 (TBD-20): the answered entries' evidence messages newest first, at most
// 20, with the stored snippet as text; and every core answer in core-key order. What the model
// proposes is kept only when the mail it was shown backs it (F6.1).

const BASE = Date.UTC(2026, 8, 30, 12);
const ago = (n: number) => new Date(BASE - n * 3_600_000).toISOString();

function stored(messageId: string, n: number, folder: "inbox" | "sent" = "inbox"): StoredMessage {
  const envelope: Envelope = {
    messageId,
    folder,
    folderPath: folder === "sent" ? "Sent" : "INBOX",
    uidValidity: 1,
    uid: n,
    date: ago(n),
    from:
      folder === "sent"
        ? { address: "maria.santos@inbox.example", name: "Maria Santos" }
        : { address: `recruiter${n}@agency.example`, name: null },
    to: [],
    cc: [],
    replyTo: [],
    inReplyTo: null,
    references: [],
    subject: `Subject ${n}`,
    listId: null,
    listUnsubscribe: null,
    precedence: null,
    autoSubmitted: null,
    snippet: `Snippet ${n}`,
  };
  return {
    envelope,
    stageOne: folder === "sent" ? "own_reply" : "likely_job",
    stageOneReason: null,
    category: folder === "sent" ? null : "recruiter_outreach",
    categorySource: folder === "sent" ? null : "scan",
    analysisStatus: "done",
    analyzedByScanId: null,
  };
}

const replyId = (n: number) => `<maria-reply-${n}@inbox.example>`;
const jobId = (n: number) => `<job-${n}@agency.example>`;

/** Maria: her replies state her answers; 30 job messages repeat a role title and a language. */
function maria() {
  const input: IntakeInput = {
    replies: [1, 3, 5, 7].map((n) => ({
      messageId: replyId(n),
      date: ago(n),
      preferences: {
        target_roles: ["Backend Engineer"],
        min_pay: [{ amount: 450, currency: "EUR", period: "day", asWritten: "€450 a day" }],
        languages: ["English", "Portuguese"],
      },
    })),
    jobs: Array.from({ length: 30 }, (_, i) => ({
      messageId: jobId(10 + i),
      date: ago(10 + i),
      category: "recruiter_outreach" as const,
      roles: [
        {
          title: "Backend Engineer",
          company: null,
          agency: null,
          places: [],
          workMode: null,
          remoteScope: null,
          timeZones: null,
          pay: null,
          contract: null,
          seniority: null,
          workPermit: null,
          skills: [],
          languages: ["German"],
          applyUrl: null,
          extra: {},
        },
      ],
    })),
  };
  const messages = [
    ...[1, 3, 5, 7].map((n) => stored(replyId(n), n, "sent")),
    ...input.jobs.map((j, i) => stored(j.messageId, 10 + i)),
  ];
  return { proposal: aggregateIntake(input), messages };
}

describe("buildIntakeExtraInput", () => {
  it("gives Maria's evidence messages, her replies only, newest first, snippets as text", () => {
    const { proposal, messages } = maria();
    const input = buildIntakeExtraInput(proposal, messages);
    expect(IntakeExtraInputSchema.parse(input)).toEqual(input);
    expect(input.items.map((i) => i.messageId)).toEqual([1, 3, 5, 7].map(replyId));
    expect(input.items[0]).toEqual({
      messageId: replyId(1),
      folder: "sent",
      from: { address: "maria.santos@inbox.example", name: "Maria Santos" },
      date: ago(1),
      subject: "Subject 1",
      text: "Snippet 1",
    });
  });

  it("gives Tom's thin inbox no items, and every answer empty", () => {
    const proposal = aggregateIntake({ replies: [], jobs: [] });
    const input = buildIntakeExtraInput(proposal, [stored(jobId(1), 1)]);
    expect(input.items).toEqual([]);
    expect(input.answers).toEqual(
      CORE_PROFILE_KEYS.map((key) => ({ key, value: [], confidence: null })),
    );
  });

  it("lists every core answer in core-key order with its value and confidence", () => {
    const { proposal, messages } = maria();
    const input = buildIntakeExtraInput(proposal, messages);
    expect(input.answers.map((a) => a.key)).toEqual([...CORE_PROFILE_KEYS]);
    expect(input.answers.find((a) => a.key === "languages")).toEqual({
      key: "languages",
      value: ["English", "Portuguese"],
      confidence: "high",
    });
    expect(input.answers.find((a) => a.key === "seniority")).toEqual({
      key: "seniority",
      value: [],
      confidence: null,
    });
  });

  it("takes each evidence message once, newest first, at most 20, and nothing else", () => {
    const proposal = aggregateIntake({
      replies: [],
      jobs: Array.from({ length: 25 }, (_, i) => ({
        messageId: jobId(i),
        date: ago(i),
        category: "job_alert" as const,
        roles: [
          {
            title: "SRE",
            company: null,
            agency: null,
            places: [],
            workMode: null,
            remoteScope: null,
            timeZones: null,
            pay: null,
            contract: "permanent",
            seniority: null,
            workPermit: null,
            skills: [],
            languages: [],
            applyUrl: null,
            extra: {},
          },
        ],
      })),
    });
    // target_roles and contracts share all 25 messages.
    expect(extraEvidenceIds(proposal)).toHaveLength(25);
    const rows = Array.from({ length: 25 }, (_, i) => stored(jobId(i), i));
    const unrelated = stored("<newsletter@shop.example>", 0);
    // Given oldest first, with a duplicate and an unrelated row.
    const input = buildIntakeExtraInput(
      proposal,
      [...rows].reverse().concat(rows[3] ?? [], unrelated),
    );
    expect(input.items.map((i) => i.messageId)).toEqual(
      Array.from({ length: 20 }, (_, i) => jobId(i)),
    );
  });
});

describe("foundExtraQuestions (F6.1)", () => {
  const question = (slug: string, evidence: string[]): ExtraQuestion => ({
    slug,
    label: `Question ${slug}?`,
    options: ["Yes", "No"],
    evidence,
  });
  const input = () => {
    const { proposal, messages } = maria();
    return buildIntakeExtraInput(proposal, messages);
  };

  it("keeps a question backed by messages it was shown, as the model worded it", () => {
    const q = question("relocation", [replyId(3), replyId(1)]);
    expect(foundExtraQuestions([q], input())).toEqual([q]);
  });

  it("drops a question without evidence, and evidence it wasn't shown", () => {
    const found = foundExtraQuestions(
      [
        question("notice-period", []),
        question("invented", ["<made-up@nowhere.example>"]),
        question("b2b", ["<made-up@nowhere.example>", replyId(5), replyId(5)]),
        // A job message that exists but wasn't among the items.
        question("visa", [jobId(10)]),
      ],
      input(),
    );
    expect(found).toEqual([question("b2b", [replyId(5)])]);
  });

  it("keeps the first question of a repeated slug, and at most five", () => {
    const backed = (slug: string) => question(slug, [replyId(1)]);
    const first = { ...backed("relocation"), label: "First wording?" };
    const found = foundExtraQuestions(
      [
        question("relocation", ["<made-up@nowhere.example>"]),
        first,
        backed("relocation"),
        ...["a", "b", "c", "d", "e"].map(backed),
      ],
      input(),
    );
    expect(found.map((q) => q.slug)).toEqual(["relocation", "a", "b", "c", "d"]);
    expect(found[0]).toEqual(first);
  });

  it("keeps nothing for Tom's thin inbox, which shows the model no items", () => {
    const proposal = aggregateIntake({ replies: [], jobs: [] });
    const empty = buildIntakeExtraInput(proposal, []);
    expect(foundExtraQuestions([question("relocation", [jobId(1)])], empty)).toEqual([]);
  });
});
