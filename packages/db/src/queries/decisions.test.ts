import type { Envelope } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { decisionMessages, decisions } from "../tables";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import {
  answerDecision,
  countOpenDecisions,
  dismissDecisionRole,
  getDecision,
  keepWaiting,
  listDecisions,
  type NeedGroupInput,
  recordNeeds,
  releaseClaimWithNeeds,
  roleDecisions,
} from "./decisions";
import { claimDraft, draftHistory, getDraftClaim, roleKey } from "./draft-claims";
import { saveAnalysis, saveEnvelopes } from "./messages";

let conn: DatabaseConnection;
let ws: string;
const t0 = new Date("2026-10-01T10:00:00Z");
const later = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
const zurich = { messageId: "<zurich@x.example>", position: 0 };
const basel = { messageId: "<basel@x.example>", position: 0 };
const dublin = { messageId: "<dublin@x.example>", position: 0 };
const chf = { amount: 120000, currency: "CHF", period: "year" as const, asWritten: "120k" };

async function seedMessage(workspaceId: string, messageId: string, uid: number, subject: string) {
  const envelope: Envelope = {
    messageId,
    folder: "inbox",
    folderPath: "INBOX",
    uidValidity: 1,
    uid,
    date: later(uid).toISOString(),
    from: { address: "r@agency.example", name: null },
    to: [],
    cc: [],
    replyTo: [],
    inReplyTo: null,
    references: [],
    subject,
    listId: null,
    listUnsubscribe: null,
    precedence: null,
    autoSubmitted: null,
    snippet: "",
  };
  await saveEnvelopes(conn.db, workspaceId, [{ envelope, verdict: "likely_job", reason: null }]);
  await saveAnalysis(conn.db, workspaceId, {
    messageId,
    scanId: null,
    category: "recruiter_outreach",
    roles: [],
  });
}

async function account(email: string) {
  const r = await registerAccount(conn.db, {
    name: "M",
    email,
    passwordHash: "h",
    workspaceName: "w",
  });
  if (!r.ok) throw new Error("expected ok");
  return r.workspaceId;
}

beforeEach(async () => {
  conn = await openTestDatabase();
  ws = await account("maria@inbox.example");
  await seedMessage(ws, zurich.messageId, 1, "Backend in Zurich");
  await seedMessage(ws, basel.messageId, 2, "Backend in Basel");
  await seedMessage(ws, dublin.messageId, 3, "Remote-first, Dublin office");
});
afterEach(() => conn.close());

const chfGroup = (waiting: NeedGroupInput["waiting"]): NeedGroupInput => ({
  groupKey: "min_pay:CHF:year",
  profileKey: "min_pay",
  question: "Minimum pay in CHF per year?",
  choices: [{ label: "CHF 120,000", value: chf }],
  waiting,
});
const relocation = (waiting: NeedGroupInput["waiting"]): NeedGroupInput => ({
  groupKey: "extra.relocate",
  profileKey: "extra.relocate",
  question: "Would you relocate to Ireland?",
  choices: [{ label: "Yes", value: "Yes" }],
  waiting,
});
const asMatch = (r: typeof zurich) => ({ ...r, source: "match" as const });

