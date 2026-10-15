import { MAX_CV_BYTES } from "@jobfilly/schema";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { drafts, roleCvChoices } from "../tables";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import {
  deleteCv,
  findCvReadByHash,
  getCv,
  getCvFile,
  getRoleCvChoice,
  insertCv,
  linkCvToProfiles,
  linkProfileCv,
  listCvs,
  listCvsForProfile,
  listProfileCvs,
  markCvReadFailed,
  saveCvRead,
  setRoleCvChoice,
  updateCvTags,
} from "./cvs";
import { claimDraft } from "./draft-claims";
import { getEvaluations, saveEvaluation } from "./evaluations";
import { saveAnalysis, saveEnvelopes } from "./messages";
import { createConfirmedProfile } from "./profiles";

let conn: DatabaseConnection;
let ws: string;
let other: string;
let userId: string;
const at = new Date("2026-10-01T10:00:00Z");

beforeEach(async () => {
  conn = await openTestDatabase();
  uploads = 0;
  const made = [];
  for (const key of ["maria", "tom"]) {
    const r = await registerAccount(conn.db, {
      name: key,
      email: `${key}@inbox.example`,
      passwordHash: "h",
      workspaceName: key,
    });
    if (!r.ok) throw new Error("expected ok");
    made.push(r);
  }
  ws = made[0]?.workspaceId ?? "";
  other = made[1]?.workspaceId ?? "";
  userId = made[0]?.user.id ?? "";
});
afterEach(() => conn.close());

let uploads = 0;
const upload = (
  w: string,
  name: string,
  bytes = new Uint8Array([37, 80, 68, 70]),
  contentHash = "a".repeat(64),
) =>
  insertCv(conn.db, w, {
    name,
    fileName: `${name}.pdf`,
    mediaType: "pdf",
    bytes,
    contentHash,
    createdBy: userId,
    at: new Date(at.getTime() + 1000 * uploads++),
  });

async function confirmProfile(w = ws) {
  const created = await createConfirmedProfile(conn.db, w, {
    name: "p",
    entries: [],
    createdBy: userId,
    at,
  });
  if (!created.ok) throw new Error("expected a profile");
  return created.profile.id;
}

const READ = {
  language: "de",
  skills: ["Go"],
  roleFamilies: ["Backend engineering"],
  seniority: "Senior",
  countryHints: ["DE"],
  formatHints: [],
};

/** A job message with one role, stored as the scan leaves it. */
async function seedJobMessage(messageId: string, w = ws) {
  await saveEnvelopes(conn.db, w, [
    {
      envelope: {
        messageId,
        folder: "inbox",
        folderPath: "INBOX",
        uidValidity: 1,
        uid: 1,
        date: at.toISOString(),
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
      },
      verdict: "likely_job",
      reason: null,
    },
  ]);
  await saveAnalysis(conn.db, w, {
    messageId,
    scanId: null,
    category: "recruiter_outreach",
    roles: [
      {
        title: "Backend",
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
    ],
  });
}

describe("CV base queries (F2)", () => {
  it("stores an upload as not read yet, with no skills until cv.v1 reads it", async () => {
    const cv = await upload(ws, "Backend (EN)");
    expect(cv).toEqual({
      id: cv.id,
      name: "Backend (EN)",
      fileName: "Backend (EN).pdf",
      mediaType: "pdf",
      sizeBytes: 4,
      contentHash: "a".repeat(64),
      language: null,
      skills: [],
      roleFamilies: [],
      seniority: null,
      countryHints: [],
      formatHints: [],
      tags: [],
      readStatus: "pending",
      uploadedAt: at.toISOString(),
    });
    expect(await getCv(conn.db, ws, cv.id)).toEqual({ ...cv, text: null });
  });

  it("gives back the exact bytes, file name and media type", async () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    const cv = await upload(ws, "Binary", bytes);
    const file = await getCvFile(conn.db, ws, cv.id);
    expect(file?.fileName).toBe("Binary.pdf");
    expect(file?.mediaType).toBe("pdf");
    expect([...(file?.bytes ?? [])]).toEqual([...bytes]);
  });

  it("lists a workspace's CVs and a profile's linked ones, never another workspace's", async () => {
    const a = await upload(ws, "A");
    const b = await upload(ws, "B");
    await upload(other, "Tom's");
    expect((await listCvs(conn.db, ws)).map((c) => c.name)).toEqual(["A", "B"]);
    const profileId = await confirmProfile();
    await linkProfileCv(conn.db, ws, profileId, b.id);
    await linkProfileCv(conn.db, ws, profileId, b.id);
    expect((await listProfileCvs(conn.db, ws, profileId)).map((c) => c.id)).toEqual([b.id]);
    expect(await getCv(conn.db, other, a.id)).toBeNull();
    expect(await getCvFile(conn.db, other, a.id)).toBeNull();
  });
});

