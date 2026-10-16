import {
  getDraftClaim,
  listDecisions,
  listDraftsToRetry,
  markStale,
  roleDecisions,
} from "@jobfilly/db";
import { MailUnavailableError } from "@jobfilly/mail";
import type { DraftMailInput, RuleEffect } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestDraft } from "../drafts/request";
import { createDraft } from "../drafts/write";
import { requestReevaluation } from "../profile/changes";
import {
  CHF_NEED,
  createHarness,
  daysAgo,
  draftAnswer,
  type Harness,
  NOW,
} from "../testing/replies";
import { reevaluateWorkspace } from "./reevaluate";

// The reply stage and draft.create (F6.1–F6.4, F7.1, F7.3): a good match gets one draft in the
// mailbox, written by draft.v1 from the profile and the chosen CV, threaded to the original and
// with the CV attached when asked; what a reply needs answered goes to the decision inbox; and a
// draft never stays in saving, whatever the mailbox or the model does.

const BERLIN = "<berlin@talentbruecke.example>";
const REMOTE = "<remote-eu@agency.example>";
const key = (id: string, attempt = 1, position = 0) => `${id}#${position}#${attempt}`;
const RELOCATE = {
  profileKey: "extra.relocate",
  groupKey: "extra.relocate",
  question: "Would you relocate to Ireland?",
  choices: [
    { label: "Yes", declines: false },
    { label: "No", declines: true },
  ],
};
const NO_DRAFT: RuleEffect = {
  ruleId: "00000000-0000-4000-8000-0000000000e2",
  action: "no_draft",
  reason: "Held by your rule (no_draft)",
  need: null,
};

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(() => h.close());

const events = (name: string) => h.deps.logs.filter((l) => l.event === name);

