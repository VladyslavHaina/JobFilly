import { describe, expect, it } from "vitest";
import { MessageListItemSchema } from "./messages";

// A row's fit (F4.1, F4.6): a score, why a job message with roles has none, or nothing.

const row = (fit: unknown) => ({
  id: "<a@b.example>",
  from: { address: "a@b.example", name: null },
  subject: "Backend role",
  date: "2026-10-01T10:00:00.000Z",
  category: "recruiter_outreach",
  categorySource: "scan",
  analysisStatus: "done",
  fit,
  sender: null,
  hidden: null,
  draft: null,
});

describe("MessageListItemSchema fit", () => {
  it.each([
    { score: 72, capped: false, stale: false },
    { score: 40, capped: true, stale: true },
    { score: null, why: "pending" },
    { score: null, why: "unscored" },
    null,
  ])("takes %j", (fit) => {
    expect(MessageListItemSchema.parse(row(fit)).fit).toEqual(fit);
  });

  it.each([
    { score: null, why: "later" },
    { score: null },
    { score: 101, capped: false, stale: false },
    { score: 72 },
  ])("refuses %j", (fit) => {
    expect(MessageListItemSchema.safeParse(row(fit)).success).toBe(false);
  });
});
