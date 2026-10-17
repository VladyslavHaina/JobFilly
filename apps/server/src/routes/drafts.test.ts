import { addMember } from "@jobfilly/db";
import { MailUnavailableError } from "@jobfilly/mail";
import { DecisionListSchema, DraftListSchema, DraftSchema } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editDraft } from "../drafts/edit";
import { requestReevaluation } from "../profile/changes";
import { seedUser, type TestClient } from "../testing";
import { createHarness, draftAnswer, type Harness } from "../testing/replies";

// Drafts over HTTP (F6.4, F6.5, F6.7): the list with each status and the failed reason, editing
// (the mailbox copy is replaced, one copy remains), discarding (deleted from the mailbox, never
// recreated automatically), Draft a reply on any role, and viewers who read but can't change.

const BERLIN = "<berlin@talentbruecke.example>";
const DATA = "<data-eng@agency.example>";
const key = (id: string, attempt = 1) => `${id}#0#${attempt}`;

let h: Harness;
let maria: TestClient;
let base: string;
beforeEach(async () => {
  h = await createHarness();
  maria = await h.client();
  base = `/api/workspaces/${h.ws}/drafts`;
});
afterEach(() => h.close());

const events = (name: string) => h.deps.logs.filter((l) => l.event === name);

const RELOCATE_QUESTION = {
  profileKey: "extra.relocate",
  groupKey: "extra.relocate",
  question: "Would you relocate to Ireland?",
  choices: [
    { label: "Yes", declines: false },
    { label: "No", declines: true },
  ],
};

const WINNER = { subject: "Re: A role for you", body: "Hello Jonas,\n\nMonday works.\n\nMaria" };

async function decisions() {
  const res = await maria.get(`/api/workspaces/${h.ws}/decisions`);
  return DecisionListSchema.parse(await res.json()).items;
}

async function drafted(id: string) {
  await h.deliver(id);
  h.ai.answers.draft[key(id)] = draftAnswer();
  await h.evaluate(id);
  await h.drain();
  const draft = await h.live(id);
  if (!draft) throw new Error("expected a draft");
  return draft;
}

describe("the Drafts list (F6.7)", () => {
  it("shows each draft's status and the failed reason", async () => {
    const saved = await drafted(BERLIN);
    // The list is newest change first; the test clock stands still, so the second draft is made
    // a second later, or the two would tie on every timestamp.
    h.deps.clock.advance(1000);
    await h.deliver(DATA);
    h.mailbox.failNext("saveDraft");
    h.ai.answers.draft[key(DATA)] = draftAnswer();
    await h.evaluate(DATA);
    await h.drain();
    const res = await maria.get(base);
    expect(res.status).toBe(200);
    const { items } = DraftListSchema.parse(await res.json());
    expect(items.map((d) => [d.messageId, d.status, d.failureReason])).toEqual([
      [DATA, "failed", "Couldn't reach the mail server"],
      [BERLIN, "in_mailbox", null],
    ]);
    // Nothing but the API's fields: no mailbox reference or claim bookkeeping.
    expect(Object.keys(items[1] ?? {}).sort()).toEqual(Object.keys(DraftSchema.shape).sort());
    const one = await maria.get(`${base}?messageId=${encodeURIComponent(BERLIN)}`);
    expect(DraftListSchema.parse(await one.json()).items.map((d) => d.id)).toEqual([saved.id]);
    expect((await maria.get(`${base}/${saved.id}`)).status).toBe(200);
  });
});

