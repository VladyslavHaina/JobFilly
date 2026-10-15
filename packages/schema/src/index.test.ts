import { describe, expect, it } from "vitest";
import {
  AiSettingsInputSchema,
  batchResultSchema,
  CATEGORIES,
  CategorySchema,
  ClassifyOutputSchema,
  CreateInviteInputSchema,
  DEFAULT_BUDGET_PER_RUN,
  EnvelopeSchema,
  IntakeExtraInputSchema,
  IntakeExtraOutputSchema,
  IntakeProposalSchema,
  InviteLinkQuerySchema,
  InviteParamsSchema,
  JOB_CATEGORIES,
  JobFactsSchema,
  JobPlatformsFileSchema,
  LiveEnvelopeSchema,
  LiveEventSchema,
  MailTestResultSchema,
  MemberParamsSchema,
  PreferencesSchema,
  ProfileEntrySchema,
  ProfileKeySchema,
  RegisterInputSchema,
  roleAtLeast,
  StageOneVerdictSchema,
  syntheticMessageId,
  TASK_IDS,
  taskResultSchema,
} from "./index";

const envelope = {
  messageId: "<abc+1/2%3@mail.example>",
  folder: "inbox",
  folderPath: "INBOX",
  uidValidity: 1700000000,
  uid: 42,
  date: "2026-10-01T09:30:00.000Z",
  from: { address: "recruiter@agency.example", name: "Ana" },
  to: [{ address: "maria.santos@inbox.example", name: null }],
  cc: [],
  replyTo: [],
  inReplyTo: null,
  references: [],
  subject: "Backend role in Berlin",
  listId: null,
  listUnsubscribe: null,
  precedence: null,
  autoSubmitted: null,
  snippet: "Hello Maria",
};

const facts = {
  title: "Backend Engineer",
  company: "Example GmbH",
  agency: null,
  places: [{ country: "DE", city: "Berlin" }],
  workMode: "hybrid",
  remoteScope: null,
  timeZones: null,
  pay: { min: 75000, max: 85000, currency: "EUR", period: "year", asWritten: "€75–85k" },
  contract: "unbefristet",
  seniority: null,
  workPermit: null,
  skills: ["Go"],
  languages: ["English"],
  applyUrl: null,
  extra: {},
};

describe("fixed ids", () => {
  it("has the nine categories and the four stage-one verdicts", () => {
    expect(CATEGORIES).toEqual([
      "recruiter_outreach",
      "job_alert",
      "application_update",
      "interview",
      "assessment",
      "offer",
      "rejection",
      "other_job",
      "not_job",
    ]);
    expect(JOB_CATEGORIES).not.toContain("not_job");
    expect(JOB_CATEGORIES).toHaveLength(8);
    expect(StageOneVerdictSchema.options).toEqual([
      "not_job",
      "likely_job",
      "own_reply",
      "job_alert",
    ]);
    expect(CategorySchema.safeParse("spam").success).toBe(false);
  });

  it("has the five task ids", () => {
    expect(TASK_IDS).toEqual(["classify.v1", "extract.v1", "prefs.v1", "intake.v1", "ai.test.v1"]);
  });

  it("orders roles viewer < editor < admin", () => {
    expect(roleAtLeast("admin", "editor")).toBe(true);
    expect(roleAtLeast("editor", "editor")).toBe(true);
    expect(roleAtLeast("viewer", "editor")).toBe(false);
    expect(roleAtLeast("editor", "admin")).toBe(false);
  });
});

describe("accounts", () => {
  it("needs a password of at least 12 characters and normalises the email", () => {
    expect(
      RegisterInputSchema.safeParse({ name: "Maria", email: "m@x.example", password: "short" })
        .success,
    ).toBe(false);
    expect(
      RegisterInputSchema.parse({
        name: " Maria Santos ",
        email: " Maria@Inbox.Example ",
        password: "twelve chars",
      }),
    ).toEqual({ name: "Maria Santos", email: "maria@inbox.example", password: "twelve chars" });
    expect(CreateInviteInputSchema.safeParse({ email: "t@x.example", role: "owner" }).success).toBe(
      false,
    );
  });
});

