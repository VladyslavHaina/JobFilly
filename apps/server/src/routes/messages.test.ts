import { getStoredMessages, markAnalysisFailed, saveAnalysis, saveEnvelopes } from "@jobfilly/db";
import type { MailClient } from "@jobfilly/mail";
import {
  type Envelope,
  type JobFacts,
  type LiveEvent,
  type MailConnection,
  MessageBodySchema,
  MessageDetailSchema,
  MessageListSchema,
  type MessageRef,
  type StageOneVerdict,
} from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import {
  createTestDeps,
  type SeededUser,
  type SeededWorkspace,
  seedMailbox,
  seedUser,
  seedWorkspace,
  signedIn,
  type TestClient,
  type TestDeps,
} from "../testing";

// The job inbox over HTTP (F5.1, F5.2, F5.4, F5.5), on PGlite with a fake mailbox for bodies.

const IMAP_PASSWORD = "E2E-SECRET-maria-imap";
const CONN: MailConnection = {
  host: "imap.inbox.example",
  port: 993,
  tlsMode: "tls",
  username: "maria.santos@inbox.example",
  password: IMAP_PASSWORD,
};
const UIDVALIDITY = 1700000000;
const BASE = Date.UTC(2026, 8, 1);

/** A fake mailbox: bodies by folder and UID, under one UIDVALIDITY per folder. */
interface FakeMailbox {
  bodies: Map<string, string>;
  uidValidity: Map<string, number>;
  connections: { conn: MailConnection; allowInsecure: boolean }[];
  fetched: MessageRef[];
  closed: number;
  fail: boolean;
}

function fakeMail(): FakeMailbox & { port: TestDeps["mail"] } {
  const box: FakeMailbox = {
    bodies: new Map(),
    uidValidity: new Map([
      ["INBOX", UIDVALIDITY],
      ["Sent", UIDVALIDITY],
    ]),
    connections: [],
    fetched: [],
    closed: 0,
    fail: false,
  };
  const client: MailClient = {
    test: () => Promise.reject(new Error("not used")),
    fetchEnvelopes: () => Promise.reject(new Error("not used")),
    async fetchBody(ref) {
      box.fetched.push(ref);
      if (box.fail) throw new Error(`connect ECONNREFUSED ${CONN.host} as ${CONN.username}`);
      if (box.uidValidity.get(ref.folderPath) !== ref.uidValidity) return null;
      const text = box.bodies.get(`${ref.folderPath}/${ref.uid}`);
      return text === undefined ? null : { text };
    },
    async close() {
      box.closed += 1;
    },
  };
  return Object.assign(box, {
    port: {
      connect(conn: MailConnection, options: { allowInsecure: boolean }) {
        box.connections.push({ conn, allowInsecure: options.allowInsecure });
        return client;
      },
    },
  });
}

/** Message-IDs with every character a path segment has to carry. */
const id = (n: number) => `<m${n}+a/b%c@mail.example>`;
const path = (ws: string, messageId?: string, rest = "") =>
  `/api/workspaces/${ws}/messages${messageId === undefined ? "" : `/${encodeURIComponent(messageId)}`}${rest}`;

function envelope(n: number, overrides: Partial<Envelope> = {}): Envelope {
  return {
    messageId: id(n),
    folder: "inbox",
    folderPath: "INBOX",
    uidValidity: UIDVALIDITY,
    uid: n,
    date: new Date(BASE + n * 60_000).toISOString(),
    from: { address: `recruiter${n}@agency.example`, name: `Recruiter ${n}` },
    to: [{ address: "maria.santos@inbox.example", name: "Maria Santos" }],
    cc: [],
    replyTo: [],
    inReplyTo: null,
    references: [],
    subject: `Subject ${n}`,
    listId: null,
    listUnsubscribe: null,
    precedence: null,
    autoSubmitted: null,
    snippet: `Snippet ${n}`,
    ...overrides,
  };
}

const at = (e: Envelope, verdict: StageOneVerdict) => ({ envelope: e, verdict, reason: "test" });

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

const BERLIN = facts({
  title: "Senior Backend Engineer",
  company: "Nordlicht GmbH",
  places: [{ country: "DE", city: "Berlin" }],
  workMode: "hybrid",
  pay: { min: 75000, max: 85000, currency: "EUR", period: "year", asWritten: "75–85k € p.a." },
  contract: "unbefristet",
});

let deps: TestDeps;
let app: ReturnType<typeof createApp>;
let mail: ReturnType<typeof fakeMail>;
let maria: SeededUser;
let ws: SeededWorkspace;
let admin: TestClient;
let editor: TestClient;
let viewer: TestClient;
let outsider: TestClient;

