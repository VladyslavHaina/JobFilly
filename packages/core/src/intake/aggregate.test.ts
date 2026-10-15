import {
  type Category,
  CORE_PROFILE_KEYS,
  CORE_PROFILE_LABELS,
  type CoreProfileKey,
  type IntakeInput,
  type IntakeProposalEntry,
  IntakeProposalSchema,
  type JobFacts,
  NOT_ENOUGH_EVIDENCE,
  type Preferences,
} from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { aggregateIntake } from "./aggregate";

// The aggregation rules (1)-(4) of F6, every core key, and the two constraints on confidence:
// at least medium from 2 replies or 10 job messages, and an answer's confidence and reason depend
// only on its own evidence.

const BASE = Date.UTC(2026, 8, 30, 12);
/** A date `n` hours before BASE: a larger n is older. */
const ago = (n: number) => new Date(BASE - n * 3_600_000).toISOString();

type Reply = IntakeInput["replies"][number];
type Job = IntakeInput["jobs"][number];

const reply = (n: number, preferences: Preferences): Reply => ({
  messageId: `<reply-${n}@inbox.example>`,
  date: ago(n),
  preferences,
});

const facts = (overrides: Partial<JobFacts> = {}): JobFacts => ({
  title: null,
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

const job = (
  n: number,
  roles: Partial<JobFacts>[],
  category: Category = "recruiter_outreach",
): Job => ({
  messageId: `<job-${n}@agency.example>`,
  date: ago(n),
  category,
  roles: roles.map(facts),
});

/** `count` job messages, hours first..first+count-1 ago (the first is the newest). */
const jobs = (first: number, count: number, roles: Partial<JobFacts>[]): Job[] =>
  Array.from({ length: count }, (_, i) => job(first + i, roles));

const replyIds = (...ns: number[]) => ns.map((n) => `<reply-${n}@inbox.example>`);
const jobIds = (first: number, count: number) =>
  Array.from({ length: count }, (_, i) => `<job-${first + i}@agency.example>`);

function answer(input: Partial<IntakeInput>, key: CoreProfileKey): IntakeProposalEntry {
  const proposal = aggregateIntake({ replies: [], jobs: [], ...input });
  expect(IntakeProposalSchema.parse(proposal)).toEqual(proposal);
  const entry = proposal.entries.find((e) => e.key === key);
  if (!entry) throw new Error(`no entry for ${key}`);
  return entry;
}

const evidenceIds = (e: IntakeProposalEntry) => e.evidence.map((x) => x.messageId);
const AT_LEAST_MEDIUM = ["medium", "high"];

describe("aggregateIntake: no evidence, no answer (rule 4, F6.3)", () => {
  it("proposes every core question, in form order, empty and marked Not enough evidence", () => {
    const proposal = aggregateIntake({ replies: [], jobs: [] });
    expect(proposal.entries).toEqual(
      CORE_PROFILE_KEYS.map((key) => ({
        key,
        label: CORE_PROFILE_LABELS[key],
        value: [],
        confidence: null,
        evidence: [],
        emptyReason: NOT_ENOUGH_EVIDENCE,
      })),
    );
  });

  it("pre-fills nothing a reply leaves empty or blank", () => {
    const e = answer(
      { replies: [reply(1, { target_roles: [], languages: ["  "] })] },
      "target_roles",
    );
    expect(e).toMatchObject({ value: [], confidence: null, emptyReason: NOT_ENOUGH_EVIDENCE });
    expect(answer({ replies: [reply(1, { languages: ["  "] })] }, "languages").emptyReason).toBe(
      NOT_ENOUGH_EVIDENCE,
    );
  });

  it("gives every answered entry evidence, and no entry with evidence is empty", () => {
    const proposal = aggregateIntake({
      replies: [reply(1, { contracts: ["B2B"] })],
      jobs: jobs(10, 6, [{ title: "Backend Engineer" }]),
    });
    for (const e of proposal.entries) {
      expect(e.value.length > 0, e.key).toBe(e.evidence.length > 0);
      expect(e.confidence === null, e.key).toBe(e.value.length === 0);
      expect(e.emptyReason === null, e.key).toBe(e.value.length > 0);
    }
  });
});

describe("aggregateIntake: inputs (rule 1)", () => {
  it("reads the replies' preferences and the job messages' roles", () => {
    const proposal = aggregateIntake({
      replies: [reply(1, { languages: ["English"] })],
      jobs: jobs(10, 5, [{ seniority: "Senior" }]),
    });
    const byKey = Object.fromEntries(proposal.entries.map((e) => [e.key, e.value]));
    expect(byKey.languages).toEqual(["English"]);
    expect(byKey.seniority).toEqual(["Senior"]);
  });

  it("leaves out messages whose category is not_job", () => {
    const notJob = Array.from({ length: 6 }, (_, i) =>
      job(10 + i, [{ title: "Backend Engineer" }], "not_job"),
    );
    expect(answer({ jobs: notJob }, "target_roles").value).toEqual([]);
    const mixed = [...notJob, ...jobs(30, 4, [{ title: "Backend Engineer" }])];
    expect(answer({ jobs: mixed }, "target_roles").value).toEqual([]);
  });
});

// Rule 2 for every core key: the newest reply's wording, duplicates by normalised form dropped,
// every distinct value kept, evidence the stating replies newest first.
const RULE_2: {
  [K in CoreProfileKey]: {
    newer: NonNullable<Preferences[K]>;
    older: NonNullable<Preferences[K]>;
    expected: NonNullable<Preferences[K]>;
  };
} = {
  target_roles: {
    newer: ["Backend Engineer"],
    older: ["  backend engineer ", "Platform Engineer"],
    expected: ["Backend Engineer", "Platform Engineer"],
  },
  seniority: { newer: ["Senior"], older: ["senior", "Staff"], expected: ["Senior", "Staff"] },
  places: {
    newer: [{ country: "DE", city: "Berlin", mode: "hybrid" }],
    older: [
      { country: "DE", city: " berlin", mode: "hybrid" },
      { country: "DE", city: "Berlin", mode: "onsite" },
      { country: "NL", city: "Amsterdam", mode: "hybrid" },
    ],
    expected: [
      { country: "DE", city: "Berlin", mode: "hybrid" },
      { country: "DE", city: "Berlin", mode: "onsite" },
      { country: "NL", city: "Amsterdam", mode: "hybrid" },
    ],
  },
  remote: {
    newer: [{ scope: "EU", timeZones: null }],
    older: [
      { scope: "eu ", timeZones: null },
      { scope: "EU", timeZones: { from: "UTC-01:00", to: "UTC+03:00" } },
    ],
    expected: [
      { scope: "EU", timeZones: null },
      { scope: "EU", timeZones: { from: "UTC-01:00", to: "UTC+03:00" } },
    ],
  },
  contracts: {
    newer: ["B2B"],
    older: ["b2b", "permanent", "unbefristet"],
    expected: ["B2B", "permanent", "unbefristet"],
  },
  min_pay: {
    newer: [{ amount: 70000, currency: "EUR", period: "year", asWritten: "€70,000 a year" }],
    older: [
      { amount: 70000, currency: "EUR", period: "year", asWritten: "70k EUR p.a." },
      { amount: 450, currency: "EUR", period: "day", asWritten: "€450 a day" },
    ],
    expected: [
      { amount: 70000, currency: "EUR", period: "year", asWritten: "€70,000 a year" },
      { amount: 450, currency: "EUR", period: "day", asWritten: "€450 a day" },
    ],
  },
  languages: {
    newer: ["English"],
    older: ["english", "Portuguese"],
    expected: ["English", "Portuguese"],
  },
  work_permits: {
    newer: [{ country: null, text: "EU citizen" }],
    older: [
      { country: null, text: "eu citizen " },
      { country: "GB", text: "EU citizen" },
    ],
    expected: [
      { country: null, text: "EU citizen" },
      { country: "GB", text: "EU citizen" },
    ],
  },
  reply_to: {
    newer: ["recruiter_outreach"],
    older: ["recruiter_outreach", "interview"],
    expected: ["recruiter_outreach", "interview"],
  },
  deal_breakers: {
    newer: ["No relocation"],
    older: ["no relocation", "Unpaid trial days"],
    expected: ["No relocation", "Unpaid trial days"],
  },
};

describe("aggregateIntake: answers the user's replies state (rule 2)", () => {
  for (const key of CORE_PROFILE_KEYS) {
    it(`${key}: unites the stated values, worded as in the newest reply`, () => {
      const { newer, older, expected } = RULE_2[key];
      // Given oldest first, to show the order comes from the dates.
      const e = answer(
        {
          replies: [
            reply(30, { [key]: older }),
            // A reply about something else is no evidence for this key.
            reply(20, key === "languages" ? { seniority: ["Senior"] } : { languages: ["Dutch"] }),
            reply(5, { [key]: newer }),
          ],
        },
        key,
      );
      expect(e.value).toEqual(expected);
      expect(evidenceIds(e)).toEqual(replyIds(5, 30));
      expect(e.confidence).toBe("medium");
      expect(e.emptyReason).toBeNull();
    });
  }

  it("takes a key a reply states only from replies, however much job mail says otherwise", () => {
    const replies = [reply(1, { target_roles: ["Backend Engineer"] })];
    const alone = answer({ replies }, "target_roles");
    const withJobs = answer(
      { replies, jobs: jobs(10, 40, [{ title: "Data Engineer" }, { title: "Backend Engineer" }]) },
      "target_roles",
    );
    expect(withJobs.value).toEqual(["Backend Engineer"]);
    expect(evidenceIds(withJobs)).toEqual(replyIds(1));
    // An answer's confidence and reason depend only on its own evidence.
    expect(withJobs).toEqual(alone);
  });

  it("keeps several minimum pays, in any currency and period, as written", () => {
    const e = answer(
      {
        replies: [
          reply(1, {
            min_pay: [
              { amount: 30, currency: "GBP", period: "hour", asWritten: "£30 an hour" },
              { amount: 450, currency: "EUR", period: "day", asWritten: "€450/day" },
            ],
          }),
          reply(2, {
            min_pay: [
              { amount: 70000, currency: "EUR", period: "year", asWritten: "€70k" },
              { amount: 9500, currency: "CHF", period: "month", asWritten: "CHF 9,500 monthly" },
              { amount: 450, currency: "EUR", period: "hour", asWritten: "450 EUR per hour" },
            ],
          }),
        ],
      },
      "min_pay",
    );
    expect(e.value).toEqual([
      { amount: 30, currency: "GBP", period: "hour", asWritten: "£30 an hour" },
      { amount: 450, currency: "EUR", period: "day", asWritten: "€450/day" },
      { amount: 70000, currency: "EUR", period: "year", asWritten: "€70k" },
      { amount: 9500, currency: "CHF", period: "month", asWritten: "CHF 9,500 monthly" },
      { amount: 450, currency: "EUR", period: "hour", asWritten: "450 EUR per hour" },
    ]);
  });

  it("keeps contract, seniority and permit wording as written: no market vocabulary", () => {
    const replies = [
      reply(1, {
        contracts: ["CDI", "umowa o pracę", "Festanstellung"],
        seniority: ["Band 6"],
        work_permits: [{ country: "GB", text: "Indefinite leave to remain" }],
        target_roles: ["Staff Nurse (Band 6)"],
      }),
    ];
    expect(answer({ replies }, "contracts").value).toEqual([
      "CDI",
      "umowa o pracę",
      "Festanstellung",
    ]);
    expect(answer({ replies }, "seniority").value).toEqual(["Band 6"]);
    expect(answer({ replies }, "work_permits").value).toEqual([
      { country: "GB", text: "Indefinite leave to remain" },
    ]);
    expect(answer({ replies }, "target_roles").value).toEqual(["Staff Nurse (Band 6)"]);
  });

  it("orders replies with the same date as they came in (stable)", () => {
    const same = ago(3);
    const e = answer(
      {
        replies: [
          { messageId: "<b@inbox.example>", date: same, preferences: { languages: ["English"] } },
          { messageId: "<a@inbox.example>", date: same, preferences: { languages: ["english"] } },
        ],
      },
      "languages",
    );
    expect(e.value).toEqual(["English"]);
    expect(evidenceIds(e)).toEqual(["<b@inbox.example>", "<a@inbox.example>"]);
  });
});

// Rule 3 for every key job facts can answer: a value needs 5 distinct job messages.
const RULE_3: {
  key: CoreProfileKey;
  role: Partial<JobFacts>;
  newerWording: Partial<JobFacts>;
  expected: unknown[];
}[] = [
  {
    key: "target_roles",
    role: { title: "backend engineer" },
    newerWording: { title: "Backend Engineer" },
    expected: ["Backend Engineer"],
  },
  {
    key: "seniority",
    role: { seniority: "senior" },
    newerWording: { seniority: "Senior" },
    expected: ["Senior"],
  },
  {
    key: "places",
    role: { places: [{ country: "DE", city: "berlin" }], workMode: "hybrid" },
    newerWording: { places: [{ country: "DE", city: "Berlin" }], workMode: "hybrid" },
    expected: [{ country: "DE", city: "Berlin", mode: "hybrid" }],
  },
  {
    key: "remote",
    role: { workMode: "remote", remoteScope: "europe", timeZones: null },
    newerWording: { workMode: "remote", remoteScope: "Europe", timeZones: null },
    expected: [{ scope: "Europe", timeZones: null }],
  },
  {
    key: "contracts",
    role: { contract: "unbefristet" },
    newerWording: { contract: "Unbefristet" },
    expected: ["Unbefristet"],
  },
  {
    key: "languages",
    role: { languages: ["german"] },
    newerWording: { languages: ["German"] },
    expected: ["German"],
  },
  {
    key: "work_permits",
    role: { workPermit: "eu work permit required" },
    newerWording: { workPermit: "EU work permit required" },
    expected: [{ country: null, text: "EU work permit required" }],
  },
];

describe("aggregateIntake: answers from job facts (rule 3)", () => {
  for (const { key, role, newerWording, expected } of RULE_3) {
    it(`${key}: proposes a value found in 5 distinct job messages, worded as the newest`, () => {
      const input = { jobs: [job(1, [newerWording]), ...jobs(10, 4, [role])] };
      const e = answer(input, key);
      expect(e.value).toEqual(expected);
      expect(evidenceIds(e)).toEqual([`<job-1@agency.example>`, ...jobIds(10, 4)]);
      expect(e.confidence).toBe("low");
      expect(e.evidence[0]?.reason).toBe("in 5 job emails");
    });

    it(`${key}: proposes nothing from only 4 job messages`, () => {
      expect(answer({ jobs: jobs(10, 4, [role]) }, key)).toMatchObject({
        value: [],
        confidence: null,
        emptyReason: NOT_ENOUGH_EVIDENCE,
      });
    });
  }

  it("counts a message once however many of its roles carry the value", () => {
    const alert = [{ title: "Go Developer" }, { title: "Go Developer" }, { title: "go developer" }];
    expect(answer({ jobs: jobs(10, 4, alert) }, "target_roles").value).toEqual([]);
    const e = answer({ jobs: jobs(10, 5, alert) }, "target_roles");
    expect(e.value).toEqual(["Go Developer"]);
    expect(evidenceIds(e)).toEqual(jobIds(10, 5));
  });

  it("keeps every value that reaches 5 messages and leaves the rest, with their evidence", () => {
    const e = answer(
      {
        jobs: [
          ...jobs(10, 5, [{ title: "Backend Engineer" }]),
          ...jobs(20, 5, [{ title: "SRE" }]),
          ...jobs(30, 3, [{ title: "Data Engineer" }]),
        ],
      },
      "target_roles",
    );
    expect(e.value).toEqual(["Backend Engineer", "SRE"]);
    expect(evidenceIds(e)).toEqual([...jobIds(10, 5), ...jobIds(20, 5)]);
  });

  it("takes places only from onsite or hybrid roles with a country", () => {
    const remote = jobs(10, 5, [
      { places: [{ country: "DE", city: "Berlin" }], workMode: "remote" },
    ]);
    const noMode = jobs(20, 5, [{ places: [{ country: "DE", city: "Berlin" }] }]);
    const noCountry = jobs(30, 5, [
      { places: [{ country: null, city: "Berlin" }], workMode: "onsite" },
    ]);
    expect(answer({ jobs: [...remote, ...noMode, ...noCountry] }, "places").value).toEqual([]);
    const onsite = jobs(40, 5, [{ places: [{ country: "PT", city: null }], workMode: "onsite" }]);
    expect(answer({ jobs: onsite }, "places").value).toEqual([
      { country: "PT", city: null, mode: "onsite" },
    ]);
  });

  it("takes remote from the remote scope or the time zones", () => {
    const zones = { from: "UTC+00:00", to: "UTC+02:00" };
    const e = answer({ jobs: jobs(10, 5, [{ timeZones: zones }]) }, "remote");
    expect(e.value).toEqual([{ scope: "", timeZones: zones }]);
  });

  it("never takes min_pay, reply_to or deal_breakers from job mail", () => {
    const pay = {
      min: 70000,
      max: 90000,
      currency: "EUR",
      period: "year" as const,
      asWritten: "x",
    };
    const input = { jobs: jobs(10, 30, [{ pay, title: "Backend Engineer" }]) };
    for (const key of ["min_pay", "reply_to", "deal_breakers"] as const) {
      expect(answer(input, key).emptyReason, key).toBe(NOT_ENOUGH_EVIDENCE);
    }
  });
});

describe("aggregateIntake: confidence and reasons", () => {
  it("is at least medium for an answer stated in 2 replies", () => {
    for (const key of CORE_PROFILE_KEYS) {
      const { newer, older } = RULE_2[key];
      const e = answer({ replies: [reply(1, { [key]: newer }), reply(2, { [key]: older })] }, key);
      expect(AT_LEAST_MEDIUM, key).toContain(e.confidence);
    }
  });

  it("is at least medium for an answer carried by 10 job messages", () => {
    for (const { key, role } of RULE_3) {
      const e = answer({ jobs: jobs(10, 10, [role]) }, key);
      expect(AT_LEAST_MEDIUM, key).toContain(e.confidence);
      expect(e.evidence[0]?.reason, key).toBe("in 10 job emails");
    }
  });

  it("is low for one reply or fewer than 10 job messages, so the answer stands out", () => {
    expect(answer({ replies: [reply(1, { seniority: ["Senior"] })] }, "seniority").confidence).toBe(
      "low",
    );
    expect(answer({ jobs: jobs(10, 9, [{ seniority: "Senior" }]) }, "seniority").confidence).toBe(
      "low",
    );
  });

  it("is high from 3 replies", () => {
    const replies = [1, 2, 3].map((n) => reply(n, { languages: ["English"] }));
    expect(answer({ replies }, "languages").confidence).toBe("high");
  });

  it("says why on every piece of evidence: from N of your replies, in N job emails", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => reply(i + 1, { contracts: ["B2B"] }));
    const e = answer({ replies: twelve }, "contracts");
    expect(new Set(e.evidence.map((x) => x.reason))).toEqual(new Set(["from 12 of your replies"]));
    expect(answer({ replies: [reply(1, { contracts: ["B2B"] })] }, "contracts").evidence).toEqual([
      { messageId: replyIds(1)[0], reason: "from one of your replies" },
    ]);
    const forty = answer({ jobs: jobs(10, 40, [{ title: "Backend Engineer" }]) }, "target_roles");
    expect(forty.evidence).toHaveLength(40);
    expect(new Set(forty.evidence.map((x) => x.reason))).toEqual(new Set(["in 40 job emails"]));
  });

  it("gives each answer a confidence from its own evidence only", () => {
    const replies = [reply(1, { languages: ["English"] }), reply(2, { languages: ["English"] })];
    const thin = aggregateIntake({ replies, jobs: [] });
    const rich = aggregateIntake({ replies, jobs: jobs(10, 40, [{ title: "Backend Engineer" }]) });
    const lang = (p: typeof thin) => p.entries.find((e) => e.key === "languages");
    expect(lang(rich)).toEqual(lang(thin));
  });
});
