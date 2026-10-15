import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import { createSession, deleteSession, findSession, touchSession } from "./sessions";

let conn: DatabaseConnection;
let userId: string;
beforeEach(async () => {
  conn = await openTestDatabase();
  const r = await registerAccount(conn.db, {
    name: "Maria",
    email: "maria@inbox.example",
    passwordHash: "h",
    workspaceName: "Maria's workspace",
  });
  if (!r.ok) throw new Error("expected ok");
  userId = r.user.id;
});
afterEach(() => conn.close());

describe("sessions", () => {
  it("finds a session by its token hash with its user, touches and deletes it", async () => {
    const now = new Date("2026-10-01T10:00:00Z");
    const { id } = await createSession(conn.db, { userId, tokenHash: "hash-1", now });
    const found = await findSession(conn.db, "hash-1");
    expect(found).toEqual({
      id,
      createdAt: now,
      lastUsedAt: now,
      user: { id: userId, name: "Maria", email: "maria@inbox.example" },
    });
    const later = new Date("2026-10-02T10:00:00Z");
    await touchSession(conn.db, id, later);
    expect((await findSession(conn.db, "hash-1"))?.lastUsedAt).toEqual(later);
    await deleteSession(conn.db, id);
    expect(await findSession(conn.db, "hash-1")).toBeNull();
  });

  it("knows nothing of an unknown hash", async () => {
    expect(await findSession(conn.db, "nope")).toBeNull();
  });
});
