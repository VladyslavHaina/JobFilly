import { createAiClient } from "@jobfilly/ai";
import { replyEligibility } from "@jobfilly/core";
import {
  claimDraft,
  createConfirmedProfile,
  getHistory,
  listRoleStates,
  listRules,
  listThreadMessages,
  markDraftFailed,
} from "@jobfilly/db";
import {
  type AssistantOutput,
  AssistantStateSchema,
  AssistantTurnSchema,
  type Change,
  MessageListSchema,
  PIPELINE_REEVALUATE_JOB,
  PipelineReevaluatePayloadSchema,
  type Profile,
  type ProfileEntry,
  ProfileHistoryListSchema,
  ProposalSchema,
  type RuleDraft,
  type TimeZoneRange,
} from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { defineJob } from "../jobs/queue";
import { jobRegistry } from "../jobs/registry";
import { matchStage } from "../pipeline/match";
import { reevaluateWorkspace, requestRun } from "../pipeline/reevaluate";
import { applyAndReevaluate } from "../profile/changes";
import {
  createFakeAi,
  createFakeMailbox,
  createTestDeps,
  type FakeAiClient,
  type FakeMailbox,
  type RecordingStages,
  recordingStages,
  roleFacts,
  type SeededWorkspace,
  seedAiSettings,
  seedJobMail,
  seedMailbox,
  seedUser,
  seedWorkspace,
  signedIn,
  TEST_AI_MODELS,
  type TestClient,
  type TestDeps,
} from "../testing";

// The assistant over HTTP (F8) with the fake AI port, keyed by the user's message and turn: a
// sent message is stored with its reply; an unclear request gets a question with choices; a
// preference request gets a proposal card with its impact preview (the real rules engine and
// match, no model call); the card is edited before Apply; Apply by an editor saves the change
// (source assistant) and the inbox follows within a minute; Discard changes nothing; drafts in
// the mailbox are never touched; anything outside rules and profile entries is refused; and no
// word of the conversation reaches the log.

const NOW = new Date("2026-10-15T12:00:00Z");
const MINUTE = 60_000;
const ASIA_REQUEST = "Lately I don't want jobs in Asian time zones anymore, ignore them";

let deps: TestDeps;
let mailbox: FakeMailbox;
let ai: FakeAiClient;
let stages: RecordingStages;
let ws: SeededWorkspace;
let profile: Profile;
let maria: TestClient;
let tom: TestClient;
let outsider: TestClient;

const entry = (key: ProfileEntry["key"], value: ProfileEntry["value"]): ProfileEntry => ({
  key,
  label: key,
  value,
  confidence: null,
  evidence: [],
  source: "you",
  updatedAt: NOW.toISOString(),
  updatedBy: null,
});

const tz = (offset: string): TimeZoneRange => ({ from: offset, to: offset });

const asiaRule = (from = "UTC+05:00"): RuleDraft => ({
  description: "Hide roles whose working hours are UTC+5 or later",
  when: [{ fact: "timeZones", op: "within", value: { from, to: "UTC+14:00" } }],
  then: "hide",
  enabled: true,
});

const proposalAnswer = (changes: Change[], summary = asiaRule().description): AssistantOutput => ({
  reply: "I can hide roles on Asian time zones for you. Here is a proposal.",
  clarify: null,
  proposal: { summary, changes },
});

/** The roles of Maria's inbox: three on Asia-Pacific hours, one on CET. */
const ROLES = {
  sg1: { id: "<sg-1@apac.example>", hours: tz("UTC+08:00"), fits: true },
  sg2: { id: "<sg-2@apac.example>", hours: tz("UTC+08:00"), fits: false },
  syd: { id: "<syd@apac.example>", hours: tz("UTC+10:00"), fits: true },
  eu: { id: "<eu@remote.example>", hours: tz("UTC+01:00"), fits: true },
};

