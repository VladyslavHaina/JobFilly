import { describe, expect, it } from "vitest";
import {
  AppliedSenderMarkSchema,
  AssistantAnswerSchema,
  AssistantOutputSchema,
  answersWaitingOnly,
  ChangeSchema,
  CORE_PROFILE_KEYS,
  ConditionSchema,
  CvChoiceOverrideSchema,
  CvSchema,
  CvUpdateSchema,
  DecisionAnswerSchema,
  DecisionChoiceSchema,
  DraftCreatePayloadSchema,
  DraftOutputSchema,
  DraftSchema,
  formatOffset,
  groupKeyFor,
  isListProfileKey,
  jobDedupeKey,
  LanguageWordsFileSchema,
  LIST_PROFILE_KEYS,
  LIVE_EVENT_TYPES,
  LiveEventSchema,
  MAX_CV_BYTES,
  MailboxPublicSchema,
  MailTestFailureReasonSchema,
  MessageDetailSchema,
  MessageListItemSchema,
  MessageListQuerySchema,
  MxLookupResultSchema,
  NEVER_SYNCED,
  POLICY_DEFAULTS,
  ProfileEntrySchema,
  ProfileHistoryListSchema,
  ProfilePatchSchema,
  ProposalEditSchema,
  ProposalSchema,
  parseGroupKey,
  profileItemSchema,
  RdapDomainAnswerSchema,
  RdapLookupResultSchema,
  RoleEvaluationSchema,
  RuleSchema,
  SenderCheckSchema,
  SenderMarkInputSchema,
  SyncFailureReasonSchema,
} from "./index";

const id = "11111111-1111-4111-8111-111111111111";
const at = "2026-10-01T09:30:00.000Z";

describe("group keys (F7.3)", () => {
  it("joins the profile key and its parts, and parses back exactly", () => {
    expect(groupKeyFor("min_pay", ["CHF", "year"])).toBe("min_pay:CHF:year");
    expect(parseGroupKey("min_pay:CHF:year")).toEqual({
      profileKey: "min_pay",
      parts: ["CHF", "year"],
    });
    expect(groupKeyFor("extra.relocate")).toBe("extra.relocate");
    expect(parseGroupKey("extra.relocate")).toEqual({ profileKey: "extra.relocate", parts: [] });
  });

  it("keeps a part holding ':' or '%' as one part", () => {
    const key = groupKeyFor("rule", ["a:b", "50%", "%3A"]);
    expect(key.split(":")).toHaveLength(4);
    expect(parseGroupKey(key)).toEqual({ profileKey: "rule", parts: ["a:b", "50%", "%3A"] });
  });
});

describe("profile keys of MVP 2", () => {
  const entry = {
    label: "x",
    confidence: null,
    evidence: [],
    updatedAt: at,
    updatedBy: null,
  };

  it("takes the policy keys as one-number lists, with their defaults", () => {
    expect(POLICY_DEFAULTS).toEqual({ reply_threshold: 70, reply_window_days: 14 });
    const policy = { ...entry, key: "reply_threshold", value: [75], source: "you" };
    expect(ProfileEntrySchema.safeParse(policy).success).toBe(true);
    expect(ProfileEntrySchema.safeParse({ ...policy, value: [70, 80] }).success).toBe(false);
    expect(ProfileEntrySchema.safeParse({ ...policy, value: ["70"] }).success).toBe(false);
    expect(
      ProfilePatchSchema.safeParse({ entries: [{ key: "reply_window_days", value: [7] }] }).success,
    ).toBe(true);
  });

  it("records entries set by a decision or the assistant", () => {
    for (const source of ["decision", "assistant"]) {
      const e = { ...entry, key: "deal_breakers", value: ["night shifts"], source };
      expect(ProfileEntrySchema.safeParse(e).success).toBe(true);
    }
  });

  it("lists every core key as a list key, and no policy or extra key", () => {
    expect([...LIST_PROFILE_KEYS].sort()).toEqual([...CORE_PROFILE_KEYS].sort());
    expect(isListProfileKey("min_pay")).toBe(true);
    expect(isListProfileKey("reply_threshold")).toBe(false);
    expect(isListProfileKey("extra.relocate")).toBe(false);
  });

  it("knows the shape of one item of each key", () => {
    const chf = { amount: 120000, currency: "CHF", period: "year", asWritten: "CHF 120k" };
    expect(profileItemSchema("min_pay").safeParse(chf).success).toBe(true);
    expect(profileItemSchema("min_pay").safeParse("CHF 120k").success).toBe(false);
    expect(profileItemSchema("reply_to").safeParse("interview").success).toBe(true);
    expect(profileItemSchema("reply_threshold").safeParse(80).success).toBe(true);
    expect(profileItemSchema("extra.relocate").safeParse("No").success).toBe(true);
  });
});

