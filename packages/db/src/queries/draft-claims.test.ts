import type { Envelope } from "@jobfilly/schema";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { decisionMessages, decisions, drafts } from "../tables";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import {
  claimDraft,
  DRAFT_MAX_ATTEMPTS,
  DRAFT_SAVING_TIMEOUT_MS,
  draftHistory,
  getDraftClaim,
  listDraftsToRetry,
  markDraftFailed,
  reclaimDraft,
  releaseDraftClaim,
  roleKey,
} from "./draft-claims";
import { saveAnalysis, saveEnvelopes } from "./messages";

let conn: DatabaseConnection;
let ws: string;
const t0 = new Date("2026-10-01T10:00:00Z");
const later = (ms: number) => new Date(t0.getTime() + ms);
const role = { messageId: "<d1@agency.example>", position: 0 };
const other = { messageId: "<d1@agency.example>", position: 1 };

beforeEach(async () => {
  conn = await openTestDatabase();
  const r = await registerAccount(conn.db, {
    name: "Maria",
    email: "maria@inbox.example",
    passwordHash: "h",
    workspaceName: "w",
  });
  if (!r.ok) throw new Error("expected ok");
  ws = r.workspaceId;
  const envelope: Envelope = {
    messageId: role.messageId,
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
    subject: "s",
    listId: null,
    listUnsubscribe: null,
    precedence: null,
    autoSubmitted: null,
    snippet: "",
  };
  await saveEnvelopes(conn.db, ws, [{ envelope, verdict: "likely_job", reason: null }]);
  await saveAnalysis(conn.db, ws, {
    messageId: role.messageId,
    scanId: null,
    category: "recruiter_outreach",
    roles: [],
  });
});
afterEach(() => conn.close());

const history = async (r = role) => (await draftHistory(conn.db, ws, [r])).get(roleKey(r));

