import { describe, expect, it } from "vitest";
import {
  ACTIVITY_KINDS,
  AccountDeletionPreviewSchema,
  ActivityRecordSchema,
  AnswerOutputSchema,
  APPLICATION_STAGES,
  AssistantLookupSchema,
  AssistantMessageSchema,
  ChangeMemberInputSchema,
  CreateInviteInputSchema,
  DeleteWorkspaceInputSchema,
  DraftStatusSchema,
  EXPORT_PARTS,
  ExportManifestSchema,
  jobDedupeKey,
  LIVE_EVENT_TYPES,
  LiveEventSchema,
  MAIL_SEND_JOB,
  MAX_SCAN_HINT_LENGTH,
  MailboxInputSchema,
  MailboxPublicSchema,
  MailboxStatusSchema,
  MailConnectionSchema,
  MailSendPayloadSchema,
  MessageListQuerySchema,
  NO_REPLY_FLAG_DAYS,
  OAuthCallbackQuerySchema,
  OAuthMailConnectionSchema,
  OAuthTokensSchema,
  PipelineItemSchema,
  ProfilePatchSchema,
  ProfileSchema,
  RoleProfileInputSchema,
  RoleProfileSchema,
  ScanFocusSchema,
  ScanKindSchema,
  SEND_DELAY_SECONDS,
  SendConfirmSchema,
  SendSchema,
  SetStageInputSchema,
  SmtpLoginSchema,
  SmtpSettingsInputSchema,
  StartScanInputSchema,
  scopeOf,
  WorkspaceSummarySchema,
} from "./index";

// The shapes MVP 3 adds to the shared contract (docs/mvp/MVP-3.md). The slices that build on them
// test their behaviour; these pin the shapes themselves.

const ID = "6f1c2f4e-8d3a-4b5c-9e7f-0a1b2c3d4e5f";

describe("several profiles and re-running setup (F1)", () => {
  it("knows the re-run scan kind", () => {
    expect(ScanKindSchema.options).toEqual(["first", "analyze_rest", "rerun"]);
  });

  it("starts the first scan when POST /scans names no kind", () => {
    expect(StartScanInputSchema.parse({})).toEqual({ kind: "first" });
  });

  it("takes a re-run with a trimmed hint of at most 500 characters", () => {
    expect(
      StartScanInputSchema.parse({ kind: "rerun", hint: "  I've moved to Germany  " }),
    ).toEqual({ kind: "rerun", hint: "I've moved to Germany" });
    expect(
      StartScanInputSchema.safeParse({ kind: "rerun", hint: "x".repeat(MAX_SCAN_HINT_LENGTH + 1) })
        .success,
    ).toBe(false);
    expect(StartScanInputSchema.safeParse({ kind: "analyze_rest" }).success).toBe(false);
  });

  it("reads a hint's focus with international codes only", () => {
    const focus = {
      countries: ["DE"],
      cities: [],
      languages: ["de"],
      workModes: ["onsite", "hybrid"],
      contracts: ["permanent"],
      words: [],
    };
    expect(ScanFocusSchema.parse(focus)).toEqual(focus);
    expect(ScanFocusSchema.safeParse({ ...focus, countries: ["Germany"] }).success).toBe(false);
    expect(ScanFocusSchema.safeParse({ ...focus, languages: ["German"] }).success).toBe(false);
  });

  it("reads a profile without `enabled` (a previous replica's answer) and takes it in a patch", () => {
    const profile = {
      id: ID,
      workspaceId: ID,
      name: "My job search",
      entries: [],
      confirmedAt: null,
    };
    expect(ProfileSchema.parse(profile)).toEqual(profile);
    expect(ProfileSchema.parse({ ...profile, enabled: false }).enabled).toBe(false);
    expect(ProfilePatchSchema.parse({ enabled: false })).toEqual({ enabled: false });
  });

  it("says which profile a role belongs to, by the app or by hand", () => {
    const assigned = {
      profileId: ID,
      name: "Germany permanent",
      reason: "Munich role",
      source: "auto",
    };
    expect(RoleProfileSchema.parse(assigned)).toEqual(assigned);
    expect(RoleProfileSchema.safeParse({ ...assigned, source: "rule" }).success).toBe(false);
    expect(RoleProfileInputSchema.safeParse({ profileId: "nope" }).success).toBe(false);
  });
});

