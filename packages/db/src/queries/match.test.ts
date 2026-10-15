import { createHash } from "node:crypto";
import type { Envelope, JobFacts, MatchAiOutput, MatchTaskInput } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import { insertCv } from "./cvs";
import { getMatchAnswer, type MatchAnswerKey, matchInputHash, saveMatchAnswer } from "./match";
import { saveAnalysis, saveEnvelopes } from "./messages";

// Stored match.v1 answers (match_ai_answers): stored and looked up by message, position, CV and
// input hash, where the hash covers exactly what the model saw, the chosen CV's skills included.

let conn: DatabaseConnection;
let ws: string;
let other: string;
const at = new Date("2026-10-15T12:00:00Z");
const MESSAGE = "<m1@agency.example>";

const envelope = (messageId: string): Envelope => ({
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
  subject: "A role",
  listId: null,
  listUnsubscribe: null,
  precedence: null,
  autoSubmitted: null,
  snippet: "",
});

const facts = (title: string): JobFacts => ({
  title,
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
  skills: ["Go"],
  languages: [],
  applyUrl: null,
  extra: {},
});

async function seedRoles(workspaceId: string) {
  await saveEnvelopes(conn.db, workspaceId, [
    { envelope: envelope(MESSAGE), verdict: "likely_job", reason: null },
  ]);
  await saveAnalysis(conn.db, workspaceId, {
    messageId: MESSAGE,
    scanId: null,
    category: "recruiter_outreach",
    roles: [facts("Backend Engineer"), facts("Platform Engineer")],
  });
}

const cv = (workspaceId: string, name: string) =>
  insertCv(conn.db, workspaceId, {
    name,
    fileName: `${name}.pdf`,
    mediaType: "pdf",
    bytes: new TextEncoder().encode(name),
    contentHash: createHash("sha256").update(name).digest("hex"),
    createdBy: null,
    at,
  });

beforeEach(async () => {
  conn = await openTestDatabase();
  const ids: string[] = [];
  for (const key of ["maria", "tom"]) {
    const r = await registerAccount(conn.db, {
      name: key,
      email: `${key}@inbox.example`,
      passwordHash: "h",
      workspaceName: key,
    });
    if (!r.ok) throw new Error("expected ok");
    ids.push(r.workspaceId);
  }
  [ws, other] = ids as [string, string];
  await seedRoles(ws);
  await seedRoles(other);
});
afterEach(() => conn.close());

const input: MatchTaskInput = {
  messageId: MESSAGE,
  position: 0,
  role: { title: "Backend Engineer", skills: ["Go"] },
  profile: { targetRoles: ["Backend Engineer"], skills: [] },
  cvSkills: ["Go", "PostgreSQL"],
};

const answer = (reason: string): MatchAiOutput => ({
  titleFit: { verdict: "fits", reason },
  skillCloseness: [{ skill: "Go", verdict: "fits", reason: "in the CV" }],
});

describe("matchInputHash", () => {
  it("covers the title and skills, the target roles and skills, and the chosen CV's skills", () => {
    const base = matchInputHash(input);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(matchInputHash(structuredClone(input))).toBe(base);
    const changes: MatchTaskInput[] = [
      { ...input, role: { ...input.role, title: "Platform Engineer" } },
      { ...input, role: { ...input.role, skills: ["Go", "Kafka"] } },
      { ...input, profile: { ...input.profile, targetRoles: ["Data Engineer"] } },
      { ...input, profile: { ...input.profile, skills: ["Kafka"] } },
      { ...input, cvSkills: ["Go"] },
      { ...input, cvSkills: ["PostgreSQL", "Go"] },
    ];
    for (const changed of changes) expect(matchInputHash(changed)).not.toBe(base);
    // The role is the key's own part, not the hash's.
    expect(matchInputHash({ ...input, messageId: "<other@x.example>", position: 3 })).toBe(base);
  });
});

describe("stored match.v1 answers", () => {
  it("are looked up by message, position, CV and input hash", async () => {
    const backend = await cv(ws, "backend");
    const data = await cv(ws, "data");
    const key: MatchAnswerKey = {
      messageId: MESSAGE,
      position: 0,
      cvId: backend.id,
      inputHash: matchInputHash(input),
    };
    expect(await getMatchAnswer(conn.db, ws, key)).toBeNull();
    await saveMatchAnswer(conn.db, ws, key, answer("first"), at);
    expect(await getMatchAnswer(conn.db, ws, key)).toEqual(answer("first"));

    // Any other part of the key finds nothing.
    expect(await getMatchAnswer(conn.db, ws, { ...key, position: 1 })).toBeNull();
    expect(await getMatchAnswer(conn.db, ws, { ...key, cvId: data.id })).toBeNull();
    expect(await getMatchAnswer(conn.db, ws, { ...key, cvId: null })).toBeNull();
    expect(await getMatchAnswer(conn.db, ws, { ...key, messageId: "<nope@x.example>" })).toBeNull();
    const otherSkills = matchInputHash({ ...input, cvSkills: ["Go"] });
    expect(await getMatchAnswer(conn.db, ws, { ...key, inputHash: otherSkills })).toBeNull();
    // Another workspace never sees it.
    expect(await getMatchAnswer(conn.db, other, key)).toBeNull();
  });

  it("keep the first answer for a key, and work with no CV chosen", async () => {
    const key: MatchAnswerKey = {
      messageId: MESSAGE,
      position: 1,
      cvId: null,
      inputHash: matchInputHash({ ...input, position: 1, cvSkills: [] }),
    };
    await saveMatchAnswer(conn.db, ws, key, answer("first"), at);
    await saveMatchAnswer(conn.db, ws, key, answer("second"), at);
    expect(await getMatchAnswer(conn.db, ws, key)).toEqual(answer("first"));
  });
});
