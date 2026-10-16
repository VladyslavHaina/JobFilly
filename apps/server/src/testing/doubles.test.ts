import { getCv, getCvFile, listProfileCvs } from "@jobfilly/db";
import { MailUnavailableError } from "@jobfilly/mail";
import type { DraftMailInput, MailConnection } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeAi } from "./ai";
import { createFakeDomains, createTestDeps, TEST_AI_MODELS, type TestDeps } from "./deps";
import { createFakeMailbox } from "./mailbox";
import { seedCv, seedUser } from "./seed";

// The test doubles the slices build on: each switch does what its comment promises.

const CONN: MailConnection = {
  host: "imap",
  port: 3143,
  tlsMode: "none",
  username: "maria",
  password: "E2E-SECRET-x",
};
const connect = (box: ReturnType<typeof createFakeMailbox>) =>
  box.port.connect(CONN, { allowInsecure: true, address: "maria.santos@inbox.example" });

const reply = (original: DraftMailInput["original"]): DraftMailInput => ({
  original,
  reply: { subject: "Re: Backend role", body: "Hello" },
  attachment: { fileName: "cv.pdf", contentType: "application/pdf", bytes: new Uint8Array([1]) },
});

describe("the fake mailbox", () => {
  it("delivers mail with increasing UIDs and fetches it since a UID", async () => {
    const box = createFakeMailbox({ uidValidity: 7 });
    const a = box.deliver({ messageId: "<a@x>", text: "first" });
    box.deliver({ messageId: "<b@x>", text: "second" });
    expect(a).toMatchObject({ folder: "inbox", folderPath: "INBOX", uidValidity: 7, uid: 1 });
    const client = connect(box);
    expect(await client.fetchSince({ folder: "inbox", uidValidity: 7, afterUid: 1 })).toMatchObject(
      {
        uidValidity: 7,
        changed: false,
        messages: [{ messageId: "<b@x>", uid: 2 }],
      },
    );
    expect(await client.fetchBody({ folderPath: "INBOX", uidValidity: 7, uid: 1 })).toEqual({
      text: "first",
    });
    expect(box.calls).toMatchObject({ connect: 1, fetchSince: 1, fetchBody: 1 });
  });

  it("renumbers UIDs under a new UIDVALIDITY, keeping the Message-IDs", async () => {
    const box = createFakeMailbox({ uidValidity: 7 });
    box.deliver({ messageId: "<a@x>" });
    box.deliver({ messageId: "<b@x>" });
    box.setUidValidity("inbox", 8);
    const client = connect(box);
    const result = await client.fetchSince({ folder: "inbox", uidValidity: 7, afterUid: 2 });
    expect(result.changed).toBe(true);
    expect(result.messages.map((m) => [m.messageId, m.uid, m.uidValidity])).toEqual([
      ["<a@x>", 1, 8],
      ["<b@x>", 2, 8],
    ]);
    // An old reference names nothing any more.
    expect(await client.fetchOriginal({ folderPath: "INBOX", uidValidity: 7, uid: 1 })).toBeNull();
  });

  it("records each saved draft with its original, reply, attachment and \\Draft flag", async () => {
    const box = createFakeMailbox();
    const env = box.deliver({ messageId: "<a@x>", subject: "Backend role", text: "Hi Maria" });
    const client = connect(box);
    const original = await client.fetchOriginal({
      folderPath: env.folderPath,
      uidValidity: env.uidValidity,
      uid: env.uid,
    });
    if (!original) throw new Error("expected the original");
    expect(original).toMatchObject({
      messageId: "<a@x>",
      subject: "Backend role",
      text: "Hi Maria",
    });
    expect(await client.ensureDraftsFolder()).toEqual({ path: "Drafts" });
    const ref = await client.saveDraft(reply(original));
    expect(box.drafts()).toMatchObject([
      {
        uid: ref.uid,
        flags: ["\\Draft"],
        original: { messageId: "<a@x>" },
        reply: { body: "Hello" },
      },
    ]);
    const replaced = await client.replaceDraft(ref, {
      ...reply(original),
      reply: { subject: "s", body: "New" },
    });
    expect(box.drafts().map((d) => d.reply.body)).toEqual(["New"]);
    await client.deleteDraft(replaced);
    expect(box.drafts()).toEqual([]);

    // A Message-ID the caller chose is the draft's; a ref without a known UIDVALIDITY (0)
    // finds the copy by it, as after a rebuilt folder.
    const chosen = await client.saveDraft({ ...reply(original), draftMessageId: "<mine@x>" });
    expect(chosen.draftMessageId).toBe("<mine@x>");
    await client.deleteDraft({
      path: "Drafts",
      uid: 0,
      uidValidity: 0,
      draftMessageId: "<mine@x>",
    });
    expect(box.drafts()).toEqual([]);
  });

  it("fails every operation while paused, and works again after resume", async () => {
    const box = createFakeMailbox();
    const env = box.deliver({ messageId: "<a@x>" });
    box.pause();
    const client = connect(box);
    const ref = { folderPath: env.folderPath, uidValidity: env.uidValidity, uid: env.uid };
    await expect(client.fetchOriginal(ref)).rejects.toBeInstanceOf(MailUnavailableError);
    await expect(
      client.fetchSince({ folder: "inbox", uidValidity: null, afterUid: 0 }),
    ).rejects.toBeInstanceOf(MailUnavailableError);
    box.resume();
    expect(await client.fetchOriginal(ref)).toMatchObject({ messageId: "<a@x>" });
  });

  it("fails one operation once with failNext, connect included", async () => {
    const box = createFakeMailbox();
    const env = box.deliver({ messageId: "<a@x>" });
    const ref = { folderPath: env.folderPath, uidValidity: env.uidValidity, uid: env.uid };
    const client = connect(box);
    const original = await client.fetchOriginal(ref);
    if (!original) throw new Error("expected the original");
    box.failNext("saveDraft");
    await expect(client.saveDraft(reply(original))).rejects.toBeInstanceOf(MailUnavailableError);
    await expect(client.saveDraft(reply(original))).resolves.toMatchObject({ path: "Drafts" });
    box.failNext("fetchSince", new Error("boom"));
    await expect(
      client.fetchSince({ folder: "inbox", uidValidity: null, afterUid: 0 }),
    ).rejects.toThrow("boom");
    box.failNext("connect");
    await expect(connect(box).fetchOriginal(ref)).rejects.toBeInstanceOf(MailUnavailableError);
    await expect(connect(box).fetchOriginal(ref)).resolves.not.toBeNull();
    expect(box.calls.fetchBody).toBe(0);
  });
});