describe("mail", () => {
  it("keeps a Message-ID verbatim and limits the snippet to 200 characters", () => {
    expect(EnvelopeSchema.parse(envelope).messageId).toBe("<abc+1/2%3@mail.example>");
    expect(EnvelopeSchema.safeParse({ ...envelope, snippet: "x".repeat(201) }).success).toBe(false);
    expect(syntheticMessageId("sent", 7, 9)).toBe("<sent.7.9@jobfilly.invalid>");
  });

  it("describes a connection test as folders or a plain reason", () => {
    expect(
      MailTestResultSchema.safeParse({ ok: true, folders: ["INBOX", "Sent"], sentPath: "Sent" })
        .success,
    ).toBe(true);
    expect(
      MailTestResultSchema.safeParse({ ok: false, reason: "wrong_password", message: "No" })
        .success,
    ).toBe(true);
    expect(
      MailTestResultSchema.safeParse({ ok: false, reason: "other", message: "x" }).success,
    ).toBe(false);
  });
});

describe("job facts", () => {
  it("accepts ISO codes and rejects market words in their place", () => {
    expect(JobFactsSchema.parse(facts)).toEqual(facts);
    const badCountry = { ...facts, places: [{ country: "Germany", city: "Berlin" }] };
    expect(JobFactsSchema.safeParse(badCountry).success).toBe(false);
    const badCurrency = { ...facts, pay: { ...facts.pay, currency: "€" } };
    expect(JobFactsSchema.safeParse(badCurrency).success).toBe(false);
    const badPeriod = { ...facts, pay: { ...facts.pay, period: "annum" } };
    expect(JobFactsSchema.safeParse(badPeriod).success).toBe(false);
    expect(
      JobFactsSchema.safeParse({ ...facts, timeZones: { from: "UTC-01:00", to: "UTC+03:00" } })
        .success,
    ).toBe(true);
  });
});

describe("profile", () => {
  const entry = {
    key: "min_pay",
    label: "Minimum pay",
    value: [{ amount: 70000, currency: "EUR", period: "year", asWritten: "€70,000 a year" }],
    confidence: "high",
    evidence: [{ messageId: "<r1@inbox.example>", reason: "your reply" }],
    source: "scan",
    updatedAt: "2026-10-01T09:30:00.000Z",
    updatedBy: null,
  };

  it("checks each core key's value against that key's schema", () => {
    expect(ProfileEntrySchema.safeParse(entry).success).toBe(true);
    expect(ProfileEntrySchema.safeParse({ ...entry, value: ["€70,000"] }).success).toBe(false);
    expect(
      ProfileEntrySchema.safeParse({ ...entry, key: "reply_to", value: ["offer", "interview"] })
        .success,
    ).toBe(true);
    expect(
      ProfileEntrySchema.safeParse({ ...entry, key: "reply_to", value: ["spam"] }).success,
    ).toBe(false);
    expect(
      ProfileEntrySchema.safeParse({ ...entry, key: "extra.b2b", value: ["Yes"] }).success,
    ).toBe(true);
  });

  it("allows core keys and extra.<slug> only", () => {
    expect(ProfileKeySchema.safeParse("places").success).toBe(true);
    expect(ProfileKeySchema.safeParse("extra.accepts-b2b").success).toBe(true);
    expect(ProfileKeySchema.safeParse("salary").success).toBe(false);
    expect(ProfileKeySchema.safeParse("extra.").success).toBe(false);
  });

  it("marks empty proposals with the one reason", () => {
    const proposal = {
      entries: [
        {
          key: "seniority",
          label: "Seniority",
          value: [],
          confidence: null,
          evidence: [],
          emptyReason: "Not enough evidence",
        },
      ],
    };
    expect(IntakeProposalSchema.safeParse(proposal).success).toBe(true);
    const other = { entries: [{ ...proposal.entries[0], emptyReason: "Unknown" }] };
    expect(IntakeProposalSchema.safeParse(other).success).toBe(false);
  });

  it("reads a reply's preferences as optional values per key", () => {
    expect(
      PreferencesSchema.parse({
        places: [{ country: "DE", city: "Berlin", mode: "hybrid" }],
        extra: { b2b: "accepts B2B" },
      }),
    ).toEqual({
      places: [{ country: "DE", city: "Berlin", mode: "hybrid" }],
      extra: { b2b: "accepts B2B" },
    });
  });
});