beforeEach(async () => {
  stages = recordingStages();
  stages.match = matchStage;
  // The replies slice's reply stage, as far as the assistant relies on it: a draft only for a
  // role replyEligibility lets through, given its draft history.
  stages.reply = async (input, ctx) => {
    for (const e of input.evaluations) {
      const { eligible } = replyEligibility({
        origin: "auto",
        category: input.message.category,
        receivedAt: input.message.receivedAt,
        now: ctx.now,
        profile: ctx.profile,
        score: e.match?.score ?? null,
        capped: e.match?.capped ?? false,
        senderVerdict: input.sender?.verdict ?? null,
        ruleEffects: e.ruleEffects,
        openNeeds: [],
        draftHistory: input.draftHistory.get(e.position) ?? { hadDraft: false, dismissed: false },
      });
      if (!eligible) continue;
      const role = { messageId: input.message.messageId, position: e.position };
      await claimDraft(ctx.deps.db, ctx.ws, role, { origin: "auto", now: ctx.now });
    }
  };
  deps = await createTestDeps({
    now: NOW,
    registry: {
      ...jobRegistry,
      [PIPELINE_REEVALUATE_JOB]: defineJob(PipelineReevaluatePayloadSchema, (ctx) =>
        reevaluateWorkspace(ctx.deps, ctx.payload.workspaceId, { stages }).then(() => {}),
      ),
    },
  });
  mailbox = createFakeMailbox();
  deps.mail = mailbox.port;
  ai = createFakeAi();
  deps.ai = ai.port;
  const owner = await seedUser(deps, { name: "Maria Santos" });
  const viewer = await seedUser(deps, { name: "Tom Okafor" });
  const stranger = await seedUser(deps, { name: "Stranger" });
  ws = await seedWorkspace(deps, { owner, members: [{ user: viewer, role: "viewer" }] });
  const app = createApp(deps);
  maria = await signedIn(app, deps, owner);
  tom = await signedIn(app, deps, viewer);
  outsider = await signedIn(app, deps, stranger);
  await seedMailbox(deps, ws.workspaceId, {
    address: "maria.santos@inbox.example",
    conn: { host: "imap", port: 3143, tlsMode: "tls", username: "maria", password: "E2E-SECRET-p" },
    sentFolderPath: "Sent",
  });
  await seedAiSettings(deps, ws.workspaceId, {
    provider: "openai-compatible",
    baseUrl: "http://fake-ai.test/v1",
    models: TEST_AI_MODELS,
    apiKey: "E2E-SECRET-ai",
  });
  const created = await createConfirmedProfile(deps.db, ws.workspaceId, {
    name: "My job search",
    entries: [
      entry("target_roles", ["Backend Engineer"]),
      entry("remote", [{ scope: "Worldwide", timeZones: null }]),
    ],
    createdBy: owner.id,
    at: NOW,
  });
  if (!created.ok) throw new Error("expected a profile");
  profile = created.profile;
});
afterEach(() => deps.close());

const base = () => `/api/workspaces/${ws.workspaceId}`;
const proposalUrl = (id: string, action = "") =>
  `${base()}/assistant/proposals/${id}${action ? `/${action}` : ""}`;

/** Runs queued jobs until none is left. */
async function drain() {
  while (await deps.queue.runOnce()) {}
}

/**
 * Marks the role's claimed draft saved to the mailbox, as the replies slice's draft.create does
 * once the copy is in the Drafts folder. This branch has no packages/db function for it (the
 * replies slice adds markDraftSaved), so it is one statement on the test database.
 */
async function markInMailbox(messageId: string) {
  await deps.db.execute(
    `update drafts set status = 'in_mailbox', claimed_at = null
     where workspace_id = '${ws.workspaceId}' and message_id = '${messageId}' and position = 0
       and status = 'saving'`,
  );
}

/**
 * Maria's inbox, evaluated: the Singapore role that fits has its draft in the mailbox, Sydney's
 * draft failed for good (it had one, so it never gets another automatically), the other
 * Singapore role scores under the threshold, and the CET role has its draft claimed.
 */
