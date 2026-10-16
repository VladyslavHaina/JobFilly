import {
  createConfirmedProfile,
  getHistory,
  getSenderChecks,
  listRules,
  listToEvaluate,
  saveEvaluation,
  saveSenderCheck,
} from "@jobfilly/db";
import type { LiveEvent, ProfileEntry } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requestRun } from "../pipeline/reevaluate";
import {
  createFakeMailbox,
  createTestDeps,
  type FakeMailbox,
  type SeededUser,
  seedJobMail,
  seedUser,
  type TestDeps,
} from "../testing";
import { applyAndReevaluate, requestReevaluation } from "./changes";

// The profile change service: requestReevaluation's scopes, and applyAndReevaluate writing the
// change with its history, re-evaluating every role and telling the browsers.

const NOW = new Date("2026-10-15T12:00:00Z");

let deps: TestDeps;
let mailbox: FakeMailbox;
let maria: SeededUser;
let ws: string;
let events: LiveEvent[];

const eur = { amount: 70000, currency: "EUR", period: "year" as const, asWritten: "€70,000" };
const chf = { amount: 120000, currency: "CHF", period: "year" as const, asWritten: "CHF 120,000" };
const minPay: ProfileEntry = {
  key: "min_pay",
  label: "Minimum pay",
  value: [eur],
  confidence: "high",
  evidence: [],
  source: "scan",
  updatedAt: NOW.toISOString(),
  updatedBy: null,
};

beforeEach(async () => {
  deps = await createTestDeps({ now: NOW });
  mailbox = createFakeMailbox();
  maria = await seedUser(deps);
  ws = maria.workspaceId;
  events = [];
  deps.live.subscribe(
    { workspaceId: ws, userId: maria.id, sessionId: "s" },
    (e) => events.push(e),
    () => {},
  );
});
afterEach(() => deps.close());

const evaluated = {
  position: 0,
  match: null,
  hidden: null,
  ruleEffects: [],
  cvChoice: { cvId: null, reason: "No CV yet", source: "auto" as const },
};
const check = { verdict: "looks_fine" as const, complete: true, reasons: [], mark: null };

async function evaluatedMail(messageId: string, from: string) {
  await seedJobMail(deps, ws, mailbox, { messageId, receivedAt: NOW, from });
  await saveEvaluation(deps.db, ws, messageId, evaluated, NOW);
  await saveSenderCheck(deps.db, ws, messageId, check, NOW);
}

const waiting = async () => !(await requestRun(deps, ws, "probe")).enqueued;

describe("requestReevaluation", () => {
  it("marks the scope stale, enqueues one re-evaluation and tells open inboxes", async () => {
    await evaluatedMail("<a@x.example>", "ann@agency.example");
    await evaluatedMail("<b@x.example>", "bob@other.example");
    await requestReevaluation(deps, ws, { messageIds: ["<a@x.example>"] }, "cv.deleted");
    expect((await listToEvaluate(deps.db, ws)).map((m) => m.messageId)).toEqual(["<a@x.example>"]);
    expect(await waiting()).toBe(true);
    await expect
      .poll(() => events)
      .toContainEqual({ type: "messages.updated", data: { messageIds: ["<a@x.example>"] } });
  });

  it("re-checks senders only for a sender scope", async () => {
    await evaluatedMail("<a@x.example>", "ann@agency.example");
    await evaluatedMail("<b@x.example>", "bob@other.example");
    await requestReevaluation(deps, ws, { all: true }, "rule.changed");
    const checks = await getSenderChecks(deps.db, ws, ["<a@x.example>", "<b@x.example>"]);
    expect(checks.map((c) => c.stale)).toEqual([false, false]);
    await requestReevaluation(deps, ws, { senderAddress: "ann@agency.example" }, "sender.marked");
    await requestReevaluation(deps, ws, { senderDomain: "other.example" }, "sender.marked");
    const after = await getSenderChecks(deps.db, ws, ["<a@x.example>", "<b@x.example>"]);
    expect(after.map((c) => c.stale)).toEqual([true, true]);
  });
});

describe("applyAndReevaluate", () => {
  async function profile() {
    const created = await createConfirmedProfile(deps.db, ws, {
      name: "My job search",
      entries: [minPay],
      createdBy: maria.id,
      at: NOW,
    });
    if (!created.ok) throw new Error("expected a profile");
    return created.profile;
  }

  it("adds a decision's answer to the list, records it, and re-evaluates every role", async () => {
    const p = await profile();
    await evaluatedMail("<zurich@x.example>", "r@agency.example");
    const result = await applyAndReevaluate(
      deps,
      ws,
      p.id,
      [{ op: "add", target: "entry", key: "min_pay", value: [chf] }],
      { source: "decision", userId: maria.id, request: "Minimum pay in CHF per year?" },
    );
    if (!result?.ok) throw new Error("expected ok");
    expect(result.profile.entries[0]?.value).toEqual([eur, chf]);
    expect(await getHistory(deps.db, ws, p.id)).toMatchObject([
      { source: "decision", by: maria.id, request: "Minimum pay in CHF per year?" },
    ]);
    expect(await listToEvaluate(deps.db, ws)).toMatchObject([
      { messageId: "<zurich@x.example>", roles: [{ state: "stale" }] },
    ]);
    expect(await waiting()).toBe(true);
    await expect.poll(() => events).toContainEqual({ type: "profiles.updated", data: {} });
  });

  it("adds a rule from an applied proposal with its source", async () => {
    const p = await profile();
    const result = await applyAndReevaluate(
      deps,
      ws,
      p.id,
      [
        {
          op: "add",
          target: "rule",
          rule: {
            description: "Hide roles whose hours are UTC+05:00 or later",
            when: [
              { fact: "timeZones", op: "within", value: { from: "UTC+05:00", to: "UTC+14:00" } },
            ],
            then: "hide",
            enabled: true,
          },
        },
      ],
      { source: "assistant", userId: maria.id, request: "no Asian time zones" },
    );
    expect(result?.ok).toBe(true);
    expect((await listRules(deps.db, ws, p.id)).map((r) => [r.source, r.then])).toEqual([
      ["assistant", "hide"],
    ]);
  });

  it("writes nothing for a change that doesn't apply, and asks for no re-evaluation", async () => {
    const p = await profile();
    const result = await applyAndReevaluate(
      deps,
      ws,
      p.id,
      [{ op: "remove", target: "rule", ruleId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
      { source: "you", userId: maria.id, request: null },
    );
    expect(result).toMatchObject({ ok: false, error: { kind: "unknown_rule" } });
    expect(await getHistory(deps.db, ws, p.id)).toEqual([]);
    expect(await waiting()).toBe(false);
    expect(
      await applyAndReevaluate(deps, ws, "00000000-0000-4000-8000-000000000000", [], {
        source: "you",
        userId: maria.id,
        request: null,
      }),
    ).toBeNull();
  });
});
