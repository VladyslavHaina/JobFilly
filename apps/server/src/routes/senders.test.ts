import {
  createConfirmedProfile,
  findSenderMark,
  getEvaluations,
  getSenderChecks,
  saveEnvelopes,
  saveEvaluation,
  saveSenderCheck,
} from "@jobfilly/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type App, createApp } from "../app";
import { reevaluateWorkspace, requestRun } from "../pipeline/reevaluate";
import { senderStage } from "../pipeline/sender";
import { requestReevaluation } from "../profile/changes";
import {
  createFakeMailbox,
  createTestDeps,
  type FakeMailbox,
  type RecordingStages,
  recordingStages,
  roleFacts,
  type SeededUser,
  seedJobMail,
  seedMailbox,
  seedUser,
  seedWorkspace,
  signedIn,
  type TestClient,
  type TestDeps,
} from "../testing";

// The mark route (F5.4): editors mark a sender trusted or blocked, viewers can't (403), outsiders
// get 404. A mark asks for a re-evaluation of that sender's mail (a sender scope, S6), and it
// lasts across re-syncs and re-evaluations, named in every check of that sender.

const NOW = new Date("2026-10-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const RECRUITER = "globex.talent.partner@gmail.com";
const TEXT =
  "Hi Maria,\n\nI am a talent partner for Globex Corporation, one of the largest companies in the world. We would love to talk to you about a senior backend role. Are you available for a call?\n\nBest regards,\nJordan";

let deps: TestDeps;
let app: App;
let mailbox: FakeMailbox;
let maria: SeededUser;
let tom: SeededUser;
let ws: string;
let editor: TestClient;
let viewer: TestClient;
let outsider: TestClient;

beforeEach(async () => {
  deps = await createTestDeps({ now: NOW });
  mailbox = createFakeMailbox();
  deps.mail = mailbox.port;
  app = createApp(deps);
  maria = await seedUser(deps, { name: "Maria Santos" });
  tom = await seedUser(deps, { name: "Tom Okafor" });
  const vera = await seedUser(deps, { name: "Vera Viewer" });
  ws = (await seedWorkspace(deps, { owner: maria, members: [{ user: vera, role: "viewer" }] }))
    .workspaceId;
  await seedMailbox(deps, ws, {
    address: "maria.santos@inbox.example",
    conn: { host: "imap", port: 3143, tlsMode: "tls", username: "maria", password: "E2E-SECRET-p" },
    sentFolderPath: "Sent",
  });
  editor = await signedIn(app, deps, maria);
  viewer = await signedIn(app, deps, vera);
  outsider = await signedIn(app, deps, tom);
});
afterEach(() => deps.close());

const marks = () => `/api/workspaces/${ws}/senders/marks`;

const evaluated = (position: number) => ({
  position,
  match: null,
  hidden: null,
  ruleEffects: [],
  cvChoice: { cvId: null, reason: "No CV uploaded yet", source: "auto" as const },
});
const caution = { verdict: "caution" as const, complete: true, reasons: [], mark: null };

/** A job message with its sender check and evaluation both current. */
async function checkedMail(messageId: string, from: string) {
  await seedJobMail(deps, ws, mailbox, { messageId, receivedAt: NOW, from, text: TEXT });
  await saveSenderCheck(deps.db, ws, messageId, caution, NOW);
  await saveEvaluation(deps.db, ws, messageId, evaluated(0), NOW);
}

const staleness = async (ids: string[]) => {
  const checks = await getSenderChecks(deps.db, ws, ids);
  const evaluations = await getEvaluations(deps.db, ws, ids);
  return ids.map((id) => [
    id,
    checks.find((c) => c.messageId === id)?.stale,
    evaluations.find((e) => e.messageId === id)?.stale,
  ]);
};

const reevaluationWaiting = async () => !(await requestRun(deps, ws, "probe")).enqueued;

describe("PUT /senders/marks", () => {
  it("lets an editor mark a sender; a viewer gets 403 and a non-member 404", async () => {
    const body = { scope: "address", value: "Globex.Talent.Partner@Gmail.com", mark: "trusted" };
    expect((await viewer.put(marks(), body)).status).toBe(403);
    expect((await outsider.put(marks(), body)).status).toBe(404);
    expect(await findSenderMark(deps.db, ws, RECRUITER)).toBeNull();

    const res = await editor.put(marks(), body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scope: "address", value: RECRUITER, mark: "trusted" });
    expect(await findSenderMark(deps.db, ws, RECRUITER)).toEqual({
      mark: "trusted",
      scope: "address",
      value: RECRUITER,
    });

    expect((await editor.put(marks(), { ...body, mark: null })).status).toBe(200);
    expect(await findSenderMark(deps.db, ws, RECRUITER)).toBeNull();
  });

  it("answers 404 for a clear that removes nothing, never a quiet success", async () => {
    await editor.put(marks(), { scope: "domain", value: "tidewater.example", mark: "blocked" });
    const grace = "grace@tidewater.example";
    const res = await editor.put(marks(), { scope: "address", value: grace, mark: null });
    expect(res.status).toBe(404);
    expect(await findSenderMark(deps.db, ws, grace)).toMatchObject({ mark: "blocked" });

    const cleared = { scope: "domain", value: "tidewater.example", mark: null };
    expect((await editor.put(marks(), cleared)).status).toBe(200);
    expect(await findSenderMark(deps.db, ws, grace)).toBeNull();
    expect((await editor.put(marks(), cleared)).status).toBe(404);
  });

  it("refuses an address without a domain, or a domain given as an address", async () => {
    expect((await editor.put(marks(), {})).status).toBe(400);
    expect(
      (await editor.put(marks(), { scope: "address", value: "nobody", mark: "blocked" })).status,
    ).toBe(400);
    expect(
      (await editor.put(marks(), { scope: "domain", value: "a@b.example", mark: "blocked" }))
        .status,
    ).toBe(400);
    expect(
      (await editor.put(marks(), { scope: "domain", value: "b.example", mark: "blocked" })).status,
    ).toBe(200);
  });

  it("re-does the checks and evaluations of that sender's mail only (S6)", async () => {
    await checkedMail("<a1@gmail.com>", RECRUITER);
    await checkedMail("<a2@gmail.com>", RECRUITER);
    await checkedMail("<b1@gmail.com>", "someone.else@gmail.com");
    await checkedMail("<c1@tidewater.example>", "grace@tidewater.example");
    const ids = ["<a1@gmail.com>", "<a2@gmail.com>", "<b1@gmail.com>", "<c1@tidewater.example>"];

    await editor.put(marks(), { scope: "address", value: RECRUITER, mark: "trusted" });
    expect(await staleness(ids)).toEqual([
      ["<a1@gmail.com>", true, true],
      ["<a2@gmail.com>", true, true],
      ["<b1@gmail.com>", false, false],
      ["<c1@tidewater.example>", false, false],
    ]);
    expect(await reevaluationWaiting()).toBe(true);

    await editor.put(marks(), { scope: "domain", value: "tidewater.example", mark: "blocked" });
    expect((await staleness(ids)).at(3)).toEqual(["<c1@tidewater.example>", true, true]);
    expect((await staleness(ids)).at(2)).toEqual(["<b1@gmail.com>", false, false]);
  });
});