describe("the reply stage", () => {
  it("claims the role, enqueues draft.create, and the job threads the draft to the original", async () => {
    await h.deliver(BERLIN, { references: ["<earlier@talentbruecke.example>"] });
    h.ai.answers.draft[key(BERLIN)] = draftAnswer();
    await h.evaluate(BERLIN);
    // The stage only claims: no model call and no mailbox write yet.
    const claimed = await h.live(BERLIN);
    expect(claimed).toMatchObject({ status: "saving", origin: "auto", subject: null });
    expect(h.ai.calls.draft).toBe(0);
    expect(h.mailbox.drafts()).toEqual([]);

    expect(await h.drain()).toBe(1);
    const [saved] = h.mailbox.drafts();
    expect(saved?.original).toMatchObject({
      messageId: BERLIN,
      references: ["<earlier@talentbruecke.example>"],
      text: "Hello Maria, a backend role for you. Could you send your CV?",
    });
    expect(saved?.flags).toEqual(["\\Draft"]);
    expect(saved?.reply).toEqual({ subject: "Re: A role for you", body: draftAnswer().body });
    expect(h.mailbox.calls.fetchOriginal).toBe(1);
    expect(await h.live(BERLIN)).toMatchObject({
      id: claimed?.id,
      status: "in_mailbox",
      body: draftAnswer().body,
      mailbox: { path: "Drafts", uid: saved?.uid, draftMessageId: saved?.draftMessageId },
    });
    // The model saw the mail, the role and the profile only.
    expect(h.draftInputs[0]).toMatchObject({
      attempt: 1,
      position: 0,
      mail: { messageId: BERLIN, subject: "A role for you" },
      cv: null,
    });
    expect(h.draftInputs[0]?.entries.map((e) => e.key)).toEqual(["target_roles", "min_pay"]);
  });

  it("writes in the language of the message and attaches the chosen CV when asked", async () => {
    const cv = await h.cv("Backend (DE)", "de");
    await h.deliver(BERLIN, {
      text: "Hallo Maria, könnten Sie mir Ihren Lebenslauf schicken?",
      roles: [{ cvId: cv.id }],
    });
    h.ai.answers.draft[key(BERLIN)] = draftAnswer({
      subject: "Re: Backend-Rolle",
      body: "Hallo Herr Weber,\n\nmeinen Lebenslauf habe ich angehängt.\n\nMaria Santos",
      language: "de",
      attachCv: true,
    });
    await h.evaluate(BERLIN);
    await h.drain();
    const [saved] = h.mailbox.drafts();
    expect(saved?.attachment).toEqual({
      fileName: "Backend (DE).pdf",
      contentType: "application/pdf",
      bytes: new TextEncoder().encode("%PDF-1.4 Backend (DE)"),
    });
    expect(await h.live(BERLIN)).toMatchObject({ language: "de", cvId: cv.id });
    // draft.v1 gets the incoming mail's own text, whose language the reply is written in.
    expect(h.draftInputs[0]?.mail.text).toBe(
      "Hallo Maria, könnten Sie mir Ihren Lebenslauf schicken?",
    );
    expect(h.draftInputs[0]?.cv).toEqual({
      name: "Backend (DE)",
      language: "de",
      skills: ["Go", "PostgreSQL"],
      text: "Backend (DE)\nGo, PostgreSQL",
    });

    // Without attachCv the CV is used for the text but not attached.
    await h.deliver(REMOTE, { roles: [{ cvId: cv.id }] });
    h.ai.answers.draft[key(REMOTE)] = draftAnswer();
    await h.evaluate(REMOTE);
    await h.drain();
    expect(h.mailbox.drafts()[1]?.attachment).toBeNull();
    expect((await h.live(REMOTE))?.cvId).toBeNull();
  });

  it("logs draft.created and draft.saved_to_mailbox", async () => {
    await h.deliver(BERLIN);
    h.ai.answers.draft[key(BERLIN)] = draftAnswer();
    await h.evaluate(BERLIN);
    await h.drain();
    const draftId = (await h.live(BERLIN))?.id;
    expect(events("draft.created")).toEqual([
      expect.objectContaining({ level: "info", draftId, origin: "auto", attempt: 1 }),
    ]);
    expect(events("draft.saved_to_mailbox")).toEqual([
      expect.objectContaining({ level: "info", draftId, attached: false }),
    ]);
    // No subject, body or address reaches the log.
    expect(h.deps.rawLogs.join("\n")).not.toContain("I'd like to hear more");
  });

  it("drafts only what the policy lets through (F6.1)", async () => {
    await h.deliver("<low@x.example>", { roles: [{ score: 55 }] });
    await h.deliver("<old@x.example>", { receivedAt: daysAgo(20) });
    for (const id of ["<low@x.example>", "<old@x.example>"]) await h.evaluate(id);
    expect(await h.drain()).toBe(0);
    expect(await h.live("<low@x.example>")).toBeNull();
    expect(await h.live("<old@x.example>")).toBeNull();
  });

  it("holds back a category outside reply_to, a risky or unchecked sender, and rules (F6.1)", async () => {
    const rule = (action: RuleEffect["action"]): RuleEffect => ({
      ruleId: "00000000-0000-4000-8000-0000000000e1",
      action,
      reason: `Held by your rule (${action})`,
      need: null,
    });
    const held = {
      "<alert@jobs.example>": { category: "job_alert" as const },
      "<scam@x.example>": { sender: "high_risk" as const },
      "<unchecked@x.example>": { sender: "fails" as const },
      "<no-draft@x.example>": { roles: [{ ruleEffects: [rule("no_draft")] }] },
      "<hidden@x.example>": { roles: [{ ruleEffects: [rule("hide")] }] },
    };
    for (const [id, setup] of Object.entries(held)) {
      await h.deliver(id, setup);
      h.ai.answers.draft[key(id)] = draftAnswer();
      await h.evaluate(id);
    }
    // The control: the same mail with nothing holding it back gets its draft.
    await h.deliver(BERLIN);
    h.ai.answers.draft[key(BERLIN)] = draftAnswer();
    await h.evaluate(BERLIN);
    expect(await h.drain()).toBe(1);
    for (const id of Object.keys(held)) expect(await h.live(id)).toBeNull();
    expect(h.mailbox.drafts().map((d) => d.original.messageId)).toEqual([BERLIN]);
    expect(h.draftInputs.map((i) => i.mail.messageId)).toEqual([BERLIN]);
  });

  it("saves exactly one mailbox draft when a sync's evaluation races pipeline.reevaluate (F6.4)", async () => {
    await h.deliver(BERLIN);
    h.ai.answers.draft[key(BERLIN)] = draftAnswer();
    await Promise.all([
      h.evaluate(BERLIN),
      reevaluateWorkspace(h.deps, h.ws, { stages: h.stages }),
      h.evaluate(BERLIN),
    ]);
    await h.drain();
    await reevaluateWorkspace(h.deps, h.ws, { stages: h.stages });
    await h.drain();
    expect(h.mailbox.drafts()).toHaveLength(1);
    expect(h.ai.calls.draft).toBe(1);
  });
});

