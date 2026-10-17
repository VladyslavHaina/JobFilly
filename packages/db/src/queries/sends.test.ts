import type { Envelope } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { markTestDraftInMailbox, openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import { claimDraft } from "./draft-claims";
import { getDraft, listDrafts } from "./drafts";
import { createMailbox } from "./mailboxes";
import { saveAnalysis, saveEnvelopes } from "./messages";
import {
  cancelSend,
  completeSend,
  failSend,
  getMailboxSmtp,
  getSend,
  markSendAccepted,
  saveMailboxSmtp,
  scheduleSend,
  startSend,
} from "./sends";

// Sends (MVP 3, F4): one waits or runs per draft, Undo and the job race on the same row and only
// one wins, a sent draft keeps its row with status sent (D13), and everything is workspace-scoped.

let conn: DatabaseConnection;
let ws: string;
let other: string;
let userId: string;
let mailboxId: string;
let draftId: string;
const t0 = new Date("2026-10-01T10:00:00Z");
const later = (s: number) => new Date(t0.getTime() + s * 1000);
const MESSAGE = "<berlin@agency.example>";

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

async function seedMessage(workspaceId: string) {
  const envelope: Envelope = {
    messageId: MESSAGE,
    folder: "inbox",
    folderPath: "INBOX",
    uidValidity: 1,
    uid: 1,
    date: t0.toISOString(),
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
  await saveEnvelopes(conn.db, workspaceId, [{ envelope, verdict: "likely_job", reason: null }]);
  await saveAnalysis(conn.db, workspaceId, {
    messageId: MESSAGE,
    scanId: null,
    category: "recruiter_outreach",
    roles: [],
  });
}

const schedule = (input: { draft?: string; workspace?: string } = {}) =>
  scheduleSend(conn.db, input.workspace ?? ws, {
    draftId: input.draft ?? draftId,
    messageId: MESSAGE,
    position: 0,
    mailboxId,
    contentHash: "hash-1",
    outgoingMessageId: "<out-1@inbox.example>",
    sendAt: later(10),
    createdBy: userId,
    now: t0,
  });

beforeEach(async () => {
  conn = await openTestDatabase();
  const maria = await account("maria@inbox.example");
  ws = maria.workspaceId;
  userId = maria.user.id;
  other = (await account("tom@inbox.example")).workspaceId;
  await seedMessage(ws);
  const created = await createMailbox(conn.db, ws, {
    address: "maria@inbox.example",
    host: "imap.inbox.example",
    port: 993,
    tlsMode: "tls",
    username: "maria",
    secretCiphertext: "sealed-imap",
    sentFolderPath: "Sent",
  });
  if (!created.ok) throw new Error("expected a mailbox");
  mailboxId = created.mailboxId;
  const claim = await claimDraft(
    conn.db,
    ws,
    { messageId: MESSAGE, position: 0 },
    { origin: "auto", now: t0, userId: null },
  );
  if (!claim) throw new Error("expected a claim");
  draftId = claim.id;
  await markTestDraftInMailbox(conn.db, ws, { messageId: MESSAGE, position: 0 }, t0);
});
afterEach(() => conn.close());

describe("SMTP settings", () => {
  it("are null until set, keep the stored password unless given, and stay in the workspace", async () => {
    expect(await getMailboxSmtp(conn.db, ws, mailboxId)).toBeNull();
    const settings = { host: "smtp.inbox.example", port: 465, tlsMode: "tls" as const };
    expect(
      await saveMailboxSmtp(conn.db, ws, mailboxId, {
        ...settings,
        username: "maria",
        secretCiphertext: "sealed-smtp",
        now: t0,
      }),
    ).toBe(true);
    await saveMailboxSmtp(conn.db, ws, mailboxId, { ...settings, username: "m2", now: t0 });
    expect(await getMailboxSmtp(conn.db, ws, mailboxId)).toEqual({
      ...settings,
      username: "m2",
      secretCiphertext: "sealed-smtp",
    });
    expect(await getMailboxSmtp(conn.db, other, mailboxId)).toBeNull();
    expect(
      await saveMailboxSmtp(conn.db, other, mailboxId, { ...settings, username: "x", now: t0 }),
    ).toBe(false);
  });
});

describe("a send", () => {
  it("waits one at a time per draft (F4.3)", async () => {
    const send = await schedule();
    expect(send).toMatchObject({ status: "scheduled", sendAt: later(10).toISOString() });
    expect(await schedule()).toBeNull();
    // Once undone, the draft can be confirmed again.
    await cancelSend(conn.db, ws, draftId, later(1));
    expect(await schedule()).not.toBeNull();
  });

  it("is undone or started, never both (F4.2)", async () => {
    const send = await schedule();
    if (!send) throw new Error("expected a send");
    expect(await cancelSend(conn.db, ws, draftId, later(1))).toMatchObject({ status: "cancelled" });
    expect(await startSend(conn.db, ws, send.id, later(10))).toBe(false);

    const again = await schedule();
    if (!again) throw new Error("expected a send");
    expect(await startSend(conn.db, ws, again.id, later(10))).toBe(true);
    expect(await cancelSend(conn.db, ws, draftId, later(11))).toBeNull();
    expect((await getSend(conn.db, ws, again.id))?.status).toBe("sending");
  });

  it("marks the draft sent and keeps its row (F4.4, D13)", async () => {
    const send = await schedule();
    if (!send) throw new Error("expected a send");
    await startSend(conn.db, ws, send.id, later(10));
    expect(await markSendAccepted(conn.db, ws, send.id, later(11))).toBe(true);
    // Accepted once only.
    expect(await markSendAccepted(conn.db, ws, send.id, later(12))).toBe(false);
    expect(await completeSend(conn.db, ws, send, later(12))).toBe(true);
    expect(await completeSend(conn.db, ws, send, later(13))).toBe(false);
    const draft = await getDraft(conn.db, ws, draftId);
    expect(draft).toMatchObject({ status: "sent", mailbox: null });
    expect(draft?.send).toMatchObject({
      id: send.id,
      status: "sent",
      sentAt: later(11).toISOString(),
    });
    // The role keeps its one live draft: no new claim is taken for it.
    expect(
      await claimDraft(
        conn.db,
        ws,
        { messageId: MESSAGE, position: 0 },
        { origin: "auto", now: later(20), userId: null },
      ),
    ).toBeNull();
  });

  it("fails with why, and the list shows each draft's latest send", async () => {
    const first = await schedule();
    if (!first) throw new Error("expected a send");
    await failSend(conn.db, ws, first.id, { reason: "The draft changed", now: later(10) });
    expect(await failSend(conn.db, ws, first.id, { reason: "again", now: later(11) })).toBe(false);
    const [draft] = await listDrafts(conn.db, ws);
    expect(draft?.send).toMatchObject({ status: "failed", failureReason: "The draft changed" });
  });

  it("is never read or changed from another workspace", async () => {
    const send = await schedule();
    if (!send) throw new Error("expected a send");
    expect(await getSend(conn.db, other, send.id)).toBeNull();
    expect(await cancelSend(conn.db, other, draftId, later(1))).toBeNull();
    expect(await startSend(conn.db, other, send.id, later(10))).toBe(false);
    expect(await failSend(conn.db, other, send.id, { reason: "x", now: later(10) })).toBe(false);
    // A draft of another workspace can't be scheduled (the composite foreign key).
    await cancelSend(conn.db, ws, draftId, later(1));
    await expect(schedule({ workspace: other })).rejects.toThrow();
  });
});
