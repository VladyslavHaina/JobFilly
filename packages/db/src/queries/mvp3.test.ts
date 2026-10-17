import type { Envelope, JobFacts } from "@jobfilly/schema";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DatabaseConnection, queryRows } from "../client";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import { recordActivity } from "./activity";
import { loadMessageInputs, saveEvaluation } from "./evaluations";
import { getInboxMessage, getMessageMailbox, getMessageRef, listInbox } from "./inbox";
import { createMailbox } from "./mailboxes";
import { newestStoredUid, reindexMessages, saveAnalysis, saveEnvelopes } from "./messages";
import { createConfirmedProfile, listProfiles } from "./profiles";
import { getMembership, listMembers, listWorkspacesForUser } from "./workspaces";

// What the MVP 3 foundation adds to packages/db: messages filed under their mailbox (F3.1), the
// inbox's mailbox filter and job-mail-only list (F6.2), the role's profile in the detail (F1.3),
// a member's scope (F6.1), a profile's on/off (F1.2) and the activity log's records (F9).

let conn: DatabaseConnection;
let ws: string;
let userId: string;
let home: string;
let work: string;

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
  userId = r.user.id;
  const box = (address: string) => ({
    address,
    host: "imap.inbox.example",
    port: 993,
    tlsMode: "tls" as const,
    username: address,
    secretCiphertext: "v1.sealed",
    sentFolderPath: "Sent",
  });
  const a = await createMailbox(conn.db, ws, box("maria@inbox.example"));
  const b = await createMailbox(conn.db, ws, box("maria.home@post.example"));
  if (!a.ok || !b.ok) throw new Error("expected ok");
  work = a.mailboxId;
  home = b.mailboxId;
});
afterEach(() => conn.close());

function envelope(n: number, overrides: Partial<Envelope> = {}): Envelope {
  return {
    messageId: `<m${n}@agency.example>`,
    folder: "inbox",
    folderPath: "INBOX",
    uidValidity: 7,
    uid: n,
    date: new Date(Date.UTC(2026, 9, 1, 10, n)).toISOString(),
    from: { address: `r${n}@agency.example`, name: null },
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
    ...overrides,
  };
}

