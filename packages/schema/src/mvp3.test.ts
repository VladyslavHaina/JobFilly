import { describe, expect, it } from "vitest";
import {
  DraftStatusSchema,
  jobDedupeKey,
  MAIL_SEND_JOB,
  MAX_SCAN_HINT_LENGTH,
  MailboxPublicSchema,
  MailboxStatusSchema,
  MailSendPayloadSchema,
  MessageListQuerySchema,
  OAuthCallbackQuerySchema,
  OAuthMailConnectionSchema,
  OAuthTokensSchema,
  ProfilePatchSchema,
  ProfileSchema,
  RoleProfileInputSchema,
  RoleProfileSchema,
  ScanFocusSchema,
  ScanKindSchema,
  SEND_DELAY_SECONDS,
  SendConfirmSchema,
  SendSchema,
  SmtpLoginSchema,
  SmtpSettingsInputSchema,
  StartScanInputSchema,
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