describe("CV files in Postgres (F2.4)", () => {
  it("accepts a file of exactly 5 MB and refuses a larger one", async () => {
    await expect(upload(ws, "Max", new Uint8Array(MAX_CV_BYTES))).resolves.toMatchObject({
      sizeBytes: MAX_CV_BYTES,
    });
    await expect(upload(ws, "Too big", new Uint8Array(MAX_CV_BYTES + 1))).rejects.toThrow();
  });
});

describe("reading and tags (F2.1)", () => {
  it("saves what cv.v1 read with the tags, and finds it again by content hash", async () => {
    const cv = await upload(ws, "Backend (DE)", undefined, "b".repeat(64));
    expect(await findCvReadByHash(conn.db, ws, "b".repeat(64))).toBeNull();
    const tags = [
      { label: "German", source: "ai" as const },
      { label: "preferred", source: "you" as const },
    ];
    const read = await saveCvRead(conn.db, ws, cv.id, { metadata: READ, tags, at });
    expect(read).toMatchObject({
      readStatus: "done",
      language: "de",
      skills: ["Go"],
      roleFamilies: ["Backend engineering"],
      seniority: "Senior",
      countryHints: ["DE"],
      tags,
    });
    expect(await findCvReadByHash(conn.db, ws, "b".repeat(64))).toEqual(READ);
    expect(await findCvReadByHash(conn.db, other, "b".repeat(64))).toBeNull();
  });

  it("marks a failed read, edits tags, and touches only its own workspace", async () => {
    const cv = await upload(ws, "CV");
    await markCvReadFailed(conn.db, ws, cv.id, at);
    expect((await getCv(conn.db, ws, cv.id))?.readStatus).toBe("failed");
    const tags = [{ label: "preferred", source: "you" as const }];
    expect((await updateCvTags(conn.db, ws, cv.id, tags, at))?.tags).toEqual(tags);
    expect(await updateCvTags(conn.db, other, cv.id, [], at)).toBeNull();
    expect(await saveCvRead(conn.db, other, cv.id, { metadata: READ, tags: [], at })).toBeNull();
    expect((await getCv(conn.db, ws, cv.id))?.tags).toEqual(tags);
  });
});

describe("profile links", () => {
  it("links a new CV to every profile of the workspace", async () => {
    const profileId = await confirmProfile();
    const cv = await upload(ws, "CV");
    await linkCvToProfiles(conn.db, ws, cv.id);
    await linkCvToProfiles(conn.db, ws, cv.id);
    expect((await listProfileCvs(conn.db, ws, profileId)).map((c) => c.id)).toEqual([cv.id]);
  });

  it("does nothing before a profile exists", async () => {
    const cv = await upload(ws, "CV");
    await expect(linkCvToProfiles(conn.db, ws, cv.id)).resolves.toBeUndefined();
  });

  it("offers a profile its linked CVs and those no profile has yet, never another's", async () => {
    await upload(ws, "Uploaded before the profile");
    const profileId = await confirmProfile();
    const linked = await upload(ws, "Linked");
    await linkCvToProfiles(conn.db, ws, linked.id);
    await upload(other, "Tom's");
    const otherProfile = await confirmProfile(other);
    const toms = await upload(other, "Tom's linked");
    await linkCvToProfiles(conn.db, other, toms.id);
    expect((await listCvsForProfile(conn.db, ws, profileId)).map((c) => c.name)).toEqual([
      "Uploaded before the profile",
      "Linked",
    ]);
    expect((await listCvsForProfile(conn.db, other, otherProfile)).map((c) => c.name)).toEqual([
      "Tom's",
      "Tom's linked",
    ]);
  });
});