describe("UTC offsets in plain words", () => {
  it("writes them the short way, with a real minus sign", () => {
    expect(formatOffset("UTC+05:00")).toBe("UTC+5");
    expect(formatOffset("UTC+05:30")).toBe("UTC+5:30");
    expect(formatOffset("UTC-01:30")).toBe("UTC−1:30");
    expect(formatOffset("UTC-10:00")).toBe("UTC−10");
    expect(formatOffset("UTC+00:00")).toBe("UTC+0");
    expect(formatOffset("UTC-00:00")).toBe("UTC+0");
    expect(formatOffset("Asia")).toBe("Asia");
  });
});

describe("rules, changes and the assistant (F3, F8)", () => {
  const rule = {
    description: "Hide roles whose hours are UTC+05:00 or later",
    when: [{ fact: "timeZones", op: "within", value: { from: "UTC+05:00", to: "UTC+14:00" } }],
    then: "hide",
    enabled: true,
  };

  it("takes the facts and ops of F3 with a closed value union", () => {
    expect(ConditionSchema.safeParse(rule.when[0]).success).toBe(true);
    const pay = { fact: "pay", op: "below", value: { amount: 1, currency: "CHF", period: "year" } };
    expect(ConditionSchema.safeParse(pay).success).toBe(true);
    expect(
      ConditionSchema.safeParse({ fact: "extra.b2b", op: "missing", value: null }).success,
    ).toBe(true);
    expect(ConditionSchema.safeParse({ fact: "salary", op: "below", value: 3 }).success).toBe(
      false,
    );
    expect(ConditionSchema.safeParse({ fact: "pay", op: "above", value: 3 }).success).toBe(false);
    expect(ConditionSchema.safeParse({ fact: "pay", op: "below", value: { a: 1 } }).success).toBe(
      false,
    );
    const stored = {
      ...rule,
      id,
      profileId: id,
      source: "assistant",
      createdAt: at,
      createdBy: null,
    };
    expect(RuleSchema.safeParse(stored).success).toBe(true);
    expect(RuleSchema.safeParse({ ...stored, then: "delete" }).success).toBe(false);
  });

  it("refuses a rule without words, and trims the words it has (F3.1, F8.2)", () => {
    for (const description of ["", "   ", "\n\t"]) {
      const blank = { ...rule, description };
      expect(ChangeSchema.safeParse({ op: "add", target: "rule", rule: blank }).success).toBe(
        false,
      );
      expect(
        ChangeSchema.safeParse({ op: "update", target: "rule", ruleId: id, rule: blank }).success,
      ).toBe(false);
      expect(
        ProposalEditSchema.safeParse({ changes: [{ op: "add", target: "rule", rule: blank }] })
          .success,
      ).toBe(false);
    }
    const padded = ChangeSchema.parse({
      op: "add",
      target: "rule",
      rule: { ...rule, description: `  ${rule.description} ` },
    });
    expect(padded.target === "rule" && padded.op === "add" && padded.rule.description).toBe(
      rule.description,
    );
  });

  it("closes Change over add, update and remove of rules and entries", () => {
    const changes = [
      { op: "add", target: "rule", rule },
      { op: "update", target: "rule", ruleId: id, rule },
      { op: "remove", target: "rule", ruleId: id },
      { op: "add", target: "entry", key: "places", value: [] },
      { op: "remove", target: "entry", key: "places", value: null },
    ];
    for (const c of changes) expect(ChangeSchema.safeParse(c).success).toBe(true);
    expect(ChangeSchema.safeParse({ op: "remove", target: "rule" }).success).toBe(false);
    expect(ChangeSchema.safeParse({ op: "send", target: "entry", key: "places" }).success).toBe(
      false,
    );
  });

  it("lets assistant.v1 answer with a clarifying question or a proposal", () => {
    const clarify = {
      reply: "Which ones?",
      clarify: { question: "What makes a job bad for you?", choices: ["Low pay", "Far away"] },
      proposal: null,
    };
    expect(AssistantOutputSchema.safeParse(clarify).success).toBe(true);
    const proposal = {
      reply: "Here is a proposal.",
      clarify: null,
      proposal: {
        summary: "Hide Asian time zones",
        changes: [{ op: "add", target: "rule", rule }],
      },
    };
    expect(AssistantOutputSchema.safeParse(proposal).success).toBe(true);
    expect(AssistantAnswerSchema.safeParse(proposal).data).toEqual(proposal);
  });

  it("lets a change outside rules and entries through assistant.v1's answer check (F8.7)", () => {
    const answer = (changes: unknown[]) => ({
      reply: "Here is a proposal.",
      clarify: null,
      proposal: { summary: "Change the mailbox", changes },
    });
    const mailbox = answer([{ op: "update", target: "mailbox", key: "host", value: ["imap"] }]);
    expect(AssistantOutputSchema.safeParse(mailbox).success).toBe(false);
    expect(AssistantAnswerSchema.safeParse(mailbox).success).toBe(true);
    expect(AssistantAnswerSchema.safeParse(answer([{ op: "send", to: "x" }])).success).toBe(true);
    // A malformed rule or entry change is a wrong answer, not one outside rules and entries.
    for (const wrong of [
      [{ op: "add", target: "rule", rule: { description: "x" } }],
      [{ op: "update", target: "entry", key: "places" }],
    ]) {
      expect(AssistantAnswerSchema.safeParse(answer(wrong)).success).toBe(false);
    }
    expect(AssistantAnswerSchema.safeParse({ reply: "Hi", clarify: null }).success).toBe(false);
  });

  it("words a proposal card and a history item line by line, before and after (F8.2, F8.4)", () => {
    const line = {
      target: "rule",
      label: "Rule",
      before: null,
      after: "Hide roles whose hours are within UTC+5 to UTC+14",
    };
    const snapshot = { entries: [], rules: [] };
    const card = {
      id,
      summary: "Hide Asian time zones",
      changes: [{ op: "add", target: "rule", rule }],
      before: snapshot,
      after: snapshot,
      lines: [line],
      impact: { hides: 3, shows: 0, scoreMoves: 0, draftsNotCreated: 0, draftsInMailbox: 1 },
      status: "open",
      createdAt: at,
    };
    expect(ProposalSchema.safeParse(card).success).toBe(true);
    expect(ProposalSchema.safeParse({ ...card, lines: undefined }).success).toBe(false);
    expect(
      ProposalSchema.safeParse({ ...card, lines: [{ ...line, target: "mailbox" }] }).success,
    ).toBe(false);
    const item = {
      id,
      at,
      by: id,
      byName: "Maria Santos",
      source: "assistant",
      request: "No Asian time zones",
      changes: card.changes,
      before: snapshot,
      after: snapshot,
      lines: [line],
      undoneAt: null,
    };
    expect(ProfileHistoryListSchema.safeParse({ items: [item] }).success).toBe(true);
    expect(
      ProfileHistoryListSchema.safeParse({ items: [{ ...item, byName: undefined }] }).success,
    ).toBe(false);
  });
});

