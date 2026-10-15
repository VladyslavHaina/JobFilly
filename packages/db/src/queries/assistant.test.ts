import type { Change, Envelope, Impact, JobFacts, MatchAiOutput } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import {
  createThread,
  decideProposal,
  getLatestThread,
  getProposal,
  getThread,
  insertProposal,
  listStoredMatchAnswers,
  listThreadMessages,
  listThreadProposals,
  nextTurn,
  saveTurn,
  updateOpenProposal,
} from "./assistant";
import { saveMatchAnswer } from "./match";
import { saveAnalysis, saveEnvelopes } from "./messages";
import { createConfirmedProfile } from "./profiles";
import { addMember } from "./workspaces";

// The assistant's storage (F8): a thread per member, its turns in order, and proposals that change
// status only while open. Messages and proposals are kept for the history (F8.10). Every read is
// scoped to the workspace, and threads to their member.

let conn: DatabaseConnection;
let ws: string;
let other: string;
let maria: string;
let tom: string;
let profileId: string;
const at = new Date("2026-10-15T12:00:00Z");
const later = (ms: number) => new Date(at.getTime() + ms);

beforeEach(async () => {
  conn = await openTestDatabase();
  const made = [];
  for (const key of ["maria", "tom"]) {
    const r = await registerAccount(conn.db, {
      name: key,
      email: `${key}@inbox.example`,
      passwordHash: "h",
      workspaceName: key,
    });
    if (!r.ok) throw new Error("expected ok");
    made.push(r);
  }
  ws = made[0]?.workspaceId ?? "";
  other = made[1]?.workspaceId ?? "";
  maria = made[0]?.user.id ?? "";
  tom = made[1]?.user.id ?? "";
  await addMember(conn.db, ws, tom, "viewer");
  const created = await createConfirmedProfile(conn.db, ws, {
    name: "My job search",
    entries: [],
    createdBy: maria,
    at,
  });
  if (!created.ok) throw new Error("expected a profile");
  profileId = created.profile.id;
});
afterEach(() => conn.close());

const change: Change = {
  op: "add",
  target: "rule",
  rule: {
    description: "Hide roles whose working hours are UTC+5 or later",
    when: [{ fact: "timeZones", op: "within", value: { from: "UTC+05:00", to: "UTC+14:00" } }],
    then: "hide",
    enabled: true,
  },
};
const impact: Impact = {
  hides: 3,
  shows: 0,
  scoreMoves: 0,
  draftsNotCreated: 0,
  draftsInMailbox: 1,
};
const snapshot = { entries: [], rules: [] };

const proposal = (threadId: string) =>
  insertProposal(conn.db, ws, {
    threadId,
    profileId,
    request: "No Asian time zones E2E-CHAT-1",
    summary: "Hide roles whose working hours are UTC+5 or later",
    changes: [change],
    before: snapshot,
    after: snapshot,
    impact,
    at,
  });

describe("assistant threads", () => {
  it("keeps each member's threads to themselves, in their workspace", async () => {
    expect(await getLatestThread(conn.db, ws, maria)).toBeNull();
    const first = await createThread(conn.db, ws, maria, at);
    const second = await createThread(conn.db, ws, maria, later(1000));
    expect(await getLatestThread(conn.db, ws, maria)).toEqual(second);
    expect(await getThread(conn.db, ws, maria, first.id)).toEqual(first);
    expect(await getThread(conn.db, ws, tom, first.id)).toBeNull();
    expect(await getLatestThread(conn.db, ws, tom)).toBeNull();
    expect(await getThread(conn.db, other, maria, first.id)).toBeNull();
  });

  it("stores each turn's message and reply in order and counts turns", async () => {
    const { id } = await createThread(conn.db, ws, maria, at);
    expect(await nextTurn(conn.db, ws, id)).toBe(1);
    await saveTurn(conn.db, ws, id, {
      turn: 1,
      text: "stop showing me bad jobs E2E-CHAT-2",
      reply: "What makes a job bad for you?",
      clarify: { question: "What makes a job bad for you?", choices: ["Low pay", "Far away"] },
      proposalId: null,
      at,
    });
    const { id: proposalId } = await proposal(id);
    await saveTurn(conn.db, ws, id, {
      turn: 2,
      text: "Low pay",
      reply: "Here is a proposal.",
      clarify: null,
      proposalId,
      at: later(5000),
    });
    expect(await nextTurn(conn.db, ws, id)).toBe(3);
    const messages = await listThreadMessages(conn.db, ws, id);
    expect(messages.map((m) => [m.turn, m.role, m.text])).toEqual([
      [1, "user", "stop showing me bad jobs E2E-CHAT-2"],
      [1, "assistant", "What makes a job bad for you?"],
      [2, "user", "Low pay"],
      [2, "assistant", "Here is a proposal."],
    ]);
    expect(messages[1]?.clarify?.choices).toEqual(["Low pay", "Far away"]);
    expect(messages[3]?.proposalId).toBe(proposalId);
    expect(await listThreadMessages(conn.db, other, id)).toEqual([]);
  });
});