describe("the CV an editor chose for a role (F2.3)", () => {
  it("sets, replaces and clears the choice", async () => {
    await seedJobMessage("<m1@agency.example>");
    const a = await upload(ws, "A");
    const b = await upload(ws, "B");
    const role = { messageId: "<m1@agency.example>", position: 0 };
    expect(await getRoleCvChoice(conn.db, ws, role)).toBeNull();
    const set = await setRoleCvChoice(conn.db, ws, { ...role, cvId: a.id, userId, at });
    expect(set).toEqual({ ok: true, cv: a });
    await setRoleCvChoice(conn.db, ws, { ...role, cvId: b.id, userId, at });
    expect(await getRoleCvChoice(conn.db, ws, role)).toBe(b.id);
    expect(await setRoleCvChoice(conn.db, ws, { ...role, cvId: null, userId, at })).toEqual({
      ok: true,
      cv: null,
    });
    expect(await getRoleCvChoice(conn.db, ws, role)).toBeNull();
  });

  it("refuses a role or a CV the workspace doesn't have", async () => {
    await seedJobMessage("<m1@agency.example>");
    const toms = await upload(other, "Tom's");
    const role = { messageId: "<m1@agency.example>", position: 0 };
    expect(await setRoleCvChoice(conn.db, ws, { ...role, cvId: toms.id, userId, at })).toEqual({
      ok: false,
      error: "unknown_cv",
    });
    expect(
      await setRoleCvChoice(conn.db, ws, { ...role, position: 3, cvId: null, userId, at }),
    ).toEqual({ ok: false, error: "not_found" });
    expect(await setRoleCvChoice(conn.db, other, { ...role, cvId: toms.id, userId, at })).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("deleting a CV (F2.5)", () => {
  it("removes the file, its links and overrides; drafts and evaluations stay with cv_id null", async () => {
    const messageId = "<m1@agency.example>";
    await seedJobMessage(messageId);
    const profileId = await confirmProfile();
    const cv = await upload(ws, "Data engineering (EN)");
    const keep = await upload(ws, "Backend (EN)");
    await linkCvToProfiles(conn.db, ws, cv.id);
    await linkCvToProfiles(conn.db, ws, keep.id);
    const role = { messageId, position: 0 };
    await setRoleCvChoice(conn.db, ws, { ...role, cvId: cv.id, userId, at });
    await saveEvaluation(
      conn.db,
      ws,
      messageId,
      {
        position: 0,
        match: null,
        hidden: null,
        ruleEffects: [],
        cvChoice: { cvId: cv.id, reason: "You chose it", source: "you" },
      },
      at,
    );
    const draft = await claimDraft(conn.db, ws, role, { origin: "on_demand", now: at });
    await conn.db
      .update(drafts)
      .set({ status: "in_mailbox", cvId: cv.id })
      .where(eq(drafts.id, draft?.id ?? ""));

    expect(await deleteCv(conn.db, other, cv.id)).toBe(false);
    expect(await deleteCv(conn.db, ws, cv.id)).toBe(true);
    expect(await deleteCv(conn.db, ws, cv.id)).toBe(false);

    expect(await getCv(conn.db, ws, cv.id)).toBeNull();
    expect(await getCvFile(conn.db, ws, cv.id)).toBeNull();
    expect((await listProfileCvs(conn.db, ws, profileId)).map((c) => c.id)).toEqual([keep.id]);
    expect(await conn.db.select().from(roleCvChoices)).toEqual([]);
    const [kept] = await conn.db.select().from(drafts);
    expect(kept).toMatchObject({ id: draft?.id, status: "in_mailbox", cvId: null });
    const [evaluation] = await getEvaluations(conn.db, ws, [messageId]);
    expect(evaluation?.cvChoice.cvId).toBeNull();
  });
});
