import { replyEligibility } from "@jobfilly/core";
import {
  createConfirmedProfile,
  getEvaluations,
  getSenderChecks,
  listToEvaluate,
  loadMessageInputs,
  markStale,
} from "@jobfilly/db";
import { CHECK_FAILED_SIGNAL, type LiveEvent } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requestReevaluation } from "../profile/changes";
import {
  createFakeMailbox,
  createTestDeps,
  type FakeMailbox,
  type RecordingStages,
  recordingStages,
  roleFacts,
  type SeededUser,
  seedJobMail,
  seedMailbox,
  seedUser,
  type TestDeps,
} from "../testing";
import { evaluateMessage } from "./evaluate";
import { MessageGoneError } from "./stages";

// The analysis pipeline for one message (F1.1, F1.6, TBD-192) with recording stages: the order of
// the stages, when the sender stage runs (only for a missing or stale check), what happens
// without a profile, and that a failing stage never marks a role evaluated.

const NOW = new Date("2026-10-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

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
  stages = recordingStages();
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

describe("evaluateMessage", () => {
  it("runs the sender stage, then cv-choice and match per role, then the reply stage", async () => {
    await confirm();
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<alert@jobs.example>",
      receivedAt: daysAgo(1),
      roles: [roleFacts({ title: "A" }), roleFacts({ title: "B" })],
    });
    const events: LiveEvent[] = [];
    deps.live.subscribe(
      { workspaceId: ws, userId: maria.id, sessionId: "s" },
      (e) => events.push(e),
      () => {},
    );
    const outcome = await evaluate("<alert@jobs.example>");
    expect(stages.calls).toEqual([
      "sender <alert@jobs.example>",
      "cvChoice <alert@jobs.example>#0",
      "match <alert@jobs.example>#0",
      "cvChoice <alert@jobs.example>#1",
      "match <alert@jobs.example>#1",
      "reply <alert@jobs.example>",
    ]);
    expect(outcome).toEqual({ found: true, senderChecked: true, evaluated: [0, 1], failed: [] });
    expect(mailbox.calls.fetchBody).toBe(1);
    const [reply] = stages.replies;
    expect(reply?.sender).toMatchObject({ verdict: "looks_fine" });
    expect(reply?.evaluations.map((e) => [e.position, e.match?.score, e.stale])).toEqual([
      [0, 75, false],
      [1, 75, false],
    ]);
    expect(reply?.withinReplyWindow).toBe(true);
    expect(await listToEvaluate(deps.db, ws)).toEqual([]);
    await expect
      .poll(() => events)
      .toContainEqual({ type: "messages.updated", data: { messageIds: ["<alert@jobs.example>"] } });
    expect(deps.logs.filter((l) => l.event === "pipeline.message_processed")).toMatchObject([
      { level: "info", origin: "new", senderChecked: true, rolesEvaluated: 2, rolesFailed: 0 },
    ]);
  });

  it("with no confirmed profile, runs only the sender stage and leaves the roles to evaluate", async () => {
    await seedJobMail(deps, ws, mailbox, { messageId: "<a@x.example>", receivedAt: daysAgo(1) });
    await evaluate("<a@x.example>", "backlog");
    expect(stages.calls).toEqual(["sender <a@x.example>"]);
    expect(await listToEvaluate(deps.db, ws)).toEqual([
      {
        messageId: "<a@x.example>",
        sender: null,
        roles: [{ position: 0, state: "missing", staleSince: null }],
      },
    ]);
  });

  it("re-scores after an {all} change without the mailbox, even while it is down", async () => {
    await confirm();
    await seedJobMail(deps, ws, mailbox, { messageId: "<a@x.example>", receivedAt: daysAgo(1) });
    await evaluate("<a@x.example>");
    stages.calls.length = 0;
    const before = { ...mailbox.calls };

    await markStale(deps.db, ws, { all: true }, NOW);
    mailbox.pause();
    stages.score = () => 82;
    await evaluate("<a@x.example>", "reevaluate");
    expect(stages.calls).toEqual([
      "cvChoice <a@x.example>#0",
      "match <a@x.example>#0",
      "reply <a@x.example>",
    ]);
    expect(mailbox.calls.fetchOriginal).toBe(0);
    expect(mailbox.calls).toEqual(before);
    expect((await getEvaluations(deps.db, ws, ["<a@x.example>"]))[0]?.match?.score).toBe(82);
    // The stored check is passed on.
    expect(stages.replies.at(-1)?.sender).toMatchObject({ verdict: "looks_fine" });
  });

  it("checks the sender again after a sender-scoped change", async () => {
    await confirm();
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<a@x.example>",
      receivedAt: daysAgo(1),
      from: "ann@agency.example",
    });
    await evaluate("<a@x.example>");
    stages.calls.length = 0;
    await markStale(deps.db, ws, { senderDomain: "agency.example" }, NOW);
    await evaluate("<a@x.example>", "reevaluate");
    expect(stages.calls[0]).toBe("sender <a@x.example>");
    expect(mailbox.calls.fetchBody).toBe(2);
  });

  it("shows an incomplete check when the sender stage fails, keeps it to do, and still matches the roles", async () => {
    await confirm();
    await seedJobMail(deps, ws, mailbox, { messageId: "<a@x.example>", receivedAt: daysAgo(1) });
    mailbox.pause();
    const outcome = await evaluate("<a@x.example>");
    expect(outcome).toMatchObject({ senderChecked: false, evaluated: [0], failed: [] });
    // Incomplete and neutral, never "looks fine" (F5.3): the inbox shows the check didn't happen.
    expect(await getSenderChecks(deps.db, ws, ["<a@x.example>"])).toEqual([
      {
        messageId: "<a@x.example>",
        verdict: "caution",
        complete: false,
        reasons: [
          {
            signal: CHECK_FAILED_SIGNAL,
            reason: "Couldn't check this sender yet. JobFilly tries again shortly.",
          },
        ],
        mark: null,
        stale: false,
      },
    ]);
    expect(stages.calls).toEqual([
      "sender <a@x.example>",
      "cvChoice <a@x.example>#0",
      "match <a@x.example>#0",
      "reply <a@x.example>",
    ]);
    // The reply waits for a real check.
    expect(stages.replies[0]?.sender).toBeNull();
    expect(deps.logs.filter((l) => l.event === "pipeline.stage_failed")).toMatchObject([
      {
        level: "warn",
        stage: "sender",
        error: "MailUnavailableError",
        kind: "mailbox_unavailable",
        reason: "Couldn't reach the mail server",
        failures: 1,
        retryAt: NOW.toISOString(),
      },
    ]);
    expect(await listToEvaluate(deps.db, ws)).toMatchObject([
      { messageId: "<a@x.example>", sender: { state: "missing" }, roles: [] },
    ]);

    // The next try reads the text and stores the real check.
    mailbox.resume();
    stages.calls.length = 0;
    expect(await evaluate("<a@x.example>", "reevaluate")).toMatchObject({ senderChecked: true });
    expect(stages.calls).toEqual(["sender <a@x.example>", "reply <a@x.example>"]);
    expect((await getSenderChecks(deps.db, ws, ["<a@x.example>"]))[0]).toMatchObject({
      verdict: "looks_fine",
      complete: true,
    });
    expect(stages.replies.at(-1)?.sender).toMatchObject({ verdict: "looks_fine" });
    expect(await listToEvaluate(deps.db, ws)).toEqual([]);
  });

  it("keeps a stored check's verdict and mark when the sender stage fails on a re-check (F5.3)", async () => {
    await confirm();
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<a@x.example>",
      receivedAt: daysAgo(1),
      from: "ann@agency.example",
    });
    const real = stages.sender;
    stages.sender = async (input, ctx) => ({
      ...(await real(input, ctx)),
      check: {
        verdict: "high_risk",
        complete: true,
        reasons: [{ signal: "asks_for_fee", reason: "Asks for a fee" }],
        mark: "blocked",
      },
    });
    await evaluate("<a@x.example>");

    // A sender mark changed, and the re-check fails.
    await markStale(deps.db, ws, { senderDomain: "agency.example" }, NOW);
    stages.failing.sender = "*";
    expect(await evaluate("<a@x.example>", "reevaluate")).toMatchObject({ senderChecked: false });
    const expected = {
      messageId: "<a@x.example>",
      verdict: "high_risk",
      complete: false,
      reasons: [
        { signal: "asks_for_fee", reason: "Asks for a fee" },
        {
          signal: CHECK_FAILED_SIGNAL,
          reason: "Couldn't check this sender yet. JobFilly tries again shortly.",
        },
      ],
      mark: "blocked",
      stale: false,
    };
    expect(await getSenderChecks(deps.db, ws, ["<a@x.example>"])).toEqual([expected]);
    // The reply waits for a real check.
    expect(stages.replies.at(-1)?.sender).toBeNull();

    // Failing again (the first retry is at once) names the failure once.
    await evaluate("<a@x.example>", "reevaluate");
    expect(stages.calls.filter((c) => c.startsWith("sender"))).toHaveLength(3);
    expect(await getSenderChecks(deps.db, ws, ["<a@x.example>"])).toEqual([expected]);
  });

  it("drops a stored looks-fine check to caution when the sender stage fails on a re-check", async () => {
    await confirm();
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<a@x.example>",
      receivedAt: daysAgo(1),
      from: "ann@agency.example",
    });
    await evaluate("<a@x.example>");
    await markStale(deps.db, ws, { senderDomain: "agency.example" }, NOW);
    stages.failing.sender = "*";
    await evaluate("<a@x.example>", "reevaluate");
    expect((await getSenderChecks(deps.db, ws, ["<a@x.example>"]))[0]).toMatchObject({
      verdict: "caution",
      complete: false,
      reasons: [{ signal: CHECK_FAILED_SIGNAL }],
      mark: null,
    });
  });

  it("says why a match stage failed, and backs off a stage that keeps failing", async () => {
    await confirm();
    await seedJobMail(deps, ws, mailbox, { messageId: "<a@x.example>", receivedAt: daysAgo(1) });
    await evaluate("<a@x.example>");
    await markStale(deps.db, ws, { all: true }, NOW);
    stages.failing.match = "*";
    stages.calls.length = 0;
    const interval = deps.config.syncIntervalSeconds * 1000;

    // The first failure is tried again at once (the next sweep), the second waits one interval.
    await evaluate("<a@x.example>", "reevaluate");
    await evaluate("<a@x.example>", "reevaluate");
    const failures = deps.logs.filter((l) => l.event === "pipeline.stage_failed");
    expect(failures).toMatchObject([
      {
        stage: "match",
        position: 0,
        error: "Error",
        reason: "match stage failed",
        failures: 1,
        retryAt: NOW.toISOString(),
      },
      { stage: "match", failures: 2, retryAt: new Date(NOW.getTime() + interval).toISOString() },
    ]);

    // While it waits, the message is left alone: no stage call, no log line.
    stages.calls.length = 0;
    const lines = deps.logs.length;
    await evaluate("<a@x.example>", "reevaluate");
    expect(stages.calls).toEqual([]);
    expect(deps.logs.length).toBe(lines);
    expect(await listToEvaluate(deps.db, ws, { now: NOW })).toEqual([]);

    // Once the wait is over it runs again; when it works, the role is evaluated.
    deps.clock.advance(interval);
    stages.failing = {};
    expect(await evaluate("<a@x.example>", "reevaluate")).toMatchObject({ evaluated: [0] });
    expect(await listToEvaluate(deps.db, ws, { now: deps.clock.now() })).toEqual([]);
  });

  it("tries a waiting role again at once after a change, even one never evaluated", async () => {
    await confirm();
    await seedJobMail(deps, ws, mailbox, { messageId: "<a@x.example>", receivedAt: daysAgo(1) });
    stages.failing.match = "*";
    await evaluate("<a@x.example>", "backlog");
    await evaluate("<a@x.example>", "reevaluate");
    await evaluate("<a@x.example>", "reevaluate");
    const matches = () => stages.calls.filter((c) => c.startsWith("match")).length;
    expect(matches()).toBe(2);
    stages.failing = {};
    await evaluate("<a@x.example>", "reevaluate");
    expect(matches()).toBe(2);

    // A profile change (say, the AI was fixed and a rule edited): no wait.
    await requestReevaluation(deps, ws, { all: true }, "profile.changed");
    expect(await listToEvaluate(deps.db, ws, { now: NOW })).toHaveLength(1);
    expect(await evaluate("<a@x.example>", "reevaluate")).toMatchObject({ evaluated: [0] });
    expect(matches()).toBe(3);
  });

  it("checks a backlog message's sender and evaluates its roles with no one doing anything (F1.6)", async () => {
    // A profile confirmed earlier, and the first scan's backlog never evaluated.
    await confirm();
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<backlog@x.example>",
      receivedAt: daysAgo(20),
      roles: [roleFacts({ title: "A" }), roleFacts({ title: "B" })],
    });
    expect(await listToEvaluate(deps.db, ws, { now: NOW })).toMatchObject([
      { messageId: "<backlog@x.example>", sender: { state: "missing" } },
    ]);
    // The startup sweep's run (pipeline.reevaluate) evaluates it as backlog.
    const outcome = await evaluate("<backlog@x.example>", "backlog");
    expect(outcome).toEqual({ found: true, senderChecked: true, evaluated: [0, 1], failed: [] });
    expect((await getSenderChecks(deps.db, ws, ["<backlog@x.example>"]))[0]).toMatchObject({
      verdict: "looks_fine",
      complete: true,
      stale: false,
    });
    expect(
      (await getEvaluations(deps.db, ws, ["<backlog@x.example>"])).map((e) => [
        e.position,
        e.match?.score,
        e.stale,
      ]),
    ).toEqual([
      [0, 75, false],
      [1, 75, false],
    ]);
    expect(deps.logs.filter((l) => l.event === "pipeline.message_processed")).toMatchObject([
      { origin: "backlog", senderChecked: true, rolesEvaluated: 2, rolesFailed: 0 },
    ]);
    expect(deps.logs.filter((l) => l.event === "pipeline.stage_failed")).toEqual([]);
    expect(await listToEvaluate(deps.db, ws)).toEqual([]);
  });

  it("stores an incomplete check for a message gone from the mailbox, so it isn't fetched again", async () => {
    await confirm();
    await seedJobMail(deps, ws, mailbox, { messageId: "<a@x.example>", receivedAt: daysAgo(1) });
    mailbox.expunge("<a@x.example>");
    const outcome = await evaluate("<a@x.example>", "backlog");
    expect(outcome).toMatchObject({ senderChecked: true, evaluated: [0], failed: [] });
    expect(await getSenderChecks(deps.db, ws, ["<a@x.example>"])).toEqual([
      {
        messageId: "<a@x.example>",
        verdict: "caution",
        complete: false,
        reasons: [
          {
            signal: "message_gone",
            reason: "The message is no longer in the mailbox, so its text couldn't be checked",
          },
        ],
        mark: null,
        stale: false,
      },
    ]);
    // The reply stage sees the incomplete check, never "looks fine".
    expect(stages.replies[0]?.sender).toMatchObject({ verdict: "caution", complete: false });
    expect(await listToEvaluate(deps.db, ws)).toEqual([]);
    expect(deps.logs.filter((l) => l.event === "pipeline.message_gone")).toMatchObject([
      { level: "warn", workspaceId: ws },
    ]);
  });

  it("keeps a check the sender stage made for a gone message incomplete and names why", async () => {
    await confirm();
    await seedJobMail(deps, ws, mailbox, { messageId: "<a@x.example>", receivedAt: daysAgo(1) });
    mailbox.expunge("<a@x.example>");
    stages.sender = async (_input, ctx) => {
      try {
        await ctx.body();
      } catch (error) {
        if (!(error instanceof MessageGoneError)) throw error;
      }
      // What it could still tell from the domain, wrongly claimed complete.
      return {
        check: { verdict: "looks_fine", complete: true, reasons: [], mark: "trusted" },
        language: "de",
      };
    };
    await evaluate("<a@x.example>", "backlog");
    expect((await getSenderChecks(deps.db, ws, ["<a@x.example>"]))[0]).toMatchObject({
      verdict: "caution",
      complete: false,
      reasons: [{ signal: "message_gone" }],
      mark: "trusted",
    });
    // Nothing was read, so no language is stored.
    expect((await loadMessageInputs(deps.db, ws, ["<a@x.example>"]))[0]?.language).toBeNull();
  });

  it("stores the language the sender stage tells, which the cv-choice stage then reads", async () => {
    await confirm();
    await seedJobMail(deps, ws, mailbox, { messageId: "<a@x.example>", receivedAt: daysAgo(1) });
    stages.language = () => "de";
    await evaluate("<a@x.example>");
    expect((await loadMessageInputs(deps.db, ws, ["<a@x.example>"]))[0]?.language).toBe("de");
    expect(stages.cvLanguages).toEqual(["<a@x.example>#0 de"]);
    // Re-scoring reads it without the mailbox.
    await markStale(deps.db, ws, { all: true }, NOW);
    mailbox.pause();
    await evaluate("<a@x.example>", "reevaluate");
    expect(stages.cvLanguages).toEqual(["<a@x.example>#0 de", "<a@x.example>#0 de"]);
  });

  it("re-chooses the CV when the sender check, done after the match, tells a new language", async () => {
    await confirm();
    await seedJobMail(deps, ws, mailbox, { messageId: "<a@x.example>", receivedAt: daysAgo(1) });
    // The mailbox was down: the role was matched without a language.
    mailbox.pause();
    await evaluate("<a@x.example>");
    expect(stages.cvLanguages).toEqual(["<a@x.example>#0 null"]);
    mailbox.resume();
    stages.language = () => "de";
    stages.calls.length = 0;
    await evaluate("<a@x.example>", "reevaluate");
    expect(stages.calls).toEqual([
      "sender <a@x.example>",
      "cvChoice <a@x.example>#0",
      "match <a@x.example>#0",
      "reply <a@x.example>",
    ]);
    expect(stages.cvLanguages.at(-1)).toBe("<a@x.example>#0 de");
    expect(await listToEvaluate(deps.db, ws)).toEqual([]);
  });

  it("tries a waiting role never evaluated in the same run once the sender stage tells a new language", async () => {
    await confirm();
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<a@x.example>",
      receivedAt: daysAgo(1),
      from: "ann@agency.example",
    });
    // The role's match keeps failing: after two tries it waits out a back-off.
    stages.failing.match = "*";
    await evaluate("<a@x.example>", "backlog");
    await evaluate("<a@x.example>", "reevaluate");
    expect(await getEvaluations(deps.db, ws, ["<a@x.example>"])).toEqual([]);
    stages.calls.length = 0;
    await evaluate("<a@x.example>", "reevaluate");
    expect(stages.calls).toEqual([]);

    // A sender change: the re-check reads the text and tells a new language, which the CV choice
    // depends on, so the role is a new question and is tried now, not after its wait.
    await markStale(deps.db, ws, { senderDomain: "agency.example" }, NOW);
    stages.failing = {};
    stages.language = () => "de";
    const outcome = await evaluate("<a@x.example>", "reevaluate");
    expect(stages.calls).toEqual([
      "sender <a@x.example>",
      "cvChoice <a@x.example>#0",
      "match <a@x.example>#0",
      "reply <a@x.example>",
    ]);
    expect(outcome).toMatchObject({ senderChecked: true, evaluated: [0], failed: [] });
    expect(stages.cvLanguages.at(-1)).toBe("<a@x.example>#0 de");
    expect(await listToEvaluate(deps.db, ws, { now: NOW })).toEqual([]);
  });

  it("never marks a role evaluated when its match stage fails", async () => {
    await confirm();
    await seedJobMail(deps, ws, mailbox, { messageId: "<a@x.example>", receivedAt: daysAgo(1) });
    stages.failing.match = "<a@x.example>";
    const outcome = await evaluate("<a@x.example>");
    expect(outcome).toMatchObject({ evaluated: [], failed: [0] });
    expect(await listToEvaluate(deps.db, ws)).toMatchObject([
      { messageId: "<a@x.example>", sender: null, roles: [{ position: 0, state: "missing" }] },
    ]);
    // A stale one stays stale too.
    stages.failing = {};
    await evaluate("<a@x.example>");
    await markStale(deps.db, ws, { all: true }, NOW);
    stages.failing.match = "*";
    await evaluate("<a@x.example>", "reevaluate");
    expect(await listToEvaluate(deps.db, ws)).toMatchObject([
      { messageId: "<a@x.example>", roles: [{ position: 0, state: "stale" }] },
    ]);
  });

  it("tells the reply stage when a message is outside the reply window, which holds its reply", async () => {
    await confirm();
    await seedJobMail(deps, ws, mailbox, { messageId: "<old@x.example>", receivedAt: daysAgo(15) });
    await seedJobMail(deps, ws, mailbox, { messageId: "<new@x.example>", receivedAt: daysAgo(14) });
    await evaluate("<old@x.example>", "backlog");
    await evaluate("<new@x.example>", "backlog");
    const verdicts = stages.replies.map((r) => {
      const evaluation = r.evaluations[0];
      return [
        r.message.messageId,
        r.withinReplyWindow,
        replyEligibility({
          origin: "auto",
          category: r.message.category,
          receivedAt: r.message.receivedAt,
          now: NOW,
          profile: { entries: [] },
          score: evaluation?.match?.score ?? null,
          capped: false,
          senderVerdict: r.sender?.verdict ?? null,
          ruleEffects: evaluation?.ruleEffects ?? [],
          openNeeds: [],
          draftHistory: r.draftHistory.get(0) ?? { hadDraft: false, dismissed: false },
        }).heldBy.map((h) => h.kind),
      ];
    });
    expect(verdicts).toEqual([
      ["<old@x.example>", false, ["outside_window"]],
      ["<new@x.example>", true, []],
    ]);
  });

  it("does nothing for an unknown message", async () => {
    expect(await evaluate("<unknown@x.example>")).toEqual({
      found: false,
      senderChecked: false,
      evaluated: [],
      failed: [],
    });
    expect(stages.calls).toEqual([]);
  });
});
