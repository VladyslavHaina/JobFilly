import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { rules } from "../tables";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import { createConfirmedProfile } from "./profiles";
import { getRule, listRules } from "./rules";

let conn: DatabaseConnection;
const at = new Date("2026-10-01T10:00:00Z");

beforeEach(async () => {
  conn = await openTestDatabase();
});
afterEach(() => conn.close());

describe("reading rules (F3)", () => {
  it("reads a profile's rules oldest first, in the Rule shape, only in its workspace", async () => {
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
    const [maria, tom] = made as [(typeof made)[0], (typeof made)[0]];
    const created = await createConfirmedProfile(conn.db, maria.workspaceId, {
      name: "p",
      entries: [],
      createdBy: maria.user.id,
      at,
    });
    if (!created.ok) throw new Error("expected a profile");
    const when = [
      {
        fact: "timeZones" as const,
        op: "outside" as const,
        value: { from: "UTC-01:00", to: "UTC+03:00" },
      },
    ];
    const [row] = await conn.db
      .insert(rules)
      .values({
        workspaceId: maria.workspaceId,
        profileId: created.profile.id,
        description: "Hide roles whose hours are outside UTC−1 to UTC+3",
        conditions: when,
        action: "hide",
        source: "assistant",
        createdBy: maria.user.id,
        createdAt: at,
        updatedAt: at,
      })
      .returning();
    const rule = {
      id: row?.id,
      profileId: created.profile.id,
      description: "Hide roles whose hours are outside UTC−1 to UTC+3",
      when,
      then: "hide",
      enabled: true,
      source: "assistant",
      createdAt: at.toISOString(),
      createdBy: maria.user.id,
    };
    expect(await listRules(conn.db, maria.workspaceId, created.profile.id)).toEqual([rule]);
    expect(await getRule(conn.db, maria.workspaceId, row?.id ?? "")).toEqual(rule);
    expect(await getRule(conn.db, tom.workspaceId, row?.id ?? "")).toBeNull();
    expect(await listRules(conn.db, tom.workspaceId, created.profile.id)).toEqual([]);
  });
});