beforeEach(async () => {
  mail = fakeMail();
  deps = await createTestDeps({ mail: mail.port });
  app = createApp(deps);
  maria = await seedUser(deps, { name: "Maria Santos", email: "maria.santos@inbox.example" });
  const ed = await seedUser(deps, { name: "Eddie Editor" });
  const tom = await seedUser(deps, { name: "Tom Okafor", email: "tom.okafor@inbox.example" });
  const stranger = await seedUser(deps, { name: "Stranger" });
  ws = await seedWorkspace(deps, {
    owner: maria,
    members: [
      { user: ed, role: "editor" },
      { user: tom, role: "viewer" },
    ],
  });
  admin = await signedIn(app, deps, maria);
  editor = await signedIn(app, deps, ed);
  viewer = await signedIn(app, deps, tom);
  outsider = await signedIn(app, deps, stranger);
});
afterEach(() => deps.close());

/** The rows a scan leaves behind, one of each kind. */
async function seedMix() {
  const w = ws.workspaceId;
  await saveEnvelopes(deps.db, w, [
    at(envelope(1, { subject: "Your weekly newsletter" }), "not_job"),
    at(envelope(2, { subject: "Backend role in Berlin" }), "likely_job"),
    at(envelope(3, { subject: "5 new jobs for you" }), "job_alert"),
    at(envelope(4), "likely_job"), // the model hasn't read it yet
    at(envelope(5), "likely_job"), // the model failed on it
    at(
      envelope(6, { folder: "sent", folderPath: "Sent", subject: "Re: Backend role" }),
      "own_reply",
    ),
    at(envelope(7, { subject: "Interview invitation" }), "likely_job"),
  ]);
  await saveAnalysis(deps.db, w, {
    messageId: id(2),
    scanId: null,
    category: "recruiter_outreach",
    roles: [BERLIN],
  });
  await saveAnalysis(deps.db, w, {
    messageId: id(3),
    scanId: null,
    category: "job_alert",
    roles: [
      facts({ title: "Platform Engineer", places: [{ country: "PT", city: "Lisbon" }] }),
      facts({ title: "Go Developer", places: [{ country: "NL", city: "Amsterdam" }] }),
      facts({ title: "SRE", workMode: "remote", remoteScope: "EU" }),
    ],
  });
  await markAnalysisFailed(deps.db, w, { messageId: id(5), scanId: null });
  await saveAnalysis(deps.db, w, {
    messageId: id(7),
    scanId: null,
    category: "interview",
    roles: [BERLIN],
  });
}

async function list(client: TestClient, query = "") {
  const res = await client.get(`${path(ws.workspaceId)}${query}`);
  expect(res.status).toBe(200);
  return MessageListSchema.parse(await res.json());
}

describe("GET /messages (F5.1)", () => {
  it("lists job messages newest first with sender, subject, date and category", async () => {
    await seedMix();
    const page = await list(viewer);
    expect(page.items.map((m) => m.id)).toEqual([id(7), id(5), id(3), id(2)]);
    expect(page.items[0]).toEqual({
      id: id(7),
      from: { address: "recruiter7@agency.example", name: "Recruiter 7" },
      subject: "Interview invitation",
      date: new Date(BASE + 7 * 60_000).toISOString(),
      category: "interview",
      categorySource: "scan",
      analysisStatus: "done",
    });
    expect(page).toMatchObject({ nonJobCount: 1, page: 1, nextPage: null });
  });

  it("leaves non-job mail out but counts it, and shows it on request", async () => {
    await seedMix();
    expect((await list(viewer)).items.map((m) => m.id)).not.toContain(id(1));
    const all = await list(viewer, "?showNonJob=true");
    expect(all.items.map((m) => m.id)).toEqual([id(7), id(5), id(3), id(2), id(1)]);
  });

  it("never lists the user's own replies", async () => {
    await seedMix();
    const all = await list(viewer, "?showNonJob=true");
    expect(all.items.map((m) => m.id)).not.toContain(id(6));
  });

  it("returns failed analysis as its status, for 'Couldn't analyze'", async () => {
    await seedMix();
    const failed = (await list(viewer)).items.find((m) => m.id === id(5));
    expect(failed).toMatchObject({ analysisStatus: "failed", category: null });
  });

  it("filters by category and searches sender or subject (F5.5)", async () => {
    await seedMix();
    expect((await list(viewer, "?category=interview")).items.map((m) => m.id)).toEqual([id(7)]);
    expect((await list(viewer, "?q=recruiter3")).items.map((m) => m.id)).toEqual([id(3)]);
    expect((await list(viewer, "?q=BERLIN")).items.map((m) => m.id)).toEqual([id(2)]);
    expect((await list(viewer, "?q=newsletter")).nonJobCount).toBe(1);
    expect((await list(viewer, "?q=newsletter")).items).toEqual([]);
  });

  it("pages by 100", async () => {
    await saveEnvelopes(
      deps.db,
      ws.workspaceId,
      Array.from({ length: 130 }, (_, i) => at(envelope(i + 1), "job_alert")),
    );
    const one = await list(viewer);
    expect([one.items.length, one.nextPage]).toEqual([100, 2]);
    const two = await list(viewer, "?page=2");
    expect([two.items.length, two.nextPage, two.items.at(-1)?.id]).toEqual([30, null, id(1)]);
  });

  it("refuses a query it doesn't understand", async () => {
    expect((await viewer.get(`${path(ws.workspaceId)}?category=spam`)).status).toBe(400);
    expect((await viewer.get(`${path(ws.workspaceId)}?page=0`)).status).toBe(400);
  });
});