describe("editing and discarding (F6.4)", () => {
  it("saving an edit replaces the mailbox draft, so exactly one copy remains", async () => {
    const draft = await drafted(BERLIN);
    const res = await maria.patch(`${base}/${draft.id}`, {
      subject: "Re: A role for you",
      body: "Hello Jonas,\n\nyes, let's talk on Monday.\n\nMaria",
    });
    expect(res.status).toBe(200);
    expect(DraftSchema.parse(await res.json())).toMatchObject({ status: "edited" });
    const copies = h.mailbox.drafts();
    expect(copies).toHaveLength(1);
    expect(copies[0]?.reply.body).toBe("Hello Jonas,\n\nyes, let's talk on Monday.\n\nMaria");
    expect(copies[0]?.original.messageId).toBe(BERLIN);
    expect(events("draft.updated")).toEqual([expect.objectContaining({ draftId: draft.id })]);
    // A second edit replaces the edited copy.
    await maria.patch(`${base}/${draft.id}`, { subject: "Re: A role", body: "Second" });
    expect(h.mailbox.drafts().map((d) => d.reply.body)).toEqual(["Second"]);
  });

  it("keeps the CV attached through edits after the CV is deleted, and says so (F2.5)", async () => {
    const cv = await h.cv("Backend (DE)", "de");
    await h.deliver(BERLIN, { roles: [{ cvId: cv.id }] });
    h.ai.answers.draft[key(BERLIN)] = draftAnswer({ attachCv: true });
    await h.evaluate(BERLIN);
    await h.drain();
    const draft = await h.live(BERLIN);
    if (!draft) throw new Error("expected a draft");
    const file = h.mailbox.drafts()[0]?.attachment;
    expect(file?.fileName).toBe("Backend (DE).pdf");
    const one = async () =>
      DraftSchema.parse(await (await maria.get(`${base}/${draft.id}`)).json());
    expect(await one()).toMatchObject({ cvId: cv.id, cvAttached: true });

    // The CV is deleted: the draft forgets it, but its copy keeps the file, and so does an edit.
    expect((await maria.delete(`/api/workspaces/${h.ws}/cvs/${cv.id}`)).status).toBe(204);
    // The role's CV choice is made again without it.
    h.roles.set(`${BERLIN}#0`, { cvId: null });
    expect(await one()).toMatchObject({ cvId: null, cvAttached: true });
    for (const body of ["Edited once", "Edited twice"]) {
      const res = await maria.patch(`${base}/${draft.id}`, { subject: "Re: A role", body });
      expect(res.status).toBe(200);
      expect(DraftSchema.parse(await res.json())).toMatchObject({ cvId: null, cvAttached: true });
      const copies = h.mailbox.drafts();
      expect(copies.map((c) => c.reply.body)).toEqual([body]);
      expect(copies[0]?.attachment).toEqual(file);
    }
    expect(events("draft.attachment_lost")).toEqual([]);

    // A draft made without the CV says it has none.
    await h.deliver(DATA);
    h.ai.answers.draft[key(DATA)] = draftAnswer();
    await h.evaluate(DATA);
    await h.drain();
    const bare = await h.live(DATA);
    expect(bare && (await maria.get(`${base}/${bare.id}`)).status).toBe(200);
    const listed = DraftListSchema.parse(await (await maria.get(base)).json()).items;
    expect(listed.find((d) => d.messageId === DATA)?.cvAttached).toBe(false);
  });

  it("edits a draft whose CV is gone and whose copy is gone too, without the file", async () => {
    const cv = await h.cv("Backend (DE)", "de");
    await h.deliver(BERLIN, { roles: [{ cvId: cv.id }] });
    h.ai.answers.draft[key(BERLIN)] = draftAnswer({ attachCv: true });
    await h.evaluate(BERLIN);
    await h.drain();
    const draft = await h.live(BERLIN);
    if (!draft?.mailbox) throw new Error("expected a draft in the mailbox");
    expect((await maria.delete(`/api/workspaces/${h.ws}/cvs/${cv.id}`)).status).toBe(204);
    h.roles.set(`${BERLIN}#0`, { cvId: null });
    // The user deleted the copy in their mail program.
    const client = h.deps.mail.connect(
      { host: "imap", port: 993, tlsMode: "tls", username: "m", password: "p" },
      { allowInsecure: false, address: "maria.santos@inbox.example" },
    );
    await client.deleteDraft(draft.mailbox);
    const res = await maria.patch(`${base}/${draft.id}`, { subject: "Re: A role", body: "Edited" });
    expect(res.status).toBe(200);
    expect(DraftSchema.parse(await res.json())).toMatchObject({ cvAttached: false });
    expect(h.mailbox.drafts().map((c) => c.attachment)).toEqual([null]);
    expect(events("draft.attachment_lost")).toEqual([
      expect.objectContaining({ level: "warn", draftId: draft.id }),
    ]);
  });

  it("leaves exactly one copy when two edits are saved at once", async () => {
    const draft = await drafted(BERLIN);
    const [a, b] = await Promise.all([
      maria.patch(`${base}/${draft.id}`, { subject: "s", body: "First" }),
      maria.patch(`${base}/${draft.id}`, { subject: "s", body: "Second" }),
    ]);
    expect([a?.status, b?.status]).toContain(200);
    const copies = h.mailbox.drafts();
    expect(copies).toHaveLength(1);
    // The row names the copy that is left, with its text.
    expect(await h.live(BERLIN)).toMatchObject({
      status: "edited",
      body: copies[0]?.reply.body,
      mailbox: { uid: copies[0]?.uid, draftMessageId: copies[0]?.draftMessageId },
    });
    // The loser, if there was one, was told.
    for (const res of [a, b]) if (res?.status !== 200) expect(res?.status).toBe(409);
  });

  it("leaves no copy when an edit races a discard", async () => {
    const draft = await drafted(BERLIN);
    const [edit, discard] = await Promise.all([
      maria.patch(`${base}/${draft.id}`, { subject: "s", body: "Edited" }),
      maria.post(`${base}/${draft.id}/discard`),
    ]);
    expect(discard?.status).toBe(200);
    expect([200, 409]).toContain(edit?.status);
    expect(h.mailbox.drafts()).toEqual([]);
    expect(await h.live(BERLIN)).toBeNull();
  });

  it("logs draft.copy_left when the losing edit's copy can't be deleted", async () => {
    const draft = await drafted(BERLIN);
    const port = h.deps.mail;
    let armed = true;
    h.deps.mail = {
      connect(conn, options) {
        const client = port.connect(conn, options);
        return {
          ...client,
          async replaceDraft(ref, input) {
            const replaced = await client.replaceDraft(ref, input);
            if (armed) {
              armed = false;
              // Another editor's save wins meanwhile; then the mailbox can't delete this copy.
              const won = await editDraft(h.deps, h.ws, draft.id, WINNER, h.deps.log);
              expect(won.ok).toBe(true);
              h.mailbox.failNext("deleteDraft");
            }
            return replaced;
          },
        };
      },
    };
    const lost = await editDraft(
      h.deps,
      h.ws,
      draft.id,
      { subject: "s", body: "Lost" },
      h.deps.log,
    );
    expect(lost).toMatchObject({ ok: false, error: "conflict" });
    expect(events("draft.copy_left")).toEqual([
      expect.objectContaining({ level: "warn", draftId: draft.id, reason: "delete_failed" }),
    ]);
    expect(await h.live(BERLIN)).toMatchObject({ status: "edited", body: WINNER.body });
  });

  it("keeps the edit out when the mailbox can't take it, and says so", async () => {
    const draft = await drafted(BERLIN);
    h.mailbox.pause();
    const res = await maria.patch(`${base}/${draft.id}`, { subject: "s", body: "New" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "mailbox" });
    h.mailbox.resume();
    expect((await h.live(BERLIN))?.status).toBe("in_mailbox");
    expect(h.mailbox.drafts().map((d) => d.reply.body)).toEqual([draftAnswer().body]);
  });

  it("discarding a failed draft deletes the copy its append left behind", async () => {
    await h.deliver(BERLIN);
    h.ai.answers.draft[key(BERLIN)] = draftAnswer();
    // The append reaches the Drafts folder, then the client fails: the row records no copy.
    const port = h.deps.mail;
    let armed = true;
    h.deps.mail = {
      connect(conn, options) {
        const client = port.connect(conn, options);
        return {
          ...client,
          async saveDraft(input) {
            const ref = await client.saveDraft(input);
            if (!armed) return ref;
            armed = false;
            throw new MailUnavailableError();
          },
        };
      },
    };
    await h.evaluate(BERLIN);
    await h.drain();
    const failed = await h.live(BERLIN);
    expect(failed).toMatchObject({ status: "failed", mailbox: null });
    expect(h.mailbox.drafts()).toHaveLength(1);

    const res = await maria.post(`${base}/${failed?.id}/discard`);
    expect(res.status).toBe(200);
    expect(DraftSchema.parse(await res.json()).status).toBe("discarded");
    expect(h.mailbox.drafts()).toEqual([]);
    expect(events("draft.discarded")).toEqual([expect.objectContaining({ draftId: failed?.id })]);
  });

  it("discards a failed draft that never wrote a text without the mailbox", async () => {
    await h.deliver(BERLIN);
    h.ai.answers.draft[key(BERLIN, 1)] = draftAnswer({ body: "Dear [Name]" });
    h.ai.answers.draft[key(BERLIN, 2)] = draftAnswer({ body: "Hi {company}" });
    await h.evaluate(BERLIN);
    await h.drain();
    const failed = await h.live(BERLIN);
    expect(failed).toMatchObject({ status: "failed", draftMessageId: null });
    h.mailbox.pause();
    const res = await maria.post(`${base}/${failed?.id}/discard`);
    h.mailbox.resume();
    expect(res.status).toBe(200);
    expect(DraftSchema.parse(await res.json()).status).toBe("discarded");
  });

  it("discarding deletes it from the mailbox, and no change brings it back", async () => {
    const draft = await drafted(BERLIN);
    const res = await maria.post(`${base}/${draft.id}/discard`);
    expect(res.status).toBe(200);
    expect(DraftSchema.parse(await res.json()).status).toBe("discarded");
    expect(h.mailbox.drafts()).toEqual([]);
    expect(events("draft.discarded")).toEqual([expect.objectContaining({ draftId: draft.id })]);

    // A rule change re-evaluates everything; a decision answer too. Neither drafts it again.
    await requestReevaluation(h.deps, h.ws, { all: true }, "rule.changed");
    await h.drain();
    await h.deliver("<zurich@x.example>", {
      roles: [
        {
          needs: [
            {
              groupKey: "min_pay:CHF:year",
              profileKey: "min_pay",
              question: "Minimum pay in CHF per year?",
              choices: [],
            },
          ],
        },
      ],
    });
    await h.evaluate("<zurich@x.example>");
    const decisions = (await (await maria.get(`/api/workspaces/${h.ws}/decisions`)).json()) as {
      items: { id: string }[];
    };
    h.ai.answers.draft[key("<zurich@x.example>")] = draftAnswer();
    const answered = await maria.post(
      `/api/workspaces/${h.ws}/decisions/${decisions.items[0]?.id}/answer`,
      { value: "CHF 120,000", useForSimilar: true },
    );
    expect(answered.status).toBe(200);
    await h.drain();
    expect(await h.live(BERLIN)).toBeNull();
    expect(h.mailbox.drafts().map((d) => d.original.messageId)).toEqual(["<zurich@x.example>"]);

    // Draft a reply after the discard makes a new one.
    const again = await maria.post(base, { messageId: BERLIN, position: 0 });
    expect(again.status).toBe(202);
    await h.drain();
    expect(await h.live(BERLIN)).toMatchObject({ status: "in_mailbox", auto: false });
    expect(h.mailbox.drafts()).toHaveLength(2);
  });
});

