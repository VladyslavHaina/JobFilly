import { createConfirmedProfile, getEvaluations, setMemberScope } from "@jobfilly/db";
import {
  MessageDetailSchema,
  type Profile,
  ProfileChangeResultSchema,
  type ProfileEntry,
  RoleProfileSchema,
} from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import {
  createFakeMailbox,
  createTestDeps,
  type FakeMailbox,
  type RecordingStages,
  recordingStages,
  roleFacts,
  type SeededWorkspace,
  seedJobMail,
  seedMailbox,
  seedUser,
  seedWorkspace,
  signedIn,
  type TestClient,
  type TestDeps,
} from "../testing";
import { profileOfRole } from "./assign";
import { evaluateMessage } from "./evaluate";

// Every role goes to the best profile that is on, with the reason (MVP 3, F1.3): the cv-choice
// and match stages work with that profile and its rules, the reply stage with each role's, the
// inbox shows it, and later steps of the role (drafting, a decision's answer) read it. An editor
// reassigns a role by hand; profiles can be switched off, and then get no roles, but one stays on.

const NOW = new Date("2026-10-15T12:00:00Z");
const MINUTE = 60_000;

const entry = (key: ProfileEntry["key"], value: ProfileEntry["value"]): ProfileEntry => ({
  key,
  label: key,
  value,
  confidence: null,
  evidence: [],
  source: "scan",
  updatedAt: NOW.toISOString(),
  updatedBy: null,
});

const MUNICH = "<munich@agency.example>";
const REMOTE = "<remote@agency.example>";
const BERLIN = "<berlin@agency.example>";

let deps: TestDeps;
let mailbox: FakeMailbox;
let stages: RecordingStages;
let seen: string[];
let ws: SeededWorkspace;
let remoteEu: Profile;
let germany: Profile;
let editor: TestClient;
let viewer: TestClient;
let pipelineOnly: TestClient;

async function profile(name: string, entries: ProfileEntry[]): Promise<Profile> {
  const created = await createConfirmedProfile(deps.db, ws.workspaceId, {
    name,
    entries,
    createdBy: ws.owner.id,
    at: deps.clock.now(),
    alongside: true,
  });
  if (!created.ok) throw new Error("expected a profile");
  deps.clock.advance(MINUTE);
  return created.profile;
}

beforeEach(async () => {
  deps = await createTestDeps({ now: NOW });
  mailbox = createFakeMailbox();
  deps.mail = mailbox.port;
  const owner = await seedUser(deps, { name: "Maria Santos" });
  const ed = await seedUser(deps, { name: "Eddie Editor" });
  const tom = await seedUser(deps, { name: "Tom Okafor" });
  const pat = await seedUser(deps, { name: "Pat Pipeline" });
  ws = await seedWorkspace(deps, {
    owner,
    members: [
      { user: ed, role: "editor" },
      { user: tom, role: "viewer" },
      { user: pat, role: "editor" },
    ],
  });
  await setMemberScope(deps.db, ws.workspaceId, pat.id, "pipeline");
  const app = createApp(deps);
  editor = await signedIn(app, deps, ed);
  viewer = await signedIn(app, deps, tom);
  pipelineOnly = await signedIn(app, deps, pat);
  await seedMailbox(deps, ws.workspaceId, {
    address: "maria.santos@inbox.example",
    conn: { host: "imap", port: 3143, tlsMode: "tls", username: "maria", password: "E2E-p" },
    sentFolderPath: "Sent",
  });
  remoteEu = await profile("Remote EU", [
    entry("places", [{ country: "DE", city: "Berlin", mode: "hybrid" }]),
    entry("remote", [{ scope: "EU", timeZones: null }]),
    entry("languages", ["English"]),
    entry("contracts", ["permanent", "B2B"]),
  ]);
  germany = await profile("Germany permanent", [
    entry("places", [{ country: "DE", city: null, mode: "onsite" }]),
    entry("languages", ["German"]),
    entry("contracts", ["permanent"]),
  ]);
  await seedJobMail(deps, ws.workspaceId, mailbox, {
    messageId: MUNICH,
    receivedAt: new Date(NOW.getTime() - 3 * MINUTE),
    roles: [
      roleFacts({
        places: [{ country: "DE", city: "München" }],
        workMode: "onsite",
        languages: ["German"],
        contract: "permanent",
      }),
    ],
  });
  await seedJobMail(deps, ws.workspaceId, mailbox, {
    messageId: REMOTE,
    receivedAt: new Date(NOW.getTime() - 2 * MINUTE),
    roles: [roleFacts({ workMode: "remote", remoteScope: "EU", languages: ["English"] })],
  });
  await seedJobMail(deps, ws.workspaceId, mailbox, {
    messageId: BERLIN,
    receivedAt: new Date(NOW.getTime() - MINUTE),
    roles: [roleFacts({ places: [{ country: "DE", city: "Berlin" }], workMode: "hybrid" })],
  });
  stages = recordingStages();
  seen = [];
  const { cvChoice, match } = stages;
  stages.cvChoice = (input, ctx) => {
    seen.push(`cv ${input.message.messageId} ${ctx.profile?.name}`);
    return cvChoice(input, ctx);
  };
  stages.match = (input, ctx) => {
    seen.push(`match ${input.message.messageId} ${ctx.profile?.name} ${ctx.rules.length}`);
    return match(input, ctx);
  };
});
afterEach(() => deps.close());