describe("evaluations, senders, drafts and decisions", () => {
  const need = {
    groupKey: "min_pay:CHF:year",
    profileKey: "min_pay",
    question: "Minimum pay in CHF per year?",
    choices: [
      {
        label: "CHF 120,000",
        value: { amount: 120000, currency: "CHF", period: "year", asWritten: "CHF 120,000" },
      },
    ],
  };
  const evaluation = {
    position: 0,
    match: {
      score: 72,
      verdicts: [
        {
          entryKey: "min_pay",
          ruleId: null,
          verdict: "unknown",
          reason: "different currency",
          hard: false,
          need,
        },
      ],
      skills: { matched: ["Go"], missing: ["Kafka"] },
      cvId: null,
      capped: false,
    },
    hidden: null,
    ruleEffects: [{ ruleId: id, action: "ask_first", reason: "Ask first", need }],
    cvChoice: { cvId: null, reason: "No CV uploaded yet", source: "auto" },
    stale: false,
    evaluatedAt: at,
  };

  it("carries a need on a verdict and on a rule effect", () => {
    expect(RoleEvaluationSchema.safeParse(evaluation).success).toBe(true);
    const over = { ...evaluation, match: { ...evaluation.match, score: 101 } };
    expect(RoleEvaluationSchema.safeParse(over).success).toBe(false);
  });

  it("answers a decision with one item, never a whole list", () => {
    const item = { amount: 120000, currency: "CHF", period: "year", asWritten: "CHF 120,000" };
    expect(DecisionAnswerSchema.safeParse({ value: item, useForSimilar: true }).success).toBe(true);
    expect(DecisionAnswerSchema.safeParse({ value: "No", useForSimilar: false }).success).toBe(
      true,
    );
    expect(DecisionAnswerSchema.safeParse({ value: [item], useForSimilar: true }).success).toBe(
      false,
    );
  });

  it("reads an RDAP answer's events and keeps what the lookup cache stores in shape", () => {
    const answer = {
      objectClassName: "domain",
      ldhName: "quickhire.example",
      events: [{ eventAction: "registration", eventDate: "2026-10-03T08:00:00Z", extra: 1 }],
    };
    expect(RdapDomainAnswerSchema.parse(answer)).toEqual(answer);
    expect(RdapDomainAnswerSchema.safeParse({ ldhName: "x.example" }).success).toBe(true);
    expect(RdapDomainAnswerSchema.safeParse({ events: { eventAction: "x" } }).success).toBe(false);
    expect(RdapDomainAnswerSchema.safeParse({ events: [{ eventAction: 1 }] }).success).toBe(false);
    expect(RdapLookupResultSchema.safeParse({ registeredAt: null }).success).toBe(true);
    expect(RdapLookupResultSchema.safeParse({ registeredAt: "yesterday" }).success).toBe(false);
    expect(MxLookupResultSchema.safeParse(["mx.example"]).success).toBe(true);
    expect(MxLookupResultSchema.safeParse({ hosts: [] }).success).toBe(false);
  });

  it("checks the language word lists: version 1, ISO 639-1 keys, lower-case words", () => {
    const lists = { common: ["the", "and"], negations: ["never", "don't"] };
    const file = { version: 1, languages: { en: lists } };
    expect(LanguageWordsFileSchema.parse(file)).toEqual(file);
    expect(LanguageWordsFileSchema.safeParse({ ...file, version: 2 }).success).toBe(false);
    expect(
      LanguageWordsFileSchema.safeParse({ version: 1, languages: { eng: lists } }).success,
    ).toBe(false);
    expect(
      LanguageWordsFileSchema.safeParse({ version: 1, languages: { EN: lists } }).success,
    ).toBe(false);
    const upper = { version: 1, languages: { en: { ...lists, common: ["The"] } } };
    expect(LanguageWordsFileSchema.safeParse(upper).success).toBe(false);
    const empty = { version: 1, languages: { en: { ...lists, negations: [""] } } };
    expect(LanguageWordsFileSchema.safeParse(empty).success).toBe(false);
    const missing = { version: 1, languages: { en: { common: ["the"] } } };
    expect(LanguageWordsFileSchema.safeParse(missing).success).toBe(false);
  });

  it("describes a sender check, a mark and a draft", () => {
    expect(
      SenderCheckSchema.safeParse({
        verdict: "high_risk",
        complete: true,
        reasons: [{ signal: "asks_for_fee", reason: "asks for a fee" }],
        mark: null,
      }).success,
    ).toBe(true);
    expect(
      SenderMarkInputSchema.parse({ scope: "address", value: " Ann@X.Example ", mark: "trusted" }),
    ).toEqual({ scope: "address", value: "ann@x.example", mark: "trusted" });
    const domainMark = { scope: "domain", value: "x.example", mark: "blocked" };
    expect(AppliedSenderMarkSchema.parse({ applied: domainMark })).toEqual({ applied: domainMark });
    expect(AppliedSenderMarkSchema.safeParse({ applied: null }).success).toBe(true);
    expect(
      AppliedSenderMarkSchema.safeParse({ applied: { ...domainMark, scope: "company" } }).success,
    ).toBe(false);
    const draft = {
      id,
      messageId: "<a@x>",
      position: 0,
      status: "failed",
      failureKind: "mailbox",
      failureReason: "Couldn't reach the mail server",
      subject: null,
      body: null,
      language: null,
      cvId: null,
      cvAttached: false,
      auto: true,
      updatedAt: at,
    };
    expect(DraftSchema.safeParse(draft).success).toBe(true);
    // A draft whose CV was deleted still says its copy has the attachment (F2.5).
    expect(DraftSchema.parse({ ...draft, status: "in_mailbox", cvAttached: true }).cvAttached).toBe(
      true,
    );
    expect(DraftSchema.safeParse({ ...draft, cvAttached: "yes" }).success).toBe(false);
    expect(DraftSchema.safeParse({ ...draft, failureKind: "ai" }).success).toBe(true);
    expect(DraftSchema.safeParse({ ...draft, failureKind: "smtp" }).success).toBe(false);
  });

  it("asks draft.v1 for questions instead of guesses", () => {
    const answer = {
      subject: "Re: Backend role",
      body: "Hallo …",
      language: "de",
      usedEntries: ["target_roles"],
      attachCv: true,
      questions: [
        {
          profileKey: "extra.relocate",
          groupKey: "extra.relocate",
          question: "Would you relocate to Ireland?",
          // The model says which answers turn the question down: no word list reads it.
          choices: [
            { label: "Yes", declines: false },
            { label: "Ні", declines: true },
          ],
        },
      ],
    };
    expect(DraftOutputSchema.safeParse(answer).success).toBe(true);
    // An answer whose meaning the model didn't state is no answer to offer.
    const words = { ...answer.questions[0], choices: ["Yes", "No"] };
    expect(DraftOutputSchema.safeParse({ ...answer, questions: [words] }).success).toBe(false);
    const unsaid = { ...answer.questions[0], choices: [{ label: "Yes" }] };
    expect(DraftOutputSchema.safeParse({ ...answer, questions: [unsaid] }).success).toBe(false);
    // A decision's choice may say it declines; one that doesn't say adds its value.
    expect(
      DecisionChoiceSchema.safeParse({ label: "No", value: "No", declines: true }).success,
    ).toBe(true);
    expect(DecisionChoiceSchema.safeParse({ label: "Yes", value: "Yes" }).success).toBe(true);
    expect(answersWaitingOnly("places", { label: "No", value: "No", declines: true })).toBe(true);
    expect(answersWaitingOnly("places", { label: "Yes", value: "Yes" })).toBe(true);
    const dublin = { country: "IE", city: "Dublin", mode: "hybrid" as const };
    expect(answersWaitingOnly("places", { label: "Yes", value: dublin })).toBe(false);
    expect(answersWaitingOnly("extra.relocate", { label: "No", value: "No" })).toBe(false);
  });

  it("limits a CV to 5 MB and takes null to go back to the automatic choice", () => {
    expect(MAX_CV_BYTES).toBe(5 * 1024 * 1024);
    const cv = {
      id,
      name: "Backend (EN)",
      fileName: "backend-en.pdf",
      mediaType: "pdf",
      sizeBytes: MAX_CV_BYTES + 1,
      contentHash: "a".repeat(64),
      language: null,
      skills: [],
      roleFamilies: [],
      seniority: null,
      countryHints: [],
      formatHints: [],
      tags: [{ label: "remote", source: "you" }],
      preferred: true,
      readStatus: "pending",
      uploadedAt: at,
    };
    expect(CvSchema.safeParse(cv).success).toBe(false);
    expect(CvSchema.safeParse({ ...cv, sizeBytes: 1000 }).success).toBe(true);
    expect(CvChoiceOverrideSchema.safeParse({ cvId: null }).success).toBe(true);
  });

  it("edits a CV's tags, skills, format hints and preferred flag, each on its own (F2.1)", () => {
    expect(CvUpdateSchema.safeParse({ skills: ["Go", " Kafka "] }).data).toEqual({
      skills: ["Go", "Kafka"],
    });
    expect(CvUpdateSchema.safeParse({ formatHints: [] }).success).toBe(true);
    expect(CvUpdateSchema.safeParse({ tags: [{ label: "remote", source: "you" }] }).success).toBe(
      true,
    );
    expect(CvUpdateSchema.safeParse({ preferred: false }).data).toEqual({ preferred: false });
    expect(CvUpdateSchema.safeParse({}).success).toBe(false);
    expect(CvUpdateSchema.safeParse({ skills: ["  "] }).success).toBe(false);
  });
});

