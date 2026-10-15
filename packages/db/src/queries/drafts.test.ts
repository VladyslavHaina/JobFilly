import type { DraftOrigin, DraftRef, Envelope } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { drafts } from "../tables";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import { claimDraft, markDraftFailed } from "./draft-claims";
import {
  getDraft,
  listDrafts,
  liveDraftFor,
  markDraftDiscarded,
  markDraftSaved,
  publicDraft,
  saveDraftEdit,
  saveDraftText,
} from "./drafts";
import { saveAnalysis, saveEnvelopes } from "./messages";

let conn: DatabaseConnection;
let ws: string;
const t0 = new Date("2026-10-01T10:00:00Z");
const later = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
const ids = ["<d1@agency.example>", "<d2@agency.example>", "<d3@agency.example>"];
const role = (i: number, position = 0) => ({ messageId: ids[i] ?? "", position });
const ref = (uid: number): DraftRef => ({
  path: "Drafts",
  uid,
  uidValidity: 7,
  draftMessageId: `<draft-${uid}@jobfilly.test>`,
});

async function seedMessage(workspaceId: string, messageId: string, uid: number) {
  const envelope: Envelope = {
    messageId,
    folder: "inbox",
    folderPath: "INBOX",
    uidValidity: 1,
    uid,
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
  for (const [i, id] of ids.entries()) await seedMessage(ws, id, i + 1);
});
afterEach(() => conn.close());

const claim = async (r: { messageId: string; position: number }, origin: DraftOrigin = "auto") => {
  const c = await claimDraft(conn.db, ws, r, { origin, now: t0 });
  if (!c) throw new Error("expected a claim");
  return c.id;
};

const text = { subject: "Re: A role", body: "Thank you, I'd like to hear more.", language: "en" };

describe("a draft's content (F6)", () => {
  it("goes from saving to in mailbox, edited and discarded, and lists every status", async () => {
    const a = await claim(role(0));
    expect(await saveDraftText(conn.db, ws, a, { ...text, cvId: null, now: later(1) })).toBe(true);
    expect(
      await markDraftSaved(conn.db, ws, a, { ref: ref(1), contentHash: "h1", now: later(2) }),
    ).toBe(true);
    // Saved once: the claim is over, a second save of the same claim does nothing.
    expect(
      await markDraftSaved(conn.db, ws, a, { ref: ref(9), contentHash: "h9", now: later(3) }),
    ).toBe(false);
    const edited = await saveDraftEdit(conn.db, ws, a, {
      subject: "Re: A role",
      body: "Edited text",
      ref: ref(2),
      contentHash: "h2",
      now: later(4),
    });
    expect(edited).toMatchObject({ status: "edited", body: "Edited text", mailbox: ref(2) });

    const b = await claim(role(1), "on_demand");
    await markDraftFailed(conn.db, ws, b, {
      kind: "mailbox",
      reason: "Couldn't reach the mail server",
      now: later(5),
    });
    const c = await claim(role(2));
    await saveDraftText(conn.db, ws, c, { ...text, cvId: null, now: later(6) });
    await markDraftSaved(conn.db, ws, c, { ref: ref(3), contentHash: "h3", now: later(6) });
    expect(await markDraftDiscarded(conn.db, ws, c, later(7))).toMatchObject({
      status: "discarded",
      mailbox: null,
    });
    const saving = await claim(role(0, 1));

    const listed = await listDrafts(conn.db, ws);
    expect(listed.map((d) => [d.id, d.status])).toEqual([
      [c, "discarded"],
      [b, "failed"],
      [a, "edited"],
      [saving, "saving"],
    ]);
    expect(listed.find((d) => d.id === b)).toMatchObject({
      failureKind: "mailbox",
      failureReason: "Couldn't reach the mail server",
      auto: false,
    });
    expect(await listDrafts(conn.db, ws, { messageId: ids[0] })).toHaveLength(2);
    expect(listed.map(publicDraft)[2]).toEqual({
      id: a,
      messageId: ids[0],
      position: 0,
      status: "edited",
      failureKind: null,
      failureReason: null,
      subject: "Re: A role",
      body: "Edited text",
      language: "en",
      cvId: null,
      auto: true,
      updatedAt: later(4).toISOString(),
    });
  });

  it("holds only the reply text: no column for the original or its quote", async () => {
    const a = await claim(role(0));
    await saveDraftText(conn.db, ws, a, { ...text, cvId: null, now: later(1) });
    const [row] = await conn.db.select().from(drafts);
    expect(Object.keys(row ?? {}).sort()).toEqual(
      [
        "id",
        "workspaceId",
        "messageId",
        "position",
        "status",
        "failureKind",
        "failureReason",
        "attempts",
        "claimedAt",
        "origin",
        "subject",
        "body",
        "language",
        "cvId",
        "mailboxFolder",
        "uid",
        "uidValidity",
        "draftMessageId",
        "contentHash",
        "createdBy",
        "createdAt",
        "updatedAt",
      ].sort(),
    );
    expect(row?.body).toBe(text.body);
  });

  it("changes only in the states each step allows", async () => {
    const a = await claim(role(0));
    // Not in the mailbox yet: nothing to edit or discard.
    const edit = { subject: "s", body: "b", ref: ref(1), contentHash: "h", now: later(1) };
    expect(await saveDraftEdit(conn.db, ws, a, edit)).toBeNull();
    expect(await markDraftDiscarded(conn.db, ws, a, later(1))).toBeNull();
    await markDraftFailed(conn.db, ws, a, {
      kind: "content",
      reason: "placeholder",
      now: later(2),
    });
    expect(await saveDraftText(conn.db, ws, a, { ...text, cvId: null, now: later(3) })).toBe(false);
    // A failed draft can be discarded; it never was in the mailbox.
    expect(await markDraftDiscarded(conn.db, ws, a, later(4))).toMatchObject({
      status: "discarded",
    });
    expect(await liveDraftFor(conn.db, ws, role(0))).toBeNull();
  });

  it("rejects two live drafts for one role, and allows a new one after a discard", async () => {
    const a = await claim(role(0));
    await saveDraftText(conn.db, ws, a, { ...text, cvId: null, now: later(1) });
    await markDraftSaved(conn.db, ws, a, { ref: ref(1), contentHash: "h", now: later(1) });
    expect(
      await claimDraft(conn.db, ws, role(0), { origin: "on_demand", now: later(2) }),
    ).toBeNull();
    const second = conn.db.insert(drafts).values({
      workspaceId: ws,
      ...role(0),
      status: "failed",
      origin: "auto",
      createdAt: t0,
      updatedAt: t0,
    });
    await expect(second).rejects.toThrow();
    await markDraftDiscarded(conn.db, ws, a, later(3));
    const b = await claim(role(0), "on_demand");
    expect((await liveDraftFor(conn.db, ws, role(0)))?.id).toBe(b);
  });

  it("is read only within its workspace", async () => {
    const a = await claim(role(0));
    const other = await account("tom@inbox.example");
    expect(await getDraft(conn.db, other, a)).toBeNull();
    expect(await listDrafts(conn.db, other)).toEqual([]);
    expect(await saveDraftText(conn.db, other, a, { ...text, cvId: null, now: later(1) })).toBe(
      false,
    );
    expect((await getDraft(conn.db, ws, a))?.status).toBe("saving");
  });
});
