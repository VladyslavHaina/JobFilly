import type { IntakeInput, JobFacts, ScanFocus } from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { focusFirst, focusIntakeInput } from "./focus";

// A re-run's focus (MVP 3, F1.1): which mail its intake form reads, and which likely job mail it
// reads first. Matched on the first kind of fact the focus names, so a hint about a country isn't
// answered by roles elsewhere whose contract happens to match.

const SINCE = new Date("2026-07-01T00:00:00Z");
const RECENT = "2026-09-20T10:00:00.000Z";
const OLD = "2026-06-01T10:00:00.000Z";

const NONE: ScanFocus = {
  countries: [],
  cities: [],
  languages: [],
  workModes: [],
  contracts: [],
  words: [],
};
const GERMANY: ScanFocus = { ...NONE, countries: ["DE"], contracts: ["permanent"] };

const role = (overrides: Partial<JobFacts>): JobFacts => ({
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
  languages: [],
  applyUrl: null,
  extra: {},
  ...overrides,
});

const input: IntakeInput = {
  replies: [
    {
      messageId: "<moved>",
      date: RECENT,
      preferences: { places: [{ country: "DE", city: "Munich", mode: "onsite" }] },
    },
    {
      messageId: "<remote>",
      date: RECENT,
      preferences: { remote: [{ scope: "EU", timeZones: null }], contracts: ["permanent"] },
    },
    {
      messageId: "<permit>",
      date: RECENT,
      preferences: { work_permits: [{ country: "DE", text: "Blue card" }] },
    },
    {
      messageId: "<old>",
      date: OLD,
      preferences: { places: [{ country: "DE", city: null, mode: "hybrid" }] },
    },
  ],
  jobs: [
    {
      messageId: "<munich>",
      date: RECENT,
      category: "recruiter_outreach",
      roles: [role({ places: [{ country: "DE", city: "München" }], contract: "unbefristet" })],
    },
    {
      messageId: "<remote-eu>",
      date: RECENT,
      category: "recruiter_outreach",
      roles: [role({ workMode: "remote", contract: "permanent" })],
    },
    {
      messageId: "<old-de>",
      date: OLD,
      category: "job_alert",
      roles: [role({ places: [{ country: "DE", city: null }] })],
    },
  ],
};

const ids = (i: IntakeInput) => [...i.replies, ...i.jobs].map((m) => m.messageId);

describe("focusIntakeInput", () => {
  it("keeps the window's mail in the hint's places, not mail that only shares a contract word", () => {
    expect(ids(focusIntakeInput(input, GERMANY, SINCE))).toEqual([
      "<moved>",
      "<permit>",
      "<munich>",
    ]);
  });

  it("names a city in any case, and falls back to the next kind of fact the focus names", () => {
    const munich = { ...NONE, cities: ["munich"] };
    expect(ids(focusIntakeInput(input, munich, SINCE))).toEqual(["<moved>"]);
    const permanent = { ...NONE, contracts: ["permanent"] };
    expect(ids(focusIntakeInput(input, permanent, SINCE))).toEqual(["<remote>", "<remote-eu>"]);
    const remote = { ...NONE, workModes: ["remote" as const] };
    expect(ids(focusIntakeInput(input, remote, SINCE))).toEqual(["<remote>", "<remote-eu>"]);
  });

  it("keeps every message of the window without a focus, or with one that names nothing", () => {
    const all = ["<moved>", "<remote>", "<permit>", "<munich>", "<remote-eu>"];
    expect(ids(focusIntakeInput(input, null, SINCE))).toEqual(all);
    expect(ids(focusIntakeInput(input, NONE, SINCE))).toEqual(all);
  });
});

describe("focusFirst", () => {
  const rows = ["A role in Hamburg", "Remote contract", "Permanent role in Munich"];
  it("puts the mail naming the focus's words first, keeping the order otherwise", () => {
    const focus = { ...NONE, countries: ["DE"], cities: ["Munich", "Hamburg"] };
    expect(focusFirst(rows, focus, (r) => r)).toEqual([
      "A role in Hamburg",
      "Permanent role in Munich",
      "Remote contract",
    ]);
    expect(focusFirst(rows, { ...NONE, countries: ["DE"] }, (r) => r)).toEqual(rows);
    expect(focusFirst(rows, null, (r) => r)).toEqual(rows);
  });
});