async function seedInbox() {
  for (const [i, r] of Object.values(ROLES).entries()) {
    await seedJobMail(deps, ws.workspaceId, mailbox, {
      messageId: r.id,
      receivedAt: new Date(NOW.getTime() - (i + 1) * MINUTE),
      roles: [roleFacts({ workMode: "remote", remoteScope: "Worldwide", timeZones: r.hours })],
    });
    ai.answers.match[`${r.id}#0`] = {
      titleFit: r.fits
        ? { verdict: "fits", reason: "a backend role" }
        : { verdict: "conflicts", reason: "a data role" },
      skillCloseness: [],
    };
  }
  const syd = await claimDraft(
    deps.db,
    ws.workspaceId,
    { messageId: ROLES.syd.id, position: 0 },
    { origin: "auto", now: NOW },
  );
  if (!syd) throw new Error("expected a claim");
  await markDraftFailed(deps.db, ws.workspaceId, syd.id, {
    kind: "content",
    reason: "A placeholder twice",
    now: NOW,
  });
  await requestRun(deps, ws.workspaceId, "seeded");
  await drain();
  expect((await states()).every((s) => s.evaluation !== null)).toBe(true);
  // The Singapore draft as the replies slice leaves it: its copy in the Drafts folder.
  const client = mailbox.port.connect(
    { host: "imap", port: 3143, tlsMode: "tls", username: "maria", password: "E2E-SECRET-p" },
    { allowInsecure: false },
  );
  const original = await client.fetchOriginal({
    folderPath: "INBOX",
    uidValidity: mailbox.uidValidity("inbox"),
    uid: 1,
  });
  if (!original) throw new Error("expected the Singapore message");
  await client.saveDraft({ original, reply: { subject: "Re", body: "Hello" }, attachment: null });
  await markInMailbox(ROLES.sg1.id);
  expect(await draftOf(ROLES.sg1.id)).toBe("in_mailbox");
}

const states = () => listRoleStates(deps.db, ws.workspaceId);
const draftsOf = async () =>
  (await states()).map((s) => [s.messageId, s.draft?.status ?? null, s.draftHistory.hadDraft]);
const draftOf = async (messageId: string) =>
  (await states()).find((s) => s.messageId === messageId)?.draft?.status ?? null;

async function send(client: TestClient, text: string, threadId: string | null = null) {
  const res = await client.post(`${base()}/assistant`, { threadId, text });
  expect(res.status).toBe(200);
  return AssistantTurnSchema.parse(await res.json());
}

const hiddenIds = async (client: TestClient) => {
  const res = await client.get(`${base()}/messages?hidden=true`);
  return MessageListSchema.parse(await res.json()).items.map((m) => m.id);
};

describe("sending a message (F8.1)", () => {
  it("stores the thread, the message and the reply, and logs assistant.message", async () => {
    ai.answers.assistant["Hallo, was kannst du?"] = {
      reply: "Ich kann deine Regeln und dein Profil ändern.",
      clarify: null,
      proposal: null,
    };
    const turn = await send(maria, "Hallo, was kannst du?");
    expect(turn).toMatchObject({
      reply: "Ich kann deine Regeln und dein Profil ändern.",
      clarify: null,
      proposal: null,
    });
    const messages = await listThreadMessages(deps.db, ws.workspaceId, turn.threadId);
    expect(messages.map((m) => [m.role, m.turn, m.text])).toEqual([
      ["user", 1, "Hallo, was kannst du?"],
      ["assistant", 1, "Ich kann deine Regeln und dein Profil ändern."],
    ]);
    expect(deps.logs.filter((l) => l.event === "assistant.message")).toEqual([
      expect.objectContaining({ threadId: turn.threadId, workspaceId: ws.workspaceId }),
    ]);

    // The thread reads back for its member, and the next message is turn 2 of the same thread.
    ai.answers.assistant["2#Und auf Englisch?"] = {
      reply: "I can change your rules and profile.",
      clarify: null,
      proposal: null,
    };
    await send(maria, "Und auf Englisch?", turn.threadId);
    expect(ai.log.filter((c) => c.task === "assistant.v1").map((c) => c.key)).toEqual([
      "1#Hallo, was kannst du?",
      "2#Und auf Englisch?",
    ]);
    const state = AssistantStateSchema.parse(await (await maria.get(`${base()}/assistant`)).json());
    expect(state.thread?.messages.map((m) => m.text)).toEqual([
      "Hallo, was kannst du?",
      "Ich kann deine Regeln und dein Profil ändern.",
      "Und auf Englisch?",
      "I can change your rules and profile.",
    ]);
  });

  it("keeps each member's thread to themselves", async () => {
    ai.answers.assistant.Hello = { reply: "Hi", clarify: null, proposal: null };
    const turn = await send(maria, "Hello");
    const theirs = AssistantStateSchema.parse(await (await tom.get(`${base()}/assistant`)).json());
    expect(theirs.thread).toBeNull();
    const res = await tom.post(`${base()}/assistant`, { threadId: turn.threadId, text: "Hello" });
    expect(res.status).toBe(404);
    expect((await outsider.get(`${base()}/assistant`)).status).toBe(404);
  });

  it("stores nothing when the model gives no answer", async () => {
    const res = await maria.post(`${base()}/assistant`, { threadId: null, text: "Hello?" });
    expect(res.status).toBe(502);
    const state = AssistantStateSchema.parse(await (await maria.get(`${base()}/assistant`)).json());
    expect(state.thread).toBeNull();
  });
});