describe("questions a draft can't answer (F6.2, F7.1)", () => {
  it("release the claim and become decisions; after the answer the role gets its draft", async () => {
    await h.deliver(REMOTE);
    h.ai.answers.draft[key(REMOTE)] = draftAnswer({ questions: [RELOCATE] });
    await h.evaluate(REMOTE);
    await h.drain();
    expect(await h.live(REMOTE)).toBeNull();
    expect(h.mailbox.drafts()).toEqual([]);
    const [decision] = await listDecisions(h.deps.db, h.ws);
    expect(decision).toMatchObject({
      question: "Would you relocate to Ireland?",
      profileKey: "extra.relocate",
      choices: [
        { label: "Yes", value: "Yes" },
        { label: "No", value: "No" },
      ],
      waiting: [{ messageId: REMOTE, position: 0 }],
    });
    expect(events("decision.created")).toHaveLength(1);
    // Re-evaluating keeps the question and makes no draft while it waits.
    await requestReevaluation(h.deps, h.ws, { all: true }, "test");
    await h.drain();
    expect(await h.live(REMOTE)).toBeNull();
    expect(h.ai.calls.draft).toBe(1);

    h.ai.answers.draft[key(REMOTE)] = draftAnswer();
    const res = await (await h.client()).post(
      `/api/workspaces/${h.ws}/decisions/${decision?.id}/answer`,
      { value: "Yes", useForSimilar: true },
    );
    expect(res.status).toBe(200);
    await h.drain();
    expect(await h.live(REMOTE)).toMatchObject({ status: "in_mailbox", origin: "decision" });
    expect(h.mailbox.drafts()).toHaveLength(1);
    // The second draft.v1 call saw the answer in the profile.
    expect(h.draftInputs[1]?.entries).toContainEqual(
      expect.objectContaining({ key: "extra.relocate", value: ["Yes"] }),
    );
  });

  /** An automatic draft of REMOTE that asks the relocation question; returns its decision. */
  async function automaticDraftAsks() {
    await h.deliver(REMOTE);
    h.ai.answers.draft[key(REMOTE)] = draftAnswer({ questions: [RELOCATE] });
    await h.evaluate(REMOTE);
    await h.drain();
    const [decision] = await listDecisions(h.deps.db, h.ws);
    expect(decision?.waiting).toEqual([expect.objectContaining({ messageId: REMOTE })]);
    expect(await roleDecisions(h.deps.db, h.ws, [{ messageId: REMOTE, position: 0 }])).toEqual([
      expect.objectContaining({ state: "waiting", source: "draft" }),
    ]);
    return decision;
  }

  /** What makes the policy hold REMOTE back from now on; its next re-evaluation sees it. */
  const holds: Record<string, () => Promise<void>> = {
    "its score drops below the threshold": async () => {
      h.roles.set(`${REMOTE}#0`, { score: 50 });
      await requestReevaluation(h.deps, h.ws, { all: true }, "test");
    },
    "a no_draft rule applies": async () => {
      h.roles.set(`${REMOTE}#0`, { ruleEffects: [NO_DRAFT] });
      await requestReevaluation(h.deps, h.ws, { all: true }, "test");
    },
    "the sender is now high risk": async () => {
      h.setSender(REMOTE, "high_risk");
      await requestReevaluation(
        h.deps,
        h.ws,
        { senderAddress: "recruiter@agency.example" },
        "test",
      );
    },
  };

  it.each(Object.keys(holds))(
    "of an automatic draft leave the inbox once %s (F7.1)",
    async (hold) => {
      await automaticDraftAsks();
      await holds[hold]?.();
      await h.drain();
      expect(await listDecisions(h.deps.db, h.ws)).toEqual([]);
      expect(await roleDecisions(h.deps.db, h.ws, [{ messageId: REMOTE, position: 0 }])).toEqual(
        [],
      );
      expect(await h.live(REMOTE)).toBeNull();
    },
  );

  it.each(Object.keys(holds))(
    "of an automatic draft, answered as %s, make no draft (F6.1)",
    async (hold) => {
      const decision = await automaticDraftAsks();
      // The answer comes in before the change's re-evaluation has run.
      await holds[hold]?.();
      h.ai.answers.draft[key(REMOTE)] = draftAnswer();
      const res = await (await h.client()).post(
        `/api/workspaces/${h.ws}/decisions/${decision?.id}/answer`,
        { value: "Yes", useForSimilar: true },
      );
      expect(res.status).toBe(200);
      await h.drain();
      expect(await h.live(REMOTE)).toBeNull();
      expect(h.mailbox.drafts()).toEqual([]);
      expect(h.ai.calls.draft).toBe(1);
    },
  );

  it("come from match needs only for a role that would otherwise get a reply (F7.1)", async () => {
    await h.deliver("<zurich@x.example>", { roles: [{ needs: [CHF_NEED] }] });
    await h.deliver("<zurich-low@x.example>", { roles: [{ needs: [CHF_NEED], score: 40 }] });
    await h.evaluate("<zurich@x.example>");
    await h.evaluate("<zurich-low@x.example>");
    expect(await h.drain()).toBe(0);
    const decisions = await listDecisions(h.deps.db, h.ws);
    expect(decisions.map((d) => d.waiting.map((w) => w.messageId))).toEqual([
      ["<zurich@x.example>"],
    ]);
    expect(await h.live("<zurich@x.example>")).toBeNull();
    // Once the role is no longer a good match it stops waiting, and the decision leaves.
    h.roles.set("<zurich@x.example>#0", { needs: [CHF_NEED], score: 50 });
    await requestReevaluation(h.deps, h.ws, { all: true }, "test");
    await h.drain();
    expect(await listDecisions(h.deps.db, h.ws)).toEqual([]);
    expect(
      await roleDecisions(h.deps.db, h.ws, [{ messageId: "<zurich@x.example>", position: 0 }]),
    ).toEqual([]);
  });
});