describe("Draft a reply (F6.5)", () => {
  it("drafts a role below the threshold", async () => {
    await h.deliver(DATA, { roles: [{ score: 52 }] });
    await h.evaluate(DATA);
    await h.drain();
    expect(await h.live(DATA)).toBeNull();
    h.ai.answers.draft[key(DATA)] = draftAnswer();
    const res = await maria.post(base, { messageId: DATA, position: 0 });
    expect(res.status).toBe(202);
    expect(DraftSchema.parse(await res.json())).toMatchObject({ status: "saving", auto: false });
    await h.drain();
    expect(await h.live(DATA)).toMatchObject({ status: "in_mailbox", origin: "on_demand" });
    expect(h.mailbox.drafts()).toHaveLength(1);
    // The role has its draft now: asking again is a conflict, not a second copy.
    expect((await maria.post(base, { messageId: DATA, position: 0 })).status).toBe(409);
  });

  it("asks what the reply needs, and writes the draft once it is answered (F6.5, F7.4)", async () => {
    await h.deliver(DATA, { roles: [{ score: 52 }] });
    await h.evaluate(DATA);
    h.ai.answers.draft[key(DATA)] = draftAnswer({ questions: [RELOCATE_QUESTION] });
    expect((await maria.post(base, { messageId: DATA, position: 0 })).status).toBe(202);
    await h.drain();
    expect(await h.live(DATA)).toBeNull();
    const [decision] = await decisions();
    expect(decision).toMatchObject({
      question: "Would you relocate to Ireland?",
      waiting: [{ messageId: DATA, position: 0 }],
    });

    h.ai.answers.draft[key(DATA)] = draftAnswer();
    const answered = await maria.post(`/api/workspaces/${h.ws}/decisions/${decision?.id}/answer`, {
      value: "No",
      useForSimilar: false,
    });
    expect(answered.status).toBe(200);
    await h.drain();
    expect(await h.live(DATA)).toMatchObject({
      status: "in_mailbox",
      origin: "on_demand",
      auto: false,
    });
    expect(h.mailbox.drafts()).toHaveLength(1);
    // The draft was written with the answer given for this role.
    expect(h.draftInputs[1]?.entries.map((e) => e.key)).toContain("extra.relocate");
  });

  it("asks again after Don't ask for this message, instead of doing nothing", async () => {
    await h.deliver(DATA, { roles: [{ score: 52 }] });
    await h.evaluate(DATA);
    h.ai.answers.draft[key(DATA)] = draftAnswer({ questions: [RELOCATE_QUESTION] });
    await maria.post(base, { messageId: DATA, position: 0 });
    await h.drain();
    const [decision] = await decisions();
    const dismissed = await maria.post(
      `/api/workspaces/${h.ws}/decisions/${decision?.id}/dismiss`,
      { messageId: DATA, position: 0 },
    );
    expect(dismissed.status).toBe(200);
    expect(await decisions()).toEqual([]);
    // A re-evaluation never drafts the dismissed role on its own.
    await requestReevaluation(h.deps, h.ws, { all: true }, "test");
    await h.drain();
    expect(await h.live(DATA)).toBeNull();

    // Draft a reply again: the reply still needs the answer, so the question is back.
    expect((await maria.post(base, { messageId: DATA, position: 0 })).status).toBe(202);
    await h.drain();
    expect((await decisions()).map((d) => [d.id, d.waiting.map((w) => w.messageId)])).toEqual([
      [decision?.id, [DATA]],
    ]);
    h.ai.answers.draft[key(DATA)] = draftAnswer();
    await maria.post(`/api/workspaces/${h.ws}/decisions/${decision?.id}/answer`, {
      value: "Yes",
      useForSimilar: true,
    });
    await h.drain();
    expect(await h.live(DATA)).toMatchObject({ status: "in_mailbox", origin: "on_demand" });
  });

  it("takes a failed draft's row back", async () => {
    await h.deliver(BERLIN);
    h.ai.answers.draft[key(BERLIN, 1)] = draftAnswer({ body: "Dear [Name]" });
    h.ai.answers.draft[key(BERLIN, 2)] = draftAnswer({ body: "Hi {company}" });
    await h.evaluate(BERLIN);
    await h.drain();
    const failed = await h.live(BERLIN);
    expect(failed?.status).toBe("failed");
    h.ai.answers.draft[key(BERLIN, 1)] = draftAnswer();
    const res = await maria.post(base, { messageId: BERLIN, position: 0 });
    expect(res.status).toBe(202);
    await h.drain();
    expect(await h.live(BERLIN)).toMatchObject({ id: failed?.id, status: "in_mailbox" });
  });

  it("refuses a role that doesn't exist", async () => {
    await h.deliver(BERLIN);
    expect((await maria.post(base, { messageId: BERLIN, position: 3 })).status).toBe(404);
    expect((await maria.post(base, { messageId: "<nope@x.example>", position: 0 })).status).toBe(
      404,
    );
  });
});

