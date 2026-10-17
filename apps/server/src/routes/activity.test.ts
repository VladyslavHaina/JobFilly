import { addMember, recordActivity, saveAnalysis, saveEnvelopes } from "@jobfilly/db";
import { ActivityListSchema, DELETED_USER, type JobFacts } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import {
  createFakeMailbox,
  createTestDeps,
  type SeededUser,
  seedUser,
  signedIn,
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