const evaluate = async (...ids: string[]) => {
  for (const id of ids)
    await evaluateMessage(deps, ws.workspaceId, id, { origin: "backlog", stages });
};
const base = () => `/api/workspaces/${ws.workspaceId}`;
const roleUrl = (id: string) => `${base()}/messages/${encodeURIComponent(id)}/roles/0/profile`;
const detail = async (id: string) => {
  const res = await viewer.get(`${base()}/messages/${encodeURIComponent(id)}`);
  expect(res.status).toBe(200);
  return MessageDetailSchema.parse(await res.json()).roles[0]?.profile;
};

describe("assigning each role to a profile (F1.3)", () => {
  it("puts each role in the best profile that is on, with the reason, and works with it", async () => {
    await evaluate(MUNICH, REMOTE, BERLIN);
    expect(await detail(MUNICH)).toEqual({
      profileId: germany.id,
      name: "Germany permanent",
      reason: "München role, German, permanent → 'Germany permanent'",
      source: "auto",
    });
    expect(await detail(REMOTE)).toMatchObject({
      profileId: remoteEu.id,
      reason: "Remote role, English → 'Remote EU'",
    });
    // Berlin is a place the first profile names by its city.
    expect(await detail(BERLIN)).toMatchObject({ profileId: remoteEu.id });
    expect(seen).toEqual([
      `cv ${MUNICH} Germany permanent`,
      `match ${MUNICH} Germany permanent 0`,
      `cv ${REMOTE} Remote EU`,
      `match ${REMOTE} Remote EU 0`,
      `cv ${BERLIN} Remote EU`,
      `match ${BERLIN} Remote EU 0`,
    ]);
    // The reply stage gets each role's profile.
    expect(stages.replies[0]?.profiles?.get(0)?.id).toBe(germany.id);
    expect(deps.logs.filter((l) => l.event === "profile.assigned")).toMatchObject([
      { profileId: germany.id, source: "auto", position: 0 },
      { profileId: remoteEu.id },
      { profileId: remoteEu.id },
    ]);
    // Later steps of the role (drafting, a decision's answer) read the same profile.
    expect(
      (await profileOfRole(deps, ws.workspaceId, { messageId: MUNICH, position: 0 }))?.id,
    ).toBe(germany.id);
    // Evaluating again with nothing changed logs no new assignment.
    const before = deps.logs.length;
    await evaluate(MUNICH);
    expect(deps.logs.slice(before).some((l) => l.event === "profile.assigned")).toBe(false);
  });

  it("lets an editor reassign a role; its match and CV choice then use that profile", async () => {
    await evaluate(REMOTE);
    expect((await viewer.put(roleUrl(REMOTE), { profileId: germany.id })).status).toBe(403);
    const res = await editor.put(roleUrl(REMOTE), { profileId: germany.id });
    expect(res.status).toBe(200);
    expect(RoleProfileSchema.parse(await res.json())).toEqual({
      profileId: germany.id,
      name: "Germany permanent",
      reason: "Chosen by hand → 'Germany permanent'",
      source: "you",
    });
    // The role is re-evaluated with it.
    const [evaluation] = await getEvaluations(deps.db, ws.workspaceId, [REMOTE]);
    expect(evaluation?.stale).toBe(true);
    seen = [];
    await evaluate(REMOTE);
    expect(seen).toEqual([`cv ${REMOTE} Germany permanent`, `match ${REMOTE} Germany permanent 0`]);
    expect(await detail(REMOTE)).toMatchObject({ profileId: germany.id, source: "you" });
    expect(deps.logs.filter((l) => l.event === "profile.assigned").at(-1)).toMatchObject({
      profileId: germany.id,
      source: "you",
    });
  });

  it("refuses an unknown role or profile, and a profile that is off", async () => {
    const unknown = "8f0e1c62-0000-4000-8000-000000000000";
    expect((await editor.put(roleUrl(REMOTE), { profileId: unknown })).status).toBe(404);
    expect((await editor.put(roleUrl("<nope@x>"), { profileId: germany.id })).status).toBe(404);
    expect((await editor.put(roleUrl(REMOTE), { profileId: "nope" })).status).toBe(400);
    await editor.patch(`${base()}/profiles/${germany.id}`, { enabled: false });
    const off = await editor.put(roleUrl(REMOTE), { profileId: germany.id });
    expect(off.status).toBe(409);
    expect(await off.json()).toMatchObject({ error: "profile_off" });
    // A member who sees the pipeline only may reassign job mail.
    expect((await pipelineOnly.put(roleUrl(REMOTE), { profileId: remoteEu.id })).status).toBe(200);
  });
});