describe("an unclear request (F8.6)", () => {
  it("gets a clarifying question with choices and no proposal", async () => {
    ai.answers.assistant["stop showing me bad jobs"] = {
      reply: "What makes a job bad for you?",
      clarify: {
        question: "What makes a job bad for you?",
        choices: ["Pay under my minimum", "Hours outside my time zones", "Agencies"],
      },
      // A guess alongside the question is dropped: the question comes first.
      proposal: {
        summary: "Hide agencies",
        changes: [{ op: "add", target: "rule", rule: asiaRule() }],
      },
    };
    const turn = await send(maria, "stop showing me bad jobs");
    expect(turn.clarify).toEqual({
      question: "What makes a job bad for you?",
      choices: ["Pay under my minimum", "Hours outside my time zones", "Agencies"],
    });
    expect(turn.proposal).toBeNull();
    const state = AssistantStateSchema.parse(await (await maria.get(`${base()}/assistant`)).json());
    expect(state.thread?.messages[1]?.clarify?.choices).toHaveLength(3);
    expect(state.thread?.proposals).toEqual([]);
  });
});

describe("a preference request (F8.2)", () => {
  it("gets a proposal card with plain words and its impact, from no model call", async () => {
    await seedInbox();
    ai.answers.assistant[ASIA_REQUEST] = proposalAnswer([
      { op: "add", target: "rule", rule: asiaRule() },
    ]);
    const matchCalls = ai.calls.match;
    const turn = await send(maria, ASIA_REQUEST);
    const card = turn.proposal;
    if (!card) throw new Error("expected a proposal");
    expect(card).toMatchObject({
      summary: "Hide roles whose working hours are UTC+5 or later",
      status: "open",
      lines: [
        {
          target: "rule",
          label: "Rule",
          before: null,
          after: "Hide roles whose working hours are UTC+5 or later",
        },
      ],
      // Sydney's draft failed for good and the other Singapore role is under the threshold, so no
      // draft goes missing; the Singapore draft is in the mailbox, where it stays (F8.5).
      impact: { hides: 3, shows: 0, scoreMoves: 0, draftsNotCreated: 0, draftsInMailbox: 1 },
    });
    // The preview ran the rules engine and the match with the stored answers: no model call.
    expect(ai.calls.match).toBe(matchCalls);
    expect(deps.logs.filter((l) => l.event === "assistant.proposal_created")).toEqual([
      expect.objectContaining({ proposalId: card.id, changes: 1 }),
    ]);
    // Nothing changed yet.
    expect(await listRules(deps.db, ws.workspaceId, profile.id)).toEqual([]);
    expect(await hiddenIds(maria)).toEqual([]);
  });

  it("previews a role whose stored answer no longer fits the profile as not compared yet", async () => {
    // One CET role, scored 82 with its stored "fits" answer and eligible for a reply; no reply
    // stage, so it has no draft yet.
    stages.reply = async () => {};
    await seedJobMail(deps, ws.workspaceId, mailbox, {
      messageId: ROLES.eu.id,
      receivedAt: new Date(NOW.getTime() - MINUTE),
      roles: [
        roleFacts({ workMode: "remote", remoteScope: "Worldwide", timeZones: tz("UTC+01:00") }),
      ],
    });
    ai.answers.match[`${ROLES.eu.id}#0`] = {
      titleFit: { verdict: "fits", reason: "a backend role" },
      skillCloseness: [],
    };
    await requestRun(deps, ws.workspaceId, "seeded");
    await drain();
    const [scored] = await states();
    expect(scored?.evaluation?.match?.score).toBe(82);

    // The target roles change and the re-evaluation hasn't run yet: the stored answer is for
    // targets the profile no longer has, so the pipeline would ask match.v1 again, never reuse it.
    const changed = await applyAndReevaluate(
      deps,
      ws.workspaceId,
      profile.id,
      [{ op: "update", target: "entry", key: "target_roles", value: ["Data Engineer"] }],
      { source: "you", userId: ws.owner.id, request: null },
    );
    expect(changed?.ok).toBe(true);

    ai.answers.assistant[ASIA_REQUEST] = proposalAnswer([
      { op: "add", target: "rule", rule: asiaRule("UTC+00:00") },
    ]);
    const matchCalls = ai.calls.match;
    const card = (await send(maria, ASIA_REQUEST)).proposal;
    if (!card) throw new Error("expected a proposal");
    // Previewed without the stale answer, the title isn't compared yet (65, under the reply
    // threshold), so hiding it costs no draft; the old "fits" would have counted one (82).
    expect(card.impact).toEqual({
      hides: 1,
      shows: 0,
      scoreMoves: 0,
      draftsNotCreated: 0,
      draftsInMailbox: 0,
    });
    expect(ai.calls.match).toBe(matchCalls);
  });

  it("is edited before Apply: the time-zone range, with the words and impact following", async () => {
    await seedInbox();
    ai.answers.assistant[ASIA_REQUEST] = proposalAnswer([
      { op: "add", target: "rule", rule: asiaRule() },
    ]);
    const card = (await send(maria, ASIA_REQUEST)).proposal;
    if (!card) throw new Error("expected a proposal");
    const edit = { changes: [{ op: "add", target: "rule", rule: asiaRule("UTC+11:00") }] };
    // A viewer can't edit; another member's proposal is not there for them.
    expect((await tom.patch(proposalUrl(card.id), edit)).status).toBe(403);
    const calls = { ...ai.calls };
    const res = await maria.patch(proposalUrl(card.id), edit);
    expect(res.status).toBe(200);
    const edited = ProposalSchema.parse(await res.json());
    expect(edited.summary).toBe("Hide roles whose hours are within UTC+11 to UTC+14");
    expect(edited.lines[0]?.after).toBe("Hide roles whose hours are within UTC+11 to UTC+14");
    expect(edited.impact.hides).toBe(0);
    const back = await maria.patch(proposalUrl(card.id), {
      changes: [{ op: "add", target: "rule", rule: asiaRule("UTC+04:00") }],
    });
    expect(ProposalSchema.parse(await back.json()).impact.hides).toBe(3);
    // Editing previews again without the model.
    expect(ai.calls).toEqual(calls);
    expect(await listRules(deps.db, ws.workspaceId, profile.id)).toEqual([]);
    // Edits are checked like any change.
    const bad = await maria.patch(proposalUrl(card.id), {
      changes: [{ op: "remove", target: "rule", ruleId: "8f0e1c62-0000-4000-8000-000000000000" }],
    });
    expect(bad.status).toBe(400);
  });
});

