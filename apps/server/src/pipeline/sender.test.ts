import { replyEligibility } from "@jobfilly/core";
import {
  createConfirmedProfile,
  getEvaluations,
  getInboxMessage,
  getSenderChecks,
  loadMessageInputs,
  markStale,
  setSenderMark,
} from "@jobfilly/db";
import { CHECK_FAILED_SIGNAL, MESSAGE_GONE_SIGNAL } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { retryFailedLookups } from "../senders/retry";
import {
  createFakeMailbox,
  createTestDeps,
  type FakeMailbox,
  type RecordingStages,
  recordingStages,
  roleFacts,
  type SeededUser,
  seedCv,
  seedJobMail,
  seedMailbox,
  seedUser,
  type TestDeps,
} from "../testing";
import { cvChoiceStage } from "./cv-choice";
import { evaluateMessage } from "./evaluate";
import { reevaluateWorkspace } from "./reevaluate";
import { senderStage } from "./sender";
import { sweep } from "./sweep";

// The sender stage (F5) inside the real pipeline: it reads the body through ctx.body() (so it
// works for a backlog message fetched from IMAP), never stores it, looks the domain up through
// the fake DomainPort, applies marks, logs sender.checked, and its verdict reaches the reply
// stage. The orchestrator only calls it while the check is missing or stale.

