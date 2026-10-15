import type { ProfileEntry } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import {
  claimIntakeExtras,
  createConfirmedProfile,
  finishIntakeExtras,
  getIntakeExtras,
  hasProfile,
  listIntakeAnswers,
  listProfiles,
  saveIntakeAnswer,
  takeOverIntakeExtras,
  updateProfile,
} from "./profiles";

let conn: DatabaseConnection;
let workspaceId: string;
let otherWorkspaceId: string;
let userId: string;
const t0 = new Date("2026-10-01T10:00:00Z");
const later = (ms: number) => new Date(t0.getTime() + ms);

beforeEach(async () => {
  conn = await openTestDatabase();
  const r = await registerAccount(conn.db, {
    name: "Maria",
    email: "maria@inbox.example",
    passwordHash: "h",
    workspaceName: "Maria's workspace",
  });
  const o = await registerAccount(conn.db, {
    name: "Tom",
    email: "tom@inbox.example",
    passwordHash: "h",
    workspaceName: "Tom's workspace",
  });
  if (!r.ok || !o.ok) throw new Error("expected ok");
  workspaceId = r.workspaceId;
  otherWorkspaceId = o.workspaceId;
  userId = r.user.id;
});
afterEach(() => conn.close());

const entry = (overrides: Partial<ProfileEntry> = {}): ProfileEntry => ({
  key: "contracts",
  label: "Contracts",
  value: ["B2B"],
  confidence: "medium",
  evidence: [{ messageId: "<r1@inbox.example>", reason: "from 2 of your replies" }],
  source: "scan",
  updatedAt: t0.toISOString(),
  updatedBy: null,
  ...overrides,
});

describe("intake answers", () => {
  it("keeps one edit per key, the latest, within its workspace", async () => {
    await saveIntakeAnswer(conn.db, workspaceId, {
      key: "places",
      value: [{ country: "DE", city: "Berlin", mode: "hybrid" }],
      source: "you",
      updatedBy: userId,
      at: t0,
    });
    const saved = await saveIntakeAnswer(conn.db, workspaceId, {
      key: "places",
      value: [],
      source: "you",
      updatedBy: userId,
      at: later(1000),
    });
    expect(saved).toEqual({
      key: "places",
      value: [],
      source: "you",
      updatedBy: userId,
      updatedAt: later(1000).toISOString(),
    });
    await saveIntakeAnswer(conn.db, workspaceId, {
      key: "extra.relocation",
      value: ["Yes"],
      source: "you",
      updatedBy: userId,
      at: later(2000),
    });
    expect((await listIntakeAnswers(conn.db, workspaceId)).map((e) => [e.key, e.value])).toEqual([
      ["places", []],
      ["extra.relocation", ["Yes"]],
    ]);
    expect(await listIntakeAnswers(conn.db, otherWorkspaceId)).toEqual([]);
  });
});

