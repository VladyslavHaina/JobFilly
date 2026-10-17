import { addMember, getMailboxConnection, type StoredMailbox, setMemberScope } from "@jobfilly/db";
import { activityRows } from "@jobfilly/db/testing";
import { SmtpError } from "@jobfilly/mail";
import {
  DraftSchema,
  SEND_DELAY_SECONDS,
  SendPreviewSchema,
  SendSchema,
  SmtpSettingsViewSchema,
} from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seal } from "../secrets";
import { createFakeSmtp, type FakeSmtp, seedUser, type TestClient } from "../testing";
import { createHarness, draftAnswer, type Harness } from "../testing/replies";
import { runSend } from "./jobs";
import { googleSmtp, providerSavesSentCopy, smtpLogin } from "./outgoing";

// Sending one reviewed draft (MVP 3, F4.1–F4.5) over HTTP, against the fake mailbox and the fake
// SMTP server: the confirmation shows the exact message with a token for its content; confirming
// waits SEND_DELAY_SECONDS with Undo; it is sent exactly once and filed in Sent exactly once; the
// draft keeps its row as sent; a stale or missing token sends nothing; viewers and pipeline-only
// members can't send; every send is in the activity log.

const BERLIN = "<berlin@talentbruecke.example>";
const SMTP_PASSWORD = "E2E-SECRET-smtp";
const SMTP = { host: "smtp.inbox.example", port: 465, tlsMode: "tls", username: "maria" } as const;

let h: Harness;
let smtp: FakeSmtp;
let maria: TestClient;
let mailboxId: string;
let ws: string;

beforeEach(async () => {
  h = await createHarness();
  smtp = createFakeSmtp();
  h.deps.smtp = smtp.port;
  maria = await h.client();
  ws = `/api/workspaces/${h.ws}`;
  const mailbox = await getMailboxConnection(h.deps.db, h.ws);
  if (!mailbox) throw new Error("expected the harness mailbox");
  mailboxId = mailbox.mailboxId;
});
afterEach(() => h.close());

const events = (name: string) => h.deps.logs.filter((l) => l.event === name);

async function drafted(id = BERLIN) {
  await h.deliver(id);
  h.ai.answers.draft[`${id}#0#1`] = draftAnswer();
  await h.evaluate(id);
  await h.drain();
  const draft = await h.live(id);
  if (!draft) throw new Error("expected a draft");
  return draft;
}

async function withSmtp(settings: Record<string, unknown> = {}) {
  const res = await maria.put(`${ws}/mailboxes/${mailboxId}/smtp`, {
    ...SMTP,
    password: SMTP_PASSWORD,
    ...settings,
  });
  expect(res.status).toBe(200);
}

async function preview(draftId: string, client = maria) {
  const res = await client.get(`${ws}/drafts/${draftId}/send`);
  expect(res.status).toBe(200);
  return SendPreviewSchema.parse(await res.json());
}

const confirm = (draftId: string, token: string | undefined, client = maria) =>
  client.post(`${ws}/drafts/${draftId}/send`, token === undefined ? {} : { token });

/** Lets the Undo delay pass and runs every job that is due. */
async function waitOut() {
  h.deps.clock.advance(SEND_DELAY_SECONDS * 1000);
  await h.drain();
}

const draftNow = async (draftId: string) =>
  DraftSchema.parse(await (await maria.get(`${ws}/drafts/${draftId}`)).json());

