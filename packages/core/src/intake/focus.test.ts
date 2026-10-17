import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type Category,
  type IntakeInput,
  type JobFacts,
  JobFactsSchema,
  type Preferences,
  type ScanFocus,
} from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { aggregateIntake } from "./aggregate";
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
const GERMANY: ScanFocus = {
  ...NONE,
  countries: ["DE"],
  contracts: ["permanent"],
  words: ["unbefristet"],
};

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
      preferences: {
        places: [{ country: "DE", city: "Munich", mode: "onsite" }],
        contracts: ["unbefristet"],
      },
    },
    {
      // An older answer that names Germany, and Amsterdam and B2B as well.
      messageId: "<before>",
      date: RECENT,
      preferences: {
        places: [
          { country: "DE", city: "Berlin", mode: "hybrid" },
          { country: "NL", city: "Amsterdam", mode: "hybrid" },
        ],
        contracts: ["permanent", "B2B"],
        min_pay: [{ amount: 450, currency: "EUR", period: "day", asWritten: "€450 a day" }],
      },
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
  it("keeps the window's mail that matches the whole hint, and nothing that names more", () => {
    // Not the remote role that only shares a contract word, not the permit that names no
    // contract, and not the older reply that names Amsterdam and B2B too.
    expect(ids(focusIntakeInput(input, GERMANY, SINCE))).toEqual(["<moved>", "<munich>"]);
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
    const all = ["<moved>", "<before>", "<remote>", "<permit>", "<munich>", "<remote-eu>"];
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

// I2 against the fixtures: Maria's re-run with S1's hint, over all her mail up to S1 (the first
// scan's backlog, MVP 2's deliveries, S1's Germany batch and her moved replies), proposes what
// expected.json's mvp3.rerun says, from her moved replies only: none of her older answers
// (Berlin, Amsterdam, B2B, €70,000 a year, €450 a day) though some of them name Germany too.
describe("Maria's re-run against the fixtures' ground truth", () => {
  const FIXTURES = fileURLToPath(new URL("../../../../e2e/fixtures/", import.meta.url));
  const read = <T>(path: string): T => JSON.parse(readFileSync(`${FIXTURES}${path}`, "utf8")) as T;
  interface Truth {
    category: Category | null;
    facts: unknown[] | null;
  }
  const expected = read<{
    messages: Record<string, Truth>;
    deliveries: Record<string, Truth>;
    mvp3: { rerun: { focus: ScanFocus; proposes: Record<string, unknown[]>; evidence: string[] } };
  }>("maria/expected.json");
  type Dated = { messageId: string; minutesAgo: number; step?: string };
  const envelopes = read<Dated[]>("maria/envelopes.json");
  const deliveries = read<Dated[]>("maria/deliveries.json").filter((d) => d.step !== "S6");
  const sent = read<Dated[]>("maria/deliveries-sent.json");
  const prefs = read<Record<string, { preferences: Preferences }>>("ai/maria/prefs.json");
  // The time the fixtures are dated against (e2e/fixtures/format.ts FIXTURE_REFERENCE_TIME).
  const NOW = Date.parse("2026-10-01T12:00:00.000Z");
  const minutesAgo = new Map([...envelopes, ...deliveries, ...sent].map((m) => [m.messageId, m]));
  const dateOf = (id: string) =>
    new Date(NOW - (minutesAgo.get(id)?.minutesAgo ?? Number.NaN) * 60_000).toISOString();
  const truth = { ...expected.messages, ...expected.deliveries };

  const all: IntakeInput = {
    replies: Object.entries(prefs).map(([messageId, { preferences }]) => ({
      messageId,
      date: dateOf(messageId),
      preferences,
    })),
    jobs: [...envelopes, ...deliveries].flatMap(({ messageId }) => {
      const t = truth[messageId];
      if (!t?.category || t.category === "not_job" || !t.facts?.length) return [];
      const roles = t.facts.map((f) => JobFactsSchema.parse(f));
      return [{ messageId, date: dateOf(messageId), category: t.category, roles }];
    }),
  };

  it("proposes her moved replies' places, contracts and pay, and none of her older answers", () => {
    const { focus, proposes, evidence } = expected.mvp3.rerun;
    expect(all.replies.length).toBeGreaterThan(sent.length);
    const since = new Date(NOW - 90 * 24 * 60 * 60_000);
    const proposal = aggregateIntake(focusIntakeInput(all, focus, since));
    for (const [key, values] of Object.entries(proposes)) {
      const answer = proposal.entries.find((e) => e.key === key);
      expect(answer?.value, key).toEqual(values);
      expect(
        answer?.evidence.map((e) => e.messageId),
        key,
      ).toEqual(evidence);
    }
    // No answer comes from a reply other than her moved ones.
    const replies = new Set(all.replies.map((r) => r.messageId));
    const fromReplies = proposal.entries.flatMap((e) =>
      e.evidence.map((x) => x.messageId).filter((id) => replies.has(id)),
    );
    expect(new Set(fromReplies)).toEqual(new Set(evidence));
  });
});
