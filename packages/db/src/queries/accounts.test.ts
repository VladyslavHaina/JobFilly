import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { openTestDatabase } from "../testing";
import { findUserByEmail, getUser, registerAccount } from "./accounts";
import { listMembers, listWorkspacesForUser } from "./workspaces";

let conn: DatabaseConnection;
beforeEach(async () => {
  conn = await openTestDatabase();
});
afterEach(() => conn.close());

const maria = {
  name: "Maria Santos",
  email: "maria.santos@inbox.example",
  passwordHash: "scrypt$hash",
  workspaceName: "Maria's workspace",
};

describe("registerAccount", () => {
  it("creates the user with a personal workspace they own as admin", async () => {
    const result = await registerAccount(conn.db, maria);
    if (!result.ok) throw new Error("expected ok");
    expect(result.user).toMatchObject({ name: "Maria Santos", email: maria.email });
    const workspaces = await listWorkspacesForUser(conn.db, result.user.id);
    expect(workspaces).toEqual([
      {
        id: result.workspaceId,
        name: "Maria's workspace",
        ownerId: result.user.id,
        role: "admin",
        isOwner: true,
      },
    ]);
    const members = await listMembers(conn.db, result.workspaceId);
    expect(members).toMatchObject([{ userId: result.user.id, role: "admin", isOwner: true }]);
  });

  it("refuses a second account with the same email and leaves no workspace behind", async () => {
    const first = await registerAccount(conn.db, maria);
    expect(await registerAccount(conn.db, { ...maria, name: "Other" })).toEqual({
      ok: false,
      reason: "email_taken",
    });
    if (!first.ok) throw new Error("expected ok");
    expect(await listWorkspacesForUser(conn.db, first.user.id)).toHaveLength(1);
  });
});

describe("finding users", () => {
  it("finds a user by email in any case, with the hash, and by id without it", async () => {
    const result = await registerAccount(conn.db, maria);
    if (!result.ok) throw new Error("expected ok");
    expect(await findUserByEmail(conn.db, "Maria.Santos@Inbox.Example")).toEqual({
      ...result.user,
      passwordHash: "scrypt$hash",
    });
    expect(await getUser(conn.db, result.user.id)).toEqual(result.user);
    expect(await findUserByEmail(conn.db, "nobody@inbox.example")).toBeNull();
  });
});
