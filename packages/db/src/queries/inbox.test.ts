import type { PGlite } from "@electric-sql/pglite";
import type { Envelope, JobFacts, StageOneVerdict } from "@jobfilly/schema";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database, DatabaseConnection } from "../client";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import { claimDraft } from "./draft-claims";
import { markStale, saveEvaluation, saveSenderCheck } from "./evaluations";
import { correctCategory, getInboxMessage, getMessageRef, listInbox } from "./inbox";
import { getStoredMessages, markAnalysisFailed, saveAnalysis, saveEnvelopes } from "./messages";

let conn: DatabaseConnection;
let ws: string;
let other: string;

beforeEach(async () => {
  conn = await openTestDatabase();
  const ids: string[] = [];
  for (const key of ["maria", "tom"]) {
    const r = await registerAccount(conn.db, {
      name: key,
      email: `${key}@inbox.example`,
      passwordHash: "h",
      workspaceName: key,
    });
    if (!r.ok) throw new Error("expected ok");
    ids.push(r.workspaceId);
  }
  [ws, other] = ids as [string, string];
});
afterEach(() => conn.close());

const BASE = Date.UTC(2026, 8, 1);
const id = (n: number) => `<m${n}+x/y%z@mail.example>`;

function envelope(n: number, overrides: Partial<Envelope> = {}): Envelope {
  return {
    messageId: id(n),
    folder: "inbox",
    folderPath: "INBOX",
    uidValidity: 1700000000,
    uid: n,
    date: new Date(BASE + n * 60_000).toISOString(),
    from: { address: `sender${n}@agency.example`, name: `Sender ${n}` },
    to: [{ address: "maria@inbox.example", name: null }],
    cc: [],
    replyTo: [],
    inReplyTo: null,
    references: [],
    subject: `Subject ${n}`,
    listId: null,
    listUnsubscribe: null,
    precedence: null,
    autoSubmitted: null,
    snippet: `Snippet ${n}`,
    ...overrides,
  };
}

const at = (e: Envelope, verdict: StageOneVerdict) => ({ envelope: e, verdict, reason: "test" });

