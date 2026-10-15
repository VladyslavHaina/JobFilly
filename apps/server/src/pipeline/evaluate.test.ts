import { replyEligibility } from "@jobfilly/core";
import {
  createConfirmedProfile,
  getEvaluations,
  getSenderChecks,
  listToEvaluate,
  markStale,
} from "@jobfilly/db";
import type { LiveEvent } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  it("keeps the check missing when the sender stage fails, and still matches the roles", async () => {
    await confirm();
    await seedJobMail(deps, ws, mailbox, { messageId: "<a@x.example>", receivedAt: daysAgo(1) });
    mailbox.pause();
    await evaluate("<a@x.example>");
    expect(await getSenderChecks(deps.db, ws, ["<a@x.example>"])).toEqual([]);
    expect(stages.calls).toEqual([
      "sender <a@x.example>",
      "cvChoice <a@x.example>#0",
      "match <a@x.example>#0",
      "reply <a@x.example>",
    ]);
    expect(stages.replies[0]?.sender).toBeNull();
    expect(deps.logs.filter((l) => l.event === "pipeline.stage_failed")).toMatchObject([
      { level: "warn", stage: "sender" },
    ]);
    expect(await listToEvaluate(deps.db, ws)).toMatchObject([
      { messageId: "<a@x.example>", sender: { state: "missing" }, roles: [] },
    ]);
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