describe("Apply (F8.3, F8.5, F8.8)", () => {
  it("saves the change as the assistant's and the inbox follows within a minute", async () => {
    await seedInbox();
    const draftsBefore = mailbox.drafts();
    const rowsBefore = await draftsOf();
    ai.answers.assistant[ASIA_REQUEST] = proposalAnswer([
      { op: "add", target: "rule", rule: asiaRule() },
    ]);
    const card = (await send(maria, ASIA_REQUEST)).proposal;
    if (!card) throw new Error("expected a proposal");

    // A viewer can chat but not apply.
    expect((await tom.post(proposalUrl(card.id, "apply"))).status).toBe(403);
    expect(await listRules(deps.db, ws.workspaceId, profile.id)).toEqual([]);

    const appliedAt = deps.clock.now();
    const res = await maria.post(proposalUrl(card.id, "apply"));
    expect(res.status).toBe(200);
    expect(ProposalSchema.parse(await res.json()).status).toBe("applied");
    const [rule] = await listRules(deps.db, ws.workspaceId, profile.id);
    expect(rule).toMatchObject({ source: "assistant", then: "hide", createdBy: ws.owner.id });
    const [history] = await getHistory(deps.db, ws.workspaceId, profile.id);
    expect(history).toMatchObject({ source: "assistant", request: ASIA_REQUEST, by: ws.owner.id });
    expect(deps.logs.filter((l) => l.event === "assistant.proposal_applied")).toEqual([
      expect.objectContaining({ proposalId: card.id }),
    ]);
    // Applied once only.
    expect((await maria.post(proposalUrl(card.id, "apply"))).status).toBe(409);

    deps.clock.advance(5_000);
    await drain();
    expect(await hiddenIds(maria)).toEqual([ROLES.sg1.id, ROLES.sg2.id, ROLES.syd.id]);
    for (const s of await states()) {
      if (s.messageId === ROLES.eu.id) continue;
      expect(s.evaluation?.hidden?.reason).toBe(
        'Hidden by your rule "Hide roles whose working hours are UTC+5 or later"',
      );
      const since = new Date(s.evaluation?.evaluatedAt ?? 0).getTime() - appliedAt.getTime();
      expect(since).toBeLessThanOrEqual(MINUTE);
    }
    // Drafts already in the mailbox are never touched, and no draft is made again.
    expect(mailbox.drafts()).toEqual(draftsBefore);
    expect(await draftsOf()).toEqual(rowsBefore);
    expect(await draftOf(ROLES.sg1.id)).toBe("in_mailbox");
  });

  it("answers 404 for another member's proposal", async () => {
    ai.answers.assistant[ASIA_REQUEST] = proposalAnswer([
      { op: "add", target: "rule", rule: asiaRule() },
    ]);
    const card = (await send(tom, ASIA_REQUEST)).proposal;
    if (!card) throw new Error("expected a proposal");
    expect((await maria.post(proposalUrl(card.id, "apply"))).status).toBe(404);
    expect((await maria.post(proposalUrl(card.id, "discard"))).status).toBe(404);
    expect((await outsider.post(proposalUrl(card.id, "discard"))).status).toBe(404);
  });
});