describe("several mailboxes and OAuth (F3)", () => {
  const mailbox = {
    id: ID,
    address: "maria.santos@inbox.example",
    host: "imap.inbox.example",
    port: 993,
    tlsMode: "tls",
    username: "maria.santos@inbox.example",
    sentFolderPath: "Sent",
    status: "connected",
  };

  it("reads a previous replica's mailbox as a password one without SMTP settings", () => {
    const parsed = MailboxPublicSchema.parse(mailbox);
    expect(parsed.auth).toBeUndefined();
    expect(parsed.smtp).toBeUndefined();
    expect(
      MailboxPublicSchema.parse({
        ...mailbox,
        auth: "google",
        smtp: { host: "smtp.gmail.com", port: 465, tlsMode: "tls", username: "m@gmail.example" },
      }).auth,
    ).toBe("google");
  });

  it("has a reconnect-needed state for a refused token", () => {
    expect(MailboxStatusSchema.options).toContain("reconnect_needed");
  });

  it("signs in to IMAP with an access token instead of a password", () => {
    const { password: _p, ...rest } = { ...mailbox, password: "x" };
    expect(OAuthMailConnectionSchema.safeParse({ ...rest, accessToken: "t" }).success).toBe(true);
    expect(OAuthMailConnectionSchema.safeParse(rest).success).toBe(false);
  });

  it("takes an IMAP host by the same rule as an SMTP host", () => {
    const imap = { host: "imap.inbox.example", port: 993, tlsMode: "tls", username: "m" };
    const smtp = { ...imap, host: "smtp.inbox.example", port: 465 };
    const schemas = [
      (host: string) => MailConnectionSchema.safeParse({ ...imap, host, password: "p" }),
      (host: string) =>
        MailboxInputSchema.safeParse({
          ...imap,
          host,
          password: "p",
          address: "maria.santos@inbox.example",
        }),
      (host: string) => OAuthMailConnectionSchema.safeParse({ ...imap, host, accessToken: "t" }),
      (host: string) => SmtpSettingsInputSchema.safeParse({ ...smtp, host }),
    ];
    for (const host of ["imap.inbox.example", "localhost", "10.0.0.5", "[::1]", " mail.x.de "]) {
      for (const parse of schemas) expect(parse(host).success, host).toBe(true);
    }
    expect(MailConnectionSchema.parse({ ...imap, host: " mail.x.de ", password: "p" }).host).toBe(
      "mail.x.de",
    );
    for (const host of [
      "imaps://imap.inbox.example",
      "imap.inbox.example:993",
      "maria@imap.inbox.example",
      "imap.inbox.example/INBOX",
      "imap inbox.example",
      "imap.inbox.example\r\nA1 LOGIN",
      "-bad.example",
      "",
    ]) {
      for (const parse of schemas) expect(parse(host).success, host).toBe(false);
    }
  });

  it("filters the inbox by a mailbox id", () => {
    expect(MessageListQuerySchema.parse({ mailboxId: ID })).toEqual({ mailboxId: ID });
    expect(MessageListQuerySchema.safeParse({ mailboxId: "inbox" }).success).toBe(false);
  });

  it("needs a state on every OAuth callback and keeps the tokens with the account's address", () => {
    expect(OAuthCallbackQuerySchema.safeParse({ code: "c" }).success).toBe(false);
    expect(OAuthCallbackQuerySchema.parse({ state: "s", error: "access_denied" })).toEqual({
      state: "s",
      error: "access_denied",
    });
    expect(
      OAuthTokensSchema.safeParse({
        accessToken: "a",
        refreshToken: "r",
        expiresAt: "2026-10-16T10:00:00.000Z",
        email: "not an address",
      }).success,
    ).toBe(false);
  });
});

