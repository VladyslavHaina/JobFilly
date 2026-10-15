import type { Envelope, JobFacts, RoleEvaluation } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import { claimDraft, markDraftFailed } from "./draft-claims";
import {
  getEvaluations,
  getSenderChecks,
  listRoleStates,
  listToEvaluate,
  listWorkspacesWithWork,
  loadMessageInputs,
  markStale,
  saveEvaluation,
  saveMessageLanguage,
  saveSenderCheck,
} from "./evaluations";
import { saveAnalysis, saveEnvelopes } from "./messages";
import { createConfirmedProfile } from "./profiles";

let conn: DatabaseConnection;
let ws: string;
let other: string;
let userId: string;
const t0 = new Date("2026-10-01T10:00:00Z");
const later = (ms: number) => new Date(t0.getTime() + ms);

beforeEach(async () => {
  conn = await openTestDatabase();
  const ids: string[] = [];
  const users: string[] = [];
  for (const key of ["maria", "tom"]) {
    const r = await registerAccount(conn.db, {
      name: key,
      email: `${key}@inbox.example`,
      passwordHash: "h",
      workspaceName: key,
    });
    if (!r.ok) throw new Error("expected ok");
    ids.push(r.workspaceId);
    users.push(r.user.id);
  }
  [ws, other] = ids as [string, string];
  userId = users[0] as string;
});
afterEach(() => conn.close());

const id = (n: number) => `<e${n}@agency.example>`;

function envelope(n: number, from = `r${n}@agency.example`): Envelope {
  return {
    messageId: id(n),
    folder: "inbox",
    folderPath: "INBOX",
    uidValidity: 7,
    uid: n,
    date: new Date(Date.UTC(2026, 8, n)).toISOString(),
    from: { address: from, name: null },
    to: [],
    cc: [],
    replyTo: [],
    inReplyTo: null,
    references: [],
    subject: `Subject ${n}`,
    listId: null,
    listUnsubscribe: null,
    precedence: null,
    autoSubmitted: null,
    snippet: "",
  };
}

const facts = (title: string): JobFacts => ({
  title,
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
});

/** A job message with `roles` roles (or a non-job one) in workspace `w`. */
async function seedMessage(
  n: number,
  options: {
    roles?: number;
    category?: "recruiter_outreach" | "not_job";
    w?: string;
    from?: string;
  } = {},
) {
  const w = options.w ?? ws;
  await saveEnvelopes(conn.db, w, [
    { envelope: envelope(n, options.from), verdict: "likely_job", reason: null },
  ]);
  await saveAnalysis(conn.db, w, {
    messageId: id(n),
    scanId: null,
    category: options.category ?? "recruiter_outreach",
    roles: Array.from({ length: options.roles ?? 1 }, (_, i) => facts(`Role ${n}.${i}`)),
  });
}

const evaluation = (
  position: number,
  score = 75,
): Omit<RoleEvaluation, "stale" | "evaluatedAt"> => ({
  position,
  match: {
    score,
    verdicts: [],
    skills: { matched: [], missing: [] },
    cvId: null,
    capped: false,
  },
  hidden: null,
  ruleEffects: [],
  cvChoice: { cvId: null, reason: "No CV yet", source: "auto" },
});

const check = { verdict: "looks_fine" as const, complete: true, reasons: [], mark: null };

async function evaluateAll(n: number, roles = 1, at = t0) {
  await saveSenderCheck(conn.db, ws, id(n), check, at);
  for (let p = 0; p < roles; p++) await saveEvaluation(conn.db, ws, id(n), evaluation(p), at);
}