describe("Discard", () => {
  it("changes nothing and logs assistant.proposal_discarded", async () => {
    await seedInbox();
    ai.answers.assistant[ASIA_REQUEST] = proposalAnswer([
      { op: "add", target: "rule", rule: asiaRule() },
    ]);
    const card = (await send(tom, ASIA_REQUEST)).proposal;
    if (!card) throw new Error("expected a proposal");
    const res = await tom.post(proposalUrl(card.id, "discard"));
    expect(res.status).toBe(200);
    expect(ProposalSchema.parse(await res.json()).status).toBe("discarded");
    expect(deps.logs.filter((l) => l.event === "assistant.proposal_discarded")).toEqual([
      expect.objectContaining({ proposalId: card.id }),
    ]);
    expect(await listRules(deps.db, ws.workspaceId, profile.id)).toEqual([]);
    expect(await getHistory(deps.db, ws.workspaceId, profile.id)).toEqual([]);
    expect((await tom.post(proposalUrl(card.id, "discard"))).status).toBe(409);
  });
});

describe("history and Undo after Apply (F8.4)", () => {
  it("lists who, when, the source and the request, and Undo brings the roles back", async () => {
    await seedInbox();
    const draftsBefore = mailbox.drafts();
    const rowsBefore = await draftsOf();
    ai.answers.assistant[ASIA_REQUEST] = proposalAnswer([
      { op: "add", target: "rule", rule: asiaRule() },
    ]);
    const card = (await send(maria, ASIA_REQUEST)).proposal;
    if (!card) throw new Error("expected a proposal");
    expect((await maria.post(proposalUrl(card.id, "apply"))).status).toBe(200);
    await drain();
    expect(await hiddenIds(maria)).toHaveLength(3);

    const historyUrl = `${base()}/profiles/${profile.id}/history`;
    const listed = ProfileHistoryListSchema.parse(await (await tom.get(historyUrl)).json());
    expect(listed.items).toEqual([
      expect.objectContaining({
        by: ws.owner.id,
        byName: "Maria Santos",
        at: NOW.toISOString(),
        source: "assistant",
        request: ASIA_REQUEST,
        undoneAt: null,
        lines: [
          {
            target: "rule",
            label: "Rule",
            before: null,
            after: "Hide roles whose working hours are UTC+5 or later",
          },
        ],
      }),
    ]);
    const entryId = listed.items[0]?.id ?? "";
    expect((await tom.post(`${historyUrl}/${entryId}/undo`)).status).toBe(403);

    deps.clock.advance(1_000);
    const undo = await maria.post(`${historyUrl}/${entryId}/undo`);
    expect(undo.status).toBe(200);
    expect(await listRules(deps.db, ws.workspaceId, profile.id)).toEqual([]);
    expect(deps.logs.filter((l) => l.event === "profile.change_undone")).toEqual([
      expect.objectContaining({ entryId }),
    ]);
    await drain();
    expect(await hiddenIds(maria)).toEqual([]);
    expect(mailbox.drafts()).toEqual(draftsBefore);
    expect(await draftsOf()).toEqual(rowsBefore);
    expect(await draftOf(ROLES.sg1.id)).toBe("in_mailbox");
    expect((await maria.post(`${historyUrl}/${entryId}/undo`)).status).toBe(409);
  });
});