describe("intake extras", () => {
  it("lets exactly one caller claim the call", async () => {
    const results = await Promise.all([
      claimIntakeExtras(conn.db, workspaceId, { instance: "app-a", at: t0 }),
      claimIntakeExtras(conn.db, workspaceId, { instance: "app-b", at: t0 }),
      claimIntakeExtras(conn.db, workspaceId, { instance: "app-a", at: t0 }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await getIntakeExtras(conn.db, workspaceId)).toMatchObject({
      status: "pending",
      questions: [],
      claimedAt: t0,
    });
    expect(await getIntakeExtras(conn.db, otherWorkspaceId)).toBeNull();
  });

  it("stores the outcome only for the current claim", async () => {
    await claimIntakeExtras(conn.db, workspaceId, { instance: "app-a", at: t0 });
    const questions = [{ slug: "b2b", label: "Do you accept B2B?", options: [], evidence: [] }];
    const stale = { instance: "app-a", at: later(-1) };
    expect(
      await finishIntakeExtras(conn.db, workspaceId, {
        claim: stale,
        status: "done",
        questions,
        at: later(10),
      }),
    ).toBe(false);
    expect(
      await finishIntakeExtras(conn.db, workspaceId, {
        claim: { instance: "app-a", at: t0 },
        status: "done",
        questions,
        at: later(10),
      }),
    ).toBe(true);
    expect(await getIntakeExtras(conn.db, workspaceId)).toMatchObject({
      status: "done",
      questions,
    });
    // Done is final.
    expect(
      await finishIntakeExtras(conn.db, workspaceId, {
        claim: { instance: "app-a", at: t0 },
        status: "failed",
        questions: [],
        at: later(20),
      }),
    ).toBe(false);
  });

  it("lets one caller take over a claim older than the cut-off, never a fresh one", async () => {
    await claimIntakeExtras(conn.db, workspaceId, { instance: "app-a", at: t0 });
    expect(
      await takeOverIntakeExtras(conn.db, workspaceId, {
        instance: "app-b",
        at: later(60_000),
        staleBefore: later(-60_000),
      }),
    ).toBe(false);
    const at = later(150_000);
    const staleBefore = later(30_000);
    const results = await Promise.all([
      takeOverIntakeExtras(conn.db, workspaceId, { instance: "app-b", at, staleBefore }),
      takeOverIntakeExtras(conn.db, workspaceId, { instance: "app-c", at, staleBefore }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const state = await getIntakeExtras(conn.db, workspaceId);
    expect(state?.claimedAt).toEqual(at);
    // The old claimant's late answer no longer counts.
    expect(
      await finishIntakeExtras(conn.db, workspaceId, {
        claim: { instance: "app-a", at: t0 },
        status: "done",
        questions: [],
        at,
      }),
    ).toBe(false);
  });

  it("never takes over a finished call", async () => {
    await claimIntakeExtras(conn.db, workspaceId, { instance: "app-a", at: t0 });
    await finishIntakeExtras(conn.db, workspaceId, {
      claim: { instance: "app-a", at: t0 },
      status: "failed",
      questions: [],
      at: t0,
    });
    expect(
      await takeOverIntakeExtras(conn.db, workspaceId, {
        instance: "app-b",
        at: later(600_000),
        staleBefore: later(500_000),
      }),
    ).toBe(false);
  });
});

describe("profiles", () => {
  it("creates one confirmed profile per workspace", async () => {
    expect(await hasProfile(conn.db, workspaceId)).toBe(false);
    const results = await Promise.all([
      createConfirmedProfile(conn.db, workspaceId, {
        name: "My job search",
        entries: [entry()],
        createdBy: userId,
        at: t0,
      }),
      createConfirmedProfile(conn.db, workspaceId, {
        name: "My job search",
        entries: [entry()],
        createdBy: userId,
        at: t0,
      }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: "exists" }]);
    const [profile] = await listProfiles(conn.db, workspaceId);
    expect(profile).toMatchObject({
      workspaceId,
      name: "My job search",
      entries: [entry()],
      confirmedAt: t0.toISOString(),
    });
    expect(await hasProfile(conn.db, workspaceId)).toBe(true);
    expect(await listProfiles(conn.db, otherWorkspaceId)).toEqual([]);
  });

  it("updates a profile of its own workspace only", async () => {
    const created = await createConfirmedProfile(conn.db, workspaceId, {
      name: "My job search",
      entries: [entry()],
      createdBy: userId,
      at: t0,
    });
    if (!created.ok) throw new Error("expected ok");
    const id = created.profile.id;
    const rename = (p: { entries: ProfileEntry[] }) => ({
      ok: true as const,
      name: "Remote EU",
      entries: p.entries,
    });
    expect(await updateProfile(conn.db, otherWorkspaceId, id, rename, later(5))).toBeNull();
    const updated = await updateProfile(conn.db, workspaceId, id, rename, later(5));
    expect(updated).toMatchObject({ ok: true, profile: { id, name: "Remote EU" } });
    const refused = await updateProfile(
      conn.db,
      workspaceId,
      id,
      () => ({ ok: false as const, error: "nope" }),
      later(6),
    );
    expect(refused).toEqual({ ok: false, error: "nope" });
    expect((await listProfiles(conn.db, workspaceId))[0]?.name).toBe("Remote EU");
  });
});