describe("GET /messages/:messageId (F5.2)", () => {
  it("returns the facts, the Message-ID carried through the path", async () => {
    await seedMix();
    const res = await viewer.get(path(ws.workspaceId, id(2)));
    expect(res.status).toBe(200);
    const detail = MessageDetailSchema.parse(await res.json());
    expect(detail).toMatchObject({
      id: id(2),
      subject: "Backend role in Berlin",
      category: "recruiter_outreach",
      ownReply: false,
    });
    expect(detail.roles).toEqual([BERLIN]);
  });

  it("returns every role of a job alert", async () => {
    await seedMix();
    const detail = MessageDetailSchema.parse(
      await (await viewer.get(path(ws.workspaceId, id(3)))).json(),
    );
    expect(detail.roles.map((r) => r.title)).toEqual(["Platform Engineer", "Go Developer", "SRE"]);
  });

  it("opens the user's own reply, which isn't listed, and says it is theirs", async () => {
    await seedMix();
    const detail = MessageDetailSchema.parse(
      await (await viewer.get(path(ws.workspaceId, id(6)))).json(),
    );
    expect(detail).toMatchObject({ id: id(6), ownReply: true, subject: "Re: Backend role" });
  });

  it("answers 404 for an unknown Message-ID, and to non-members", async () => {
    await seedMix();
    expect((await viewer.get(path(ws.workspaceId, "<unknown@mail.example>"))).status).toBe(404);
    const res = await outsider.get(path(ws.workspaceId, id(2)));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect((await outsider.get(path(ws.workspaceId))).status).toBe(404);
  });
});

describe("GET /messages/:messageId/body (F5.2, F4.9)", () => {
  const BODY = "Hallo Maria,\n\nwir suchen eine Senior Backend Engineer (m/w/d) in Berlin.";

  beforeEach(async () => {
    await seedMix();
    await seedMailbox(deps, ws.workspaceId, {
      address: CONN.username,
      conn: CONN,
      sentFolderPath: "Sent",
    });
    mail.bodies.set("INBOX/2", BODY);
    mail.bodies.set("Sent/6", "Thanks, I'm interested in hybrid roles in Berlin.");
  });

  it("fetches the plain text on demand with the stored connection and UIDs", async () => {
    const res = await viewer.get(path(ws.workspaceId, id(2), "/body"));
    expect(res.status).toBe(200);
    expect(MessageBodySchema.parse(await res.json())).toEqual({ text: BODY });
    expect(mail.connections).toEqual([{ conn: CONN, allowInsecure: false }]);
    expect(mail.fetched).toEqual([{ folderPath: "INBOX", uidValidity: UIDVALIDITY, uid: 2 }]);
    expect(mail.closed).toBe(1);
  });

  it("opens the body of the user's own reply from Sent", async () => {
    const res = await viewer.get(path(ws.workspaceId, id(6), "/body"));
    expect(await res.json()).toEqual({ text: "Thanks, I'm interested in hybrid roles in Berlin." });
    expect(mail.fetched).toEqual([{ folderPath: "Sent", uidValidity: UIDVALIDITY, uid: 6 }]);
  });

  it("never stores or logs the body", async () => {
    await viewer.get(path(ws.workspaceId, id(2), "/body"));
    await viewer.get(path(ws.workspaceId, id(2), "/body"));
    expect(mail.fetched).toHaveLength(2);
    const [stored] = await getStoredMessages(deps.db, ws.workspaceId, [id(2)]);
    expect(JSON.stringify(stored)).not.toContain("wir suchen");
    expect(deps.rawLogs.join("\n")).not.toContain("wir suchen");
    expect(deps.rawLogs.join("\n")).not.toContain(IMAP_PASSWORD);
  });

  it("says plainly when the folder's UIDVALIDITY changed", async () => {
    mail.uidValidity.set("INBOX", UIDVALIDITY + 1);
    const res = await viewer.get(path(ws.workspaceId, id(2), "/body"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ gone: true });
  });

  it("answers plainly when the mailbox can't be reached, without its details", async () => {
    mail.fail = true;
    const res = await viewer.get(path(ws.workspaceId, id(2), "/body"));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain("Couldn't reach your mailbox");
    expect(text).not.toContain(CONN.host);
    expect(mail.closed).toBe(1);
  });

  it("answers 404 for an unknown message and to non-members, without touching the mailbox", async () => {
    expect((await viewer.get(path(ws.workspaceId, "<nope@x>", "/body"))).status).toBe(404);
    expect((await outsider.get(path(ws.workspaceId, id(2), "/body"))).status).toBe(404);
    expect(mail.connections).toEqual([]);
  });
});