describe("what the assistant can't do (F8.7)", () => {
  const mailboxAnswer = {
    reply: "Here is a proposal.",
    clarify: null,
    proposal: {
      summary: "Change the mailbox",
      changes: [{ op: "update", target: "mailbox", key: "host", value: ["imap.evil.example"] }],
    },
  };

  /**
   * The real packages/ai client on a fake OpenAI-compatible provider answering every request
   * with `answer`: the answer goes through the same checks as in production.
   */
  function realClientAnswering(answer: unknown) {
    const requests: string[] = [];
    deps.ai = {
      client: (settings) =>
        createAiClient(settings, {
          fetch: async (url) => {
            requests.push(String(url));
            return Response.json({
              id: `chatcmpl-${requests.length}`,
              object: "chat.completion",
              created: 1790000000,
              model: TEST_AI_MODELS.assistant,
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: JSON.stringify(answer) },
                  finish_reason: "stop",
                },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            });
          },
        }),
    };
    return requests;
  }

  it("refuses a proposal that changes anything but rules and profile entries, reply kept", async () => {
    const requests = realClientAnswering(mailboxAnswer);
    const turn = await send(maria, "connect my work mailbox");
    expect(requests).toEqual(["http://fake-ai.test/v1/chat/completions"]);
    expect(turn.proposal).toBeNull();
    expect(turn.reply).toBe(
      "Here is a proposal.\n\nI can only propose changes to your rules and profile entries, so nothing was proposed.",
    );
    expect(deps.logs.some((l) => l.event === "assistant.proposal_created")).toBe(false);
    const state = AssistantStateSchema.parse(await (await maria.get(`${base()}/assistant`)).json());
    expect(state.thread?.messages.map((m) => m.text)).toEqual([
      "connect my work mailbox",
      turn.reply,
    ]);
    expect(state.thread?.proposals).toEqual([]);
  });

  it("answers no reply to a malformed rule change, after the client's one retry", async () => {
    const requests = realClientAnswering(
      proposalAnswer([{ op: "add", target: "rule", rule: { description: "x" } } as never]),
    );
    const res = await maria.post(`${base()}/assistant`, { threadId: null, text: "hide them" });
    expect(res.status).toBe(502);
    expect(requests).toHaveLength(2);
    const state = AssistantStateSchema.parse(await (await maria.get(`${base()}/assistant`)).json());
    expect(state.thread).toBeNull();
  });

  it("gets the same outcomes from the fake AI port, which checks answers the same way", async () => {
    ai.answers.assistant["connect my work mailbox"] = mailboxAnswer;
    const turn = await send(maria, "connect my work mailbox");
    expect(turn.proposal).toBeNull();
    expect(turn.reply).toContain("I can only propose changes to your rules and profile entries");
    ai.answers.assistant["hide them"] = proposalAnswer([
      { op: "add", target: "rule", rule: { description: "x" } } as never,
    ]);
    const res = await maria.post(`${base()}/assistant`, {
      threadId: turn.threadId,
      text: "hide them",
    });
    expect(res.status).toBe(502);
  });

  it("refuses a change that doesn't apply to the profile", async () => {
    ai.answers.assistant["remove that rule"] = proposalAnswer([
      { op: "remove", target: "rule", ruleId: "8f0e1c62-0000-4000-8000-000000000000" },
    ]);
    const turn = await send(maria, "remove that rule");
    expect(turn.proposal).toBeNull();
    expect(turn.reply).toContain("It changes a rule that no longer exists.");
  });

  it.each([
    [
      "send my reply to the Berlin recruiter",
      "I can't send mail. Your drafts are on the Drafts page.",
    ],
    [
      "invite my partner as an editor",
      "I can't invite people. Admins do that on the Members page.",
    ],
    [
      "switch my mailbox to work mail",
      "I can't change mailboxes. That's under Settings › Mailbox.",
    ],
    ["use another AI model", "I can't change AI settings. That's under Settings › AI."],
    ["delete all my data", "I can't delete data. CVs are deleted on the CVs page."],
  ])("answers %j with where that is done, and changes nothing", async (text, reply) => {
    await seedInbox();
    const draftsBefore = mailbox.drafts();
    const mailCalls = { ...mailbox.calls };
    ai.answers.assistant[text] = { reply, clarify: null, proposal: null };
    const turn = await send(maria, text);
    expect(turn).toMatchObject({ reply, clarify: null, proposal: null });
    expect(mailbox.calls).toEqual(mailCalls);
    expect(mailbox.drafts()).toEqual(draftsBefore);
    expect(await listRules(deps.db, ws.workspaceId, profile.id)).toEqual([]);
    expect(await getHistory(deps.db, ws.workspaceId, profile.id)).toEqual([]);
  });
});

