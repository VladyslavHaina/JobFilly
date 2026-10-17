import { addMember, saveAnalysis, saveEnvelopes, setMemberScope } from "@jobfilly/db";
import {
  type Category,
  type Envelope,
  type JobFacts,
  type LiveEvent,
  type Pipeline,
  type PipelineItem,
  PipelineItemSchema,
  PipelineSchema,
} from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type App, createApp } from "../app";
import { loadPipeline } from "../applications/load";
import {
  createTestDeps,
  roleFacts,
  type SeededUser,
  seedUser,
  signedIn,
  type TestClient,
  type TestDeps,
} from "../testing";

// The application pipeline over HTTP (F5.1–F5.3, S6): the pipeline threads delivered, every role
// shows under the stage its mail gives it, the silent application flagged, the role from two
// agencies once with both senders; a role moved by hand stays there after more mail comes, and
// goes back to the derived stage when cleared. Viewers read, editors move, outsiders get 404, and
// a member who sees the pipeline only has it all (D14) but never a role of non-job mail.

const NOW = new Date("2026-10-16T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

let deps: TestDeps;
let app: App;
let maria: SeededUser;
let ws: string;
let editor: TestClient;
let viewer: TestClient;
let tom: SeededUser;
let tomClient: TestClient;
let outsider: TestClient;
let events: LiveEvent[];
let uid = 0;

beforeEach(async () => {
  deps = await createTestDeps({ now: NOW });
  app = createApp(deps);
  maria = await seedUser(deps, { name: "Maria Santos" });
  ws = maria.workspaceId;
  tom = await seedUser(deps, { name: "Tom Okafor" });
  const vera = await seedUser(deps, { name: "Vera Viewer" });
  const stranger = await seedUser(deps);
  await addMember(deps.db, ws, tom.id, "editor");
  await addMember(deps.db, ws, vera.id, "viewer");
  editor = await signedIn(app, deps, maria);
  viewer = await signedIn(app, deps, vera);
  tomClient = await signedIn(app, deps, tom);
  outsider = await signedIn(app, deps, stranger);
  events = [];
  deps.live.subscribe(
    { workspaceId: ws, userId: maria.id, sessionId: "s" },
    (e) => events.push(e),
    () => {},
  );
});
afterEach(() => deps.close());

const pipelinePath = () => `/api/workspaces/${ws}/pipeline`;
const stagePath = () => `${pipelinePath()}/stage`;

/** One message as the sync stores it: inbound job mail with its roles, or one of Maria's own. */
async function message(
  messageId: string,
  input: {
    at: Date;
    category?: Category;
    roles?: JobFacts[];
    from?: string;
    replyTo?: string;
    own?: boolean;
  },
) {
  uid += 1;
  const envelope: Envelope = {
    messageId,
    folder: input.own ? "sent" : "inbox",
    folderPath: input.own ? "Sent" : "INBOX",
    uidValidity: 1,
    uid,
    date: input.at.toISOString(),
    from: {
      address: input.own ? "maria.santos@inbox.example" : (input.from ?? "hr@globex.example"),
      name: null,
    },
    to: [],
    cc: [],
    replyTo: [],
    inReplyTo: input.replyTo ?? null,
    references: input.replyTo ? [input.replyTo] : [],
    subject: "Your application",
    listId: null,
    listUnsubscribe: null,
    precedence: null,
    autoSubmitted: null,
    snippet: "",
  };
  if (input.own) {
    await saveEnvelopes(deps.db, ws, [
      { envelope, verdict: "own_reply", reason: "your own message" },
    ]);
    return;
  }
  await saveEnvelopes(deps.db, ws, [{ envelope, verdict: "likely_job", reason: null }]);
  await saveAnalysis(deps.db, ws, {
    messageId,
    scanId: null,
    category: input.category ?? "recruiter_outreach",
    roles: input.roles ?? [],
  });
}

const role = (title: string, overrides: Partial<JobFacts> = {}) =>
  roleFacts({ title, company: "Globex", ...overrides });

/** The pipeline threads of S6. */
async function deliverPipelineThreads() {
  // Application confirmation → interview invite → offer.
  await message("<conf@globex>", {
    at: daysAgo(30),
    category: "application_update",
    roles: [role("Platform Engineer")],
  });
  await message("<inv@globex>", {
    at: daysAgo(20),
    category: "interview",
    replyTo: "<conf@globex>",
  });
  await message("<offer@globex>", { at: daysAgo(3), category: "offer", replyTo: "<inv@globex>" });
  // Application → rejection.
  await message("<initech@hr>", {
    at: daysAgo(15),
    category: "recruiter_outreach",
    from: "hr@initech.example",
    roles: [role("Data Engineer", { company: "Initech" })],
  });
  await message("<apply-initech@me>", { at: daysAgo(14), own: true, replyTo: "<initech@hr>" });
  await message("<no@initech>", {
    at: daysAgo(5),
    category: "rejection",
    from: "hr@initech.example",
    replyTo: "<apply-initech@me>",
  });
  // An application with no answer for 25 days.
  await message("<umbrella@hr>", {
    at: daysAgo(27),
    from: "hr@umbrella.example",
    roles: [role("SRE", { company: "Umbrella" })],
  });
  await message("<apply-umbrella@me>", { at: daysAgo(25), own: true, replyTo: "<umbrella@hr>" });
  // The same role sent by two agencies.
  await message("<hays@agency>", {
    at: daysAgo(4),
    from: "anna@hays.example",
    roles: [role("Backend Engineer", { company: null, agency: { name: "Hays", client: "Hooli" } })],
  });
  await message("<randstad@agency>", {
    at: daysAgo(2),
    from: "ben@randstad.example",
    roles: [role("Backend Engineer", { company: "Hooli" })],
  });
}

async function getPipeline(client: TestClient = editor): Promise<Pipeline> {
  const res = await client.get(pipelinePath());
  expect(res.status).toBe(200);
  return PipelineSchema.parse(await res.json());
}

const inStage = (p: Pipeline, stage: PipelineItem["stage"]) =>
  p.stages.find((s) => s.stage === stage)?.items ?? [];
const titled = (p: Pipeline, title: string) =>
  p.stages.flatMap((s) => s.items).find((i) => i.title === title);

describe("GET /pipeline (F5.1–F5.3)", () => {
  it("shows each thread under its stage, flags the silent application, and the two agencies' role once", async () => {
    await deliverPipelineThreads();
    const p = await getPipeline();
    expect(inStage(p, "offer").map((i) => i.title)).toEqual(["Platform Engineer"]);
    expect(inStage(p, "rejected").map((i) => i.title)).toEqual(["Data Engineer"]);
    expect(titled(p, "SRE")).toMatchObject({
      stage: "replied",
      noReply: true,
      since: daysAgo(25).toISOString(),
      nextStep: "Follow up: no answer for 25 days",
    });
    const backend = p.stages.flatMap((s) => s.items).filter((i) => i.title === "Backend Engineer");
    expect(backend).toHaveLength(1);
    expect(backend[0]).toMatchObject({
      stage: "new",
      company: "Hooli",
      senders: [
        { address: "anna@hays.example", name: null },
        { address: "ben@randstad.example", name: null },
      ],
    });
    expect(backend[0]?.roles).toHaveLength(2);
    // Nothing else is flagged.
    expect(p.stages.flatMap((s) => s.items).filter((i) => i.noReply)).toHaveLength(1);
    // What the assistant reads is what the route answers.
    expect(await loadPipeline(deps, ws)).toEqual(p);
  });

  it("leaves out roles of mail that isn't job mail", async () => {
    await message("<a@globex>", { at: daysAgo(1), roles: [role("Kept")] });
    await message("<b@spam>", { at: daysAgo(1), category: "not_job", roles: [role("Left out")] });
    const p = await getPipeline();
    expect(p.stages.flatMap((s) => s.items).map((i) => i.title)).toEqual(["Kept"]);
  });

  it("is read by viewers and members who see the pipeline only, never by outsiders", async () => {
    await deliverPipelineThreads();
    expect((await viewer.get(pipelinePath())).status).toBe(200);
    expect((await outsider.get(pipelinePath())).status).toBe(404);
    await setMemberScope(deps.db, ws, tom.id, "pipeline");
    expect(await getPipeline(tomClient)).toEqual(await getPipeline());
  });
});

describe("PUT /pipeline/stage (F5.1)", () => {
  const umbrella = { messageId: "<umbrella@hr>", position: 0 };

  it("moves a role by hand; it stays there after the next sync, and goes back when cleared", async () => {
    await deliverPipelineThreads();
    const res = await editor.put(stagePath(), { role: umbrella, stage: "interview" });
    expect(res.status).toBe(200);
    expect(PipelineItemSchema.parse(await res.json())).toMatchObject({
      role: umbrella,
      stage: "interview",
      stageSource: "you",
      since: NOW.toISOString(),
      noReply: false,
    });
    expect(deps.logs.filter((l) => l.event === "pipeline.stage_changed")).toEqual([
      expect.objectContaining({
        previousStage: "replied",
        stage: "interview",
        workspaceId: ws,
        userId: maria.id,
      }),
    ]);
    await expect.poll(() => events).toContainEqual({ type: "pipeline.updated", data: {} });

    // The next sync brings a rejection in the thread: the stage set by hand wins.
    deps.clock.advance(60 * 60 * 1000);
    await message("<no@umbrella>", {
      at: deps.clock.now(),
      category: "rejection",
      from: "hr@umbrella.example",
      replyTo: "<apply-umbrella@me>",
    });
    expect(titled(await getPipeline(), "SRE")).toMatchObject({
      stage: "interview",
      stageSource: "you",
    });

    const cleared = await editor.put(stagePath(), { role: umbrella, stage: null });
    expect(await cleared.json()).toMatchObject({ stage: "rejected", stageSource: "derived" });
    // Nothing of the role is logged: no Message-ID, no title.
    const logged = deps.rawLogs.join("\n");
    expect(logged).not.toContain("umbrella@hr");
    expect(logged).not.toContain("SRE");
  });

  it("moves the whole item from either agency's role", async () => {
    await deliverPipelineThreads();
    const second = { messageId: "<randstad@agency>", position: 0 };
    expect((await editor.put(stagePath(), { role: second, stage: "applied" })).status).toBe(200);
    const backend = (await getPipeline()).stages
      .flatMap((s) => s.items)
      .filter((i) => i.title === "Backend Engineer");
    expect(backend).toEqual([expect.objectContaining({ stage: "applied", stageSource: "you" })]);
  });

  it("is for editors: viewers get 403, outsiders 404, a bad stage 400", async () => {
    await deliverPipelineThreads();
    expect((await viewer.put(stagePath(), { role: umbrella, stage: "offer" })).status).toBe(403);
    expect((await outsider.put(stagePath(), { role: umbrella, stage: "offer" })).status).toBe(404);
    expect((await editor.put(stagePath(), { role: umbrella, stage: "hired" })).status).toBe(400);
    expect((await editor.put(stagePath(), { stage: "offer" })).status).toBe(400);
    expect(titled(await getPipeline(), "SRE")?.stageSource).toBe("derived");
  });

  it("answers 404 for a role it doesn't hold: none, or one of non-job mail, for every member", async () => {
    await message("<b@spam>", { at: daysAgo(1), category: "not_job", roles: [role("Left out")] });
    const spam = { messageId: "<b@spam>", position: 0 };
    expect((await editor.put(stagePath(), { role: spam, stage: "offer" })).status).toBe(404);
    const missing = { messageId: "<none@x>", position: 0 };
    expect((await editor.put(stagePath(), { role: missing, stage: "offer" })).status).toBe(404);
    await setMemberScope(deps.db, ws, tom.id, "pipeline");
    expect((await tomClient.put(stagePath(), { role: spam, stage: "offer" })).status).toBe(404);
  });

  it("is open to an editor who sees the pipeline only", async () => {
    await deliverPipelineThreads();
    await setMemberScope(deps.db, ws, tom.id, "pipeline");
    const res = await tomClient.put(stagePath(), { role: umbrella, stage: "closed" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stage: "closed", stageSource: "you" });
  });
});
