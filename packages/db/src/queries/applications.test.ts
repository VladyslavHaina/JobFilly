import type { Category, Envelope, JobFacts } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { markTestDraftInMailbox, openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import { loadPipelineRows, setRoleStage } from "./applications";
import { claimDraft } from "./draft-claims";
import { createMailbox } from "./mailboxes";
import { saveAnalysis, saveEnvelopes } from "./messages";
import { completeSend, markSendAccepted, scheduleSend, startSend } from "./sends";

// What the pipeline is derived from (MVP 3, F5, D15): roles and mail of job messages and the
// user's own, replies sent from the app, and the stages set by hand, the only part stored. All
// of it workspace-scoped; non-job mail stays out.

let conn: DatabaseConnection;
let ws: string;
let other: string;
let userId: string;
const t0 = new Date("2026-10-01T10:00:00Z");
const later = (s: number) => new Date(t0.getTime() + s * 1000);

const facts = (title: string): JobFacts => ({
  title,
  company: "Globex",
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

function envelope(messageId: string, input: Partial<Envelope> = {}): Envelope {
  return {
    messageId,
    folder: "inbox",
    folderPath: "INBOX",
    uidValidity: 1,
    uid: 1,
    date: t0.toISOString(),
    from: { address: "r@agency.example", name: "Rita" },
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
    ...input,
  };
}

async function jobMessage(
  workspaceId: string,
  messageId: string,
  category: Category,
  roles: JobFacts[],
) {
  await saveEnvelopes(conn.db, workspaceId, [
    { envelope: envelope(messageId), verdict: "likely_job", reason: null },
  ]);
  await saveAnalysis(conn.db, workspaceId, { messageId, scanId: null, category, roles });
}

async function account(email: string) {
  const r = await registerAccount(conn.db, {
    name: "M",
    email,
    passwordHash: "h",
    workspaceName: "w",
  });
  if (!r.ok) throw new Error("expected ok");
  return r;
}

beforeEach(async () => {
  conn = await openTestDatabase();
  const maria = await account("maria@inbox.example");
  ws = maria.workspaceId;
  userId = maria.user.id;
  other = (await account("tom@inbox.example")).workspaceId;
});
afterEach(() => conn.close());

describe("loadPipelineRows", () => {
  it("reads the roles and mail of job messages and the user's own replies, nothing else", async () => {
    await jobMessage(ws, "<a@x>", "recruiter_outreach", [facts("Backend"), facts("Data")]);
    await jobMessage(ws, "<spam@x>", "not_job", [facts("Ignored")]);
    await saveEnvelopes(conn.db, ws, [
      {
        envelope: envelope("<re@me>", {
          folder: "sent",
          folderPath: "Sent",
          inReplyTo: "<a@x>",
          references: ["<a@x>"],
          date: later(60).toISOString(),
        }),
        verdict: "own_reply",
        reason: "your own message",
      },
    ]);
    await jobMessage(other, "<b@x>", "interview", [facts("Elsewhere")]);

    const rows = await loadPipelineRows(conn.db, ws);
    expect(rows.roles.map((r) => [r.messageId, r.position, r.facts.title])).toEqual(
      expect.arrayContaining([
        ["<a@x>", 0, "Backend"],
        ["<a@x>", 1, "Data"],
      ]),
    );
    expect(rows.roles).toHaveLength(2);
    expect(rows.roles[0]).toMatchObject({
      from: { address: "r@agency.example", name: "Rita" },
      receivedAt: t0,
    });
    expect(rows.mail).toEqual(
      expect.arrayContaining([
        {
          messageId: "<a@x>",
          inReplyTo: null,
          references: [],
          receivedAt: t0,
          category: "recruiter_outreach",
          own: false,
        },
        {
          messageId: "<re@me>",
          inReplyTo: "<a@x>",
          references: ["<a@x>"],
          receivedAt: later(60),
          category: null,
          own: true,
        },
      ]),
    );
    expect(rows.mail).toHaveLength(2);
    expect(rows.sent).toEqual([]);
    expect(rows.manual).toEqual([]);
  });

  it("reads a reply sent from the app once the SMTP server took it", async () => {
    await jobMessage(ws, "<a@x>", "recruiter_outreach", [facts("Backend")]);
    const role = { messageId: "<a@x>", position: 0 };
    const claim = await claimDraft(conn.db, ws, role, { origin: "auto", now: t0, userId: null });
    if (!claim) throw new Error("expected a claim");
    await markTestDraftInMailbox(conn.db, ws, role, t0);
    const mailbox = await createMailbox(conn.db, ws, {
      address: "maria@inbox.example",
      host: "imap.inbox.example",
      port: 993,
      tlsMode: "tls",
      username: "maria",
      secretCiphertext: "sealed",
      sentFolderPath: "Sent",
    });
    if (!mailbox.ok) throw new Error("expected a mailbox");
    const send = await scheduleSend(conn.db, ws, {
      draftId: claim.id,
      ...role,
      mailboxId: mailbox.mailboxId,
      contentHash: "h",
      outgoingMessageId: "<out@me>",
      sendAt: later(10),
      createdBy: userId,
      now: t0,
    });
    if (!send) throw new Error("expected a send");
    expect((await loadPipelineRows(conn.db, ws)).sent).toEqual([]);
    await startSend(conn.db, ws, send.id, later(10));
    await markSendAccepted(conn.db, ws, send.id, later(11));
    expect((await loadPipelineRows(conn.db, ws)).sent).toEqual([{ ...role, sentAt: later(11) }]);
    await completeSend(conn.db, ws, send, later(12));
    expect((await loadPipelineRows(conn.db, ws)).sent).toEqual([{ ...role, sentAt: later(11) }]);
    expect((await loadPipelineRows(conn.db, other)).sent).toEqual([]);
  });
});

describe("setRoleStage", () => {
  const one = { messageId: "<one@x>", position: 0 };
  const two = { messageId: "<two@x>", position: 0 };

  beforeEach(async () => {
    await jobMessage(ws, one.messageId, "recruiter_outreach", [facts("Backend")]);
    await jobMessage(ws, two.messageId, "recruiter_outreach", [facts("Backend")]);
  });

  it("stores one stage per item, replaces it, and clears it", async () => {
    await setRoleStage(conn.db, ws, {
      roles: [one, two],
      role: two,
      stage: "applied",
      userId,
      at: t0,
    });
    expect((await loadPipelineRows(conn.db, ws)).manual).toEqual([
      { ...two, stage: "applied", setAt: t0 },
    ]);
    await setRoleStage(conn.db, ws, {
      roles: [one, two],
      role: one,
      stage: "interview",
      userId,
      at: later(5),
    });
    expect((await loadPipelineRows(conn.db, ws)).manual).toEqual([
      { ...one, stage: "interview", setAt: later(5) },
    ]);
    await setRoleStage(conn.db, ws, {
      roles: [one, two],
      role: one,
      stage: null,
      userId,
      at: later(6),
    });
    expect((await loadPipelineRows(conn.db, ws)).manual).toEqual([]);
  });

  it("is workspace-scoped", async () => {
    await jobMessage(other, one.messageId, "recruiter_outreach", [facts("Backend")]);
    await setRoleStage(conn.db, other, { roles: [one], role: one, stage: "offer", userId, at: t0 });
    await setRoleStage(conn.db, ws, { roles: [one], role: one, stage: "closed", userId, at: t0 });
    await setRoleStage(conn.db, ws, { roles: [one], role: one, stage: null, userId, at: t0 });
    expect((await loadPipelineRows(conn.db, ws)).manual).toEqual([]);
    expect((await loadPipelineRows(conn.db, other)).manual).toEqual([
      { ...one, stage: "offer", setAt: t0 },
    ]);
  });

  it("goes with its role when an analysis drops the role", async () => {
    await setRoleStage(conn.db, ws, { roles: [one], role: one, stage: "offer", userId, at: t0 });
    await saveAnalysis(conn.db, ws, {
      messageId: one.messageId,
      scanId: null,
      category: "recruiter_outreach",
      roles: [],
    });
    expect((await loadPipelineRows(conn.db, ws)).manual).toEqual([]);
  });
});