describe("viewers (F6.7)", () => {
  it("read drafts but get 403 on every change", async () => {
    const draft = await drafted(BERLIN);
    const tom = await seedUser(h.deps, { name: "Tom Okafor" });
    await addMember(h.deps.db, h.ws, tom.id, "viewer");
    const viewer = await h.client(tom);
    expect((await viewer.get(base)).status).toBe(200);
    expect((await viewer.get(`${base}/${draft.id}`)).status).toBe(200);
    expect((await viewer.post(base, { messageId: BERLIN, position: 0 })).status).toBe(403);
    expect((await viewer.patch(`${base}/${draft.id}`, { subject: "s", body: "b" })).status).toBe(
      403,
    );
    expect((await viewer.post(`${base}/${draft.id}/discard`)).status).toBe(403);
    expect(h.mailbox.drafts()).toHaveLength(1);
    expect((await h.live(BERLIN))?.status).toBe("in_mailbox");
  });

  it("are not shown to a non-member, who gets 404 on a real draft", async () => {
    const draft = await drafted(BERLIN);
    const outsider = await seedUser(h.deps, { name: "Eve Outsider" });
    const eve = await h.client(outsider);
    // From her own workspace, where she is an admin, Maria's draft isn't there either.
    const own = `/api/workspaces/${outsider.workspaceId}/drafts`;
    expect((await eve.get(`${own}/${draft.id}`)).status).toBe(404);
    expect((await eve.patch(`${own}/${draft.id}`, { subject: "s", body: "b" })).status).toBe(404);
    expect((await eve.post(`${own}/${draft.id}/discard`)).status).toBe(404);
    expect((await eve.get(base)).status).toBe(404);
    expect((await eve.get(`${base}/${draft.id}`)).status).toBe(404);
    expect((await eve.post(base, { messageId: BERLIN, position: 0 })).status).toBe(404);
    expect((await eve.patch(`${base}/${draft.id}`, { subject: "s", body: "b" })).status).toBe(404);
    expect((await eve.post(`${base}/${draft.id}/discard`)).status).toBe(404);
    expect(h.mailbox.drafts()).toHaveLength(1);
    expect(await h.live(BERLIN)).toMatchObject({ status: "in_mailbox", body: draft.body });
  });
});
