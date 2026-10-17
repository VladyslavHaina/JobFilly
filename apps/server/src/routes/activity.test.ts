import { addMember, recordActivity, saveAnalysis, saveEnvelopes } from "@jobfilly/db";
import { activityRows } from "@jobfilly/db/testing";
import { ActivityListSchema, DELETED_USER, type JobFacts } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import {
  createFakeMailbox,
  createTestDeps,
  type SeededUser,
  seedUser,
  signedIn,
  TEST_AI_MODELS,
  type TestClient,
  type TestDeps,
} from "../testing";

// The activity log (MVP 3, F9.1): admins see who did which outward or sharing action, when, and
// what, in plain words; an account that is gone shows as "Deleted user" (F7.3).

let deps: TestDeps;
let app: ReturnType<typeof createApp>;
let maria: SeededUser;
let tom: SeededUser;
let mariaApi: TestClient;
let tomApi: TestClient;

const JOB = "<berlin-1@agency.example>";
const facts: JobFacts = {
  title: "Senior Backend Engineer",
  company: "Nordlicht",
  agency: null,
  places: [],
  workMode: null,
  remoteScope: null,
  timeZones: null,
  pay: null,
  contract: null,
  seniority: null,
  workPermit: null,
  skills: [],
  languages: [],
  applyUrl: null,
  extra: {},
};

beforeEach(async () => {
  deps = await createTestDeps();
  app = createApp(deps);
  maria = await seedUser(deps, { name: "Maria Santos", email: "maria.santos@inbox.example" });
  tom = await seedUser(deps, { name: "Tom Okafor", email: "tom.okafor@inbox.example" });
  mariaApi = await signedIn(app, deps, maria);
  tomApi = await signedIn(app, deps, tom);
});
afterEach(() => deps.close());

const activity = (query = "") => `/api/workspaces/${maria.workspaceId}/activity${query}`;

async function read(api: TestClient, query = "") {
  const res = await api.get(activity(query));
  expect(res.status).toBe(200);
  return ActivityListSchema.parse(await res.json());
}

describe("the activity log (F9.1)", () => {
  it("is for admins: 404 to a non-member, 403 to an editor", async () => {
    expect((await tomApi.get(activity())).status).toBe(404);
    await addMember(deps.db, maria.workspaceId, tom.id, "editor");
    expect((await tomApi.get(activity())).status).toBe(403);
    await addMember(deps.db, maria.workspaceId, tom.id, "admin");
    expect((await tomApi.get(activity())).status).toBe(200);
  });

  it("says who did what and when, newest first", async () => {
    const envelope = createFakeMailbox().deliver({
      messageId: JOB,
      from: { address: "jo@agency.example", name: null },
    });
    await saveEnvelopes(deps.db, maria.workspaceId, [
      { envelope, verdict: "likely_job", reason: null },
    ]);
    await saveAnalysis(deps.db, maria.workspaceId, {
      messageId: JOB,
      scanId: null,
      category: "recruiter_outreach",
      roles: [facts],
    });
    await recordActivity(
      deps.db,
      maria.workspaceId,
      {
        kind: "draft.saved",
        actor: { kind: "system" },
        targetUserId: null,
        refs: { messageId: JOB, position: 0 },
      },
      deps.clock.now(),
    );
    deps.clock.advance(1000);
    await mariaApi.post(`/api/workspaces/${maria.workspaceId}/invites`, {
      email: tom.email,
      role: "viewer",
    });
    deps.clock.advance(1000);
    await addMember(deps.db, maria.workspaceId, tom.id, "viewer");
    await mariaApi.patch(`/api/workspaces/${maria.workspaceId}/members/${tom.id}`, {
      role: "editor",
    });

    const log = await read(mariaApi);
    expect(
      log.items.map((e) => [e.kind, e.actor?.name ?? null, e.target?.name ?? null, e.what]),
    ).toEqual([
      ["member.role_changed", "Maria Santos", "Tom Okafor", "Made Tom Okafor Editor"],
      [
        "member.invited",
        "Maria Santos",
        null,
        "Invited tom.okafor@inbox.example as Viewer, seeing everything",
      ],
      [
        "draft.saved",
        null,
        null,
        "Saved a reply draft to the mailbox: Senior Backend Engineer at Nordlicht",
      ],
    ]);
    expect(log.items[2]?.at).toBe("2026-10-01T10:00:00.000Z");
    expect(log.nextBefore).toBeNull();
  });

  it("pages with nextBefore", async () => {
    for (let i = 0; i < 60; i++) {
      await recordActivity(
        deps.db,
        maria.workspaceId,
        {
          kind: "export.downloaded",
          actor: { kind: "user", userId: maria.id },
          targetUserId: null,
          refs: {},
        },
        deps.clock.now(),
      );
    }
    const first = await read(mariaApi);
    expect(first.items).toHaveLength(50);
    const second = await read(mariaApi, `?before=${first.nextBefore}`);
    expect(second.items).toHaveLength(10);
    expect(second.nextBefore).toBeNull();
    expect(new Set([...first.items, ...second.items].map((e) => e.id)).size).toBe(60);
    expect((await mariaApi.get(activity("?before=not-an-id"))).status).toBe(400);
  });

  it("shows a deleted account's actions as Deleted user", async () => {
    await addMember(deps.db, maria.workspaceId, tom.id, "admin");
    await tomApi.post(`/api/workspaces/${maria.workspaceId}/invites`, {
      email: "anna.berg@inbox.example",
      role: "viewer",
    });
    deps.clock.advance(1000);
    expect(
      (await tomApi.request("DELETE", "/api/account", { password: tom.password })).status,
    ).toBe(204);
    const log = await read(mariaApi);
    expect(log.items.map((e) => [e.kind, e.actor, e.what])).toEqual([
      ["account.deleted", { userId: null, name: DELETED_USER }, "Deleted their account"],
      [
        "member.invited",
        { userId: null, name: DELETED_USER },
        // The invite he sent went with his account.
        "Invited someone as Viewer, seeing everything",
      ],
    ]);
  });
});

