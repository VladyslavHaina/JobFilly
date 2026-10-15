import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import { getCv, getCvFile, insertCv, linkProfileCv, listCvs, listProfileCvs } from "./cvs";
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
const upload = (w: string, name: string, bytes = new Uint8Array([37, 80, 68, 70])) =>
  insertCv(conn.db, w, {
    name,
    fileName: `${name}.pdf`,
    mediaType: "pdf",
    bytes,
    contentHash: "a".repeat(64),
    createdBy: userId,
    at: new Date(at.getTime() + 1000 * uploads++),
  });

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
    const created = await createConfirmedProfile(conn.db, ws, {
      name: "p",
      entries: [],
      createdBy: userId,
      at,
    });
    if (!created.ok) throw new Error("expected a profile");
    await linkProfileCv(conn.db, ws, created.profile.id, b.id);
    await linkProfileCv(conn.db, ws, created.profile.id, b.id);
    expect((await listProfileCvs(conn.db, ws, created.profile.id)).map((c) => c.id)).toEqual([
      b.id,
    ]);
    expect(await getCv(conn.db, other, a.id)).toBeNull();
    expect(await getCvFile(conn.db, other, a.id)).toBeNull();
  });
});