describe("what the pipeline has to evaluate", () => {
  it("lists job messages whose sender check or role evaluation is missing, the backlog first", async () => {
    await seedMessage(1, { roles: 2 });
    await seedMessage(2, { roles: 0 });
    await seedMessage(3, { category: "not_job" });
    await seedMessage(4, { w: other });
    const list = await listToEvaluate(conn.db, ws);
    expect(list).toEqual([
      { messageId: id(2), sender: { state: "missing", staleSince: null }, roles: [] },
      {
        messageId: id(1),
        sender: { state: "missing", staleSince: null },
        roles: [
          { position: 0, state: "missing", staleSince: null },
          { position: 1, state: "missing", staleSince: null },
        ],
      },
    ]);
  });

  it("leaves out what is current, and lists only the part still missing", async () => {
    await seedMessage(1, { roles: 2 });
    await saveSenderCheck(conn.db, ws, id(1), check, t0);
    await saveEvaluation(conn.db, ws, id(1), evaluation(0), t0);
    expect(await listToEvaluate(conn.db, ws)).toEqual([
      {
        messageId: id(1),
        sender: null,
        roles: [{ position: 1, state: "missing", staleSince: null }],
      },
    ]);
    await saveEvaluation(conn.db, ws, id(1), evaluation(1), t0);
    expect(await listToEvaluate(conn.db, ws)).toEqual([]);
  });

  it("marks evaluations stale by scope, and sender checks only for sender scopes", async () => {
    await seedMessage(1, { from: "ann@agency.example" });
    await seedMessage(2, { from: "bob@other.example" });
    await evaluateAll(1);
    await evaluateAll(2);

    expect(await markStale(conn.db, ws, { all: true }, later(1))).toEqual({
      evaluations: 2,
      senderChecks: 0,
    });
    const all = await listToEvaluate(conn.db, ws);
    expect(all.map((m) => [m.messageId, m.sender, m.roles])).toEqual([
      [id(2), null, [{ position: 0, state: "stale", staleSince: later(1) }]],
      [id(1), null, [{ position: 0, state: "stale", staleSince: later(1) }]],
    ]);

    await evaluateAll(1);
    await evaluateAll(2);
    expect(
      await markStale(conn.db, ws, { roles: [{ messageId: id(1), position: 0 }] }, t0),
    ).toEqual({ evaluations: 1, senderChecks: 0 });
    expect(await markStale(conn.db, ws, { messageIds: [id(2)] }, t0)).toEqual({
      evaluations: 1,
      senderChecks: 0,
    });

    await evaluateAll(1);
    await evaluateAll(2);
    expect(await markStale(conn.db, ws, { senderAddress: "ANN@agency.example" }, t0)).toEqual({
      evaluations: 1,
      senderChecks: 1,
    });
    expect(await markStale(conn.db, ws, { senderDomain: "other.example" }, t0)).toEqual({
      evaluations: 1,
      senderChecks: 1,
    });
    const stale = await listToEvaluate(conn.db, ws);
    expect(stale.map((m) => m.sender?.state)).toEqual(["stale", "stale"]);
    // Another workspace's rows are never touched.
    expect(await markStale(conn.db, other, { all: true }, t0)).toEqual({
      evaluations: 0,
      senderChecks: 0,
    });
  });

  it("saves an evaluation as current again, and reads it back", async () => {
    await seedMessage(1);
    await saveEvaluation(conn.db, ws, id(1), evaluation(0, 64), t0);
    await markStale(conn.db, ws, { all: true }, later(1));
    expect((await getEvaluations(conn.db, ws, [id(1)]))[0]).toMatchObject({ stale: true });
    await saveEvaluation(conn.db, ws, id(1), evaluation(0, 80), later(2));
    expect(await getEvaluations(conn.db, ws, [id(1)])).toEqual([
      {
        messageId: id(1),
        ...evaluation(0, 80),
        stale: false,
        evaluatedAt: later(2).toISOString(),
      },
    ]);
  });
});

describe("the stages' message input", () => {
  it("reads the envelope fields and every role's facts in order", async () => {
    await seedMessage(1, { roles: 2 });
    const [input] = await loadMessageInputs(conn.db, ws, [id(1), "<unknown@x>"]);
    expect(input).toMatchObject({
      messageId: id(1),
      folder: "inbox",
      folderPath: "INBOX",
      uidValidity: 7,
      uid: 1,
      from: { address: "r1@agency.example", name: null },
      subject: "Subject 1",
      category: "recruiter_outreach",
      facts: [facts("Role 1.0"), facts("Role 1.1")],
      language: null,
    });
    expect(input?.receivedAt).toEqual(new Date(Date.UTC(2026, 8, 1)));
    expect(await loadMessageInputs(conn.db, other, [id(1)])).toEqual([]);
  });

  it("reads the language the sender stage stored, and says whether it changed", async () => {
    await seedMessage(1);
    expect(await saveMessageLanguage(conn.db, ws, id(1), "de")).toBe(true);
    expect(await saveMessageLanguage(conn.db, ws, id(1), "de")).toBe(false);
    // Another workspace can't set it.
    expect(await saveMessageLanguage(conn.db, other, id(1), "en")).toBe(false);
    expect((await loadMessageInputs(conn.db, ws, [id(1)]))[0]?.language).toBe("de");
    // Seeing the message again keeps it.
    await saveEnvelopes(conn.db, ws, [
      { envelope: envelope(1), verdict: "likely_job", reason: null },
    ]);
    expect((await loadMessageInputs(conn.db, ws, [id(1)]))[0]?.language).toBe("de");
    expect(await saveMessageLanguage(conn.db, ws, id(1), null)).toBe(true);
  });
});