describe("sending with confirmation (F4)", () => {
  it("waits ten seconds with Undo before anything leaves", () => {
    expect(SEND_DELAY_SECONDS).toBe(10);
  });

  it("keeps the SMTP password write-only and optional", () => {
    const settings = { host: "smtp.inbox.example", port: 465, tlsMode: "tls", username: "m" };
    expect(SmtpSettingsInputSchema.parse(settings)).toEqual(settings);
    expect(SmtpSettingsInputSchema.safeParse({ ...settings, port: 0 }).success).toBe(false);
  });

  it("signs in to SMTP with a password or an access token, never with neither", () => {
    const base = { host: "smtp.gmail.com", port: 465, tlsMode: "tls", username: "m@gmail.example" };
    expect(SmtpLoginSchema.safeParse({ ...base, accessToken: "t" }).success).toBe(true);
    expect(SmtpLoginSchema.safeParse({ ...base, password: "p" }).success).toBe(true);
    expect(SmtpLoginSchema.safeParse(base).success).toBe(false);
  });

  it("refuses a confirmation without a token", () => {
    expect(SendConfirmSchema.safeParse({}).success).toBe(false);
    expect(SendConfirmSchema.safeParse({ token: "" }).success).toBe(false);
  });

  it("knows a sent draft and the states of a send", () => {
    expect(DraftStatusSchema.options).toContain("sent");
    expect(SendSchema.shape.status.options).toEqual([
      "scheduled",
      "cancelled",
      "sending",
      "sent",
      "failed",
    ]);
  });

  it("queues one deduped mail.send job per send", () => {
    expect(MAIL_SEND_JOB).toBe("mail.send");
    expect(jobDedupeKey.send(ID)).toBe(`send:${ID}`);
    expect(MailSendPayloadSchema.safeParse({ workspaceId: ID, sendId: ID }).success).toBe(true);
  });
});

describe("the application pipeline (F5)", () => {
  it("has the stages of the spec, in order, and the 21-day flag", () => {
    expect(APPLICATION_STAGES).toEqual([
      "new",
      "replied",
      "applied",
      "interview",
      "assessment",
      "offer",
      "rejected",
      "closed",
    ]);
    expect(NO_REPLY_FLAG_DAYS).toBe(21);
  });

  it("keeps every sender of a role sent by two agencies on one item", () => {
    const role = { messageId: "<a@agency.example>", position: 0 };
    const item = {
      role,
      roles: [role, { messageId: "<b@other.example>", position: 0 }],
      title: "Backend Engineer",
      company: "Nordlicht",
      senders: [
        { address: "jo@agency.example", name: null },
        { address: "al@other.example", name: "Al" },
      ],
      stage: "interview",
      stageSource: "you",
      since: "2026-10-01T12:00:00.000Z",
      nextStep: "Prepare for the interview",
      noReply: false,
    };
    expect(PipelineItemSchema.parse(item)).toEqual(item);
    expect(PipelineItemSchema.safeParse({ ...item, roles: [] }).success).toBe(false);
  });

  it("sets a stage by hand or goes back to the derived one", () => {
    const role = { messageId: "<a@agency.example>", position: 0 };
    expect(SetStageInputSchema.safeParse({ role, stage: "interview" }).success).toBe(true);
    expect(SetStageInputSchema.safeParse({ role, stage: null }).success).toBe(true);
    expect(SetStageInputSchema.safeParse({ role, stage: "hired" }).success).toBe(false);
  });
});

describe("sharing and members (F6)", () => {
  it("reads a member without a scope as seeing everything", () => {
    const summary = {
      id: ID,
      name: "Maria's workspace",
      ownerId: ID,
      role: "editor",
      isOwner: false,
    };
    expect(scopeOf(WorkspaceSummarySchema.parse(summary))).toBe("everything");
    expect(scopeOf(WorkspaceSummarySchema.parse({ ...summary, scope: "pipeline" }))).toBe(
      "pipeline",
    );
  });

  it("invites with a scope, everything when left out", () => {
    const invite = { email: "Tom.Okafor@inbox.example", role: "editor" };
    expect(CreateInviteInputSchema.parse(invite)).toEqual({
      email: "tom.okafor@inbox.example",
      role: "editor",
    });
    expect(CreateInviteInputSchema.parse({ ...invite, scope: "pipeline" }).scope).toBe("pipeline");
  });

  it("changes a member's role, scope or both, but not nothing", () => {
    expect(ChangeMemberInputSchema.safeParse({ scope: "pipeline" }).success).toBe(true);
    expect(ChangeMemberInputSchema.safeParse({ role: "admin", scope: "everything" }).success).toBe(
      true,
    );
    expect(ChangeMemberInputSchema.safeParse({}).success).toBe(false);
  });
});