describe("the fake DomainPort", () => {
  it("answers set domains, a default for others, fails on 'fail', and counts calls", async () => {
    const domains = createFakeDomains();
    domains.setRdap("young.example", { registeredAt: "2026-09-30T00:00:00.000Z" });
    domains.setMx("nomail.example", []);
    domains.setRdap("down.example", "fail");
    domains.setMx("down.example", "fail");
    expect(await domains.rdap("Young.Example")).toEqual({
      registeredAt: "2026-09-30T00:00:00.000Z",
    });
    expect(await domains.rdap("other.example")).toEqual({
      registeredAt: "2016-10-01T00:00:00.000Z",
    });
    expect(await domains.mx("nomail.example")).toEqual([]);
    expect(await domains.mx("other.example")).toEqual(["mx.other.example"]);
    await expect(domains.rdap("down.example")).rejects.toThrow();
    await expect(domains.mx("down.example")).rejects.toThrow();
    expect(domains.calls).toEqual({
      rdap: ["Young.Example", "other.example", "down.example"],
      mx: ["nomail.example", "other.example", "down.example"],
    });
  });
});

describe("the fake AI", () => {
  const cvAnswer = {
    language: "en",
    skills: ["Go"],
    roleFamilies: [],
    seniority: null,
    countryHints: [],
    formatHints: [],
  };
  const settings = {
    provider: "openai-compatible" as const,
    baseUrl: "http://fake-ai/v1",
    models: TEST_AI_MODELS,
    apiKey: null,
  };

  it("answers the MVP 2 tasks by their keys, and fails what it has no answer for", async () => {
    const ai = createFakeAi({
      cv: { [`${"a".repeat(64)}`]: cvAnswer },
      match: { "<m@x>#1": { titleFit: { verdict: "fits", reason: "r" }, skillCloseness: [] } },
      draft: {
        "<m@x>#0#2": {
          subject: "Re",
          body: "Hi",
          language: "en",
          usedEntries: [],
          attachCv: false,
          questions: [],
        },
      },
      assistant: { "hide asia": { reply: "ok", clarify: null, proposal: null } },
    });
    const client = ai.port.client(settings);
    expect(
      await client.readCv({ contentHash: "a".repeat(64), fileName: "x", text: "Go" }),
    ).toMatchObject({
      ok: true,
      data: cvAnswer,
      usage: [{ task: "cv.v1" }],
    });
    const match = {
      messageId: "<m@x>",
      position: 1,
      role: { title: null, skills: [] },
      profile: { targetRoles: [], skills: [] },
      cvSkills: [],
    };
    expect((await client.match(match)).ok).toBe(true);
    expect((await client.match({ ...match, position: 0 })).ok).toBe(false);
    const mail = {
      messageId: "<m@x>",
      folder: "inbox" as const,
      from: { address: "a@x", name: null },
      date: "2026-10-01T00:00:00.000Z",
      subject: "s",
      text: "t",
    };
    const draft = {
      attempt: 1 as const,
      mail,
      position: 0,
      role: {
        title: null,
        company: null,
        agency: null,
        places: [],
        workMode: null,
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
      },
      entries: [],
      cv: null,
    };
    expect((await client.draft(draft)).ok).toBe(false);
    expect((await client.draft({ ...draft, attempt: 2 })).ok).toBe(true);
    // Another role of the same message has its own answers.
    expect((await client.draft({ ...draft, position: 1, attempt: 2 })).ok).toBe(false);
    const turn = { turn: 3, text: "hide asia", history: [], entries: [], rules: [] };
    expect(await client.assistant(turn)).toMatchObject({ ok: true, data: { reply: "ok" } });
    expect(ai.calls).toMatchObject({ cv: 1, match: 2, draft: 3, assistant: 1 });
    expect(ai.log.map((l) => l.key)).toContain("<m@x>#0#2");
  });

  it("fails a task's next call once with failNext", async () => {
    const ai = createFakeAi({ cv: { [`${"b".repeat(64)}`]: cvAnswer } });
    const client = ai.port.client(settings);
    const input = { contentHash: "b".repeat(64), fileName: "x", text: "" };
    ai.failNext("cv", "unreachable");
    expect(await client.readCv(input)).toMatchObject({ ok: false, error: { kind: "unreachable" } });
    expect((await client.readCv(input)).ok).toBe(true);
  });
});