describe("AI", () => {
  it("defaults the budget to 300 calls and never needs the key to save", () => {
    const parsed = AiSettingsInputSchema.parse({
      provider: "openai-compatible",
      baseUrl: "http://fake-ai:8080/v1",
      models: { classify: "m", extract: "m", prefs: "m", intake: "m" },
    });
    expect(parsed.budgetPerRun).toBe(DEFAULT_BUDGET_PER_RUN);
    expect(DEFAULT_BUDGET_PER_RUN).toBe(300);
    expect(parsed.apiKey).toBeUndefined();
  });

  it("caps intake.v1 at 20 items in and five questions out", () => {
    const item = {
      messageId: "<a@x>",
      folder: "inbox",
      from: { address: "a@x.example", name: null },
      date: "2026-10-01T09:30:00.000Z",
      subject: "s",
      text: "t",
    };
    const answers = [{ key: "deal_breakers", value: [], confidence: null }];
    expect(IntakeExtraInputSchema.safeParse({ items: [item], answers }).success).toBe(true);
    expect(IntakeExtraInputSchema.safeParse({ items: Array(21).fill(item), answers }).success).toBe(
      false,
    );
    const q = {
      slug: "b2b",
      label: "Do you accept B2B contracts?",
      options: ["Yes"],
      evidence: [],
    };
    expect(IntakeExtraOutputSchema.safeParse({ questions: Array(5).fill(q) }).success).toBe(true);
    expect(IntakeExtraOutputSchema.safeParse({ questions: Array(6).fill(q) }).success).toBe(false);
  });

  it("describes task and batch results with usage per call", () => {
    const usage = [{ task: "classify.v1", inputTokens: 10, outputTokens: 2 }];
    const batch = batchResultSchema(
      ClassifyOutputSchema.shape.items.element.pick({ category: true }),
    );
    expect(
      batch.safeParse({
        items: [
          { messageId: "<a@x>", ok: true, data: { category: "offer" } },
          { messageId: "<b@x>", ok: false, error: { kind: "not_retried", message: "budget" } },
        ],
        usage,
      }).success,
    ).toBe(true);
    const task = taskResultSchema(IntakeExtraOutputSchema);
    expect(
      task.safeParse({ ok: false, error: { kind: "auth", message: "Wrong key" }, usage: [] })
        .success,
    ).toBe(true);
    expect(task.safeParse({ ok: true, usage: [] }).success).toBe(false);
  });
});

describe("scan and live events", () => {
  it("validates the job-platforms data file", () => {
    const file = {
      version: 1,
      entries: [
        { domain: "jobs.example", kind: "job_board", countries: [], alertSenders: ["alerts"] },
      ],
    };
    expect(JobPlatformsFileSchema.safeParse(file).success).toBe(true);
    const upper = { ...file, entries: [{ ...file.entries[0], domain: "Jobs.Example" }] };
    expect(JobPlatformsFileSchema.safeParse(upper).success).toBe(false);
  });

  it("types each SSE event by name", () => {
    expect(LiveEventSchema.safeParse({ type: "intake.updated", data: {} }).success).toBe(true);
    expect(LiveEventSchema.safeParse({ type: "scan.progress", data: {} }).success).toBe(false);
    expect(LiveEventSchema.safeParse({ type: "unknown", data: {} }).success).toBe(false);
  });
});

describe("path params and the live envelope", () => {
  const id = "00000000-0000-4000-8000-0000000000aa";

  it("take a UUID as a row id and nothing else", () => {
    expect(MemberParamsSchema.safeParse({ userId: id }).success).toBe(true);
    expect(InviteParamsSchema.safeParse({ inviteId: id.toUpperCase() }).success).toBe(true);
    for (const bad of ["xyz", "", `${id}0`, "<a@b.example>"]) {
      expect(MemberParamsSchema.safeParse({ userId: bad }).success).toBe(false);
      expect(InviteParamsSchema.safeParse({ inviteId: bad }).success).toBe(false);
    }
  });

  it("reads an invite link's token, which may be absent", () => {
    expect(InviteLinkQuerySchema.parse({})).toEqual({});
    expect(InviteLinkQuerySchema.parse({ token: "t" })).toEqual({ token: "t" });
  });

  it("carries a workspace id and a valid live event across replicas", () => {
    const event = { type: "workspace.updated", data: {} };
    expect(LiveEnvelopeSchema.safeParse({ workspaceId: id, event }).success).toBe(true);
    expect(LiveEnvelopeSchema.safeParse({ workspaceId: "w1", event }).success).toBe(false);
    expect(
      LiveEnvelopeSchema.safeParse({ workspaceId: id, event: { type: "nope", data: {} } }).success,
    ).toBe(false);
  });
});