describe("GET /senders/messages/:messageId/mark", () => {
  // A Message-ID with a '/' in it, URL-encoded as one path segment as in the messages routes.
  const GRACE_MAIL = "<offer/1@tidewater.example>";
  const GRACE = "grace@tidewater.example";
  const markOf = (workspaceId: string, messageId: string) =>
    `/api/workspaces/${workspaceId}/senders/messages/${encodeURIComponent(messageId)}/mark`;
  const applied = async (client: TestClient, messageId: string, workspaceId = ws) => {
    const res = await client.get(markOf(workspaceId, messageId));
    return { status: res.status, body: res.status === 200 ? await res.json() : null };
  };
  beforeEach(async () => {
    await seedJobMail(deps, ws, mailbox, {
      messageId: GRACE_MAIL,
      receivedAt: NOW,
      from: "Grace@Tidewater.example",
      text: TEXT,
    });
  });

  it("tells the mark that applies to the message's sender: its own, else its domain's", async () => {
    expect(await applied(editor, GRACE_MAIL)).toEqual({ status: 200, body: { applied: null } });

    await editor.put(marks(), { scope: "domain", value: "tidewater.example", mark: "blocked" });
    const domain = { scope: "domain", value: "tidewater.example", mark: "blocked" };
    expect(await applied(editor, GRACE_MAIL)).toEqual({ status: 200, body: { applied: domain } });
    // A viewer sees the mark too; only editors change it.
    expect(await applied(viewer, GRACE_MAIL)).toEqual({ status: 200, body: { applied: domain } });

    await editor.put(marks(), { scope: "address", value: GRACE, mark: "trusted" });
    expect((await applied(editor, GRACE_MAIL)).body).toEqual({
      applied: { scope: "address", value: GRACE, mark: "trusted" },
    });
  });

  it("never has the sender's address in its URL, which proxies log", () => {
    expect(markOf(ws, GRACE_MAIL)).not.toMatch(/grace/i);
  });

  it("is for members only, and a message outside the workspace is a 404", async () => {
    await editor.put(marks(), { scope: "domain", value: "tidewater.example", mark: "blocked" });
    expect((await applied(outsider, GRACE_MAIL)).status).toBe(404);
    expect((await applied(editor, "<unknown@tidewater.example>")).status).toBe(404);

    // Tom's own workspace doesn't have Maria's message, so its mark isn't Tom's to read.
    const tomWs = (await seedWorkspace(deps, { owner: tom })).workspaceId;
    expect((await applied(outsider, GRACE_MAIL, tomWs)).status).toBe(404);
  });
});