describe("assistant proposals", () => {
  it("are read with their thread's member, only in their workspace", async () => {
    const thread = await createThread(conn.db, ws, maria, at);
    const { id } = await proposal(thread.id);
    const stored = await getProposal(conn.db, ws, id);
    expect(stored).toMatchObject({
      id,
      threadId: thread.id,
      userId: maria,
      profileId,
      request: "No Asian time zones E2E-CHAT-1",
      changes: [change],
      impact,
      status: "open",
    });
    expect(await getProposal(conn.db, other, id)).toBeNull();
    expect((await listThreadProposals(conn.db, ws, thread.id)).map((p) => p.id)).toEqual([id]);
  });

  it("are edited only while open and decided once", async () => {
    const thread = await createThread(conn.db, ws, maria, at);
    const { id } = await proposal(thread.id);
    const edited = { ...impact, hides: 4 };
    const content = { summary: "edited", changes: [change], before: snapshot, after: snapshot };
    expect(await updateOpenProposal(conn.db, ws, id, { ...content, impact: edited, at })).toBe(
      true,
    );
    expect((await getProposal(conn.db, ws, id))?.impact.hides).toBe(4);
    expect(await decideProposal(conn.db, other, id, { status: "applied", userId: maria, at })).toBe(
      false,
    );
    expect(await decideProposal(conn.db, ws, id, { status: "applied", userId: maria, at })).toBe(
      true,
    );
    expect(await decideProposal(conn.db, ws, id, { status: "discarded", userId: maria, at })).toBe(
      false,
    );
    expect(await updateOpenProposal(conn.db, ws, id, { ...content, impact, at })).toBe(false);
    expect(await getProposal(conn.db, ws, id)).toMatchObject({
      status: "applied",
      decidedBy: maria,
      decidedAt: at,
      impact: edited,
    });
  });
});

describe("listStoredMatchAnswers", () => {
  const MESSAGE = "<m1@agency.example>";
  const envelope: Envelope = {
    messageId: MESSAGE,
    folder: "inbox",
    folderPath: "INBOX",
    uidValidity: 1,
    uid: 1,
    date: at.toISOString(),
    from: { address: "r@agency.example", name: null },
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
    skills: ["Go"],
    languages: [],
    applyUrl: null,
    extra: {},
  };
  const answer: MatchAiOutput = {
    titleFit: { verdict: "fits", reason: "a backend role" },
    skillCloseness: [],
  };

  it("lists the messages' stored answers with their keys, only in the workspace", async () => {
    for (const w of [ws, other]) {
      await saveEnvelopes(conn.db, w, [{ envelope, verdict: "likely_job", reason: null }]);
      await saveAnalysis(conn.db, w, {
        messageId: MESSAGE,
        scanId: null,
        category: "recruiter_outreach",
        roles: [facts],
      });
    }
    const key = { messageId: MESSAGE, position: 0, cvId: null, inputHash: "a".repeat(64) };
    await saveMatchAnswer(conn.db, ws, key, answer, at);
    await saveMatchAnswer(conn.db, other, { ...key, inputHash: "b".repeat(64) }, answer, at);
    expect(await listStoredMatchAnswers(conn.db, ws, [MESSAGE])).toEqual([{ ...key, answer }]);
    expect(await listStoredMatchAnswers(conn.db, ws, [])).toEqual([]);
  });
});