describe("a reply in another language than the message (F6.1)", () => {
  it("is regenerated once, then marks the draft failed with kind content", async () => {
    await h.deliver(BERLIN, { language: "de", text: "Hallo Maria, eine Backend-Rolle für Sie." });
    h.ai.answers.draft[key(BERLIN, 1)] = draftAnswer({ language: "en" });
    h.ai.answers.draft[key(BERLIN, 2)] = draftAnswer({ language: "en" });
    await h.evaluate(BERLIN);
    await h.drain();
    expect(h.ai.calls.draft).toBe(2);
    expect(events("draft.rejected_language")).toHaveLength(2);
    expect(await h.live(BERLIN)).toMatchObject({
      status: "failed",
      failureKind: "content",
      failureReason: "The draft still wasn't in the language of the message after one retry",
    });
    expect(h.mailbox.drafts()).toEqual([]);
  });
});

describe("a template placeholder (F6.2)", () => {
  it("is regenerated once with Attempt 2", async () => {
    await h.deliver(REMOTE);
    h.ai.answers.draft[key(REMOTE, 1)] = draftAnswer({ body: "Dear [Name],\n\nthanks!" });
    h.ai.answers.draft[key(REMOTE, 2)] = draftAnswer();
    await h.evaluate(REMOTE);
    await h.drain();
    expect(h.ai.log.filter((c) => c.task === "draft.v1").map((c) => c.key)).toEqual([
      key(REMOTE, 1),
      key(REMOTE, 2),
    ]);
    expect(events("draft.rejected_placeholder")).toEqual([
      expect.objectContaining({ level: "warn", attempt: 1 }),
    ]);
    expect(h.mailbox.drafts().map((d) => d.reply.body)).toEqual([draftAnswer().body]);
    expect(events("draft.created")).toEqual([expect.objectContaining({ attempt: 2 })]);
  });

  it("is not seen in brackets copied from the original message", async () => {
    await h.deliver(REMOTE, { subject: "[External] Backend Engineer" });
    h.ai.answers.draft[key(REMOTE, 1)] = draftAnswer({
      subject: "Re: [External] Backend Engineer",
    });
    await h.evaluate(REMOTE);
    await h.drain();
    expect(events("draft.rejected_placeholder")).toEqual([]);
    expect(h.mailbox.drafts().map((d) => d.reply.subject)).toEqual([
      "Re: [External] Backend Engineer",
    ]);
  });

  it("twice marks the draft failed with kind content, never retried automatically", async () => {
    await h.deliver(REMOTE);
    h.ai.answers.draft[key(REMOTE, 1)] = draftAnswer({ body: "Dear [Name]," });
    h.ai.answers.draft[key(REMOTE, 2)] = draftAnswer({ body: "I'd love to join {company}." });
    await h.evaluate(REMOTE);
    await h.drain();
    const failed = await h.live(REMOTE);
    expect(failed).toMatchObject({
      status: "failed",
      failureKind: "content",
      failureReason: "The draft still held a template placeholder after one retry",
      body: null,
    });
    expect(events("draft.rejected_placeholder")).toHaveLength(2);
    expect(h.mailbox.drafts()).toEqual([]);
    expect(await listDraftsToRetry(h.deps.db, h.ws, NOW)).toEqual([]);
    expect((await reevaluateWorkspace(h.deps, h.ws, { stages: h.stages })).retried).toBe(0);
    await requestReevaluation(h.deps, h.ws, { all: true }, "test");
    await h.drain();
    expect(h.ai.calls.draft).toBe(2);
    expect((await h.live(REMOTE))?.status).toBe("failed");
  });
});