describe("a sender check made while the message was gone", () => {
  const gone = {
    verdict: "caution" as const,
    complete: false,
    reasons: [{ signal: "message_gone", reason: "The message is no longer in the mailbox" }],
    mark: null,
  };

  it("is current until a scan or sync sees the message again, then stale", async () => {
    await seedMessage(1);
    await seedMessage(2);
    await saveSenderCheck(conn.db, ws, id(1), gone, t0);
    await saveSenderCheck(conn.db, ws, id(2), check, t0);
    for (const n of [1, 2]) await saveEvaluation(conn.db, ws, id(n), evaluation(0), t0);
    expect(await listToEvaluate(conn.db, ws)).toEqual([]);

    // The folder was rebuilt (a new UIDVALIDITY): the sync saves both under their new UIDs.
    const rebuilt = (n: number) => ({ ...envelope(n), uidValidity: 8, uid: 100 + n });
    await saveEnvelopes(conn.db, ws, [
      { envelope: rebuilt(1), verdict: "likely_job", reason: null },
      { envelope: rebuilt(2), verdict: "likely_job", reason: null },
    ]);
    expect(await listToEvaluate(conn.db, ws)).toMatchObject([
      { messageId: id(1), sender: { state: "stale" }, roles: [] },
    ]);
    // The other workspace's checks are its own.
    await seedMessage(1, { w: other });
    await saveSenderCheck(conn.db, other, id(1), gone, t0);
    await saveEnvelopes(conn.db, ws, [
      { envelope: rebuilt(1), verdict: "likely_job", reason: null },
    ]);
    expect((await getSenderChecks(conn.db, other, [id(1)]))[0]?.stale).toBe(false);
  });
});

describe("role states for the impact preview", () => {
  it("joins each role's evaluation, sender verdict, live draft and history", async () => {
    await seedMessage(1, { roles: 2 });
    await evaluateAll(1, 1);
    const claim = await claimDraft(
      conn.db,
      ws,
      { messageId: id(1), position: 0 },
      {
        origin: "auto",
        now: t0,
      },
    );
    await markDraftFailed(conn.db, ws, claim?.id ?? "", { kind: "mailbox", reason: "x", now: t0 });
    const states = await listRoleStates(conn.db, ws);
    expect(states).toHaveLength(2);
    expect(states[0]).toMatchObject({
      messageId: id(1),
      position: 0,
      category: "recruiter_outreach",
      facts: facts("Role 1.0"),
      evaluation: { position: 0, match: { score: 75 } },
      sender: { verdict: "looks_fine", complete: true },
      draft: { status: "failed", failureKind: "mailbox" },
      draftHistory: { hadDraft: true, dismissed: false },
    });
    expect(states[1]).toMatchObject({
      position: 1,
      evaluation: null,
      draft: null,
      draftHistory: { hadDraft: false, dismissed: false },
    });
  });
});

describe("workspaces with pipeline work (the sweep)", () => {
  it("names only workspaces with a confirmed profile and something to evaluate or retry", async () => {
    await seedMessage(1);
    await seedMessage(2, { w: other });
    expect(await listWorkspacesWithWork(conn.db, t0)).toEqual([]);
    await createConfirmedProfile(conn.db, ws, {
      name: "p",
      entries: [],
      createdBy: userId,
      at: t0,
    });
    expect(await listWorkspacesWithWork(conn.db, t0)).toEqual([ws]);
    await evaluateAll(1);
    expect(await listWorkspacesWithWork(conn.db, t0)).toEqual([]);
    const claim = await claimDraft(
      conn.db,
      ws,
      { messageId: id(1), position: 0 },
      {
        origin: "auto",
        now: t0,
      },
    );
    await markDraftFailed(conn.db, ws, claim?.id ?? "", { kind: "mailbox", reason: "x", now: t0 });
    expect(await listWorkspacesWithWork(conn.db, t0)).toEqual([ws]);
  });
});
