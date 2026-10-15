import { saveAnalysis, saveEnvelopes, savePreferences } from "@jobfilly/db";
import {
  type Envelope,
  IntakeFormSchema,
  type JobFacts,
  ProfileListSchema,
  ProfileSchema,
} from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import {
  createTestDeps,
  type SeededWorkspace,
  seedScan,
  seedUser,
  seedWorkspace,
  signedIn,
  type TestClient,
  type TestDeps,
} from "../testing";

// The profile over HTTP (F6.5, F6.7): every entry with its source, renaming, hand edits, and a
// confirmed profile that later scan runs never change. No AI settings are stored, so the
// extra-questions call ends 'failed' without reaching a model.

const NOW = new Date("2026-10-01T10:00:00Z");
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000).toISOString();

function envelope(messageId: string, hours: number, folder: "inbox" | "sent"): Envelope {
  return {
    messageId,
    folder,
    folderPath: folder === "sent" ? "Sent" : "INBOX",
    uidValidity: 1,
    uid: hours,
    date: hoursAgo(hours),
    from: { address: `someone${hours}@mail.example`, name: null },
    to: [],
    cc: [],
    replyTo: [],
    inReplyTo: null,
    references: [],
    subject: "Subject",
    listId: null,
    listUnsubscribe: null,
    precedence: null,
    autoSubmitted: null,
    snippet: "Snippet",
  };
}

const facts = (overrides: Partial<JobFacts>): JobFacts => ({
  title: null,
  company: null,
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
  ...overrides,
});

const replyId = (n: number) => `<reply-${n}@inbox.example>`;
const jobId = (n: number) => `<job-${n}@agency.example>`;

let deps: TestDeps;
let ws: SeededWorkspace;
let editor: TestClient;
let viewer: TestClient;
let outsider: TestClient;

beforeEach(async () => {
  deps = await createTestDeps({ now: NOW });
  const app = createApp(deps);
  const owner = await seedUser(deps, { name: "Maria Santos" });
  const ed = await seedUser(deps, { name: "Eddie Editor" });
  const tom = await seedUser(deps, { name: "Tom Okafor" });
  const stranger = await seedUser(deps, { name: "Stranger" });
  ws = await seedWorkspace(deps, {
    owner,
    members: [
      { user: ed, role: "editor" },
      { user: tom, role: "viewer" },
    ],
  });
  editor = await signedIn(app, deps, ed);
  viewer = await signedIn(app, deps, tom);
  outsider = await signedIn(app, deps, stranger);

  await saveEnvelopes(deps.db, ws.workspaceId, [
    { envelope: envelope(replyId(1), 1, "sent"), verdict: "own_reply", reason: "test" },
    { envelope: envelope(replyId(2), 2, "sent"), verdict: "own_reply", reason: "test" },
  ]);
  for (const n of [1, 2]) {
    await savePreferences(deps.db, ws.workspaceId, {
      messageId: replyId(n),
      scanId: null,
      preferences: {
        places: [{ country: "DE", city: "Berlin", mode: "hybrid" }],
        contracts: ["permanent", "B2B"],
      },
    });
  }
  await seedScan(deps, ws.workspaceId, { kind: "first", status: "stopped", stopReason: "done" });
});
afterEach(() => deps.close());

const intakePath = (rest = "") => `/api/workspaces/${ws.workspaceId}/intake${rest}`;
const profilesPath = (rest = "") => `/api/workspaces/${ws.workspaceId}/profiles${rest}`;

async function confirm() {
  const res = await editor.post(intakePath("/confirm"), {});
  expect(res.status).toBe(201);
  return ProfileSchema.parse(await res.json());
}

async function profiles(client: TestClient) {
  const res = await client.get(profilesPath());
  expect(res.status).toBe(200);
  return ProfileListSchema.parse(await res.json()).items;
}