describe("where the workspace's mail comes from and goes (security review)", () => {
  it("records connecting a mailbox, its SMTP settings, the AI settings and disconnecting, by id only", async () => {
    deps.mail = createFakeMailbox().port;
    const ws = `/api/workspaces/${maria.workspaceId}`;
    const connected = await mariaApi.post(`${ws}/mailboxes`, {
      address: "maria.santos@inbox.example",
      host: "imap.inbox.example",
      port: 993,
      tlsMode: "tls",
      username: "maria",
      password: "E2E-SECRET-maria-imap",
    });
    expect(connected.status).toBe(201);
    const { id: mailboxId } = (await connected.json()) as { id: string };
    deps.clock.advance(1000);
    const smtp = await mariaApi.put(`${ws}/mailboxes/${mailboxId}/smtp`, {
      host: "smtp.inbox.example",
      port: 465,
      tlsMode: "tls",
      username: "maria",
      password: "E2E-SECRET-smtp",
    });
    expect(smtp.status).toBe(200);
    deps.clock.advance(1000);
    const ai = await mariaApi.put(`${ws}/ai`, {
      provider: "openai-compatible",
      baseUrl: "http://fake-ai:8080/v1",
      models: TEST_AI_MODELS,
      apiKey: "E2E-SECRET-ai-key",
      budgetPerRun: 120,
    });
    expect(ai.status).toBe(200);
    deps.clock.advance(1000);
    expect((await mariaApi.delete(`${ws}/mailboxes/${mailboxId}`)).status).toBe(204);

    const actor = { actorKind: "user", actorId: maria.id, targetUserId: null };
    expect(await activityRows(deps.db, maria.workspaceId)).toEqual([
      { kind: "mailbox.connected", ...actor, refs: { mailboxId } },
      { kind: "mailbox.smtp_changed", ...actor, refs: { mailboxId } },
      { kind: "ai.settings_changed", ...actor, refs: {} },
      { kind: "mailbox.disconnected", ...actor, refs: { mailboxId } },
    ]);
    const { items } = await read(mariaApi);
    expect(items.map((i) => i.what)).toEqual([
      "Disconnected a mailbox",
      "Changed the AI provider settings",
      "Changed a mailbox's sending settings",
      "Connected a mailbox",
    ]);
    // Never a host, an address or a key.
    const text = JSON.stringify(items);
    for (const leak of ["inbox.example", "fake-ai", "E2E-SECRET"]) expect(text).not.toContain(leak);
  });
});