describe("the confirmation (F4.1)", () => {
  it("shows the recipients, subject, attachment and exact text with a token", async () => {
    const cv = await h.cv("Backend (DE)", "de");
    await h.deliver(BERLIN, { roles: [{ cvId: cv.id }] });
    h.ai.answers.draft[`${BERLIN}#0#1`] = draftAnswer({ attachCv: true });
    await h.evaluate(BERLIN);
    await h.drain();
    const draft = await h.live(BERLIN);
    if (!draft) throw new Error("expected a draft");
    await withSmtp();
    const shown = await preview(draft.id);
    expect(shown).toMatchObject({
      draftId: draft.id,
      mailboxId,
      from: { address: "maria.santos@inbox.example" },
      to: [{ address: "recruiter@agency.example" }],
      cc: [],
      subject: "Re: A role for you",
      attachments: [{ fileName: "Backend (DE).pdf" }],
    });
    expect(shown.text).toContain(draftAnswer().body);
    // The quote of the original, as the message leaves.
    expect(shown.text).toContain("> Hello Maria, a backend role for you.");
    expect(Date.parse(shown.expiresAt)).toBe(h.deps.clock.now().getTime() + 15 * 60_000);
    // Showing it sends nothing.
    expect(smtp.sent).toEqual([]);
  });

  it("is refused for a mailbox without SMTP settings, and for a draft not in the mailbox", async () => {
    const draft = await drafted();
    const res = await maria.get(`${ws}/drafts/${draft.id}/send`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "no_smtp" });
    await withSmtp();
    await maria.post(`${ws}/drafts/${draft.id}/discard`, {});
    expect((await maria.get(`${ws}/drafts/${draft.id}/send`)).status).toBe(409);
    expect((await maria.get(`${ws}/drafts/6f1c2f4e-8d3a-4b5c-9e7f-0a1b2c3d4e5f/send`)).status).toBe(
      404,
    );
  });
});