describe("the decision inbox (F7)", () => {
  it("keeps one open decision per group key listing every waiting message (F7.3)", async () => {
    const first = await recordNeeds(conn.db, ws, [chfGroup([asMatch(zurich)])], t0);
    expect(first.created).toHaveLength(1);
    const again = await recordNeeds(
      conn.db,
      ws,
      [chfGroup([asMatch(zurich), asMatch(basel)]), relocation([{ ...dublin, source: "draft" }])],
      later(1),
    );
    expect(again.created.map((c) => c.groupKey)).toEqual(["extra.relocate"]);
    const listed = await listDecisions(conn.db, ws);
    expect(listed).toMatchObject([
      {
        id: first.created[0]?.id,
        question: "Minimum pay in CHF per year?",
        groupKey: "min_pay:CHF:year",
        profileKey: "min_pay",
        status: "open",
        waiting: [
          { ...zurich, subject: "Backend in Zurich" },
          { ...basel, subject: "Backend in Basel" },
        ],
      },
      { question: "Would you relocate to Ireland?", waiting: [{ ...dublin }] },
    ]);
    expect(await countOpenDecisions(conn.db, ws)).toBe(2);
  });

  it("dismisses a role for good, and the decision leaves the inbox once nobody waits (F7.5)", async () => {
    const { created } = await recordNeeds(conn.db, ws, [relocation([asMatch(dublin)])], t0);
    const id = created[0]?.id ?? "";
    expect(await dismissDecisionRole(conn.db, ws, id, dublin, later(1))).toBe(true);
    expect(await dismissDecisionRole(conn.db, ws, id, dublin, later(1))).toBe(false);
    expect(await listDecisions(conn.db, ws)).toEqual([]);
    expect(await countOpenDecisions(conn.db, ws)).toBe(0);
    expect((await draftHistory(conn.db, ws, [dublin])).get(roleKey(dublin))).toEqual({
      hadDraft: false,
      dismissed: true,
    });
    // Recording the need again keeps the dismissal.
    await recordNeeds(conn.db, ws, [relocation([asMatch(dublin)])], later(2));
    expect((await roleDecisions(conn.db, ws, [dublin])).map((r) => r.state)).toEqual(["dismissed"]);
    // Another role joins the same open decision and brings it back.
    await recordNeeds(conn.db, ws, [relocation([asMatch(zurich)])], later(3));
    expect((await listDecisions(conn.db, ws)).map((d) => d.id)).toEqual([id]);
  });

  it("answers a decision: every waiting role is resolved and a new question opens a new one", async () => {
    const { created } = await recordNeeds(
      conn.db,
      ws,
      [chfGroup([asMatch(zurich), asMatch(basel)])],
      t0,
    );
    const id = created[0]?.id ?? "";
    const answered = await answerDecision(conn.db, ws, id, {
      answer: chf,
      userId: null,
      now: later(1),
    });
    expect(answered).toMatchObject({
      status: "answered",
      roles: expect.arrayContaining([zurich, basel]),
    });
    expect(
      await answerDecision(conn.db, ws, id, { answer: chf, userId: null, now: later(2) }),
    ).toEqual({ status: "not_open" });
    expect(await listDecisions(conn.db, ws)).toEqual([]);
    expect(await getDecision(conn.db, ws, id)).toMatchObject({
      status: "answered",
      answer: chf,
      waiting: [],
    });
    expect(await roleDecisions(conn.db, ws, [zurich])).toMatchObject([
      { decisionId: id, state: "resolved", decisionStatus: "answered", answer: chf },
    ]);
    const next = await recordNeeds(conn.db, ws, [chfGroup([asMatch(dublin)])], later(3));
    expect(next.created).toHaveLength(1);
    expect(next.created[0]?.id).not.toBe(id);
  });

  it("writes what goes with an answer in its transaction, and nothing when that refuses", async () => {
    const { created } = await recordNeeds(conn.db, ws, [chfGroup([asMatch(zurich)])], t0);
    const id = created[0]?.id ?? "";
    const input = { answer: chf, userId: null, now: later(1) };
    // The write sees the decision answered; when it refuses, the answer is rolled back.
    const refused = await answerDecision(conn.db, ws, id, input, async (tx) => {
      const seen = await getDecision(tx, ws, id);
      return { keep: false, value: seen?.status };
    });
    expect(refused).toEqual({ status: "refused", written: "answered" });
    expect(await getDecision(conn.db, ws, id)).toMatchObject({ status: "open", answer: null });
    expect(await roleDecisions(conn.db, ws, [zurich])).toMatchObject([{ state: "waiting" }]);
    // Two answers racing: one is answered with its write, the other writes nothing.
    const writes: string[] = [];
    const answer = (who: string) =>
      answerDecision(conn.db, ws, id, input, async () => {
        writes.push(who);
        return { keep: true, value: who };
      });
    const outcomes = await Promise.all([answer("first"), answer("second")]);
    expect(outcomes.map((o) => o.status).sort()).toEqual(["answered", "not_open"]);
    expect(writes).toHaveLength(1);
    expect(outcomes.find((o) => o.status === "answered")).toMatchObject({
      roles: [zurich],
      written: writes[0],
    });
  });

  it("reopens a dismissed place only when told (Draft a reply asks again)", async () => {
    const { created } = await recordNeeds(conn.db, ws, [relocation([asMatch(dublin)])], t0);
    const id = created[0]?.id ?? "";
    expect(await dismissDecisionRole(conn.db, ws, id, dublin, later(1))).toBe(true);
    const asDraft = relocation([{ ...dublin, source: "draft_on_demand" }]);
    expect((await recordNeeds(conn.db, ws, [asDraft], later(2))).added).toBe(0);
    expect(await roleDecisions(conn.db, ws, [dublin])).toMatchObject([{ state: "dismissed" }]);
    expect((await recordNeeds(conn.db, ws, [asDraft], later(3), { reopen: true })).added).toBe(1);
    expect(await roleDecisions(conn.db, ws, [dublin])).toMatchObject([
      { decisionId: id, state: "waiting", source: "draft_on_demand" },
    ]);
    expect((await draftHistory(conn.db, ws, [dublin])).get(roleKey(dublin))?.dismissed).toBe(false);
    // A place already waiting isn't added again.
    expect((await recordNeeds(conn.db, ws, [asDraft], later(4), { reopen: true })).added).toBe(0);
  });

  it("makes a waiting place Draft a reply's when Draft a reply asks the same question", async () => {
    await recordNeeds(conn.db, ws, [relocation([{ ...dublin, source: "draft" }])], t0);
    const onDemand = relocation([{ ...dublin, source: "draft_on_demand" }]);
    // Without reopen (the reply stage asking again) the place keeps what raised it first.
    await recordNeeds(conn.db, ws, [onDemand], later(1));
    expect(await roleDecisions(conn.db, ws, [dublin])).toMatchObject([{ source: "draft" }]);
    expect((await recordNeeds(conn.db, ws, [onDemand], later(2), { reopen: true })).added).toBe(0);
    expect(await roleDecisions(conn.db, ws, [dublin])).toMatchObject([
      { state: "waiting", source: "draft_on_demand" },
    ]);
  });

  it("lets a role stop waiting when its needs change, keeping dismissed and resolved places", async () => {
    await recordNeeds(
      conn.db,
      ws,
      [chfGroup([asMatch(zurich)]), relocation([asMatch(zurich), asMatch(dublin)])],
      t0,
    );
    expect(await keepWaiting(conn.db, ws, zurich, ["min_pay:CHF:year"])).toBe(1);
    expect((await roleDecisions(conn.db, ws, [zurich])).map((r) => r.groupKey)).toEqual([
      "min_pay:CHF:year",
    ]);
    expect(await keepWaiting(conn.db, ws, zurich, [])).toBe(1);
    expect(await roleDecisions(conn.db, ws, [zurich])).toEqual([]);
    // Dublin still waits on the relocation question.
    expect((await listDecisions(conn.db, ws)).map((d) => d.groupKey)).toEqual(["extra.relocate"]);
  });

  it("releases a draft claim and records its questions in one transaction", async () => {
    const claim = await claimDraft(conn.db, ws, dublin, { origin: "auto", now: t0 });
    const id = claim?.id ?? "";
    const result = await releaseClaimWithNeeds(
      conn.db,
      ws,
      id,
      [relocation([{ ...dublin, source: "draft" }])],
      later(1),
    );
    expect(result.released).toBe(true);
    expect(result.created).toHaveLength(1);
    expect(await getDraftClaim(conn.db, ws, id)).toBeNull();
    expect((await draftHistory(conn.db, ws, [dublin])).get(roleKey(dublin))?.hadDraft).toBe(false);
    expect(await roleDecisions(conn.db, ws, [dublin])).toMatchObject([
      { state: "waiting", source: "draft", groupKey: "extra.relocate" },
    ]);
    // A claim no longer saving records nothing.
    const again = await releaseClaimWithNeeds(conn.db, ws, id, [chfGroup([asMatch(dublin)])], t0);
    expect(again).toEqual({ released: false, created: [] });
    expect(await countOpenDecisions(conn.db, ws)).toBe(1);
  });

  it("is scoped to the workspace", async () => {
    const { created } = await recordNeeds(conn.db, ws, [chfGroup([asMatch(zurich)])], t0);
    const id = created[0]?.id ?? "";
    const other = await account("tom@inbox.example");
    expect(await getDecision(conn.db, other, id)).toBeNull();
    expect(await listDecisions(conn.db, other)).toEqual([]);
    expect(
      await answerDecision(conn.db, other, id, { answer: chf, userId: null, now: t0 }),
    ).toEqual({ status: "not_open" });
    expect(await dismissDecisionRole(conn.db, other, id, zurich, t0)).toBe(false);
    expect((await conn.db.select().from(decisions)).map((d) => d.status)).toEqual(["open"]);
    expect((await conn.db.select().from(decisionMessages)).map((d) => d.state)).toEqual([
      "waiting",
    ]);
  });
});
