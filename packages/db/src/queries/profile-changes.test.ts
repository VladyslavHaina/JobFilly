import type { Change, ProfileEntry, ProfileSnapshot, Rule } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import {
  type ApplyResult,
  applyProfileChanges,
  getHistory,
  getHistoryEntry,
  markUndone,
  type ProfileState,
} from "./profile-changes";
import { createConfirmedProfile, listProfiles } from "./profiles";
import { listRules } from "./rules";

// The storage side of the profile change service. packages/core's applyChanges is the real
// `apply`; here a small stand-in applies updates of entries and adds or removes of rules, enough
// to show what is written, in one transaction, and what the history keeps.

let conn: DatabaseConnection;
let ws: string;
let other: string;
let userId: string;
let profileId: string;
const at = new Date("2026-10-01T10:00:00Z");
const later = (ms: number) => new Date(at.getTime() + ms);
const RULE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const entry = (key: "seniority" | "deal_breakers", value: string[]): ProfileEntry => ({
  key,
  label: key,
  value,
  confidence: null,
  evidence: [],
  source: "scan",
  updatedAt: at.toISOString(),
  updatedBy: null,
});

beforeEach(async () => {
  conn = await openTestDatabase();
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
  const created = await createConfirmedProfile(conn.db, ws, {
    name: "p",
    entries: [entry("seniority", ["Senior"])],
    createdBy: userId,
    at,
  });
  if (!created.ok) throw new Error("expected a profile");
  profileId = created.profile.id;
});
afterEach(() => conn.close());

function apply(state: ProfileState, changes: readonly Change[]): ApplyResult<string> {
  let entries = [...state.profile.entries];
  let rules = [...state.rules];
  const before: ProfileSnapshot = { entries: [], rules: [] };
  const after: ProfileSnapshot = { entries: [], rules: [] };
  for (const c of changes) {
    if (c.target === "entry" && c.op === "update") {
      const old = entries.find((e) => e.key === c.key);
      if (!old) return { ok: false, error: `no entry ${c.key}` };
      before.entries.push({ key: c.key, value: old.value });
      after.entries.push({ key: c.key, value: c.value });
      entries = entries.map((e) => (e.key === c.key ? { ...e, value: c.value, source: "you" } : e));
    } else if (c.target === "rule" && c.op === "add") {
      const rule: Rule = {
        ...c.rule,
        id: RULE_ID,
        profileId,
        source: "assistant",
        createdAt: at.toISOString(),
        createdBy: userId,
      };
      before.rules.push({ id: rule.id, rule: null });
      after.rules.push({ id: rule.id, rule });
      rules = [...rules, rule];
    } else if (c.target === "rule" && c.op === "remove") {
      before.rules.push({ id: c.ruleId, rule: rules.find((r) => r.id === c.ruleId) ?? null });
      after.rules.push({ id: c.ruleId, rule: null });
      rules = rules.filter((r) => r.id !== c.ruleId);
    }
  }
  return { ok: true, entries, rules, before, after };
}

const meta = (overrides: { request?: string | null } = {}) => ({
  source: "assistant" as const,
  userId,
  request: overrides.request ?? "Lately I don't want jobs in Asian time zones",
  at: later(1),
  apply,
});

const addRule: Change = {
  op: "add",
  target: "rule",
  rule: {
    description: "Hide roles whose hours are UTC+05:00 or later",
    when: [{ fact: "timeZones", op: "within", value: { from: "UTC+05:00", to: "UTC+14:00" } }],
    then: "hide",
    enabled: true,
  },
};

describe("applying profile changes", () => {
  it("writes entries, rules and a history row with before and after, together", async () => {
    const changes: Change[] = [
      { op: "update", target: "entry", key: "seniority", value: ["Lead"] },
      addRule,
    ];
    const result = await applyProfileChanges(conn.db, ws, profileId, changes, meta());
    if (!result?.ok) throw new Error("expected ok");
    expect(result.profile.entries[0]?.value).toEqual(["Lead"]);
    expect((await listProfiles(conn.db, ws))[0]?.entries[0]?.value).toEqual(["Lead"]);
    expect((await listRules(conn.db, ws, profileId)).map((r) => [r.id, r.source])).toEqual([
      [RULE_ID, "assistant"],
    ]);
    expect(result.entry).toMatchObject({
      by: userId,
      source: "assistant",
      request: "Lately I don't want jobs in Asian time zones",
      changes,
      before: {
        entries: [{ key: "seniority", value: ["Senior"] }],
        rules: [{ id: RULE_ID, rule: null }],
      },
      after: { entries: [{ key: "seniority", value: ["Lead"] }] },
      undoneAt: null,
    });
    expect(await getHistory(conn.db, ws, profileId)).toEqual([result.entry]);
  });

  it("removes a rule it no longer has", async () => {
    await applyProfileChanges(conn.db, ws, profileId, [addRule], meta());
    await applyProfileChanges(
      conn.db,
      ws,
      profileId,
      [{ op: "remove", target: "rule", ruleId: RULE_ID }],
      meta(),
    );
    expect(await listRules(conn.db, ws, profileId)).toEqual([]);
  });

  it("writes nothing when apply refuses, and no history when nothing changed", async () => {
    const refused = await applyProfileChanges(
      conn.db,
      ws,
      profileId,
      [{ op: "update", target: "entry", key: "deal_breakers", value: [] }],
      meta(),
    );
    expect(refused).toEqual({ ok: false, error: "no entry deal_breakers" });
    const nothing = await applyProfileChanges(conn.db, ws, profileId, [], meta());
    expect(nothing).toMatchObject({ ok: true, entry: null });
    expect(await getHistory(conn.db, ws, profileId)).toEqual([]);
  });

  it("answers null for another workspace's profile", async () => {
    expect(await applyProfileChanges(conn.db, other, profileId, [addRule], meta())).toBeNull();
    expect(await listRules(conn.db, ws, profileId)).toEqual([]);
  });
});

describe("the profile history", () => {
  it("lists newest first, reads one entry, and marks it undone once", async () => {
    const first = await applyProfileChanges(conn.db, ws, profileId, [addRule], meta());
    const second = await applyProfileChanges(
      conn.db,
      ws,
      profileId,
      [{ op: "update", target: "entry", key: "seniority", value: ["Lead"] }],
      { ...meta({ request: null }), source: "you", at: later(2) },
    );
    if (!first?.ok || !second?.ok || !first.entry || !second.entry) throw new Error("expected ok");
    expect((await getHistory(conn.db, ws, profileId)).map((e) => e.id)).toEqual([
      second.entry.id,
      first.entry.id,
    ]);
    expect(await markUndone(conn.db, ws, first.entry.id, { userId, at: later(3) })).toBe(true);
    expect(await markUndone(conn.db, ws, first.entry.id, { userId, at: later(4) })).toBe(false);
    expect((await getHistoryEntry(conn.db, ws, profileId, first.entry.id))?.undoneAt).toBe(
      later(3).toISOString(),
    );
    expect(await getHistoryEntry(conn.db, other, profileId, first.entry.id)).toBeNull();
    expect(await markUndone(conn.db, other, second.entry.id, { userId, at: later(5) })).toBe(false);
  });
});
