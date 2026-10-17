import {
  type Envelope,
  type JobFacts,
  MESSAGE_GONE_SIGNAL,
  type StageOneVerdict,
} from "@jobfilly/schema";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DatabaseConnection, queryRows } from "../client";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import { loadPipelineRows, setRoleStage } from "./applications";
import { getRoleProfileChoices, setRoleProfileChoice } from "./assignments";
import { claimDraft, getDraftClaim } from "./draft-claims";
import {
  getEvaluations,
  getSenderChecks,
  saveEvaluation,
  saveMessageLanguage,
  saveSenderCheck,
} from "./evaluations";
import {
  countNotAnalyzed,
  countScanAnalysis,
  getRoles,
  getStoredMessages,
  listJobMailLanguages,
  listPendingCandidates,
  listPendingOwnReplies,
  loadIntakeInput,
  markAnalysisFailed,
  newestStoredUid,
  reindexMessages,
  saveAnalysis,
  saveEnvelopes,
  savePreferences,
} from "./messages";
import { createConfirmedProfile } from "./profiles";
import { createScan } from "./scans";

let conn: DatabaseConnection;
let ws: string;
let other: string;
let userId: string;

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
  [userId] = users as [string];
});
afterEach(() => conn.close());

function envelope(n: number, overrides: Partial<Envelope> = {}): Envelope {
  return {
    messageId: `<m${n}+x/y%z@mail.example>`,
    folder: "inbox",
    folderPath: "INBOX",
    uidValidity: 1700000000,
    uid: n,
    date: new Date(Date.UTC(2026, 8, 1) + n * 3600_000).toISOString(),
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

const role = (title: string): JobFacts => ({
  title,
  company: null,
  agency: null,
  places: [{ country: "DE", city: "Berlin" }],
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

async function setCorrection(messageId: string, category: string) {
  await conn.db.execute(
    sql`update messages set category = ${category}, category_source = 'you'
        where workspace_id = ${ws} and message_id = ${messageId}`,
  );
}

describe("saveEnvelopes", () => {
  it("starts each row in the state its stage-one verdict gives it", async () => {
    await saveEnvelopes(conn.db, ws, [
      at(envelope(1), "not_job"),
      at(envelope(2), "job_alert"),
      at(envelope(3), "likely_job"),
      at(envelope(4, { folder: "sent", folderPath: "Sent" }), "own_reply"),
    ]);
    const stored = await getStoredMessages(
      conn.db,
      ws,
      [1, 2, 3, 4].map((n) => envelope(n).messageId),
    );
    const byId = new Map(stored.map((m) => [m.envelope.uid, m]));
    expect(byId.get(1)).toMatchObject({
      category: "not_job",
      categorySource: "scan",
      analysisStatus: "done",
    });
    expect(byId.get(2)).toMatchObject({
      category: "job_alert",
      categorySource: "scan",
      analysisStatus: "pending",
    });
    expect(byId.get(3)).toMatchObject({
      category: null,
      categorySource: null,
      analysisStatus: "pending",
    });
    expect(byId.get(4)).toMatchObject({
      stageOne: "own_reply",
      category: null,
      analysisStatus: "pending",
    });
    expect(byId.get(3)?.envelope).toEqual(envelope(3));
  });

  it("is idempotent and keeps the analysis when the same Message-ID is saved again", async () => {
    const e = envelope(1);
    await saveEnvelopes(conn.db, ws, [at(e, "likely_job")]);
    await saveAnalysis(conn.db, ws, {
      messageId: e.messageId,
      scanId: null,
      category: "interview",
      roles: [role("Backend")],
    });
    await saveEnvelopes(conn.db, ws, [at({ ...e, uid: 99, snippet: "new" }, "likely_job")]);
    const [row] = await getStoredMessages(conn.db, ws, [e.messageId]);
    expect(row).toMatchObject({ category: "interview", analysisStatus: "done" });
    expect(row?.envelope).toMatchObject({ uid: 99, snippet: "new" });
    expect(await getRoles(conn.db, ws, e.messageId)).toEqual([role("Backend")]);
    const [n] = await queryRows<{ n: number }>(
      conn.db,
      sql`select count(*)::int as n from messages`,
    );
    expect(n?.n).toBe(1);
  });

  it("stores two envelopes with one Message-ID in one batch once, where the newest is (F1.3)", async () => {
    const id = "<inbox.0123456789abcdef0123456789abcdef@jobfilly.invalid>";
    const copies = [7, 3, 5].map((uid) => at(envelope(uid, { messageId: id }), "likely_job"));
    await saveEnvelopes(conn.db, ws, copies);
    const stored = await getStoredMessages(conn.db, ws, [id]);
    expect(stored.map((m) => m.envelope.uid)).toEqual([7]);
    const [n] = await queryRows<{ n: number }>(
      conn.db,
      sql`select count(*)::int as n from messages`,
    );
    expect(n?.n).toBe(1);
  });

  it("keeps workspaces apart even for the same Message-ID", async () => {
    await saveEnvelopes(conn.db, ws, [at(envelope(1), "likely_job")]);
    await saveEnvelopes(conn.db, other, [at(envelope(1), "not_job")]);
    expect((await getStoredMessages(conn.db, ws, [envelope(1).messageId]))[0]?.stageOne).toBe(
      "likely_job",
    );
    expect((await getStoredMessages(conn.db, other, [envelope(1).messageId]))[0]?.stageOne).toBe(
      "not_job",
    );
    expect(await countNotAnalyzed(conn.db, other)).toBe(0);
  });

  it("derives the lower-case search text from sender and subject", async () => {
    await saveEnvelopes(conn.db, ws, [
      at(
        envelope(1, {
          subject: "Senior BACKEND role",
          from: { address: "Ana@Agency.example", name: "Ana Pérez" },
        }),
        "likely_job",
      ),
    ]);
    const [row] = await queryRows<{ search_text: string }>(
      conn.db,
      sql`select search_text from messages`,
    );
    expect(row?.search_text).toBe("ana pérez ana@agency.example senior backend role");
  });
});

describe("analysis", () => {
  it("never overwrites a category a person corrected, but stores the roles", async () => {
    const e = envelope(1);
    await saveEnvelopes(conn.db, ws, [at(e, "likely_job")]);
    await setCorrection(e.messageId, "offer");
    expect(
      await saveAnalysis(conn.db, ws, {
        messageId: e.messageId,
        scanId: null,
        category: "rejection",
        roles: [role("A"), role("B")],
      }),
    ).toBe(true);
    const [row] = await getStoredMessages(conn.db, ws, [e.messageId]);
    expect(row).toMatchObject({ category: "offer", categorySource: "you", analysisStatus: "done" });
    expect((await getRoles(conn.db, ws, e.messageId)).map((r) => r.title)).toEqual(["A", "B"]);
  });

  it("replaces the roles of a message analysed again", async () => {
    const e = envelope(1);
    await saveEnvelopes(conn.db, ws, [at(e, "job_alert")]);
    await saveAnalysis(conn.db, ws, {
      messageId: e.messageId,
      scanId: null,
      category: "job_alert",
      roles: [role("A"), role("B"), role("C")],
    });
    await saveAnalysis(conn.db, ws, {
      messageId: e.messageId,
      scanId: null,
      category: "job_alert",
      roles: [role("D")],
    });
    expect((await getRoles(conn.db, ws, e.messageId)).map((r) => r.title)).toEqual(["D"]);
  });

  it("keeps a stage and a profile set by hand when the message is analysed again", async () => {
    const e = envelope(1);
    await saveEnvelopes(conn.db, ws, [at(e, "job_alert")]);
    const analyse = (titles: string[]) =>
      saveAnalysis(conn.db, ws, {
        messageId: e.messageId,
        scanId: null,
        category: "job_alert",
        roles: titles.map(role),
      });
    await analyse(["A", "B", "C"]);
    const profile = await createConfirmedProfile(conn.db, ws, {
      name: "p",
      entries: [],
      createdBy: userId,
      at: new Date("2026-09-02T10:00:00Z"),
    });
    if (!profile.ok) throw new Error("expected a profile");
    const setAt = new Date("2026-09-03T10:00:00Z");
    for (const position of [1, 2]) {
      const ref = { messageId: e.messageId, position };
      await setRoleStage(conn.db, ws, {
        roles: [ref],
        role: ref,
        stage: "interview",
        userId,
        at: setAt,
      });
      await setRoleProfileChoice(conn.db, ws, ref, {
        profileId: profile.profile.id,
        userId,
        at: setAt,
      });
    }

    // A re-run of setup analyses the mail again: the same roles, then one fewer.
    await analyse(["A", "B", "C"]);
    const manual = async () =>
      (await loadPipelineRows(conn.db, ws)).manual.sort((x, y) => x.position - y.position);
    expect(await manual()).toEqual([
      { messageId: e.messageId, position: 1, stage: "interview", setAt },
      { messageId: e.messageId, position: 2, stage: "interview", setAt },
    ]);
    expect(await getRoleProfileChoices(conn.db, ws, e.messageId)).toEqual(
      new Map([
        [1, profile.profile.id],
        [2, profile.profile.id],
      ]),
    );
    await analyse(["A", "B"]);
    expect((await manual()).map((m) => m.position)).toEqual([1]);
    expect([...(await getRoleProfileChoices(conn.db, ws, e.messageId)).keys()]).toEqual([1]);
    const [stage] = await queryRows<{ set_by: string }>(
      conn.db,
      sql`select set_by from role_stages where workspace_id = ${ws}`,
    );
    expect(stage?.set_by).toBe(userId);
  });

  it("does nothing for a message of another workspace", async () => {
    const e = envelope(1);
    await saveEnvelopes(conn.db, ws, [at(e, "likely_job")]);
    expect(
      await saveAnalysis(conn.db, other, {
        messageId: e.messageId,
        scanId: null,
        category: "offer",
        roles: [],
      }),
    ).toBe(false);
    expect(await markAnalysisFailed(conn.db, other, { messageId: e.messageId, scanId: null })).toBe(
      false,
    );
    expect((await getStoredMessages(conn.db, ws, [e.messageId]))[0]?.analysisStatus).toBe(
      "pending",
    );
  });

  it("marks a message Couldn't analyze and keeps it out of the pending list", async () => {
    await saveEnvelopes(conn.db, ws, [
      at(envelope(1), "likely_job"),
      at(envelope(2), "likely_job"),
    ]);
    expect(await countNotAnalyzed(conn.db, ws)).toBe(2);
    await markAnalysisFailed(conn.db, ws, { messageId: envelope(1).messageId, scanId: null });
    expect(await countNotAnalyzed(conn.db, ws)).toBe(1);
    expect((await getStoredMessages(conn.db, ws, [envelope(1).messageId]))[0]?.analysisStatus).toBe(
      "failed",
    );
  });
});

describe("pending work", () => {
  it("lists likely job messages not analysed yet, newest first, page by page", async () => {
    await saveEnvelopes(conn.db, ws, [
      at(envelope(1), "likely_job"),
      at(envelope(2), "job_alert"),
      at(envelope(3), "not_job"),
      at(envelope(4), "likely_job"),
      at(envelope(5, { folder: "sent", folderPath: "Sent" }), "own_reply"),
      at(envelope(6), "likely_job"),
    ]);
    await saveAnalysis(conn.db, ws, {
      messageId: envelope(6).messageId,
      scanId: null,
      category: "offer",
      roles: [],
    });
    const first = await listPendingCandidates(conn.db, ws, { limit: 2 });
    expect(first.map((m) => m.envelope.uid)).toEqual([4, 2]);
    const last = first.at(-1)?.envelope;
    if (!last) throw new Error("expected rows");
    const next = await listPendingCandidates(conn.db, ws, {
      limit: 2,
      before: { date: last.date, messageId: last.messageId },
    });
    expect(next.map((m) => m.envelope.uid)).toEqual([1]);
    expect(await countNotAnalyzed(conn.db, ws)).toBe(3);
    expect(
      (await listPendingOwnReplies(conn.db, ws, { limit: 20 })).map((m) => m.envelope.uid),
    ).toEqual([5]);
  });
});

describe("countScanAnalysis", () => {
  it("counts the likely job mail one run analysed or failed, and the job mail among it", async () => {
    const r = await registerAccount(conn.db, {
      name: "Ana",
      email: "ana@inbox.example",
      passwordHash: "h",
      workspaceName: "Ana",
    });
    if (!r.ok) throw new Error("expected ok");
    const scan = async () => {
      const s = await createScan(conn.db, r.workspaceId, { kind: "first", startedBy: r.user.id });
      if (!s.ok) throw new Error("expected ok");
      await conn.db.execute(sql`update scans set status = 'stopped' where id = ${s.scan.id}`);
      return s.scan.id;
    };
    const [run, earlier] = [await scan(), await scan()];
    const w = r.workspaceId;
    await saveEnvelopes(conn.db, w, [
      at(envelope(1), "likely_job"),
      at(envelope(2), "likely_job"),
      at(envelope(3), "job_alert"),
      at(envelope(4), "likely_job"),
      at(envelope(5), "likely_job"),
      at(envelope(6), "own_reply"),
      at(envelope(7), "likely_job"),
    ]);
    const id = (n: number) => envelope(n).messageId;
    await saveAnalysis(conn.db, w, {
      messageId: id(1),
      scanId: run,
      category: "interview",
      roles: [],
    });
    await saveAnalysis(conn.db, w, {
      messageId: id(2),
      scanId: run,
      category: "not_job",
      roles: [],
    });
    await saveAnalysis(conn.db, w, {
      messageId: id(3),
      scanId: run,
      category: "job_alert",
      roles: [],
    });
    await markAnalysisFailed(conn.db, w, { messageId: id(4), scanId: run });
    await saveAnalysis(conn.db, w, {
      messageId: id(5),
      scanId: earlier,
      category: "offer",
      roles: [],
    });
    await savePreferences(conn.db, w, { messageId: id(6), scanId: run, preferences: {} });
    expect(await countScanAnalysis(conn.db, w, run)).toEqual({ analyzed: 4, jobFound: 2 });
    expect(await countScanAnalysis(conn.db, w, earlier)).toEqual({ analyzed: 1, jobFound: 1 });
    expect(await countScanAnalysis(conn.db, ws, run)).toEqual({ analyzed: 0, jobFound: 0 });
  });
});

describe("loadIntakeInput", () => {
  it("reads replies' preferences and analysed job mail, leaving out not_job and failed", async () => {
    const reply = envelope(10, { folder: "sent", folderPath: "Sent" });
    await saveEnvelopes(conn.db, ws, [
      at(reply, "own_reply"),
      at(envelope(11, { folder: "sent", folderPath: "Sent" }), "own_reply"),
      at(envelope(1), "likely_job"),
      at(envelope(2), "likely_job"),
      at(envelope(3), "likely_job"),
      at(envelope(4), "likely_job"),
      at(envelope(5), "not_job"),
      at(envelope(6), "job_alert"),
    ]);
    await savePreferences(conn.db, ws, {
      messageId: reply.messageId,
      scanId: null,
      preferences: { contracts: ["B2B"] },
    });
    await saveAnalysis(conn.db, ws, {
      messageId: envelope(1).messageId,
      scanId: null,
      category: "recruiter_outreach",
      roles: [role("A")],
    });
    await saveAnalysis(conn.db, ws, {
      messageId: envelope(2).messageId,
      scanId: null,
      category: "not_job",
      roles: [],
    });
    await saveAnalysis(conn.db, ws, {
      messageId: envelope(3).messageId,
      scanId: null,
      category: "interview",
      roles: [role("C")],
    });
    await setCorrection(envelope(3).messageId, "not_job");
    await setCorrection(envelope(5).messageId, "offer");
    await markAnalysisFailed(conn.db, ws, { messageId: envelope(4).messageId, scanId: null });

    const input = await loadIntakeInput(conn.db, ws);
    expect(input.replies).toEqual([
      { messageId: reply.messageId, date: reply.date, preferences: { contracts: ["B2B"] } },
    ]);
    expect(input.jobs).toEqual([
      { messageId: envelope(5).messageId, date: envelope(5).date, category: "offer", roles: [] },
      {
        messageId: envelope(1).messageId,
        date: envelope(1).date,
        category: "recruiter_outreach",
        roles: [role("A")],
      },
    ]);
  });

  it("is empty for another workspace", async () => {
    await saveEnvelopes(conn.db, ws, [at(envelope(1), "likely_job")]);
    await saveAnalysis(conn.db, ws, {
      messageId: envelope(1).messageId,
      scanId: null,
      category: "offer",
      roles: [],
    });
    expect(await loadIntakeInput(conn.db, other)).toEqual({ replies: [], jobs: [] });
  });
});

describe("listJobMailLanguages", () => {
  /** A message of this category whose body the sender stage read as this language. */
  async function seed(n: number, category: string | null, language: string | null, w = ws) {
    const e = envelope(n);
    await saveEnvelopes(conn.db, w, [at(e, "likely_job")]);
    if (category) {
      await saveAnalysis(conn.db, w, {
        messageId: e.messageId,
        scanId: null,
        category: category as "offer",
        roles: [],
      });
    }
    await saveMessageLanguage(conn.db, w, e.messageId, language);
  }

  it("lists the job mail's languages, most frequent first, ties by code", async () => {
    await seed(1, "recruiter_outreach", "nl");
    await seed(2, "job_alert", "de");
    await seed(3, "offer", "de");
    await seed(4, "interview", "pt");
    await seed(5, "recruiter_outreach", "en");
    await seed(6, "rejection", "de");
    await seed(7, "recruiter_outreach", "en");
    await seed(8, "recruiter_outreach", null);
    expect(await listJobMailLanguages(conn.db, ws)).toEqual(["de", "en", "nl", "pt"]);
    expect(await listJobMailLanguages(conn.db, ws, 2)).toEqual(["de", "en"]);
  });

  it("leaves out mail that isn't job mail or isn't analysed, and other workspaces", async () => {
    await seed(1, "recruiter_outreach", "en");
    await seed(2, "not_job", "fr");
    await seed(3, null, "it");
    await seed(4, "offer", "es", other);
    expect(await listJobMailLanguages(conn.db, ws)).toEqual(["en"]);
    expect(await listJobMailLanguages(conn.db, other)).toEqual(["es"]);
  });
});

describe("reindexMessages (F1.3)", () => {
  const rebuilt = (e: Envelope, uid: number): Envelope => ({ ...e, uidValidity: 1800000000, uid });
  const now = new Date("2026-10-15T10:00:00Z");

  it("moves stored messages to their new UIDs by Message-ID and keeps everything on them", async () => {
    const [a, b] = [envelope(1), envelope(2)];
    await saveEnvelopes(conn.db, ws, [at(a, "likely_job"), at(b, "likely_job")]);
    await saveAnalysis(conn.db, ws, {
      messageId: a.messageId,
      scanId: null,
      category: "recruiter_outreach",
      roles: [role("Backend")],
    });
    await setCorrection(b.messageId, "offer");
    await saveEvaluation(
      conn.db,
      ws,
      a.messageId,
      {
        position: 0,
        match: {
          score: 80,
          verdicts: [],
          skills: { matched: [], missing: [] },
          cvId: null,
          capped: false,
        },
        hidden: null,
        ruleEffects: [],
        cvChoice: { cvId: null, reason: "No CV yet", source: "auto" },
      },
      now,
    );
    const draft = await claimDraft(
      conn.db,
      ws,
      { messageId: a.messageId, position: 0 },
      { origin: "auto", now },
    );
    // A decision the role waits on: decision_messages cascades on a delete of the messages row,
    // so a re-index that dropped and re-inserted the message would lose it.
    const [decision] = await queryRows<{ id: string }>(
      conn.db,
      sql`insert into decisions (workspace_id, group_key, question, choices, status, created_at)
          values (${ws}, 'contract', 'Which contract?', '[]'::jsonb, 'open', ${now})
          returning id`,
    );
    await conn.db.execute(
      sql`insert into decision_messages
            (decision_id, workspace_id, message_id, position, state, source, created_at, updated_at)
          values (${decision?.id}, ${ws}, ${a.messageId}, 0, 'waiting', 'match', ${now}, ${now})`,
    );
    const decisionRows = () =>
      queryRows<{
        id: string;
        status: string;
        message_id: string;
        position: number;
        state: string;
      }>(
        conn.db,
        sql`select d.id, d.status, m.message_id, m.position, m.state
            from decisions d join decision_messages m on m.decision_id = d.id
            where d.workspace_id = ${ws}`,
      );
    const ids = () =>
      queryRows<{ id: string }>(
        conn.db,
        sql`select id from messages where workspace_id = ${ws} order by id`,
      );
    const before = await ids();

    // The folder was rebuilt: new UIDVALIDITY, other UIDs; a third message is new.
    const found = await reindexMessages(conn.db, ws, [
      rebuilt(a, 5),
      rebuilt(b, 6),
      rebuilt(envelope(3), 7),
    ]);
    expect([...found].sort()).toEqual([a.messageId, b.messageId].sort());

    const stored = await getStoredMessages(conn.db, ws, [a.messageId, b.messageId]);
    const byId = new Map(stored.map((m) => [m.envelope.messageId, m]));
    expect(byId.get(a.messageId)).toMatchObject({
      envelope: { uidValidity: 1800000000, uid: 5, subject: "Subject 1" },
      category: "recruiter_outreach",
      analysisStatus: "done",
    });
    expect(byId.get(b.messageId)).toMatchObject({
      envelope: { uidValidity: 1800000000, uid: 6 },
      category: "offer",
      categorySource: "you",
    });
    expect(await getRoles(conn.db, ws, a.messageId)).toEqual([role("Backend")]);
    expect(await getEvaluations(conn.db, ws, [a.messageId])).toMatchObject([
      { position: 0, stale: false, match: { score: 80 } },
    ]);
    expect(await getDraftClaim(conn.db, ws, draft?.id ?? "")).toMatchObject({ status: "saving" });
    expect(await decisionRows()).toEqual([
      {
        id: decision?.id,
        status: "open",
        message_id: a.messageId,
        position: 0,
        state: "waiting",
      },
    ]);
    // The rows themselves are kept, with their ids; nothing is inserted for the new message.
    expect(await ids()).toEqual(before);
  });

  it("makes a message_gone sender check stale, as the message is there again", async () => {
    const [a, b] = [envelope(1), envelope(2)];
    await saveEnvelopes(conn.db, ws, [at(a, "likely_job"), at(b, "likely_job")]);
    await saveSenderCheck(
      conn.db,
      ws,
      a.messageId,
      {
        verdict: "caution",
        complete: false,
        reasons: [{ signal: MESSAGE_GONE_SIGNAL, reason: "gone" }],
        mark: null,
      },
      now,
    );
    await saveSenderCheck(
      conn.db,
      ws,
      b.messageId,
      { verdict: "looks_fine", complete: true, reasons: [], mark: null },
      now,
    );
    await reindexMessages(conn.db, ws, [rebuilt(a, 1), rebuilt(b, 2)]);
    const checks = await getSenderChecks(conn.db, ws, [a.messageId, b.messageId]);
    expect(Object.fromEntries(checks.map((c) => [c.messageId, c.stale]))).toEqual({
      [a.messageId]: true,
      [b.messageId]: false,
    });
  });

  it("keeps the newest copy of a duplicate, and never touches another workspace", async () => {
    const a = envelope(1);
    await saveEnvelopes(conn.db, ws, [at(a, "likely_job")]);
    await saveEnvelopes(conn.db, other, [at(a, "likely_job")]);
    await reindexMessages(conn.db, ws, [rebuilt(a, 3), rebuilt(a, 9)]);
    expect((await getStoredMessages(conn.db, ws, [a.messageId]))[0]?.envelope.uid).toBe(9);
    expect((await getStoredMessages(conn.db, other, [a.messageId]))[0]?.envelope).toMatchObject({
      uidValidity: 1700000000,
      uid: 1,
    });
    expect(await reindexMessages(conn.db, ws, [])).toEqual(new Set());
  });
});

describe("newestStoredUid", () => {
  it("gives the folder's current UIDVALIDITY and the highest UID stored under it", async () => {
    expect(await newestStoredUid(conn.db, ws, "INBOX")).toBeNull();
    await saveEnvelopes(conn.db, ws, [
      at(envelope(4), "likely_job"),
      at(envelope(9), "not_job"),
      // An older message under an earlier UIDVALIDITY, with a higher UID.
      at(envelope(2, { messageId: "<old@x>", uidValidity: 1600000000, uid: 50 }), "not_job"),
      at(envelope(30, { folder: "sent", folderPath: "Sent" }), "own_reply"),
    ]);
    expect(await newestStoredUid(conn.db, ws, "INBOX")).toEqual({
      uidValidity: 1700000000,
      uid: 9,
    });
    expect(await newestStoredUid(conn.db, other, "INBOX")).toBeNull();
  });
});