describe("sending (F4.2, F4.4)", () => {
  it("waits out the delay, then sends exactly once, files it in Sent once and keeps the row", async () => {
    const draft = await drafted();
    await withSmtp();
    const shown = await preview(draft.id);
    const res = await confirm(draft.id, shown.token);
    expect(res.status).toBe(202);
    const send = SendSchema.parse(await res.json());
    expect(send).toMatchObject({ status: "scheduled", sentAt: null });
    expect(Date.parse(send.sendAt)).toBe(h.deps.clock.now().getTime() + SEND_DELAY_SECONDS * 1000);

    // Nothing leaves during the delay.
    h.deps.clock.advance(SEND_DELAY_SECONDS * 1000 - 1);
    expect(await h.drain()).toBe(0);
    expect(smtp.sent).toEqual([]);
    expect((await draftNow(draft.id)).send).toMatchObject({ status: "scheduled" });

    h.deps.clock.advance(1);
    await h.drain();
    expect(smtp.sent).toHaveLength(1);
    const [sent] = smtp.sent;
    expect(sent?.envelope).toEqual({
      from: "maria.santos@inbox.example",
      to: ["recruiter@agency.example"],
    });
    expect(sent?.login).toEqual({ ...SMTP, password: SMTP_PASSWORD });
    // The exact text that was shown, in the exact bytes that left.
    expect(sent?.raw).toContain("Hello Jonas,");
    const copies = h.mailbox.messages("sent");
    expect(copies).toHaveLength(1);
    expect(copies[0]?.text).toBe(sent?.raw);
    // The Drafts copy is gone; the draft's row stays, sent (D13).
    expect(h.mailbox.drafts()).toEqual([]);
    const after = await draftNow(draft.id);
    expect(after).toMatchObject({ status: "sent", send: { status: "sent" } });
    expect(events("send.confirmed")).toHaveLength(1);
    expect(events("send.completed")).toEqual([
      expect.objectContaining({ draftId: draft.id, sentCopy: "appended" }),
    ]);
    // No message content in any log line.
    expect(h.deps.rawLogs.join("\n")).not.toContain("Hello Jonas");
    expect(h.deps.rawLogs.join("\n")).not.toContain(SMTP_PASSWORD);

    // Run again (a retry, another replica): nothing is sent or filed twice.
    await runSend(h.deps, { workspaceId: h.ws, sendId: send.id }, new AbortController().signal);
    expect(smtp.sent).toHaveLength(1);
    expect(h.mailbox.messages("sent")).toHaveLength(1);
    // A sent draft can't be sent, edited or discarded, and no new draft is written for the role.
    expect((await maria.get(`${ws}/drafts/${draft.id}/send`)).status).toBe(409);
    expect((await maria.post(`${ws}/drafts/${draft.id}/discard`, {})).status).toBe(409);
    expect((await h.live(BERLIN))?.id).toBe(draft.id);
  });

  it("Undo within the delay means nothing is sent", async () => {
    const draft = await drafted();
    await withSmtp();
    const shown = await preview(draft.id);
    await confirm(draft.id, shown.token);
    h.deps.clock.advance(5_000);
    const res = await maria.delete(`${ws}/drafts/${draft.id}/send`);
    expect(res.status).toBe(200);
    expect(SendSchema.parse(await res.json()).status).toBe("cancelled");
    await waitOut();
    expect(smtp.sent).toEqual([]);
    expect(h.mailbox.messages("sent")).toEqual([]);
    expect(await draftNow(draft.id)).toMatchObject({
      status: "in_mailbox",
      send: { status: "cancelled" },
    });
    expect(events("send.undone")).toEqual([expect.objectContaining({ draftId: draft.id })]);
    // Nothing to undo now.
    expect((await maria.delete(`${ws}/drafts/${draft.id}/send`)).status).toBe(409);
    // It can be sent again, and then it goes.
    await confirm(draft.id, shown.token);
    await waitOut();
    expect(smtp.sent).toHaveLength(1);
  });

  it("doesn't file a second copy where the provider saves sent mail itself (Gmail)", async () => {
    const draft = await drafted();
    await withSmtp({ host: "smtp.gmail.com" });
    await confirm(draft.id, (await preview(draft.id)).token);
    await waitOut();
    expect(smtp.sent).toHaveLength(1);
    expect(h.mailbox.calls.appendSent).toBe(0);
    expect(events("send.completed")).toEqual([expect.objectContaining({ sentCopy: "provider" })]);
  });

  it("fails with fixed words when the SMTP server refuses, never its own", async () => {
    const draft = await drafted();
    await withSmtp();
    await confirm(draft.id, (await preview(draft.id)).token);
    smtp.failNext(new SmtpError("wrong_password", "EAUTH"));
    await waitOut();
    expect(smtp.sent).toEqual([]);
    const after = await draftNow(draft.id);
    expect(after.status).toBe("in_mailbox");
    expect(after.send?.status).toBe("failed");
    expect(after.send?.failureReason).toMatch(/didn't accept the user name or password/);
    expect(events("send.failed")).toEqual([
      expect.objectContaining({ step: "smtp", reason: "wrong_password", code: "EAUTH" }),
    ]);

    // Anything else thrown: a plain reason, and nothing of its text in the logs.
    await confirm(draft.id, (await preview(draft.id)).token);
    smtp.failNext(new Error("554 SERVER-SAYS go to evil.example"));
    await waitOut();
    expect((await draftNow(draft.id)).send?.failureReason).toBe(
      "The message couldn't be sent. Nothing was sent.",
    );
    expect(h.deps.rawLogs.join("\n")).not.toContain("SERVER-SAYS");
  });
});

describe("one confirmed draft at a time (F4.3)", () => {
  it("refuses a send without a token, with a forged one or another user's", async () => {
    const draft = await drafted();
    await withSmtp();
    const shown = await preview(draft.id);
    expect((await confirm(draft.id, undefined)).status).toBe(400);
    expect((await confirm(draft.id, "v1.1.abc.def")).status).toBe(403);
    const forged = shown.token.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect((await confirm(draft.id, forged)).status).toBe(403);
    // Tom is an editor of the workspace, but the token was shown to Maria.
    const tom = await seedUser(h.deps);
    await addMember(h.deps.db, h.ws, tom.id, "editor");
    expect((await confirm(draft.id, shown.token, await h.client(tom))).status).toBe(403);
    await waitOut();
    expect(smtp.sent).toEqual([]);
  });

  it("asks to confirm again when the draft changed after the confirmation, or it expired", async () => {
    const draft = await drafted();
    await withSmtp();
    const shown = await preview(draft.id);
    await maria.patch(`${ws}/drafts/${draft.id}`, { subject: "Re: A role", body: "Changed" });
    const res = await confirm(draft.id, shown.token);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "confirm_again" });
    // A token for the new content works…
    const again = await preview(draft.id);
    expect(again.text).toContain("Changed");
    // …but not after 15 minutes.
    h.deps.clock.advance(15 * 60_000 + 1);
    expect((await confirm(draft.id, again.token)).status).toBe(409);
    await waitOut();
    expect(smtp.sent).toEqual([]);
  });

  it("doesn't send a draft edited during the delay", async () => {
    const draft = await drafted();
    await withSmtp();
    await confirm(draft.id, (await preview(draft.id)).token);
    await maria.patch(`${ws}/drafts/${draft.id}`, { subject: "Re: A role", body: "Changed" });
    await waitOut();
    expect(smtp.sent).toEqual([]);
    expect((await draftNow(draft.id)).send).toMatchObject({
      status: "failed",
      failureReason: expect.stringMatching(/changed after you confirmed/),
    });
  });

  it("schedules one send per draft: a second confirmation while one waits is refused", async () => {
    const draft = await drafted();
    await withSmtp();
    const { token } = await preview(draft.id);
    expect((await confirm(draft.id, token)).status).toBe(202);
    const second = await confirm(draft.id, token);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: "already_sending" });
    await waitOut();
    expect(smtp.sent).toHaveLength(1);
  });
});