describe("the conversation is stored but never logged (F8.10)", () => {
  it("keeps E2E-CHAT sentinels out of every log line", async () => {
    await seedInbox();
    const text = "No Asian hours please E2E-CHAT-1";
    ai.answers.assistant[text] = {
      reply: "Here is a proposal E2E-CHAT-2",
      clarify: null,
      proposal: {
        summary: "Hide Asian hours E2E-CHAT-3",
        changes: [
          { op: "add", target: "rule", rule: { ...asiaRule(), description: "No Asia E2E-CHAT-4" } },
        ],
      },
    };
    const turn = await send(maria, text);
    const card = turn.proposal;
    if (!card) throw new Error("expected a proposal");
    expect((await maria.post(proposalUrl(card.id, "apply"))).status).toBe(200);
    await drain();
    const history = await getHistory(deps.db, ws.workspaceId, profile.id);
    // Stored for the history…
    expect(history[0]?.request).toBe(text);
    const state = AssistantStateSchema.parse(await (await maria.get(`${base()}/assistant`)).json());
    expect(JSON.stringify(state)).toContain("E2E-CHAT-1");
    expect(JSON.stringify(state)).toContain("E2E-CHAT-2");
    expect(JSON.stringify(state)).toContain("E2E-CHAT-3");
    expect(JSON.stringify(state)).toContain("E2E-CHAT-4");
    const listed = await (await maria.get(`${base()}/profiles/${profile.id}/history`)).text();
    expect(listed).toContain("E2E-CHAT-1");
    // …and never logged.
    expect(deps.rawLogs.length).toBeGreaterThan(0);
    expect(deps.rawLogs.filter((l) => l.includes("E2E-CHAT"))).toEqual([]);
  });
});