describe("seedCv", () => {
  let deps: TestDeps;
  beforeEach(async () => {
    deps = await createTestDeps();
  });
  afterEach(() => deps.close());

  it("stores a read CV with its skills, file and profile link", async () => {
    const maria = await seedUser(deps);
    const cv = await seedCv(deps, maria.workspaceId, {
      name: "Backend (DE)",
      mediaType: "docx",
      language: "de",
      skills: ["Go", "PostgreSQL"],
      text: "Kenntnisse: Go, PostgreSQL",
    });
    expect(cv).toMatchObject({
      name: "Backend (DE)",
      fileName: "Backend (DE).docx",
      language: "de",
      skills: ["Go", "PostgreSQL"],
      readStatus: "done",
    });
    expect((await getCv(deps.db, maria.workspaceId, cv.id))?.text).toBe(
      "Kenntnisse: Go, PostgreSQL",
    );
    expect((await getCvFile(deps.db, maria.workspaceId, cv.id))?.mediaType).toBe("docx");
    const unread = await seedCv(deps, maria.workspaceId, { name: "New", unread: true });
    expect(unread).toMatchObject({ readStatus: "pending", skills: [] });
    expect(
      await listProfileCvs(deps.db, maria.workspaceId, "00000000-0000-4000-8000-000000000000"),
    ).toEqual([]);
  });
});