describe("who can send (F4.5)", () => {
  it("viewers can't, a member who sees the pipeline only doesn't see it, outsiders neither", async () => {
    const draft = await drafted();
    await withSmtp();
    const viewer = await seedUser(h.deps);
    await addMember(h.deps.db, h.ws, viewer.id, "viewer");
    const asViewer = await h.client(viewer);
    const pipeline = await seedUser(h.deps);
    await addMember(h.deps.db, h.ws, pipeline.id, "admin");
    await setMemberScope(h.deps.db, h.ws, pipeline.id, "pipeline");
    const asPipeline = await h.client(pipeline);
    const asOutsider = await h.client(await seedUser(h.deps));
    const { token } = await preview(draft.id);
    for (const [client, status] of [
      [asViewer, 403],
      [asPipeline, 404],
      [asOutsider, 404],
    ] as const) {
      expect((await client.get(`${ws}/drafts/${draft.id}/send`)).status).toBe(status);
      expect((await confirm(draft.id, token, client)).status).toBe(status);
      expect((await client.delete(`${ws}/drafts/${draft.id}/send`)).status).toBe(status);
    }
    await waitOut();
    expect(smtp.sent).toEqual([]);
  });

  it("puts every send in the activity log, by id, with who confirmed it (F9.1)", async () => {
    const draft = await drafted();
    await withSmtp();
    const res = await confirm(draft.id, (await preview(draft.id)).token);
    const send = SendSchema.parse(await res.json());
    await waitOut();
    const rows = await activityRows(h.deps.db, h.ws);
    expect(rows.filter((r) => r.kind === "mail.sent")).toEqual([
      {
        kind: "mail.sent",
        actorKind: "user",
        actorId: h.maria.id,
        targetUserId: null,
        refs: { draftId: draft.id, sendId: send.id, messageId: BERLIN, position: 0, mailboxId },
      },
    ]);
  });
});