describe("GET /profiles", () => {
  it("is empty until the intake is confirmed", async () => {
    expect(await profiles(viewer)).toEqual([]);
  });

  it("lists the profile with every entry and its source, to viewers too", async () => {
    await editor.put(intakePath("/answers/contracts"), { value: ["B2B"] });
    const created = await confirm();
    const [profile] = await profiles(viewer);
    expect(profile).toEqual(created);
    const sources = Object.fromEntries(profile?.entries.map((e) => [e.key, e.source]) ?? []);
    expect(sources).toMatchObject({ contracts: "you", places: "scan", min_pay: "scan" });
  });

  it("is refused to non-members with 404", async () => {
    expect((await outsider.get(profilesPath())).status).toBe(404);
  });
});

describe("PATCH /profiles/:profileId", () => {
  it("lets an editor rename it and change an answer, recorded as theirs", async () => {
    const created = await confirm();
    const res = await editor.patch(profilesPath(`/${created.id}`), {
      name: "Germany permanent",
      entries: [{ key: "contracts", value: ["unbefristet"] }],
    });
    expect(res.status).toBe(200);
    const updated = ProfileSchema.parse(await res.json());
    expect(updated.name).toBe("Germany permanent");
    expect(updated.entries.find((e) => e.key === "contracts")).toMatchObject({
      value: ["unbefristet"],
      source: "you",
      updatedAt: NOW.toISOString(),
    });
    expect(updated.entries.find((e) => e.key === "places")?.source).toBe("scan");
    expect(await profiles(viewer)).toEqual([updated]);
  });

  it("refuses viewers (403), non-members (404), unknown profiles and questions", async () => {
    const created = await confirm();
    const rename = { name: "Mine now" };
    expect((await viewer.patch(profilesPath(`/${created.id}`), rename)).status).toBe(403);
    expect((await outsider.patch(profilesPath(`/${created.id}`), rename)).status).toBe(404);
    const missing = "8f0e1c62-0000-4000-8000-000000000000";
    expect((await editor.patch(profilesPath(`/${missing}`), rename)).status).toBe(404);
    expect((await editor.patch(profilesPath("/not-an-id"), rename)).status).toBe(404);
    const unknown = await editor.patch(profilesPath(`/${created.id}`), {
      entries: [{ key: "extra.salary-history", value: ["x"] }],
    });
    expect(unknown.status).toBe(400);
    const badValue = await editor.patch(profilesPath(`/${created.id}`), {
      entries: [{ key: "places", value: ["Berlin"] }],
    });
    expect(badValue.status).toBe(400);
    expect((await editor.patch(profilesPath(`/${created.id}`), { name: " " })).status).toBe(400);
    expect(await profiles(viewer)).toEqual([created]);
  });
});

describe("a confirmed profile", () => {
  it("never changes when an Analyze them run finds more", async () => {
    const created = await confirm();
    await seedScan(deps, ws.workspaceId, { kind: "analyze_rest", status: "running" });
    await saveEnvelopes(deps.db, ws.workspaceId, [
      ...[20, 21, 22, 23, 24].map((n) => ({
        envelope: envelope(jobId(n), n, "inbox"),
        verdict: "likely_job" as const,
        reason: "test",
      })),
      { envelope: envelope(replyId(9), 9, "sent"), verdict: "own_reply", reason: "test" },
    ]);
    for (const n of [20, 21, 22, 23, 24]) {
      await saveAnalysis(deps.db, ws.workspaceId, {
        messageId: jobId(n),
        scanId: null,
        category: "recruiter_outreach",
        roles: [facts({ seniority: "Senior" })],
      });
    }
    await savePreferences(deps.db, ws.workspaceId, {
      messageId: replyId(9),
      scanId: null,
      preferences: { places: [{ country: "PT", city: "Lisbon", mode: "onsite" }] },
    });
    // The proposal moves on…
    const form = IntakeFormSchema.parse(await (await viewer.get(intakePath())).json());
    expect(form.proposal.entries.find((e) => e.key === "seniority")?.value).toEqual(["Senior"]);
    expect(form.proposal.entries.find((e) => e.key === "places")?.value).toHaveLength(2);
    // …the confirmed profile doesn't.
    expect(await profiles(viewer)).toEqual([created]);
  });
});