describe("your data and the activity log (F7, F9)", () => {
  it("records actions by id, a user's or the app's", () => {
    expect(ACTIVITY_KINDS).toContain("mail.sent");
    expect(
      ActivityRecordSchema.safeParse({
        kind: "draft.saved",
        actor: { kind: "system" },
        targetUserId: null,
        refs: { draftId: ID, messageId: "<m@x.example>", position: 0 },
      }).success,
    ).toBe(true);
    // Refs hold ids only: a name or an address handed in is not kept.
    expect(
      ActivityRecordSchema.parse({
        kind: "member.removed",
        actor: { kind: "user", userId: ID },
        targetUserId: ID,
        refs: { name: "Tom", email: "tom.okafor@inbox.example" },
      }).refs,
    ).toEqual({});
  });

  it("exports every listed part with a schema version", () => {
    expect(EXPORT_PARTS).toEqual([
      "profiles",
      "rules",
      "cvs",
      "messages",
      "facts",
      "matches",
      "decisions",
      "drafts",
      "pipeline",
      "activity",
    ]);
    const manifest = {
      schemaVersion: 1,
      workspaceId: ID,
      workspaceName: "Maria's workspace",
      exportedAt: "2026-10-16T10:00:00.000Z",
      parts: [...EXPORT_PARTS],
      cvFiles: ["cvs/backend-en.pdf"],
    };
    expect(ExportManifestSchema.parse(manifest)).toEqual(manifest);
    expect(ExportManifestSchema.safeParse({ ...manifest, schemaVersion: 2 }).success).toBe(false);
  });

  it("needs the workspace's name to delete it and lists what an account deletion takes", () => {
    expect(DeleteWorkspaceInputSchema.safeParse({ name: "" }).success).toBe(false);
    expect(
      AccountDeletionPreviewSchema.parse({
        owned: [{ workspaceId: ID, name: "Tom's workspace", members: [] }],
        memberOf: [{ workspaceId: ID, name: "Maria's workspace" }],
      }).owned,
    ).toHaveLength(1);
  });
});

describe("the assistant answers questions (F8)", () => {
  it("asks for read-only lookups in one flat shape", () => {
    const lookup = {
      tool: "find_roles",
      words: "Singapore",
      messageId: null,
      position: null,
      stage: null,
      days: null,
    };
    expect(AssistantLookupSchema.parse(lookup)).toEqual(lookup);
    expect(AssistantLookupSchema.safeParse({ ...lookup, tool: "send_mail" }).success).toBe(false);
  });

  it("answers with refs of what it used", () => {
    expect(
      AnswerOutputSchema.parse({
        text: "Two decisions wait on you.",
        sources: [{ kind: "decision", ref: "min_pay:CHF:year" }],
      }).sources,
    ).toHaveLength(1);
    expect(
      AnswerOutputSchema.safeParse({ text: "x", sources: [{ kind: "url", ref: "http://x" }] })
        .success,
    ).toBe(false);
  });

  it("reads an assistant message of a previous replica, without links", () => {
    const message = {
      id: ID,
      role: "assistant",
      text: "Done.",
      clarify: null,
      proposalId: null,
      at: "2026-10-16T10:00:00.000Z",
    };
    expect(AssistantMessageSchema.parse(message).links).toBeUndefined();
  });
});

describe("live events (MVP 3)", () => {
  it("tells open pages about stages set by hand and sends", () => {
    expect(LIVE_EVENT_TYPES).toContain("pipeline.updated");
    expect(
      LiveEventSchema.safeParse({ type: "sends.updated", data: { draftId: ID } }).success,
    ).toBe(true);
    expect(LiveEventSchema.safeParse({ type: "sends.updated", data: {} }).success).toBe(false);
  });
});
