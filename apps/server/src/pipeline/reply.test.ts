import { getDraftClaim, listDecisions, listDraftsToRetry, roleDecisions } from "@jobfilly/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CHF_NEED,
  createHarness,
  daysAgo,
  draftAnswer,
  type Harness,
  NOW,
} from "../drafts/harness";
import { requestReevaluation } from "../profile/changes";
import { reevaluateWorkspace } from "./reevaluate";

// The reply stage and draft.create (F6.1–F6.4, F7.1, F7.3): a good match gets one draft in the
// mailbox, written by draft.v1 from the profile and the chosen CV, threaded to the original and
// with the CV attached when asked; what a reply needs answered goes to the decision inbox; and a
// draft never stays in saving, whatever the mailbox or the model does.

const BERLIN = "<berlin@talentbruecke.example>";
const REMOTE = "<remote-eu@agency.example>";
const key = (id: string, attempt = 1, position = 0) => `${id}#${position}#${attempt}`;

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
    h.ai.answers.draft[key(REMOTE)] = draftAnswer({
      questions: [
        {
          profileKey: "extra.relocate",
          groupKey: "extra.relocate",
          question: "Would you relocate to Ireland?",
          choices: ["Yes", "No"],
        },
      ],
    });
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
