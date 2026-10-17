import {
  addMember,
  createWorkspace,
  findUserByEmail,
  listMembers,
  listWorkspacesForUser,
} from "@jobfilly/db";
import {
  AccountDeletionPreviewSchema,
  ActivityListSchema,
  DELETED_USER,
  WorkspaceListSchema,
} from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import {
  createTestDeps,
  type SeededUser,
  seedCv,
  seedMailbox,
  seedUser,
  signedIn,
  type TestClient,
  type TestDeps,
  testClient,
} from "../testing";

// Deleting a workspace (MVP 3, F7.2) and an account (F7.3). The workspace goes with its name
// typed in, only by its owner, with everything it holds; the account goes with its password,
// with the workspaces it owns, and leaves the others, where its actions show "Deleted user".

let deps: TestDeps;
let app: ReturnType<typeof createApp>;
let maria: SeededUser;
let tom: SeededUser;
let mariaApi: TestClient;
let tomApi: TestClient;

beforeEach(async () => {
  deps = await createTestDeps();
  app = createApp(deps);
  maria = await seedUser(deps, { name: "Maria Santos", email: "maria.santos@inbox.example" });
  tom = await seedUser(deps, { name: "Tom Okafor", email: "tom.okafor@inbox.example" });
  mariaApi = await signedIn(app, deps, maria);
  tomApi = await signedIn(app, deps, tom);
});
afterEach(() => deps.close());

const workspace = (ws: string) => `/api/workspaces/${ws}`;
const deleteWorkspace = (api: TestClient, ws: string, name: string) =>
  api.request("DELETE", workspace(ws), { name });

describe("deleting a workspace (F7.2)", () => {
  it("needs its name typed in, and takes everything it holds", async () => {
    await seedMailbox(deps, tom.workspaceId, {
      address: "tom@inbox.example",
      conn: { host: "imap.example", port: 993, tlsMode: "tls", username: "t", password: "pw" },
      sentFolderPath: null,
    });
    await seedCv(deps, tom.workspaceId, { name: "Tom's CV" });
    await addMember(deps.db, tom.workspaceId, maria.id, "viewer");

    const wrong = await deleteWorkspace(tomApi, tom.workspaceId, "tom okafor's workspace");
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ error: "name_mismatch" });
    expect((await tomApi.request("DELETE", workspace(tom.workspaceId), {})).status).toBe(400);

    const res = await deleteWorkspace(tomApi, tom.workspaceId, "Tom Okafor's workspace");
    expect(res.status).toBe(204);
    expect(await listWorkspacesForUser(deps.db, tom.id)).toEqual([]);
    expect(await listWorkspacesForUser(deps.db, maria.id)).toHaveLength(1);
    for (const api of [tomApi, mariaApi]) {
      expect((await api.get(`${workspace(tom.workspaceId)}/members`)).status).toBe(404);
      expect((await api.get(`${workspace(tom.workspaceId)}/cvs`)).status).toBe(404);
    }
    expect(deps.logs.find((l) => l.event === "workspace.deleted")).toMatchObject({
      workspaceId: tom.workspaceId,
      userId: tom.id,
    });
  });

  it("is the owner's alone: 403 to another admin, 404 to a non-member", async () => {
    await addMember(deps.db, maria.workspaceId, tom.id, "admin");
    const name = "Maria Santos's workspace";
    expect((await deleteWorkspace(tomApi, maria.workspaceId, name)).status).toBe(403);
    await addMember(deps.db, maria.workspaceId, tom.id, "editor");
    expect((await deleteWorkspace(tomApi, maria.workspaceId, name)).status).toBe(403);
    expect(
      (await deleteWorkspace(mariaApi, tom.workspaceId, "Tom Okafor's workspace")).status,
    ).toBe(404);
    expect(await listWorkspacesForUser(deps.db, maria.id)).toHaveLength(1);
  });
});

describe("deleting an account (F7.3)", () => {
  it("first lists the workspaces it owns, with their members, and those it leaves", async () => {
    const shared = await createWorkspace(deps.db, { name: "Tom's search", ownerId: tom.id });
    await addMember(deps.db, shared.id, maria.id, "viewer");
    await addMember(deps.db, maria.workspaceId, tom.id, "editor");
    const res = await tomApi.get("/api/account/deletion");
    expect(AccountDeletionPreviewSchema.parse(await res.json())).toEqual({
      owned: [
        { workspaceId: tom.workspaceId, name: "Tom Okafor's workspace", members: [] },
        {
          workspaceId: shared.id,
          name: "Tom's search",
          members: [{ userId: maria.id, name: "Maria Santos" }],
        },
      ],
      memberOf: [{ workspaceId: maria.workspaceId, name: "Maria Santos's workspace" }],
    });
    expect((await testClient(app, deps).get("/api/account/deletion")).status).toBe(401);
  });

  it("asks for the password, then deletes it: no sign-in, no membership, Deleted user", async () => {
    await addMember(deps.db, maria.workspaceId, tom.id, "admin");
    await mariaApi.patch(`${workspace(maria.workspaceId)}/members/${tom.id}`, {
      scope: "pipeline",
    });
    deps.clock.advance(1000);

    const wrong = await tomApi.request("DELETE", "/api/account", { password: "not it" });
    expect(wrong.status).toBe(403);
    expect(await findUserByEmail(deps.db, tom.email)).not.toBeNull();

    const res = await tomApi.request("DELETE", "/api/account", { password: tom.password });
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie().join(";")).toContain("jf_session=;");
    expect(await findUserByEmail(deps.db, tom.email)).toBeNull();
    expect((await tomApi.get("/api/workspaces")).status).toBe(401);
    const signIn = await testClient(app, deps).post("/api/auth/sign-in", {
      email: tom.email,
      password: tom.password,
    });
    expect(signIn.status).toBe(401);

    expect((await listMembers(deps.db, maria.workspaceId)).map((m) => m.name)).toEqual([
      "Maria Santos",
    ]);
    const workspaces = WorkspaceListSchema.parse(
      await (await mariaApi.get("/api/workspaces")).json(),
    );
    expect(workspaces.items.map((w) => w.id)).toEqual([maria.workspaceId]);
    const log = ActivityListSchema.parse(
      await (await mariaApi.get(`${workspace(maria.workspaceId)}/activity`)).json(),
    );
    expect(log.items[0]).toMatchObject({
      kind: "account.deleted",
      actor: { userId: null, name: DELETED_USER },
    });
    expect(log.items.find((e) => e.kind === "member.scope_changed")).toMatchObject({
      actor: { userId: maria.id, name: "Maria Santos" },
      target: { userId: null, name: DELETED_USER },
      what: `Let ${DELETED_USER} see the job pipeline only`,
    });
    expect(JSON.stringify(log)).not.toContain("Tom Okafor");
    expect(JSON.stringify(log)).not.toContain(tom.email);
    expect(deps.logs.find((l) => l.event === "account.deleted")).toMatchObject({
      userId: tom.id,
      workspacesDeleted: 1,
      workspacesLeft: 1,
    });
    expect(deps.rawLogs.join("\n")).not.toContain(tom.email);
  });
});