const NOW = new Date("2026-10-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

const SENTINEL = "BODYSENTINEL-sender-0001";
const SCAM = `Dear Candidate,\n\nCongratulations! We are pleased to offer you the position of Remote Software Engineer. To complete your hiring, please pay a one-time processing fee of €150 and send a clear scan of your passport to this email address within 24 hours.\n\nRegards,\nHR Department\n\n${SENTINEL}`;
const PLAIN = `Hello Maria,\n\nI am a recruiter at Tidewater Systems and we are looking for a backend engineer to join our team. Would you be open to a call this week?\n\nKind regards,\nGrace\n\n${SENTINEL}`;
const GERMAN = `Hallo Maria,\n\nwir suchen für unser Team in Berlin eine Backend-Entwicklerin. Hätten Sie Zeit für ein Gespräch? Wir freuen uns auf Ihre Antwort.\n\nMit freundlichen Grüßen\nMiriam`;
// A job board's alert as the e2e fixtures write it: three German lines, then an English footer
// with more common words than the German text.
const GERMAN_ALERT = [
  "Wir haben 2 neue Jobs im Bereich Softwareentwicklung für Sie gefunden.",
  "Softwareentwickler Backend (m/w/d)\nCopperleaf Analytics · Berlin, Deutschland · Hybrid\nZur Stelle: https://jobs.example/1",
  "Senior Backend Engineer (m/w/d)\nZuidas Payments · Berlin, Deutschland · Vor Ort\nZur Stelle: https://jobs.example/2",
  "You are receiving job alert emails because you created a job alert. You can change how often you receive these alerts, edit your search or stop the alert at any time from your alert settings.",
  "Jobs are listed by the employers and recruiters who post them; check every listing carefully: a genuine employer never asks for money or identity documents before an offer.",
  "This email was sent to you by the job platform. Our privacy policy explains how we use your search activity to recommend jobs. To stop receiving all marketing and alert emails, use the unsubscribe link in your settings.",
].join("\n\n");

let deps: TestDeps;
let mailbox: FakeMailbox;
let maria: SeededUser;
let ws: string;
let stages: RecordingStages;

beforeEach(async () => {
  deps = await createTestDeps({ now: NOW });
  mailbox = createFakeMailbox();
  deps.mail = mailbox.port;
  maria = await seedUser(deps, { name: "Maria Santos" });
  ws = maria.workspaceId;
  await seedMailbox(deps, ws, {
    address: "maria.santos@inbox.example",
    conn: { host: "imap", port: 3143, tlsMode: "tls", username: "maria", password: "E2E-SECRET-p" },
    sentFolderPath: "Sent",
  });
  // The real sender stage; the rest record what they get.
  stages = recordingStages();
  stages.sender = senderStage;
});
afterEach(() => deps.close());

const confirm = () =>
  createConfirmedProfile(deps.db, ws, {
    name: "My job search",
    entries: [],
    createdBy: maria.id,
    at: NOW,
  });

const evaluate = (messageId: string, origin: "new" | "backlog" | "reevaluate" = "new") =>
  evaluateMessage(deps, ws, messageId, { origin, stages });

const checkOf = async (messageId: string) => (await getSenderChecks(deps.db, ws, [messageId]))[0];

describe("the sender stage", () => {
  it("checks a backlog message from its body fetched from the mailbox, and stores no body", async () => {
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<scam@globalcareers-mail.example>",
      receivedAt: daysAgo(18),
      from: "hr.department@globalcareers-mail.example",
      roles: [
        roleFacts({ title: "Remote Software Engineer", company: "Global Careers International" }),
      ],
      text: SCAM,
    });
    const outcome = await evaluate("<scam@globalcareers-mail.example>", "backlog");
    expect(outcome.senderChecked).toBe(true);
    expect(mailbox.calls.fetchBody).toBe(1);

    const check = await checkOf("<scam@globalcareers-mail.example>");
    expect(check).toMatchObject({ verdict: "high_risk", complete: true, mark: null, stale: false });
    const reasons = check?.reasons.map((r) => r.reason).join("\n") ?? "";
    expect(reasons).toContain("asks for a fee");
    expect(reasons).toContain("asks for a passport scan");

    const stored = JSON.stringify([
      await loadMessageInputs(deps.db, ws, ["<scam@globalcareers-mail.example>"]),
      await getInboxMessage(deps.db, ws, "<scam@globalcareers-mail.example>"),
      await getSenderChecks(deps.db, ws, ["<scam@globalcareers-mail.example>"]),
    ]);
    expect(stored).not.toContain(SENTINEL);
    expect(deps.rawLogs.join("\n")).not.toContain(SENTINEL);
  });

  it("checks the first scan's backlog on the sweep, without anyone doing anything (F1.6)", async () => {
    await confirm();
    const [scam, plain] = ["<scam@globalcareers-mail.example>", "<grace@tidewater.example>"];
    const backlog = [scam, plain];
    await seedJobMail(deps, ws, mailbox, {
      messageId: scam,
      receivedAt: daysAgo(18),
      from: "hr.department@globalcareers-mail.example",
      roles: [roleFacts({ company: "Global Careers International" })],
      text: SCAM,
    });
    await seedJobMail(deps, ws, mailbox, {
      messageId: plain,
      receivedAt: daysAgo(20),
      from: "grace@tidewater.example",
      roles: [roleFacts({ company: "Tidewater Systems" })],
      text: PLAIN,
    });
    expect(await sweep(deps)).toBe(1);
    await reevaluateWorkspace(deps, ws, { stages });

    const checks = await getSenderChecks(deps.db, ws, backlog);
    expect(checks.map((c) => [c.messageId, c.stale]).sort()).toEqual(
      backlog.map((id) => [id, false]).sort(),
    );
    expect(checks.find((c) => c.messageId === scam)?.verdict).toBe("high_risk");
    expect(deps.logs.filter((l) => l.event === "sender.checked")).toHaveLength(2);
    expect(stages.replies.map((r) => r.sender?.verdict).sort()).toEqual(
      checks.map((c) => c.verdict).sort(),
    );
  });

  it("logs sender.checked with its verdict, and a high-risk verdict reaches the reply stage", async () => {
    await confirm();
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<scam@globalcareers-mail.example>",
      receivedAt: daysAgo(1),
      from: "hr.department@globalcareers-mail.example",
      roles: [roleFacts({ company: "Global Careers International" })],
      text: SCAM,
    });
    await evaluate("<scam@globalcareers-mail.example>");
    const logged = deps.logs.filter((l) => l.event === "sender.checked");
    expect(logged).toEqual([
      expect.objectContaining({
        level: "info",
        verdict: "high_risk",
        complete: true,
        workspaceId: ws,
      }),
    ]);
    expect(stages.replies).toHaveLength(1);
    const reply = stages.replies[0];
    expect(reply?.sender?.verdict).toBe("high_risk");
    // F5.2: the reply policy then holds back the automatic draft, however well the role fits.
    const eligibility = replyEligibility({
      origin: "auto",
      category: reply?.message.category ?? null,
      receivedAt: reply?.message.receivedAt ?? NOW,
      now: NOW,
      profile: { entries: [] },
      score: 95,
      capped: false,
      senderVerdict: reply?.sender?.verdict ?? null,
      ruleEffects: [],
      openNeeds: [],
      draftHistory: { hadDraft: false, dismissed: false },
    });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.heldBy.map((h) => h.kind)).toEqual(["high_risk"]);
  });

  it("looks the domain up through deps.domains and notices a young one", async () => {
    deps.domains.setRdap("quickhire.example", { registeredAt: daysAgo(12).toISOString() });
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<young@quickhire.example>",
      receivedAt: daysAgo(1),
      from: "talent@quickhire.example",
      roles: [roleFacts({ company: "QuickHire" })],
      text: PLAIN,
    });
    await evaluate("<young@quickhire.example>");
    expect(deps.domains.calls).toEqual({ rdap: ["quickhire.example"], mx: ["quickhire.example"] });
    expect(await checkOf("<young@quickhire.example>")).toMatchObject({
      verdict: "caution",
      complete: true,
      reasons: [
        {
          signal: "young_domain",
          reason: "Possibly risky: the domain quickhire.example seems to be only 12 days old",
        },
      ],
    });
  });

  it("marks the check incomplete when a lookup fails, never 'looks fine' (F5.3)", async () => {
    deps.domains.setMx("tidewater.example", "fail");
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<grace@tidewater.example>",
      receivedAt: daysAgo(1),
      from: "grace.lin@tidewater.example",
      roles: [roleFacts({ company: "Tidewater Systems" })],
      text: PLAIN,
    });
    await evaluate("<grace@tidewater.example>");
    expect(await checkOf("<grace@tidewater.example>")).toMatchObject({
      verdict: "caution",
      complete: false,
    });
    expect(
      deps.logs.some((l) => l.event === "sender.lookup_incomplete" && l.level === "warn"),
    ).toBe(true);
  });

  it("checks again on its own once a failed lookup has expired, and is then complete", async () => {
    deps.domains.setRdap("tidewater.example", "fail");
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<grace@tidewater.example>",
      receivedAt: daysAgo(1),
      from: "grace.lin@tidewater.example",
      roles: [roleFacts({ company: "Tidewater Systems" })],
      text: PLAIN,
    });
    await evaluate("<grace@tidewater.example>");
    expect(await checkOf("<grace@tidewater.example>")).toMatchObject({
      verdict: "caution",
      complete: false,
      reasons: [expect.objectContaining({ signal: "lookup_failed" })],
    });

    // Within the 15 minutes the failure is cached, nothing is done again.
    deps.clock.advance(10 * 60 * 1000);
    expect(await retryFailedLookups(deps)).toBe(0);

    deps.clock.advance(6 * 60 * 1000);
    deps.domains.setRdap("tidewater.example", { registeredAt: "2012-03-01T00:00:00.000Z" });
    expect(await retryFailedLookups(deps)).toBe(1);
    expect(deps.logs.filter((l) => l.event === "sender.lookup_retry")).toEqual([
      expect.objectContaining({ level: "info", workspaceId: ws, checks: 1 }),
    ]);
    await evaluate("<grace@tidewater.example>", "reevaluate");
    expect(await checkOf("<grace@tidewater.example>")).toMatchObject({
      verdict: "looks_fine",
      complete: true,
      reasons: [expect.objectContaining({ signal: "no_warning_signs" })],
      stale: false,
    });
    expect(mailbox.calls.fetchBody).toBe(2);
    expect(await retryFailedLookups(deps)).toBe(0);
  });

  it("tells the body's language, which the pipeline stores for the CV choice", async () => {
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<berlin@rheinpfad.example>",
      receivedAt: daysAgo(1),
      from: "miriam.wolf@rheinpfad.example",
      roles: [roleFacts({ company: "Rheinpfad Energie AG" })],
      text: GERMAN,
    });
    await evaluate("<berlin@rheinpfad.example>");
    const [input] = await loadMessageInputs(deps.db, ws, ["<berlin@rheinpfad.example>"]);
    expect(input?.language).toBe("de");
    expect((await checkOf("<berlin@rheinpfad.example>"))?.verdict).toBe("looks_fine");
  });

  it("tells a German job alert with an English footer is German, so it gets the German CV", async () => {
    const confirmed = await confirm();
    if (!confirmed.ok) throw new Error("expected a profile");
    const { profile } = confirmed;
    const cv = (name: string, language: string) =>
      seedCv(deps, ws, {
        name,
        language,
        skills: ["Go", "PostgreSQL"],
        roleFamilies: ["Backend engineering"],
        seniority: "Senior",
        tags: [
          { label: language, source: "ai" },
          { label: "Backend engineering", source: "ai" },
          { label: "Senior", source: "ai" },
          ...(language === "en" ? [{ label: "preferred", source: "you" } as const] : []),
        ],
        profileId: profile.id,
      });
    await cv("Backend (EN)", "en");
    deps.clock.advance(1000);
    const de = await cv("Backend (DE)", "de");
    stages.cvChoice = cvChoiceStage;
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<alert-0077@jobs.example>",
      receivedAt: daysAgo(1),
      from: "alerts@jobs.example",
      category: "job_alert",
      roles: [
        roleFacts({ title: "Softwareentwickler Backend (m/w/d)", company: "Copperleaf Analytics" }),
        roleFacts({ title: "Senior Backend Engineer (m/w/d)", company: "Zuidas Payments" }),
      ],
      text: GERMAN_ALERT,
    });
    await evaluate("<alert-0077@jobs.example>");
    const [input] = await loadMessageInputs(deps.db, ws, ["<alert-0077@jobs.example>"]);
    expect(input?.language).toBe("de");
    const evaluations = await getEvaluations(deps.db, ws, ["<alert-0077@jobs.example>"]);
    expect(evaluations.map((e) => e.cvChoice)).toEqual([
      { cvId: de.id, reason: "German backend role → Backend (DE)", source: "auto" },
      { cvId: de.id, reason: "German backend role → Backend (DE)", source: "auto" },
    ]);
  });

  it("names the free-mail 'recruiter' as caution without looking the provider up", async () => {
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<globex@gmail.com>",
      receivedAt: daysAgo(1),
      from: "globex.talent.partner@gmail.com",
      roles: [roleFacts({ company: "Globex Corporation" })],
      text: PLAIN,
    });
    await evaluate("<globex@gmail.com>");
    expect(deps.domains.calls).toEqual({ rdap: [], mx: [] });
    expect(await checkOf("<globex@gmail.com>")).toMatchObject({
      verdict: "caution",
      reasons: [expect.objectContaining({ signal: "free_mail_company" })],
    });
  });

  it("applies an editor's mark, named in the explanation (F5.4)", async () => {
    await setSenderMark(deps.db, ws, {
      scope: "address",
      value: "globex.talent.partner@gmail.com",
      mark: "trusted",
      userId: maria.id,
      at: NOW,
    });
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<globex@gmail.com>",
      receivedAt: daysAgo(1),
      from: "globex.talent.partner@gmail.com",
      roles: [roleFacts({ company: "Globex Corporation" })],
      text: PLAIN,
    });
    await evaluate("<globex@gmail.com>");
    const check = await checkOf("<globex@gmail.com>");
    expect(check).toMatchObject({ verdict: "looks_fine", mark: "trusted" });
    expect(check?.reasons[0]?.signal).toBe("marked_trusted");
    expect(check?.reasons[0]?.reason).toContain("globex.talent.partner@gmail.com");
  });

  it("runs only while the check is missing or stale", async () => {
    await confirm();
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<grace@tidewater.example>",
      receivedAt: daysAgo(1),
      from: "grace.lin@tidewater.example",
      text: PLAIN,
    });
    await evaluate("<grace@tidewater.example>");
    await markStale(deps.db, ws, { all: true }, NOW);
    await evaluate("<grace@tidewater.example>", "reevaluate");
    expect(mailbox.calls.fetchBody).toBe(1);
    expect(deps.logs.filter((l) => l.event === "sender.checked")).toHaveLength(1);
    await markStale(deps.db, ws, { senderAddress: "grace.lin@tidewater.example" }, NOW);
    await evaluate("<grace@tidewater.example>", "reevaluate");
    expect(mailbox.calls.fetchBody).toBe(2);
  });

  it("checks a message gone from the mailbox without its text: incomplete, with message_gone", async () => {
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<gone@tidewater.example>",
      receivedAt: daysAgo(1),
      from: "grace.lin@tidewater.example",
      text: PLAIN,
    });
    mailbox.expunge("<gone@tidewater.example>");
    await evaluate("<gone@tidewater.example>");
    const check = await checkOf("<gone@tidewater.example>");
    expect(check).toMatchObject({ verdict: "caution", complete: false });
    expect(check?.reasons.filter((r) => r.signal === MESSAGE_GONE_SIGNAL)).toHaveLength(1);
    // What can be told without the text is still checked.
    expect(deps.domains.calls.rdap).toEqual(["tidewater.example"]);
  });

  it("leaves the check incomplete when the mailbox can't be reached, for a later sweep", async () => {
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<grace@tidewater.example>",
      receivedAt: daysAgo(1),
      from: "grace.lin@tidewater.example",
      text: PLAIN,
    });
    mailbox.pause();
    const outcome = await evaluate("<grace@tidewater.example>");
    expect(outcome.senderChecked).toBe(false);
    // Stored incomplete with the neutral check_failed reason, never "looks fine" (F5.3); it still
    // counts as missing, so a later sweep checks it again (pipeline/evaluate.ts).
    expect(await checkOf("<grace@tidewater.example>")).toMatchObject({
      verdict: "caution",
      complete: false,
      reasons: [{ signal: CHECK_FAILED_SIGNAL }],
    });
  });
});
