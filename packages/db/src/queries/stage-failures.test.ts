import {
  CHECK_FAILED_SIGNAL,
  type Envelope,
  type JobFacts,
  type SenderCheck,
} from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import {
  listToEvaluate,
  listWorkspacesWithWork,
  markStale,
  saveEvaluation,
  saveSenderCheck,
} from "./evaluations";
import { saveAnalysis, saveEnvelopes } from "./messages";
import { createConfirmedProfile } from "./profiles";
import { clearStageFailure, getStageHolds, recordStageFailure } from "./stage-failures";

// The pipeline's back-off for stages that keep failing: the first retry at the next sweep, then
// one interval doubling up to the cap, in the database so every replica agrees; a change that
// makes the item stale again ends the wait.

const MINUTE = 60_000;
const BACK_OFF = { intervalMs: 5 * MINUTE, capMs: 60 * MINUTE };
const t0 = new Date("2026-10-01T10:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

let conn: DatabaseConnection;
let ws: string;
let userId: string;

beforeEach(async () => {
  conn = await openTestDatabase();
  const r = await registerAccount(conn.db, {
    name: "maria",
    email: "maria@inbox.example",
    passwordHash: "h",
    workspaceName: "maria",
  });
  if (!r.ok) throw new Error("expected ok");
  ws = r.workspaceId;
  userId = r.user.id;
});
afterEach(() => conn.close());

const MSG = "<a@agency.example>";

const facts: JobFacts = {
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
};

async function seedMessage() {
  const envelope: Envelope = {
    messageId: MSG,
    folder: "inbox",
    folderPath: "INBOX",
    uidValidity: 7,
    uid: 1,
    date: t0.toISOString(),
    from: { address: "ann@agency.example", name: null },
    to: [],
    cc: [],
    replyTo: [],
    inReplyTo: null,
    references: [],
    subject: "A role",
    listId: null,
    listUnsubscribe: null,
    precedence: null,
    autoSubmitted: null,
    snippet: "",
  };
  await saveEnvelopes(conn.db, ws, [{ envelope, verdict: "likely_job", reason: null }]);
  await saveAnalysis(conn.db, ws, {
    messageId: MSG,
    scanId: null,
    category: "recruiter_outreach",
    roles: [facts, facts],
  });
}

const failed: SenderCheck = {
  verdict: "caution",
  complete: false,
  reasons: [{ signal: CHECK_FAILED_SIGNAL, reason: "Couldn't check this sender yet" }],
  mark: null,
};

const evaluation = (position: number) => ({
  position,
  match: null,
  hidden: null,
  ruleEffects: [],
  cvChoice: { cvId: null, reason: "No CV yet", source: "auto" as const },
});

const sender = { messageId: MSG, stage: "sender" } as const;
const role = (position: number) => ({ messageId: MSG, stage: "match", position }) as const;

describe("recordStageFailure", () => {
  it("retries at the next sweep first, then waits one interval doubling up to the cap", async () => {
    await seedMessage();
    const waits: [number, number][] = [];
    for (let n = 0; n < 7; n++) {
      const now = at(n * MINUTE);
      const { failures, retryAt } = await recordStageFailure(conn.db, ws, sender, {
        ...BACK_OFF,
        now,
      });
      waits.push([failures, (retryAt.getTime() - now.getTime()) / MINUTE]);
    }
    expect(waits).toEqual([
      [1, 0],
      [2, 5],
      [3, 10],
      [4, 20],
      [5, 40],
      [6, 60],
      [7, 60],
    ]);
  });

  it("keeps counting each stage of each role apart, and forgets one that succeeded", async () => {
    await seedMessage();
    const options = { ...BACK_OFF, now: t0 };
    await recordStageFailure(conn.db, ws, role(0), options);
    await recordStageFailure(conn.db, ws, role(0), options);
    expect((await recordStageFailure(conn.db, ws, role(1), options)).failures).toBe(1);
    expect((await recordStageFailure(conn.db, ws, sender, options)).failures).toBe(1);
    await clearStageFailure(conn.db, ws, role(0));
    expect((await recordStageFailure(conn.db, ws, role(0), options)).failures).toBe(1);
  });

  it("never waits less than one interval, whatever the cap", async () => {
    await seedMessage();
    const options = { intervalMs: 90 * MINUTE, capMs: 60 * MINUTE, now: t0 };
    await recordStageFailure(conn.db, ws, sender, options);
    const { retryAt } = await recordStageFailure(conn.db, ws, sender, options);
    expect(retryAt).toEqual(at(90 * MINUTE));
  });
});

describe("what waits out its back-off", () => {
  async function failTwice(ref: Parameters<typeof recordStageFailure>[2]) {
    await recordStageFailure(conn.db, ws, ref, { ...BACK_OFF, now: t0 });
    await recordStageFailure(conn.db, ws, ref, { ...BACK_OFF, now: t0 });
  }

  it("holds a failed check and role until their retry time", async () => {
    await createConfirmedProfile(conn.db, ws, {
      name: "p",
      entries: [],
      createdBy: userId,
      at: t0,
    });
    await seedMessage();
    await saveEvaluation(conn.db, ws, MSG, evaluation(1), t0);
    await saveSenderCheck(conn.db, ws, MSG, failed, t0);
    await failTwice(sender);
    await failTwice(role(0));

    expect(await getStageHolds(conn.db, ws, MSG, at(MINUTE))).toEqual({
      sender: true,
      positions: [0],
      reply: "none",
    });
    // The sweep sees nothing to do while they wait; the full listing still names them.
    expect(await listToEvaluate(conn.db, ws, { now: at(MINUTE) })).toEqual([]);
    expect(await listWorkspacesWithWork(conn.db, at(MINUTE))).toEqual([]);
    expect(await listToEvaluate(conn.db, ws)).toEqual([
      {
        messageId: MSG,
        sender: { state: "missing", staleSince: null },
        roles: [{ position: 0, state: "missing", staleSince: null }],
        reply: false,
      },
    ]);

    // Their time has come.
    expect(await getStageHolds(conn.db, ws, MSG, at(5 * MINUTE))).toEqual({
      sender: false,
      positions: [],
      reply: "none",
    });
    expect(await listToEvaluate(conn.db, ws, { now: at(5 * MINUTE) })).toHaveLength(1);
    expect(await listWorkspacesWithWork(conn.db, at(5 * MINUTE))).toEqual([ws]);
  });

  it("lists a failed check as missing at the next sweep after its first failure", async () => {
    await seedMessage();
    await saveSenderCheck(conn.db, ws, MSG, failed, t0);
    await recordStageFailure(conn.db, ws, sender, { ...BACK_OFF, now: t0 });
    expect(await listToEvaluate(conn.db, ws, { now: t0 })).toMatchObject([
      { messageId: MSG, sender: { state: "missing" } },
    ]);
  });

  it("ends the wait when a change makes the item stale again", async () => {
    await seedMessage();
    await saveSenderCheck(conn.db, ws, MSG, failed, t0);
    await saveEvaluation(conn.db, ws, MSG, evaluation(0), t0);
    await markStale(conn.db, ws, { roles: [{ messageId: MSG, position: 0 }] }, t0);
    // The stale role fails twice; the check fails twice.
    await failTwice(role(0));
    await failTwice(sender);
    const now = at(MINUTE);
    expect(await getStageHolds(conn.db, ws, MSG, now)).toEqual({
      sender: true,
      positions: [0],
      reply: "none",
    });

    // A sender mark, then a rule change.
    await markStale(conn.db, ws, { senderDomain: "agency.example" }, at(30_000));
    await markStale(conn.db, ws, { all: true }, at(40_000));
    expect(await getStageHolds(conn.db, ws, MSG, now)).toEqual({
      sender: false,
      positions: [],
      reply: "none",
    });
    expect(await listToEvaluate(conn.db, ws, { now })).toMatchObject([
      {
        messageId: MSG,
        sender: { state: "stale" },
        roles: [
          { position: 0, state: "stale" },
          { position: 1, state: "missing" },
        ],
      },
    ]);
  });
});

describe("a failed reply stage", () => {
  const reply = { messageId: MSG, stage: "reply" } as const;

  async function evaluated() {
    await createConfirmedProfile(conn.db, ws, {
      name: "p",
      entries: [],
      createdBy: userId,
      at: t0,
    });
    await seedMessage();
    await saveSenderCheck(conn.db, ws, MSG, { ...failed, reasons: [], complete: true }, t0);
    await saveEvaluation(conn.db, ws, MSG, evaluation(0), t0);
    await saveEvaluation(conn.db, ws, MSG, evaluation(1), t0);
  }

  it("lists its message although everything is evaluated, until the stage succeeds", async () => {
    await evaluated();
    expect(await listToEvaluate(conn.db, ws)).toEqual([]);
    expect(await getStageHolds(conn.db, ws, MSG, t0)).toEqual({
      sender: false,
      positions: [],
      reply: "none",
    });

    // At the next sweep after its first failure.
    await recordStageFailure(conn.db, ws, reply, { ...BACK_OFF, now: t0 });
    const due = [{ messageId: MSG, sender: null, roles: [], reply: true }];
    expect(await listToEvaluate(conn.db, ws, { now: t0 })).toEqual(due);
    expect(await listWorkspacesWithWork(conn.db, t0)).toEqual([ws]);
    expect((await getStageHolds(conn.db, ws, MSG, t0)).reply).toBe("due");

    // Again: it waits one interval, and the sweep leaves it alone meanwhile.
    await recordStageFailure(conn.db, ws, reply, { ...BACK_OFF, now: t0 });
    expect(await listToEvaluate(conn.db, ws, { now: at(MINUTE) })).toEqual([]);
    expect(await listWorkspacesWithWork(conn.db, at(MINUTE))).toEqual([]);
    expect((await getStageHolds(conn.db, ws, MSG, at(MINUTE))).reply).toBe("held");
    expect(await listToEvaluate(conn.db, ws)).toEqual(due);
    expect(await listToEvaluate(conn.db, ws, { now: at(5 * MINUTE) })).toEqual(due);

    await clearStageFailure(conn.db, ws, reply);
    expect(await listToEvaluate(conn.db, ws)).toEqual([]);
    expect((await getStageHolds(conn.db, ws, MSG, t0)).reply).toBe("none");
  });

  it("is counted apart from the message's sender check", async () => {
    await evaluated();
    const options = { ...BACK_OFF, now: t0 };
    await recordStageFailure(conn.db, ws, sender, options);
    expect((await recordStageFailure(conn.db, ws, reply, options)).failures).toBe(1);
    expect((await recordStageFailure(conn.db, ws, reply, options)).failures).toBe(2);
    await clearStageFailure(conn.db, ws, reply);
    expect((await recordStageFailure(conn.db, ws, sender, options)).failures).toBe(2);
  });
});