describe("claiming a role's draft", () => {
  it("lets exactly one claim win, and only once while the draft is live", async () => {
    const results = await Promise.all([
      claimDraft(conn.db, ws, role, { origin: "auto", now: t0 }),
      claimDraft(conn.db, ws, role, { origin: "decision", now: t0 }),
      claimDraft(conn.db, ws, role, { origin: "auto", now: t0 }),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await claimDraft(conn.db, ws, role, { origin: "auto", now: later(1) })).toBeNull();
    // Another role of the same message has its own draft.
    expect(await claimDraft(conn.db, ws, other, { origin: "auto", now: t0 })).not.toBeNull();
  });

  it("refuses a second live draft for a role in the database itself", async () => {
    await claimDraft(conn.db, ws, role, { origin: "auto", now: t0 });
    const insert = conn.db.insert(drafts).values({
      workspaceId: ws,
      ...role,
      status: "in_mailbox",
      origin: "auto",
      createdAt: t0,
      updatedAt: t0,
    });
    await expect(insert).rejects.toThrow();
    // A discarded one leaves room for a new live one.
    await conn.db.update(drafts).set({ status: "discarded" });
    expect(await claimDraft(conn.db, ws, role, { origin: "on_demand", now: t0 })).not.toBeNull();
  });

  it("releases a claim whose answer raised questions, so the role was never drafted", async () => {
    const claim = await claimDraft(conn.db, ws, role, { origin: "auto", now: t0 });
    expect(await history()).toEqual({ hadDraft: true, dismissed: false });
    expect(await releaseDraftClaim(conn.db, ws, claim?.id ?? "")).toBe(true);
    expect(await history()).toEqual({ hadDraft: false, dismissed: false });
    expect(await claimDraft(conn.db, ws, role, { origin: "decision", now: t0 })).not.toBeNull();
  });

  it("only releases a claim still saving", async () => {
    const claim = await claimDraft(conn.db, ws, role, { origin: "auto", now: t0 });
    await markDraftFailed(conn.db, ws, claim?.id ?? "", {
      kind: "content",
      reason: "placeholder",
      now: t0,
    });
    expect(await releaseDraftClaim(conn.db, ws, claim?.id ?? "")).toBe(false);
  });
});

describe("a role's draft history", () => {
  it("counts a discarded or failed draft as drafted", async () => {
    const claim = await claimDraft(conn.db, ws, role, { origin: "auto", now: t0 });
    await conn.db.update(drafts).set({ status: "discarded" }).where(sql`id = ${claim?.id}`);
    expect(await history()).toEqual({ hadDraft: true, dismissed: false });
    expect(await history(other)).toEqual({ hadDraft: false, dismissed: false });
  });

  it("knows a role dismissed with Don't ask for this message", async () => {
    const [decision] = await conn.db
      .insert(decisions)
      .values({
        workspaceId: ws,
        groupKey: "extra.relocate",
        profileKey: "extra.relocate",
        question: "Would you relocate?",
        choices: [],
        createdAt: t0,
      })
      .returning();
    await conn.db.insert(decisionMessages).values({
      decisionId: decision?.id ?? "",
      workspaceId: ws,
      ...role,
      state: "dismissed",
      source: "draft",
      createdAt: t0,
      updatedAt: t0,
    });
    expect(await history()).toEqual({ hadDraft: false, dismissed: true });
    expect(await history(other)).toEqual({ hadDraft: false, dismissed: false });
  });
});

describe("failures and retries", () => {
  it("reuses a failed row for Draft a reply, never for the automatic origins", async () => {
    const claim = await claimDraft(conn.db, ws, role, { origin: "auto", now: t0 });
    await markDraftFailed(conn.db, ws, claim?.id ?? "", {
      kind: "content",
      reason: "placeholder",
      now: t0,
    });
    expect(await claimDraft(conn.db, ws, role, { origin: "auto", now: later(1) })).toBeNull();
    expect(await claimDraft(conn.db, ws, role, { origin: "decision", now: later(1) })).toBeNull();
    const reused = await claimDraft(conn.db, ws, role, { origin: "on_demand", now: later(2) });
    expect(reused?.id).toBe(claim?.id);
    expect(await getDraftClaim(conn.db, ws, claim?.id ?? "")).toEqual({
      status: "saving",
      failureKind: null,
      attempts: 2,
      origin: "on_demand",
    });
  });

  it("retries mailbox failures up to 5 attempts, never content failures", async () => {
    const a = await claimDraft(conn.db, ws, role, { origin: "auto", now: t0 });
    const b = await claimDraft(conn.db, ws, other, { origin: "auto", now: t0 });
    await markDraftFailed(conn.db, ws, a?.id ?? "", { kind: "mailbox", reason: "down", now: t0 });
    await markDraftFailed(conn.db, ws, b?.id ?? "", { kind: "content", reason: "[Name]", now: t0 });
    expect((await listDraftsToRetry(conn.db, ws, later(1))).map((d) => d.id)).toEqual([a?.id]);

    for (let attempt = 2; attempt <= DRAFT_MAX_ATTEMPTS; attempt++) {
      expect(await reclaimDraft(conn.db, ws, a?.id ?? "", later(attempt))).toBe(true);
      // Single-flight: the claim is taken.
      expect(await reclaimDraft(conn.db, ws, a?.id ?? "", later(attempt))).toBe(false);
      expect((await getDraftClaim(conn.db, ws, a?.id ?? ""))?.attempts).toBe(attempt);
      await markDraftFailed(conn.db, ws, a?.id ?? "", { kind: "mailbox", reason: "down", now: t0 });
    }
    expect(await listDraftsToRetry(conn.db, ws, later(99))).toEqual([]);
    expect(await reclaimDraft(conn.db, ws, a?.id ?? "", later(99))).toBe(false);
  });

  it("retries a draft.v1 failure (kind ai) under the same 5-attempt cap as mailbox failures", async () => {
    const a = await claimDraft(conn.db, ws, role, { origin: "auto", now: t0 });
    const reason = "The AI provider can't be reached";
    await markDraftFailed(conn.db, ws, a?.id ?? "", { kind: "ai", reason, now: t0 });
    expect(await listDraftsToRetry(conn.db, ws, later(1))).toEqual([
      { id: a?.id, ...role, attempts: 1, status: "failed" },
    ]);
    // Mailbox and AI failures share the one cap.
    for (let attempt = 2; attempt <= DRAFT_MAX_ATTEMPTS; attempt++) {
      expect(await reclaimDraft(conn.db, ws, a?.id ?? "", later(attempt))).toBe(true);
      const kind = attempt % 2 === 0 ? "mailbox" : "ai";
      await markDraftFailed(conn.db, ws, a?.id ?? "", { kind, reason, now: later(attempt) });
    }
    expect(await listDraftsToRetry(conn.db, ws, later(99))).toEqual([]);
    const [row] = await conn.db.select().from(drafts);
    expect(row).toMatchObject({ status: "failed", failureKind: "ai", failureReason: reason });
    // The role had a draft, so no automatic one comes; Draft a reply takes the row back.
    expect((await draftHistory(conn.db, ws, [role])).get(roleKey(role))?.hadDraft).toBe(true);
    expect(await claimDraft(conn.db, ws, role, { origin: "auto", now: later(100) })).toBeNull();
    expect(
      (await claimDraft(conn.db, ws, role, { origin: "on_demand", now: later(100) }))?.id,
    ).toBe(a?.id);
  });

  it("retries a saving claim whose job died, after 5 minutes", async () => {
    const a = await claimDraft(conn.db, ws, role, { origin: "auto", now: t0 });
    expect(await listDraftsToRetry(conn.db, ws, later(DRAFT_SAVING_TIMEOUT_MS - 1))).toEqual([]);
    expect(await reclaimDraft(conn.db, ws, a?.id ?? "", later(DRAFT_SAVING_TIMEOUT_MS - 1))).toBe(
      false,
    );
    const due = later(DRAFT_SAVING_TIMEOUT_MS + 1);
    expect(await listDraftsToRetry(conn.db, ws, due)).toEqual([
      { id: a?.id, ...role, attempts: 1, status: "saving" },
    ]);
    expect(await reclaimDraft(conn.db, ws, a?.id ?? "", due)).toBe(true);
    expect(await listDraftsToRetry(conn.db, ws, due)).toEqual([]);
  });
});