describe("a mailbox that can't take the draft", () => {
  it("fails the draft with kind mailbox, and the sweep's retry lands exactly one draft", async () => {
    await h.deliver(BERLIN);
    h.ai.answers.draft[key(BERLIN)] = draftAnswer();
    h.mailbox.failNext("saveDraft");
    await h.evaluate(BERLIN);
    await h.drain();
    const failed = await h.live(BERLIN);
    expect(failed).toMatchObject({
      status: "failed",
      failureKind: "mailbox",
      failureReason: "Couldn't reach the mail server",
    });
    expect(h.mailbox.drafts()).toEqual([]);
    // The sweep takes it back and saves the same text, without asking the model again.
    expect((await reevaluateWorkspace(h.deps, h.ws, { stages: h.stages })).retried).toBe(1);
    await h.drain();
    expect(h.mailbox.drafts()).toHaveLength(1);
    expect(h.ai.calls.draft).toBe(1);
    expect(await h.live(BERLIN)).toMatchObject({
      id: failed?.id,
      status: "in_mailbox",
      attempts: 2,
    });
  });

  it("doesn't retry a failed draft whose message left the reply window (F1.6)", async () => {
    await h.deliver(BERLIN, { receivedAt: daysAgo(13) });
    h.ai.answers.draft[key(BERLIN)] = draftAnswer();
    h.mailbox.failNext("saveDraft");
    await h.evaluate(BERLIN);
    await h.drain();
    const failed = await h.live(BERLIN);
    expect(failed).toMatchObject({ status: "failed", failureKind: "mailbox" });

    // Two days later the message is 15 days old: the sweep holds the retry instead of saving it.
    h.deps.clock.advance(2 * 24 * 60 * 60 * 1000);
    expect((await reevaluateWorkspace(h.deps, h.ws, { stages: h.stages })).retried).toBe(0);
    await h.drain();
    expect(h.mailbox.drafts()).toEqual([]);
    expect(await h.live(BERLIN)).toMatchObject({
      id: failed?.id,
      status: "failed",
      failureKind: "content",
      failureReason: "Not tried again: Older than 14 days",
    });
    expect(h.ai.calls.draft).toBe(1);
    // It is held for good: the next sweep doesn't take it back either.
    expect(await listDraftsToRetry(h.deps.db, h.ws, h.deps.clock.now())).toEqual([]);
  });

  it("doesn't retry a failed draft once its sender is high risk or a rule holds it (F5.2, F6.1)", async () => {
    const SCAM = "<scam-later@agency.example>";
    for (const id of [BERLIN, SCAM]) {
      await h.deliver(id);
      h.ai.answers.draft[key(id)] = draftAnswer();
    }
    for (const id of [BERLIN, SCAM]) await h.evaluate(id);
    h.mailbox.pause();
    await h.drain();
    expect((await h.live(BERLIN))?.status).toBe("failed");
    expect((await h.live(SCAM))?.status).toBe("failed");
    h.mailbox.resume();

    // The sender is now high risk for SCAM; a no_draft rule now holds BERLIN.
    h.setSender(SCAM, "high_risk");
    await markStale(
      h.deps.db,
      h.ws,
      { senderAddress: "recruiter@agency.example" },
      h.deps.clock.now(),
    );
    h.roles.set(`${BERLIN}#0`, { ruleEffects: [NO_DRAFT] });
    expect((await reevaluateWorkspace(h.deps, h.ws, { stages: h.stages })).retried).toBe(0);
    await h.drain();
    expect(h.mailbox.drafts()).toEqual([]);
    expect(await h.live(SCAM)).toMatchObject({
      status: "failed",
      failureReason: "Not tried again: The sender looks high risk",
    });
    expect(await h.live(BERLIN)).toMatchObject({
      status: "failed",
      failureReason: "Not tried again: Held by your rule (no_draft)",
    });
  });

  it("retries a failed Draft a reply whatever the policy says (F6.5)", async () => {
    await h.deliver(BERLIN, { roles: [{ score: 40 }], receivedAt: daysAgo(13) });
    await h.evaluate(BERLIN);
    h.ai.answers.draft[key(BERLIN)] = draftAnswer();
    h.mailbox.failNext("saveDraft");
    await requestDraft(h.deps, h.ws, { messageId: BERLIN, position: 0 }, { origin: "on_demand" });
    await h.drain();
    expect(await h.live(BERLIN)).toMatchObject({ status: "failed", origin: "on_demand" });
    h.deps.clock.advance(2 * 24 * 60 * 60 * 1000);
    expect((await reevaluateWorkspace(h.deps, h.ws, { stages: h.stages })).retried).toBe(1);
    await h.drain();
    expect(await h.live(BERLIN)).toMatchObject({ status: "in_mailbox", origin: "on_demand" });
    expect(h.mailbox.drafts()).toHaveLength(1);
  });

  it("is never left in saving while paused, and recovers after resume()", async () => {
    await h.deliver(BERLIN);
    h.ai.answers.draft[key(BERLIN)] = draftAnswer();
    await h.evaluate(BERLIN);
    h.mailbox.pause();
    await h.drain();
    const failed = await h.live(BERLIN);
    expect(failed).toMatchObject({ status: "failed", failureKind: "mailbox" });
    expect(failed?.failureReason).toBeTruthy();
    expect(await getDraftClaim(h.deps.db, h.ws, failed?.id ?? "")).toMatchObject({
      status: "failed",
    });
    // Still paused: the retry fails again, and the row is failed, not saving.
    await reevaluateWorkspace(h.deps, h.ws, { stages: h.stages });
    await h.drain();
    expect((await h.live(BERLIN))?.status).toBe("failed");
    h.mailbox.resume();
    await reevaluateWorkspace(h.deps, h.ws, { stages: h.stages });
    await h.drain();
    expect(h.mailbox.drafts()).toHaveLength(1);
    expect((await h.live(BERLIN))?.status).toBe("in_mailbox");
  });

  /** The next append lands in the Drafts folder, but saveDraft then throws `error()`. */
  function appendThenThrow(error: () => Error) {
    const port = h.deps.mail;
    let armed = true;
    h.deps.mail = {
      connect(conn, options) {
        const client = port.connect(conn, options);
        return {
          ...client,
          async saveDraft(input: DraftMailInput) {
            const ref = await client.saveDraft(input);
            if (!armed) return ref;
            armed = false;
            throw error();
          },
        };
      },
    };
  }

  it("lands one copy when an append got through but its answer was lost (F6.3)", async () => {
    await h.deliver(BERLIN);
    h.ai.answers.draft[key(BERLIN)] = draftAnswer();
    appendThenThrow(() => new MailUnavailableError());
    await h.evaluate(BERLIN);
    await h.drain();
    const failed = await h.live(BERLIN);
    expect(failed).toMatchObject({ status: "failed", failureKind: "mailbox", mailbox: null });
    // The Message-ID was chosen, on the mailbox's domain, before the append.
    expect(failed?.draftMessageId).toMatch(/^<[0-9a-f-]+@inbox\.example>$/);
    expect(h.mailbox.drafts().map((d) => d.draftMessageId)).toEqual([failed?.draftMessageId]);

    expect((await reevaluateWorkspace(h.deps, h.ws, { stages: h.stages })).retried).toBe(1);
    await h.drain();
    const copies = h.mailbox.drafts();
    expect(copies).toHaveLength(1);
    expect(await h.live(BERLIN)).toMatchObject({
      status: "in_mailbox",
      mailbox: { uid: copies[0]?.uid, draftMessageId: failed?.draftMessageId },
    });
    expect(h.ai.calls.draft).toBe(1);
  });

  it("lands one copy when the replica died after the append and the sweep takes it back", async () => {
    await h.deliver(BERLIN);
    h.ai.answers.draft[key(BERLIN)] = draftAnswer();
    await h.evaluate(BERLIN);
    const dying = new AbortController();
    appendThenThrow(() => {
      dying.abort();
      return new Error("replica died");
    });
    // The job's work as a replica that is gone right after the append.
    const payload = { workspaceId: h.ws, messageId: BERLIN, position: 0, origin: "auto" as const };
    await expect(createDraft(h.deps, payload, { signal: dying.signal })).rejects.toThrow(
      "replica died",
    );
    expect(await h.live(BERLIN)).toMatchObject({ status: "saving", mailbox: null });
    expect(h.mailbox.drafts()).toHaveLength(1);

    h.deps.clock.advance(6 * 60_000);
    await reevaluateWorkspace(h.deps, h.ws, { stages: h.stages });
    await h.drain();
    expect(h.mailbox.drafts()).toHaveLength(1);
    expect((await h.live(BERLIN))?.status).toBe("in_mailbox");
    expect(h.ai.calls.draft).toBe(1);
  });

  it("keeps the winner's copy when a run that lost its claim doesn't know its copy's UID (F6.4)", async () => {
    await h.deliver(BERLIN);
    h.ai.answers.draft[key(BERLIN)] = draftAnswer();
    await h.evaluate(BERLIN);
    const payload = { workspaceId: h.ws, messageId: BERLIN, position: 0, origin: "auto" as const };
    // This run's append lands, but the server (no UIDPLUS) tells no UID. Before it records the
    // copy, another run of the claim (the sweep's, after this one looked dead) saves its own,
    // with the same kept Message-ID.
    const port = h.deps.mail;
    let armed = true;
    h.deps.mail = {
      connect(conn, options) {
        const client = port.connect(conn, options);
        return {
          ...client,
          async saveDraft(input: DraftMailInput) {
            const ref = await client.saveDraft(input);
            if (!armed) return ref;
            armed = false;
            await createDraft(h.deps, payload);
            return { ...ref, uid: 0, uidValidity: 0 };
          },
        };
      },
    };
    await createDraft(h.deps, payload);
    const copies = h.mailbox.drafts();
    expect(copies).toHaveLength(1);
    expect(await h.live(BERLIN)).toMatchObject({
      status: "in_mailbox",
      mailbox: { uid: copies[0]?.uid, draftMessageId: copies[0]?.draftMessageId },
    });
    expect(events("draft.copy_left")).toEqual([
      expect.objectContaining({ level: "warn", reason: "uid_unknown" }),
    ]);
    expect(h.ai.calls.draft).toBe(1);
  });

  it("isn't a mailbox failure when what follows the append fails", async () => {
    await h.deliver(BERLIN);
    h.ai.answers.draft[key(BERLIN)] = draftAnswer();
    await h.evaluate(BERLIN);
    const publish = h.deps.live.publish.bind(h.deps.live);
    let armed = true;
    vi.spyOn(h.deps.live, "publish").mockImplementation(async (ws, event) => {
      if (armed && event.type === "drafts.updated" && h.mailbox.drafts().length > 0) {
        armed = false;
        throw new Error("live bus down");
      }
      return publish(ws, event);
    });
    await h.drain();
    expect(armed).toBe(false);
    expect(await h.live(BERLIN)).toMatchObject({ status: "in_mailbox", failureKind: null });
    expect(await listDraftsToRetry(h.deps.db, h.ws, NOW)).toEqual([]);
    expect(h.mailbox.drafts()).toHaveLength(1);
  });

  it("fails with kind ai when draft.v1 gives no draft", async () => {
    await h.deliver(BERLIN);
    await h.evaluate(BERLIN);
    await h.drain();
    expect(await h.live(BERLIN)).toMatchObject({
      status: "failed",
      failureKind: "ai",
      failureReason: "The AI provider returned an error",
    });
  });
});