describe("a mark across syncs and re-evaluations (F5.4)", () => {
  let stages: RecordingStages;
  beforeEach(async () => {
    await createConfirmedProfile(deps.db, ws, {
      name: "My job search",
      entries: [],
      createdBy: maria.id,
      at: NOW,
    });
    // The real sender stage; the match and reply stages only record.
    stages = recordingStages();
    stages.sender = senderStage;
  });

  const run = () => reevaluateWorkspace(deps, ws, { stages });
  const check = async (messageId: string) => (await getSenderChecks(deps.db, ws, [messageId]))[0];

  it("is applied after the mark, kept through a re-sync and a re-evaluation, and on new mail", async () => {
    const envelope = await seedJobMail(deps, ws, mailbox, {
      messageId: "<globex-1@gmail.com>",
      receivedAt: new Date(NOW.getTime() - DAY),
      from: RECRUITER,
      roles: [roleFacts({ company: "Globex Corporation" })],
      text: TEXT,
    });
    await run();
    expect(await check("<globex-1@gmail.com>")).toMatchObject({ verdict: "caution", mark: null });

    await editor.put(marks(), { scope: "address", value: RECRUITER, mark: "trusted" });
    await run();
    const trusted = await check("<globex-1@gmail.com>");
    expect(trusted).toMatchObject({ verdict: "looks_fine", mark: "trusted", stale: false });
    expect(trusted?.reasons[0]?.reason).toContain(`the address ${RECRUITER} is marked trusted`);

    // The next sync sees the message again, and a profile change re-evaluates everything.
    await saveEnvelopes(deps.db, ws, [{ envelope, verdict: "likely_job", reason: null }]);
    await requestReevaluation(deps, ws, { all: true }, "profile.you");
    await run();
    expect(await check("<globex-1@gmail.com>")).toMatchObject({
      verdict: "looks_fine",
      mark: "trusted",
    });

    // New mail from the same sender is trusted from the start.
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<globex-2@gmail.com>",
      receivedAt: NOW,
      from: RECRUITER,
      roles: [roleFacts({ company: "Globex Corporation" })],
      text: TEXT,
    });
    await run();
    expect(await check("<globex-2@gmail.com>")).toMatchObject({ mark: "trusted" });

    // Clearing the mark checks the sender again on its own signals.
    await editor.put(marks(), { scope: "address", value: RECRUITER, mark: null });
    await run();
    expect(await check("<globex-1@gmail.com>")).toMatchObject({ verdict: "caution", mark: null });
  });

  it("a blocked sender's high-risk check reaches the reply stage", async () => {
    await editor.put(marks(), { scope: "domain", value: "gmail.com", mark: "blocked" });
    await seedJobMail(deps, ws, mailbox, {
      messageId: "<globex-1@gmail.com>",
      receivedAt: NOW,
      from: RECRUITER,
      text: TEXT,
    });
    await run();
    expect(stages.replies.at(-1)?.sender).toMatchObject({ verdict: "high_risk", mark: "blocked" });
  });
});