describe("GET /messages/:messageId/body without a mailbox", () => {
  it("says no mailbox is connected", async () => {
    await seedMix();
    const res = await viewer.get(path(ws.workspaceId, id(2), "/body"));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "no_mailbox" });
    expect(mail.connections).toEqual([]);
  });
});

describe("PUT /messages/:messageId/category (F5.4)", () => {
  it("stores an editor's correction as theirs, and later analysis keeps it", async () => {
    await seedMix();
    const events: LiveEvent[] = [];
    const unsubscribe = deps.live.subscribe(
      ws.workspaceId,
      (e) => events.push(e),
      () => {},
    );
    const res = await editor.put(path(ws.workspaceId, id(2), "/category"), { category: "offer" });
    expect(res.status).toBe(200);
    expect(MessageDetailSchema.parse(await res.json())).toMatchObject({
      id: id(2),
      category: "offer",
      categorySource: "you",
    });
    await expect
      .poll(() => events)
      .toContainEqual({
        type: "messages.updated",
        data: { messageIds: [id(2)] },
      });
    unsubscribe();

    // A later analysis run refreshes the facts but keeps the person's category.
    await saveAnalysis(deps.db, ws.workspaceId, {
      messageId: id(2),
      scanId: null,
      category: "rejection",
      roles: [BERLIN],
    });
    const after = await list(viewer, "?category=offer");
    expect(after.items).toEqual([
      expect.objectContaining({ id: id(2), category: "offer", categorySource: "you" }),
    ]);
  });

  it("lets admins correct too, and moves mail corrected to not job behind the toggle", async () => {
    await seedMix();
    const res = await admin.put(path(ws.workspaceId, id(7), "/category"), { category: "not_job" });
    expect(res.status).toBe(200);
    const page = await list(viewer);
    expect(page.items.map((m) => m.id)).not.toContain(id(7));
    expect(page.nonJobCount).toBe(2);
  });

  it("refuses viewers with 403 and non-members with 404, changing nothing", async () => {
    await seedMix();
    const asViewer = await viewer.put(path(ws.workspaceId, id(2), "/category"), {
      category: "offer",
    });
    expect(asViewer.status).toBe(403);
    const asOutsider = await outsider.put(path(ws.workspaceId, id(2), "/category"), {
      category: "offer",
    });
    expect(asOutsider.status).toBe(404);
    expect(await asOutsider.json()).toEqual({ error: "not_found" });
    const [stored] = await getStoredMessages(deps.db, ws.workspaceId, [id(2)]);
    expect(stored).toMatchObject({ category: "recruiter_outreach", categorySource: "scan" });
  });

  it("refuses an unknown category, an unknown message and the user's own replies", async () => {
    await seedMix();
    const put = (messageId: string, body: unknown) =>
      editor.put(path(ws.workspaceId, messageId, "/category"), body);
    expect((await put(id(2), { category: "spam" })).status).toBe(400);
    expect((await put("<nope@x>", { category: "offer" })).status).toBe(404);
    expect((await put(id(6), { category: "offer" })).status).toBe(409);
  });
});

describe("first page speed (F5.5)", () => {
  it("answers the first page of 600 messages with a p95 under one second", async () => {
    await saveEnvelopes(
      deps.db,
      ws.workspaceId,
      Array.from({ length: 600 }, (_, i) =>
        at(envelope(i + 1), i % 5 < 2 ? "not_job" : "job_alert"),
      ),
    );
    const timings: number[] = [];
    for (let i = 0; i < 20; i++) {
      const started = performance.now();
      const res = await viewer.get(path(ws.workspaceId));
      expect(res.status).toBe(200);
      expect(MessageListSchema.parse(await res.json()).items).toHaveLength(100);
      timings.push(performance.now() - started);
    }
    timings.sort((a, b) => a - b);
    const p95 = timings[Math.ceil(0.95 * timings.length) - 1] ?? Infinity;
    expect(p95).toBeLessThan(1000);
  });
});