describe("switching profiles on and off (F1.2)", () => {
  it("gives a profile that is off no roles, and keeps one on", async () => {
    await evaluate(MUNICH);
    const res = await editor.patch(`${base()}/profiles/${germany.id}`, { enabled: false });
    expect(res.status).toBe(200);
    expect(ProfileChangeResultSchema.parse(await res.json())).toMatchObject({ enabled: false });
    const asViewer = await viewer.patch(`${base()}/profiles/${germany.id}`, { enabled: true });
    expect(asViewer.status).toBe(403);
    // Every role is evaluated again: the Munich role goes to the profile that is on.
    expect((await getEvaluations(deps.db, ws.workspaceId, [MUNICH]))[0]?.stale).toBe(true);
    await evaluate(MUNICH);
    expect(await detail(MUNICH)).toMatchObject({ profileId: remoteEu.id });

    const last = await editor.patch(`${base()}/profiles/${remoteEu.id}`, { enabled: false });
    expect(last.status).toBe(409);
    expect(await last.json()).toMatchObject({ error: "last_on" });

    // Back on, it gets its roles again; a hand choice for a profile that is off is set aside.
    await editor.put(roleUrl(MUNICH), { profileId: remoteEu.id });
    expect((await editor.patch(`${base()}/profiles/${germany.id}`, { enabled: true })).status).toBe(
      200,
    );
    expect(
      (await editor.patch(`${base()}/profiles/${remoteEu.id}`, { enabled: false })).status,
    ).toBe(200);
    await evaluate(MUNICH);
    expect(await detail(MUNICH)).toMatchObject({ profileId: germany.id, source: "auto" });
  });
});