const role: JobFacts = {
  title: "Backend Engineer",
  company: null,
  agency: null,
  places: [{ country: "DE", city: "Munich" }],
  workMode: "onsite",
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

const likely = (e: Envelope) => ({ envelope: e, verdict: "likely_job" as const, reason: null });

describe("messages filed under their mailbox (F3.1)", () => {
  it("keeps a Message-ID with the first mailbox that stored it", async () => {
    await saveEnvelopes(conn.db, ws, [likely(envelope(1))], { mailboxId: work });
    // The same message in the second mailbox, under another UID: it stays the first one's.
    await saveEnvelopes(conn.db, ws, [likely(envelope(1, { uid: 90, uidValidity: 8 }))], {
      mailboxId: home,
    });
    expect(await getMessageRef(conn.db, ws, "<m1@agency.example>")).toEqual({
      folderPath: "INBOX",
      uidValidity: 7,
      uid: 1,
    });
    expect(await getMessageMailbox(conn.db, ws, "<m1@agency.example>")).toBe(work);
    expect(await getMessageMailbox(conn.db, ws, "<unknown@agency.example>")).toBeUndefined();
    const [input] = await loadMessageInputs(conn.db, ws, ["<m1@agency.example>"]);
    expect(input?.mailboxId).toBe(work);
  });

  it("files a message stored without a mailbox under the first mailbox that sees it", async () => {
    await saveEnvelopes(conn.db, ws, [likely(envelope(2))]);
    expect(await getMessageMailbox(conn.db, ws, "<m2@agency.example>")).toBeNull();
    await saveEnvelopes(conn.db, ws, [likely(envelope(2, { uid: 5 }))], { mailboxId: home });
    expect((await getMessageRef(conn.db, ws, "<m2@agency.example>"))?.uid).toBe(5);
    expect(await getMessageMailbox(conn.db, ws, "<m2@agency.example>")).toBe(home);
  });

  it("re-indexes and finds a folder's end per mailbox", async () => {
    await saveEnvelopes(conn.db, ws, [likely(envelope(3))], { mailboxId: work });
    await saveEnvelopes(conn.db, ws, [likely(envelope(4, { uid: 40 }))], { mailboxId: home });
    expect(await newestStoredUid(conn.db, ws, "INBOX", { mailboxId: work })).toEqual({
      uidValidity: 7,
      uid: 3,
    });
    expect(await newestStoredUid(conn.db, ws, "INBOX", { mailboxId: home })).toEqual({
      uidValidity: 7,
      uid: 40,
    });
    // The home mailbox's rebuilt folder doesn't move the work mailbox's message.
    const found = await reindexMessages(conn.db, ws, [envelope(3, { uid: 300, uidValidity: 9 })], {
      mailboxId: home,
    });
    expect(found.size).toBe(0);
    expect((await getMessageRef(conn.db, ws, "<m3@agency.example>"))?.uid).toBe(3);
  });
});

describe("the inbox's mailbox and scope (F3.1, F6.2)", () => {
  beforeEach(async () => {
    await saveEnvelopes(conn.db, ws, [likely(envelope(1))], { mailboxId: work });
    await saveEnvelopes(conn.db, ws, [likely(envelope(2))], { mailboxId: home });
    await saveEnvelopes(conn.db, ws, [likely(envelope(3))], { mailboxId: home });
    await saveAnalysis(conn.db, ws, {
      messageId: "<m1@agency.example>",
      scanId: null,
      category: "recruiter_outreach",
      roles: [role],
    });
    await saveAnalysis(conn.db, ws, {
      messageId: "<m2@agency.example>",
      scanId: null,
      category: "interview",
      roles: [],
    });
    await saveAnalysis(conn.db, ws, {
      messageId: "<m3@agency.example>",
      scanId: null,
      category: "not_job",
      roles: [],
    });
  });

  it("names each message's mailbox and filters by it", async () => {
    const all = await listInbox(conn.db, ws);
    expect(all.items.map((m) => [m.id, m.mailbox?.address])).toEqual([
      ["<m2@agency.example>", "maria.home@post.example"],
      ["<m1@agency.example>", "maria@inbox.example"],
    ]);
    const homeOnly = await listInbox(conn.db, ws, { mailboxId: home, showNonJob: true });
    expect(homeOnly.items.map((m) => m.id)).toEqual(["<m3@agency.example>", "<m2@agency.example>"]);
    expect(homeOnly.nonJobCount).toBe(1);
  });

  it("lists job mail alone, with no count of the rest, for a pipeline-only member", async () => {
    const list = await listInbox(conn.db, ws, { jobMailOnly: true, showNonJob: true });
    expect(list.items.map((m) => m.id)).toEqual(["<m2@agency.example>", "<m1@agency.example>"]);
    expect(list.nonJobCount).toBe(0);
    const notJob = await listInbox(conn.db, ws, { jobMailOnly: true, category: "not_job" });
    expect(notJob.items).toEqual([]);
  });

  it("shows the profile a role was evaluated with", async () => {
    const created = await createConfirmedProfile(conn.db, ws, {
      name: "Germany permanent",
      entries: [],
      createdBy: userId,
      at: new Date(),
    });
    if (!created.ok) throw new Error("expected ok");
    await saveEvaluation(
      conn.db,
      ws,
      "<m1@agency.example>",
      {
        position: 0,
        match: null,
        hidden: null,
        ruleEffects: [],
        cvChoice: { cvId: null, reason: "No CV yet", source: "auto" },
      },
      new Date(),
    );
    expect((await getInboxMessage(conn.db, ws, "<m1@agency.example>"))?.roles[0]?.profile).toBe(
      null,
    );
    await conn.db.execute(
      sql`update role_evaluations set profile_id = ${created.profile.id},
          profile_reason = 'Munich role', profile_source = 'auto' where workspace_id = ${ws}`,
    );
    expect((await getInboxMessage(conn.db, ws, "<m1@agency.example>"))?.roles[0]?.profile).toEqual({
      profileId: created.profile.id,
      name: "Germany permanent",
      reason: "Munich role",
      source: "auto",
    });
  });
});

describe("members' scope and profiles' on/off (F6.1, F1.2)", () => {
  it("reads every member as seeing everything until an admin chooses otherwise", async () => {
    expect((await getMembership(conn.db, ws, userId))?.scope).toBe("everything");
    expect((await listWorkspacesForUser(conn.db, userId))[0]?.scope).toBe("everything");
    await conn.db.execute(sql`update memberships set scope = 'pipeline' where user_id = ${userId}`);
    expect((await getMembership(conn.db, ws, userId))?.scope).toBe("pipeline");
    expect((await listMembers(conn.db, ws))[0]?.scope).toBe("pipeline");
    await expect(
      conn.db.execute(sql`update memberships set scope = 'mail' where user_id = ${userId}`),
    ).rejects.toThrow();
  });

  it("makes a profile on", async () => {
    await createConfirmedProfile(conn.db, ws, {
      name: "My job search",
      entries: [],
      createdBy: userId,
      at: new Date(),
    });
    expect((await listProfiles(conn.db, ws))[0]?.enabled).toBe(true);
  });
});

describe("the activity log (F9)", () => {
  it("records by id, and keeps the action once the actor's account is gone", async () => {
    const at = new Date("2026-10-16T10:00:00.000Z");
    await recordActivity(
      conn.db,
      ws,
      {
        kind: "draft.saved",
        actor: { kind: "system" },
        targetUserId: null,
        refs: { messageId: "<m1@agency.example>", position: 0 },
      },
      at,
    );
    await recordActivity(
      conn.db,
      ws,
      { kind: "export.downloaded", actor: { kind: "user", userId }, targetUserId: null, refs: {} },
      at,
    );
    const rows = () =>
      queryRows<{ kind: string; actor_kind: string; actor_id: string | null }>(
        conn.db,
        sql`select kind, actor_kind, actor_id from activity_log where workspace_id = ${ws}
            order by kind`,
      );
    expect(await rows()).toEqual([
      { kind: "draft.saved", actor_kind: "system", actor_id: null },
      { kind: "export.downloaded", actor_kind: "user", actor_id: userId },
    ]);
    // The workspace passes to another owner, then the account goes: the action stays.
    const [other] = await queryRows<{ id: string }>(
      conn.db,
      sql`insert into users (name, email, password_hash) values ('O', 'o@x.example', 'h') returning id`,
    );
    await conn.db.execute(sql`update workspaces set owner_id = ${other?.id} where id = ${ws}`);
    await conn.db.execute(sql`delete from users where id = ${userId}`);
    expect((await rows())[1]).toEqual({
      kind: "export.downloaded",
      actor_kind: "user",
      actor_id: null,
    });
  });
});
