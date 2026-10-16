import {
  getAiSettings,
  getLatestScan,
  getMailboxConnection,
  getMembership,
  listWorkspacesForUser,
} from "@jobfilly/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyPassword } from "../auth/password";
import { open } from "../secrets";
import { createTestDeps, TEST_SECRET_KEY, type TestDeps } from "./deps";
import { seedAiSettings, seedMailbox, seedScan, seedUser, seedWorkspace } from "./seed";

let deps: TestDeps;
beforeEach(async () => {
  deps = await createTestDeps();
});
afterEach(() => deps.close());

const models = {
  classify: "m",
  extract: "m",
  prefs: "m",
  intake: "m",
  cv: "m",
  match: "m",
  draft: "m",
  assistant: "m",
};

describe("test seeding", () => {
  it("seeds a user with a verifiable password and a personal workspace", async () => {
    const maria = await seedUser(deps, { name: "Maria Santos", email: "Maria@Inbox.Example" });
    expect(maria.email).toBe("maria@inbox.example");
    const [ws] = await listWorkspacesForUser(deps.db, maria.id);
    expect(ws).toMatchObject({
      id: maria.workspaceId,
      name: "Maria Santos's workspace",
      role: "admin",
    });
  });

  it("seeds a workspace with members in their roles", async () => {
    const tom = await seedUser(deps, { name: "Tom" });
    const ws = await seedWorkspace(deps, { members: [{ user: tom, role: "viewer" }] });
    expect((await getMembership(deps.db, ws.workspaceId, tom.id))?.role).toBe("viewer");
    expect((await getMembership(deps.db, ws.workspaceId, ws.owner.id))?.role).toBe("admin");
  });

  it("seals the mailbox password and the AI key with the test key", async () => {
    const maria = await seedUser(deps);
    await seedMailbox(deps, maria.workspaceId, {
      address: "maria@inbox.example",
      conn: {
        host: "imap",
        port: 3143,
        tlsMode: "none",
        username: "maria",
        password: "E2E-SECRET-x",
      },
      sentFolderPath: "Sent",
    });
    const mailbox = await getMailboxConnection(deps.db, maria.workspaceId);
    expect(mailbox?.secretCiphertext).not.toContain("E2E-SECRET");
    expect(open(TEST_SECRET_KEY, mailbox?.secretCiphertext ?? "")).toBe("E2E-SECRET-x");

    await seedAiSettings(deps, maria.workspaceId, {
      provider: "openai-compatible",
      baseUrl: "http://fake-ai:8080/v1",
      models,
      apiKey: "E2E-SECRET-ai-key",
    });
    const ai = await getAiSettings(deps.db, maria.workspaceId);
    expect(ai?.budgetPerRun).toBe(300);
    expect(open(TEST_SECRET_KEY, ai?.keyCiphertext ?? "")).toBe("E2E-SECRET-ai-key");
  });

  it("seeds scans in any state", async () => {
    const maria = await seedUser(deps);
    const stopped = await seedScan(deps, maria.workspaceId, {
      kind: "first",
      status: "stopped",
      stopReason: "confident",
      counts: { likely: 260, analyzed: 140 },
      calls: 12,
    });
    expect(stopped).toMatchObject({
      status: "stopped",
      stopReason: "confident",
      calls: 12,
      counts: { likely: 260, analyzed: 140, notAnalyzed: 0 },
      startedBy: maria.id,
    });
    deps.clock.advance(60_000);
    const running = await seedScan(deps, maria.workspaceId, {
      kind: "analyze_rest",
      status: "running",
    });
    expect(running.status).toBe("running");
    expect((await getLatestScan(deps.db, maria.workspaceId))?.id).toBe(running.id);
  });

  it("hashes test passwords so verifyPassword accepts them", async () => {
    const user = await seedUser(deps, { password: "twelve chars!" });
    const { findUserByEmail } = await import("@jobfilly/db");
    const stored = await findUserByEmail(deps.db, user.email);
    expect(await verifyPassword("twelve chars!", stored?.passwordHash ?? "")).toBe(true);
    expect(await verifyPassword("wrong password", stored?.passwordHash ?? "")).toBe(false);
  });
});
