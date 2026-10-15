import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import { createScan } from "./scans";
import { recordAiUsage, usagePerDay, usageTotal } from "./usage";

let conn: DatabaseConnection;
const ws: { a: string; b: string; user: string } = { a: "", b: "", user: "" };

beforeEach(async () => {
  conn = await openTestDatabase();
  for (const key of ["a", "b"] as const) {
    const r = await registerAccount(conn.db, {
      name: key,
      email: `${key}@x.example`,
      passwordHash: "h",
      workspaceName: key,
    });
    if (!r.ok) throw new Error("expected ok");
    ws[key] = r.workspaceId;
    ws.user = r.user.id;
  }
});
afterEach(() => conn.close());

describe("AI usage", () => {
  it("totals calls and tokens per workspace and per scan", async () => {
    const created = await createScan(conn.db, ws.a, { kind: "first", startedBy: ws.user });
    if (!created.ok) throw new Error("expected ok");
    const scanId = created.scan.id;
    await recordAiUsage(conn.db, ws.a, {
      scanId,
      task: "classify.v1",
      inputTokens: 100,
      outputTokens: 10,
    });
    await recordAiUsage(conn.db, ws.a, {
      scanId,
      task: "extract.v1",
      inputTokens: 50,
      outputTokens: 5,
    });
    await recordAiUsage(conn.db, ws.a, {
      scanId: null,
      task: "intake.v1",
      inputTokens: 7,
      outputTokens: 3,
    });
    await recordAiUsage(conn.db, ws.b, {
      scanId: null,
      task: "ai.test.v1",
      inputTokens: 1,
      outputTokens: 1,
    });

    expect(await usageTotal(conn.db, ws.a, scanId)).toEqual({
      calls: 2,
      inputTokens: 150,
      outputTokens: 15,
    });
    expect(await usageTotal(conn.db, ws.a)).toEqual({
      calls: 3,
      inputTokens: 157,
      outputTokens: 18,
    });
    expect(await usageTotal(conn.db, ws.b)).toEqual({ calls: 1, inputTokens: 1, outputTokens: 1 });
  });

  it("lists calls and tokens per UTC day, newest first, for one workspace", async () => {
    const call = (workspaceId: string, at: string, inputTokens: number) =>
      recordAiUsage(conn.db, workspaceId, {
        scanId: null,
        task: "match.v1",
        inputTokens,
        outputTokens: 1,
        at: new Date(at),
      });
    await call(ws.a, "2026-10-14T23:59:59Z", 10);
    await call(ws.a, "2026-10-15T00:00:00Z", 20);
    await call(ws.a, "2026-10-15T18:00:00Z", 30);
    await call(ws.b, "2026-10-15T09:00:00Z", 99);
    expect(await usagePerDay(conn.db, ws.a)).toEqual([
      { day: "2026-10-15", calls: 2, inputTokens: 50, outputTokens: 2 },
      { day: "2026-10-14", calls: 1, inputTokens: 10, outputTokens: 1 },
    ]);
    expect(await usagePerDay(conn.db, ws.a, { days: 1 })).toHaveLength(1);
  });

  it("is zero for a workspace without calls", async () => {
    expect(await usageTotal(conn.db, ws.a)).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0 });
  });
});