describe("Settings › Sending", () => {
  it("saves a mailbox's SMTP settings and never returns the password", async () => {
    const get = async () =>
      SmtpSettingsViewSchema.parse(
        await (await maria.get(`${ws}/mailboxes/${mailboxId}/smtp`)).json(),
      );
    expect(await get()).toEqual({ smtp: null, savesSentCopy: false });
    await withSmtp();
    const res = await maria.get(`${ws}/mailboxes/${mailboxId}/smtp`);
    const text = await res.text();
    expect(text).not.toContain(SMTP_PASSWORD);
    expect(JSON.parse(text)).toEqual({ smtp: SMTP, savesSentCopy: false });
    expect(h.deps.rawLogs.join("\n")).not.toContain(SMTP_PASSWORD);
  });

  it("uses a stored password only with the host it was given for", async () => {
    const put = (body: Record<string, unknown>) =>
      maria.put(`${ws}/mailboxes/${mailboxId}/smtp`, { ...SMTP, ...body });
    // The first settings need it.
    expect((await put({})).status).toBe(400);
    await withSmtp();
    // Same host: kept, for saving and for Test.
    expect((await put({ username: "maria2" })).status).toBe(200);
    const test = await maria.post(`${ws}/mailboxes/${mailboxId}/smtp/test`, SMTP);
    expect(await test.json()).toEqual({ ok: true });
    expect(smtp.tests).toEqual([{ ...SMTP, password: SMTP_PASSWORD }]);
    // Another host: the stored password never goes there.
    expect((await put({ host: "smtp.elsewhere.example" })).status).toBe(400);
    const elsewhere = await maria.post(`${ws}/mailboxes/${mailboxId}/smtp/test`, {
      ...SMTP,
      host: "smtp.elsewhere.example",
    });
    expect(elsewhere.status).toBe(400);
    expect(smtp.tests).toHaveLength(1);
  });

  it("takes a plain host only, and refuses plain text unless the server allows it", async () => {
    for (const host of ["smtps://smtp.inbox.example", "smtp.inbox.example:25", "a@b.example"]) {
      expect(
        (await maria.put(`${ws}/mailboxes/${mailboxId}/smtp`, { ...SMTP, host, password: "p" }))
          .status,
      ).toBe(400);
    }
    const plain = { ...SMTP, port: 25, tlsMode: "none", password: "p" };
    const res = await maria.put(`${ws}/mailboxes/${mailboxId}/smtp`, plain);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "insecure_refused" });
    expect(
      await (await maria.post(`${ws}/mailboxes/${mailboxId}/smtp/test`, plain)).json(),
    ).toMatchObject({
      ok: false,
      reason: "insecure_refused",
    });
    expect(smtp.tests).toEqual([]);
  });

  it("is changed by admins only, and stays in the workspace", async () => {
    const editor = await seedUser(h.deps);
    await addMember(h.deps.db, h.ws, editor.id, "editor");
    const asEditor = await h.client(editor);
    const body = { ...SMTP, password: "p" };
    expect((await asEditor.put(`${ws}/mailboxes/${mailboxId}/smtp`, body)).status).toBe(403);
    expect((await asEditor.post(`${ws}/mailboxes/${mailboxId}/smtp/test`, body)).status).toBe(403);
    // Another workspace's admin, with this mailbox's id in their own workspace's URL.
    const other = await seedUser(h.deps);
    const asOther = await h.client(other);
    const theirs = `/api/workspaces/${other.workspaceId}/mailboxes/${mailboxId}/smtp`;
    expect((await asOther.put(theirs, body)).status).toBe(404);
    expect((await asOther.get(theirs)).status).toBe(404);
  });
});

describe("a Google mailbox (F3, F4)", () => {
  const google = {
    clientId: "c",
    clientSecret: "E2E-SECRET-google",
    authorizeUrl: "https://accounts.google.test/auth",
    tokenUrl: "https://oauth2.google.test/token",
    imap: { host: "imap.gmail.com", port: 993, tlsMode: "tls" as const },
    smtp: { host: "smtp.gmail.com", port: 465, tlsMode: "tls" as const },
  };
  const mailbox = (): StoredMailbox => ({
    mailboxId: "6f1c2f4e-8d3a-4b5c-9e7f-0a1b2c3d4e5f",
    address: "maria.gmail@gmail.example",
    host: "imap.gmail.com",
    port: 993,
    tlsMode: "tls",
    username: "maria.gmail@gmail.example",
    secretCiphertext: seal(
      h.deps.config.secretKey,
      JSON.stringify({
        accessToken: "E2E-SECRET-access",
        refreshToken: "E2E-SECRET-refresh",
        expiresAt: "2026-10-16T11:00:00.000Z",
        email: "maria.gmail@gmail.example",
      }),
    ),
    sentFolderPath: null,
    status: "connected",
    authKind: "google",
  });

  it("sends through the server's Google SMTP host only, with its access token", () => {
    h.deps.config.google = google;
    const smtp = googleSmtp(h.deps, mailbox());
    expect(smtp).toEqual({
      ...google.smtp,
      username: "maria.gmail@gmail.example",
      secretCiphertext: null,
    });
    if (!smtp) throw new Error("expected Google's SMTP");
    expect(smtpLogin(h.deps, { mailbox: mailbox(), smtp })).toEqual({
      ...google.smtp,
      username: "maria.gmail@gmail.example",
      accessToken: "E2E-SECRET-access",
    });
    expect(providerSavesSentCopy({ mailbox: mailbox(), smtp })).toBe(true);
    // Without Google set up on the server, it can't send.
    h.deps.config.google = null;
    expect(googleSmtp(h.deps, mailbox())).toBeNull();
  });
});