const role = (title: string, country = "DE"): JobFacts => ({
  title,
  company: null,
  agency: null,
  places: [{ country, city: null }],
  workMode: "hybrid",
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

/** A mailbox of every kind of row the scan leaves behind. */
async function seedMix() {
  await saveEnvelopes(conn.db, ws, [
    at(envelope(1), "not_job"),
    at(envelope(2), "likely_job"), // analysed: recruiter outreach
    at(envelope(3), "job_alert"), // alert, analysed with two roles
    at(envelope(4), "likely_job"), // still pending: not listed
    at(envelope(5), "likely_job"), // failed: "Couldn't analyze"
    at(envelope(6, { folder: "sent", folderPath: "Sent", uid: 6 }), "own_reply"),
    at(envelope(7), "likely_job"), // analysed: not job after all
    at(envelope(8), "likely_job"), // analysed: interview
  ]);
  await saveAnalysis(conn.db, ws, {
    messageId: id(2),
    scanId: null,
    category: "recruiter_outreach",
    roles: [role("Backend Engineer")],
  });
  await saveAnalysis(conn.db, ws, {
    messageId: id(3),
    scanId: null,
    category: "job_alert",
    roles: [role("Platform Engineer", "PT"), role("Go Developer", "NL")],
  });
  await markAnalysisFailed(conn.db, ws, { messageId: id(5), scanId: null });
  await saveAnalysis(conn.db, ws, {
    messageId: id(7),
    scanId: null,
    category: "not_job",
    roles: [],
  });
  await saveAnalysis(conn.db, ws, {
    messageId: id(8),
    scanId: null,
    category: "interview",
    roles: [role("Backend Engineer")],
  });
}

describe("listInbox (F5.1)", () => {
  it("lists job mail newest first with sender, subject, date and category", async () => {
    await seedMix();
    const list = await listInbox(conn.db, ws);
    expect(list.items.map((m) => m.id)).toEqual([id(8), id(5), id(3), id(2)]);
    expect(list.items[0]).toEqual({
      id: id(8),
      from: { address: "sender8@agency.example", name: "Sender 8" },
      subject: "Subject 8",
      date: new Date(BASE + 8 * 60_000).toISOString(),
      category: "interview",
      categorySource: "scan",
      analysisStatus: "done",
      // Its role isn't scored yet.
      fit: { score: null, why: "pending" },
      sender: null,
      hidden: null,
      draft: null,
      // Saved without naming a mailbox (MVP 3, F3.1).
      mailbox: null,
    });
    // A message the model failed on is listed, to say "Couldn't analyze".
    expect(list.items[1]).toMatchObject({ category: null, analysisStatus: "failed" });
    expect(list).toMatchObject({ page: 1, nextPage: null });
  });

  it("leaves non-job mail out but counts it, and shows it on request", async () => {
    await seedMix();
    const hidden = await listInbox(conn.db, ws);
    expect(hidden.nonJobCount).toBe(2);
    expect(hidden.items.map((m) => m.id)).not.toContain(id(1));
    const shown = await listInbox(conn.db, ws, { showNonJob: true });
    expect(shown.items.map((m) => m.id)).toEqual([id(8), id(7), id(5), id(3), id(2), id(1)]);
    expect(shown.nonJobCount).toBe(2);
  });

  it("never lists the user's own replies or mail the model hasn't read yet", async () => {
    await seedMix();
    const all = await listInbox(conn.db, ws, { showNonJob: true });
    expect(all.items.map((m) => m.id)).not.toContain(id(6));
    expect(all.items.map((m) => m.id)).not.toContain(id(4));
  });

  it("only shows the workspace's own mail", async () => {
    await seedMix();
    const list = await listInbox(conn.db, other, { showNonJob: true });
    expect(list).toEqual({ items: [], nonJobCount: 0, page: 1, nextPage: null });
  });

  it("filters by category", async () => {
    await seedMix();
    const interviews = await listInbox(conn.db, ws, { category: "interview" });
    expect(interviews.items.map((m) => m.id)).toEqual([id(8)]);
    const nonJob = await listInbox(conn.db, ws, { category: "not_job" });
    expect(nonJob.items.map((m) => m.id)).toEqual([id(7), id(1)]);
  });

  it("searches sender name, sender address and subject, case-insensitively", async () => {
    await saveEnvelopes(conn.db, ws, [
      at(
        envelope(1, { from: { address: "jobs@talentco.example", name: "Anna Weber" } }),
        "job_alert",
      ),
      at(envelope(2, { subject: "Senior BACKEND role in Berlin" }), "job_alert"),
      at(envelope(3, { subject: "50% off_shoes" }), "not_job"),
      at(envelope(4, { subject: "Other role" }), "job_alert"),
    ]);
    const ids = async (q: string) => (await listInbox(conn.db, ws, { q })).items.map((m) => m.id);
    expect(await ids("weber")).toEqual([id(1)]);
    expect(await ids("TALENTCO.example")).toEqual([id(1)]);
    expect(await ids("backend role")).toEqual([id(2)]);
    expect(await ids("  berlin ")).toEqual([id(2)]);
    expect(await ids("nothing like this")).toEqual([]);
    // The count of hidden non-job mail follows the search.
    expect((await listInbox(conn.db, ws, { q: "role" })).nonJobCount).toBe(0);
    // LIKE wildcards in the search are taken literally.
    expect((await listInbox(conn.db, ws, { q: "50% off_" })).nonJobCount).toBe(1);
    expect((await listInbox(conn.db, ws, { q: "5_%" })).nonJobCount).toBe(0);
    expect((await listInbox(conn.db, ws, { q: "%" })).nonJobCount).toBe(1);
  });

  it("pages by 100", async () => {
    await saveEnvelopes(
      conn.db,
      ws,
      Array.from({ length: 250 }, (_, i) => at(envelope(i + 1), "job_alert")),
    );
    const one = await listInbox(conn.db, ws);
    const two = await listInbox(conn.db, ws, { page: 2 });
    const three = await listInbox(conn.db, ws, { page: 3 });
    expect([one.items.length, two.items.length, three.items.length]).toEqual([100, 100, 50]);
    expect([one.nextPage, two.nextPage, three.nextPage]).toEqual([2, 3, null]);
    expect(one.items[0]?.id).toBe(id(250));
    expect(two.items[0]?.id).toBe(id(150));
    expect(three.items.at(-1)?.id).toBe(id(1));
    const seen = new Set([...one.items, ...two.items, ...three.items].map((m) => m.id));
    expect(seen.size).toBe(250);
    expect((await listInbox(conn.db, ws, { page: 4 })).items).toEqual([]);
  });
});

describe("the list's indexes (F5.5)", () => {
  /** Runs `run` on a database that records its statements, and EXPLAINs the first one. */
  async function planOf(run: (db: Database) => Promise<unknown>): Promise<string> {
    const pglite = (conn.db as unknown as { $client: PGlite }).$client;
    const statements: { sql: string; params: unknown[] }[] = [];
    const recording = drizzle({
      client: pglite,
      logger: { logQuery: (q, params) => statements.push({ sql: q, params }) },
    });
    await run(recording as unknown as Database);
    const first = statements[0];
    if (!first) throw new Error("no statement ran");
    // Too few rows for the planner to prefer an index on its own; forbid the full scan instead.
    await pglite.exec("set enable_seqscan = off");
    try {
      const plan = await pglite.query<{ "QUERY PLAN": string }>(
        `explain ${first.sql}`,
        first.params,
      );
      return plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    } finally {
      await pglite.exec("reset enable_seqscan");
    }
  }

  // Enough rows that the planner weighs the indexes as it would on a real mailbox: with a few
  // hundred, scanning the job categories and filtering costs about as much as the search index.
  beforeEach(async () => {
    await saveEnvelopes(
      conn.db,
      ws,
      Array.from({ length: 5000 }, (_, i) => at(envelope(i + 1), i % 3 ? "job_alert" : "not_job")),
    );
    // As autovacuum would: flush the GIN pending list the bulk insert left, and take statistics.
    await pglite().exec("vacuum analyze messages");
  });
  const pglite = () => (conn.db as unknown as { $client: PGlite }).$client;

  it("filters a category through (workspace_id, category, date desc)", async () => {
    const plan = await planOf((db) => listInbox(db, ws, { category: "job_alert" }));
    expect(plan).toContain("messages_workspace_category_date_idx");
  });

  it("searches sender and subject through the pg_trgm index on search_text", async () => {
    const plan = await planOf((db) => listInbox(db, ws, { q: "sender421@agency" }));
    expect(plan).toContain("messages_search_text_trgm_idx");
  });
});

describe("getInboxMessage (F5.2)", () => {
  it("returns the facts of every role, in order", async () => {
    await seedMix();
    const alert = await getInboxMessage(conn.db, ws, id(3));
    expect(alert).toMatchObject({ id: id(3), category: "job_alert", ownReply: false });
    expect(alert?.roles.map((r) => r.title)).toEqual(["Platform Engineer", "Go Developer"]);
    expect((await getInboxMessage(conn.db, ws, id(1)))?.roles).toEqual([]);
  });

  it("opens the user's own replies and mail not listed, saying which is a reply", async () => {
    await seedMix();
    expect(await getInboxMessage(conn.db, ws, id(6))).toMatchObject({
      id: id(6),
      ownReply: true,
      category: null,
      roles: [],
    });
    expect(await getInboxMessage(conn.db, ws, id(4))).toMatchObject({
      ownReply: false,
      analysisStatus: "pending",
    });
  });

  it("knows nothing of another workspace's messages", async () => {
    await seedMix();
    expect(await getInboxMessage(conn.db, other, id(2))).toBeNull();
    expect(await getInboxMessage(conn.db, ws, "<unknown@mail.example>")).toBeNull();
  });
});

describe("getMessageRef", () => {
  it("names the folder path, UIDVALIDITY and UID the body is fetched with", async () => {
    await seedMix();
    expect(await getMessageRef(conn.db, ws, id(6))).toEqual({
      folderPath: "Sent",
      uidValidity: 1700000000,
      uid: 6,
    });
    expect(await getMessageRef(conn.db, other, id(6))).toBeNull();
  });
});

describe("correctCategory (F5.4)", () => {
  it("stores the correction as the person's, and later analysis keeps it", async () => {
    await seedMix();
    expect(await correctCategory(conn.db, ws, id(2), "offer")).toBe("corrected");
    expect(await getInboxMessage(conn.db, ws, id(2))).toMatchObject({
      category: "offer",
      categorySource: "you",
    });
    await saveAnalysis(conn.db, ws, {
      messageId: id(2),
      scanId: null,
      category: "rejection",
      roles: [role("Changed")],
    });
    const after = await getInboxMessage(conn.db, ws, id(2));
    expect(after).toMatchObject({ category: "offer", categorySource: "you" });
    // The facts are refreshed; only the category is the person's.
    expect(after?.roles.map((r) => r.title)).toEqual(["Changed"]);
  });

  it("moves mail corrected to not job behind the Show toggle", async () => {
    await seedMix();
    await correctCategory(conn.db, ws, id(5), "not_job");
    await correctCategory(conn.db, ws, id(8), "not_job");
    const list = await listInbox(conn.db, ws);
    expect(list.items.map((m) => m.id)).toEqual([id(3), id(2)]);
    expect(list.nonJobCount).toBe(4);
  });

  it("refuses own replies, unknown messages and other workspaces' messages", async () => {
    await seedMix();
    expect(await correctCategory(conn.db, ws, id(6), "offer")).toBe("own_reply");
    expect(await correctCategory(conn.db, ws, "<nope@x>", "offer")).toBe("not_found");
    expect(await correctCategory(conn.db, other, id(2), "offer")).toBe("not_found");
    const [stored] = await getStoredMessages(conn.db, ws, [id(2)]);
    expect(stored?.category).toBe("recruiter_outreach");
  });
});

describe("the inbox of MVP 2: fit, sender, drafts and the Hidden filter (F3.4)", () => {
  const RULE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const at = new Date(BASE);
  const evaluated = (
    position: number,
    options: { score?: number; hidden?: string; stale?: boolean } = {},
  ) => ({
    position,
    match: {
      score: options.score ?? 70,
      verdicts: [],
      skills: { matched: [], missing: [] },
      cvId: null,
      capped: false,
    },
    hidden: options.hidden ? { ruleId: RULE, reason: options.hidden } : null,
    ruleEffects: [],
    cvChoice: { cvId: null, reason: "No CV yet", source: "auto" as const },
  });

  it("gives each row its best visible fit score, sender verdict and live draft", async () => {
    await seedMix();
    // The alert: one role hidden (scored 90), one shown (scored 55).
    await saveEvaluation(
      conn.db,
      ws,
      id(3),
      evaluated(0, { score: 90, hidden: "Hidden by your rule" }),
      at,
    );
    await saveEvaluation(conn.db, ws, id(3), evaluated(1, { score: 55 }), at);
    await saveSenderCheck(
      conn.db,
      ws,
      id(3),
      { verdict: "caution", complete: false, reasons: [], mark: null },
      at,
    );
    await claimDraft(conn.db, ws, { messageId: id(3), position: 1 }, { origin: "auto", now: at });
    const row = (await listInbox(conn.db, ws)).items.find((m) => m.id === id(3));
    expect(row).toMatchObject({
      fit: { score: 55, capped: false, stale: false },
      sender: { verdict: "caution", complete: false },
      hidden: null,
      draft: { status: "saving" },
    });
  });

  it("gives each row only its own message's fit, sender, draft and hidden reason", async () => {
    await seedMix();
    const reason = "Hidden by your rule";
    await saveEvaluation(conn.db, ws, id(3), evaluated(0, { score: 90, hidden: reason }), at);
    await saveEvaluation(conn.db, ws, id(3), evaluated(1, { score: 80, hidden: reason }), at);
    for (const [n, verdict] of [
      [3, "caution"],
      [2, "high_risk"],
    ] as const) {
      await saveSenderCheck(
        conn.db,
        ws,
        id(n),
        { verdict, complete: true, reasons: [], mark: null },
        at,
      );
    }
    await claimDraft(conn.db, ws, { messageId: id(3), position: 1 }, { origin: "auto", now: at });
    const shown = await listInbox(conn.db, ws);
    expect(
      shown.items.map((m) => [m.id, m.fit, m.sender?.verdict ?? null, m.hidden, m.draft]),
    ).toEqual([
      [id(8), { score: null, why: "pending" }, null, null, null],
      [id(5), null, null, null, null],
      [id(2), { score: null, why: "pending" }, "high_risk", null, null],
    ]);
    const hidden = await listInbox(conn.db, ws, { hidden: true });
    expect(hidden.items.map((m) => [m.id, m.fit?.score, m.sender?.verdict, m.hidden])).toEqual([
      [id(3), 90, "caution", { reason }],
    ]);
    expect((await getInboxMessage(conn.db, ws, id(2)))?.fit).toEqual({
      score: null,
      why: "pending",
    });
  });

  it("says why a job message with roles has no fit score: pending, or not scored (F4.1)", async () => {
    await seedMix();
    const fitOf = async (messageId: string) =>
      (await listInbox(conn.db, ws, { showNonJob: true })).items.find((m) => m.id === messageId)
        ?.fit;
    const unscored = (position: number) => ({ ...evaluated(position), match: null });

    // No role evaluated yet, or only one of two: pending.
    expect(await fitOf(id(3))).toEqual({ score: null, why: "pending" });
    await saveEvaluation(conn.db, ws, id(3), unscored(0), at);
    expect(await fitOf(id(3))).toEqual({ score: null, why: "pending" });
    // Both evaluated and neither could be scored: not scored.
    await saveEvaluation(conn.db, ws, id(3), unscored(1), at);
    expect(await fitOf(id(3))).toEqual({ score: null, why: "unscored" });
    expect((await getInboxMessage(conn.db, ws, id(3)))?.fit).toEqual({
      score: null,
      why: "unscored",
    });
    // A change makes them stale: pending again, until they are re-scored.
    await markStale(conn.db, ws, { messageIds: [id(3)] }, at);
    expect(await fitOf(id(3))).toEqual({ score: null, why: "pending" });
    await saveEvaluation(conn.db, ws, id(3), evaluated(1, { score: 64 }), at);
    expect(await fitOf(id(3))).toEqual({ score: 64, capped: false, stale: false });

    // No roles, or not job mail: nothing to score, so nothing at all.
    expect(await fitOf(id(5))).toBeNull();
    expect(await fitOf(id(7))).toBeNull();
    await correctCategory(conn.db, ws, id(8), "not_job");
    expect(await fitOf(id(8))).toBeNull();
    // Another workspace's evaluations never count.
    await saveEnvelopes(conn.db, other, [
      { envelope: envelope(2), verdict: "likely_job", reason: "test" },
    ]);
    await saveAnalysis(conn.db, other, {
      messageId: id(2),
      scanId: null,
      category: "recruiter_outreach",
      roles: [role("Backend Engineer")],
    });
    await saveEvaluation(conn.db, other, id(2), unscored(0), at);
    expect(await fitOf(id(2))).toEqual({ score: null, why: "pending" });
  });

  it("lists a message whose roles are all hidden only under the Hidden filter, with the reason", async () => {
    await seedMix();
    const reason = "Hidden by your rule: hours outside UTC−1 to UTC+3";
    await saveEvaluation(conn.db, ws, id(3), evaluated(0, { hidden: reason }), at);
    expect((await listInbox(conn.db, ws)).items.map((m) => m.id)).toContain(id(3));
    await saveEvaluation(conn.db, ws, id(3), evaluated(1, { hidden: reason }), at);
    expect((await listInbox(conn.db, ws)).items.map((m) => m.id)).toEqual([id(8), id(5), id(2)]);
    const hidden = await listInbox(conn.db, ws, { hidden: true });
    expect(hidden.items.map((m) => [m.id, m.hidden])).toEqual([[id(3), { reason }]]);
    expect((await listInbox(conn.db, other, { hidden: true })).items).toEqual([]);
  });

  it("opens a message with each role's evaluation, CV choice and the sender check", async () => {
    await seedMix();
    await saveEvaluation(conn.db, ws, id(3), evaluated(1, { score: 61 }), at);
    const check = {
      verdict: "high_risk" as const,
      complete: true,
      reasons: [{ signal: "asks_for_fee", reason: "asks for a fee" }],
      mark: null,
    };
    await saveSenderCheck(conn.db, ws, id(3), check, at);
    const detail = await getInboxMessage(conn.db, ws, id(3));
    expect(detail?.senderCheck).toEqual(check);
    expect(
      detail?.roles.map((r) => [r.title, r.evaluation?.match?.score ?? null, r.cvChoice]),
    ).toEqual([
      ["Platform Engineer", null, null],
      ["Go Developer", 61, { cvId: null, reason: "No CV yet", source: "auto" }],
    ]);
    expect((await getInboxMessage(conn.db, ws, id(2)))?.senderCheck).toBeNull();
  });
});
