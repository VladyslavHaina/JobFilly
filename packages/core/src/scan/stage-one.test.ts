import {
  type Envelope,
  JobPlatformsFileSchema,
  type StageOneContext,
  StageOneOutcomeSchema,
} from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { orderNewestFirst, toBatches } from "./batches";
import { loadJobPlatforms } from "./platforms";
import { stageOne } from "./stage-one";

let uid = 0;
function envelope(overrides: Partial<Envelope> & { from?: Envelope["from"] }): Envelope {
  uid += 1;
  return {
    messageId: `<m${uid}@test.example>`,
    folder: "inbox",
    folderPath: "INBOX",
    uidValidity: 1,
    uid,
    date: new Date(Date.UTC(2026, 8, 1) + uid * 60_000).toISOString(),
    from: { address: `sender${uid}@company.example`, name: null },
    to: [{ address: "me@inbox.example", name: null }],
    cc: [],
    replyTo: [],
    inReplyTo: null,
    references: [],
    subject: "Hello",
    listId: null,
    listUnsubscribe: null,
    precedence: null,
    autoSubmitted: null,
    snippet: "",
    ...overrides,
  };
}

const ctx: StageOneContext = {
  ownAddresses: ["Me@Inbox.example"],
  platforms: JobPlatformsFileSchema.parse({
    version: 1,
    entries: [
      { domain: "jobboard.example", kind: "job_board", countries: [], alertSenders: ["alerts"] },
      { domain: "ats.example", kind: "ats", countries: ["DE"], alertSenders: [] },
    ],
  }),
};

const verdicts = (envelopes: Envelope[]) => {
  const outcome = stageOne(envelopes, ctx);
  return Object.fromEntries(
    [...outcome.handled, ...outcome.candidates, ...outcome.ownReplies].map((r) => [
      r.envelope.messageId,
      r.verdict,
    ]),
  );
};

describe("stageOne (F4.2)", () => {
  it("sorts mail from the headers alone", () => {
    const recruiter = envelope({});
    const newsletter = envelope({ listUnsubscribe: "<https://news.example/u>" });
    const bulk = envelope({ precedence: "Bulk" });
    const list = envelope({ listId: "<club.lists.example>" });
    const alert = envelope({
      from: { address: "Alerts@jobboard.example", name: null },
      listUnsubscribe: "<https://jobboard.example/u>",
    });
    const boardOther = envelope({
      from: { address: "messages@jobboard.example", name: null },
      listUnsubscribe: "<https://jobboard.example/u>",
    });
    const ats = envelope({
      from: { address: "no-reply@mail.ats.example", name: null },
      precedence: "bulk",
    });
    expect(verdicts([recruiter, newsletter, bulk, list, alert, boardOther, ats])).toEqual({
      [recruiter.messageId]: "likely_job",
      [newsletter.messageId]: "not_job",
      [bulk.messageId]: "not_job",
      [list.messageId]: "not_job",
      [alert.messageId]: "job_alert",
      [boardOther.messageId]: "likely_job",
      [ats.messageId]: "likely_job",
    });
  });

  it("reads the user's own messages as replies and keeps senders they replied to", () => {
    const fromList = envelope({
      from: { address: "talent@agency.example", name: null },
      replyTo: [{ address: "jobs@agency.example", name: null }],
      listUnsubscribe: "<https://agency.example/u>",
    });
    const laterFromList = envelope({
      from: { address: "talent@agency.example", name: null },
      listId: "<agency.example>",
    });
    const viaReplyTo = envelope({
      from: { address: "jobs@agency.example", name: null },
      listId: "<agency.example>",
    });
    const reply = envelope({
      folder: "sent",
      folderPath: "Sent",
      from: { address: "me@inbox.example", name: "Me" },
      inReplyTo: fromList.messageId,
    });
    const toSelf = envelope({ from: { address: "ME@inbox.example", name: null } });
    expect(verdicts([fromList, laterFromList, viaReplyTo, reply, toSelf])).toEqual({
      [fromList.messageId]: "likely_job",
      [laterFromList.messageId]: "likely_job",
      [viaReplyTo.messageId]: "likely_job",
      [reply.messageId]: "own_reply",
      [toSelf.messageId]: "own_reply",
    });
  });

  it("returns every message once, in the list of its verdict, newest first", () => {
    const old = envelope({ date: "2026-08-01T10:00:00.000Z" });
    const recent = envelope({ date: "2026-09-20T10:00:00.000Z" });
    const sentCopy = envelope({ folder: "sent", folderPath: "Sent" });
    const inboxCopy = { ...sentCopy, folder: "inbox" as const, folderPath: "INBOX", uid: 999 };
    const outcome = stageOne([old, inboxCopy, recent, sentCopy], ctx);
    expect(StageOneOutcomeSchema.parse(outcome)).toEqual(outcome);
    expect(outcome.candidates.map((r) => r.envelope.messageId)).toEqual([
      recent.messageId,
      old.messageId,
    ]);
    expect(outcome.ownReplies.map((r) => r.envelope)).toEqual([sentCopy]);
    expect(outcome.handled).toEqual([]);
  });

  it("gives reasons in plain words, never a subject or an address", () => {
    const e = envelope({ subject: "Secret plans", listId: "<x.example>" });
    const outcome = stageOne([e], ctx);
    expect(outcome.handled[0]?.reason).toBe("mailing list or bulk mail");
    expect(JSON.stringify(outcome.handled[0]?.reason)).not.toMatch(/Secret|@/);
  });
});

describe("loadJobPlatforms", () => {
  it("reads a valid data file covering many countries, boards and applicant trackers", () => {
    const file = loadJobPlatforms();
    expect(JobPlatformsFileSchema.parse(file)).toEqual(file);
    const countries = new Set(file.entries.flatMap((e) => e.countries));
    expect(countries.size).toBeGreaterThanOrEqual(20);
    expect(file.entries.some((e) => e.kind === "ats")).toBe(true);
    expect(file.entries.some((e) => e.countries.length === 0)).toBe(true);
    const domains = file.entries.map((e) => e.domain);
    expect(new Set(domains).size).toBe(domains.length);
  });
});

describe("orderNewestFirst and toBatches", () => {
  it("orders by date, then by Message-ID, without changing the input", () => {
    const a = envelope({ messageId: "<a@x>", date: "2026-09-01T10:00:00.000Z" });
    const b = envelope({ messageId: "<b@x>", date: "2026-09-01T10:00:00.000Z" });
    const c = envelope({ messageId: "<c@x>", date: "2026-09-02T10:00:00.000Z" });
    const input = [a, b, c];
    expect(orderNewestFirst(input).map((e) => e.messageId)).toEqual(["<c@x>", "<b@x>", "<a@x>"]);
    expect(input).toEqual([a, b, c]);
  });

  it("cuts batches of 20 by default and keeps the order", () => {
    const items = Array.from({ length: 45 }, (_, i) => i);
    const batches = toBatches(items);
    expect(batches.map((b) => b.length)).toEqual([20, 20, 5]);
    expect(batches.flat()).toEqual(items);
    expect(toBatches([], 20)).toEqual([]);
    expect(toBatches([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(() => toBatches([1], 0)).toThrow(RangeError);
  });
});