describe("the inbox, live events, jobs and the mailbox of MVP 2", () => {
  const row = {
    id: "<a@x>",
    from: { address: "a@x.example", name: null },
    subject: "s",
    date: at,
    category: "recruiter_outreach",
    categorySource: "scan",
    analysisStatus: "done",
    fit: { score: 72, capped: false, stale: true },
    sender: { verdict: "caution", complete: false },
    hidden: null,
    draft: { status: "in_mailbox" },
  };

  it("gives a list row its fit, sender, hidden reason and draft", () => {
    expect(MessageListItemSchema.safeParse(row).success).toBe(true);
    expect(MessageListQuerySchema.parse({ hidden: "true" })).toEqual({ hidden: "true" });
    const role = {
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
      evaluation: null,
      cvChoice: null,
    };
    expect(
      MessageDetailSchema.safeParse({ ...row, roles: [role], ownReply: false, senderCheck: null })
        .success,
    ).toBe(true);
  });

  it("types the new live events", () => {
    for (const type of [
      "cvs.updated",
      "drafts.updated",
      "decisions.updated",
      "profiles.updated",
      "assistant.updated",
      "mailbox.updated",
    ] as const) {
      expect(LIVE_EVENT_TYPES).toContain(type);
      expect(LiveEventSchema.safeParse({ type, data: {} }).success).toBe(true);
    }
  });

  it("keys each job so at most one waits", () => {
    expect(jobDedupeKey.draft(id, "<a@x>", 1)).toBe(`draft:${id}:<a@x>:1`);
    expect(jobDedupeKey.reevaluate(id)).toBe(`reevaluate:${id}`);
    expect(
      DraftCreatePayloadSchema.safeParse({
        workspaceId: id,
        messageId: "<a@x>",
        position: 0,
        origin: "decision",
      }).success,
    ).toBe(true);
  });

  it("reads a mailbox without a sync status as never synced", () => {
    const mailbox = {
      id,
      address: "a@x.example",
      host: "imap",
      port: 993,
      tlsMode: "tls",
      username: "a",
      sentFolderPath: null,
      status: "connected",
    };
    expect(MailboxPublicSchema.parse(mailbox).sync).toEqual(NEVER_SYNCED);
  });

  it("names every reason a mail server fails with as a sync failure reason (F1.4)", () => {
    expect(SyncFailureReasonSchema.options).toEqual(
      expect.arrayContaining(MailTestFailureReasonSchema.options),
    );
  });
});
