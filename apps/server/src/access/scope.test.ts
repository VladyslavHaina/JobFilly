import { addMember, saveAnalysis, saveEnvelopes, setMemberScope } from "@jobfilly/db";
import { type MessageDetail, MessageListSchema } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import {
  createFakeMailbox,
  createTestDeps,
  type SeededUser,
  seedMailbox,
  seedUser,
  signedIn,
  type TestClient,
  type TestDeps,
} from "../testing";

// A member who sees the job pipeline only (MVP 3, F6.1, F6.2): roles, facts and matches, but no
// message bodies, drafts or non-job mail. Hidden resources answer 404, as for anything that
// doesn't exist; the same member with "everything" gets them.

let deps: TestDeps;
let maria: SeededUser;
let tom: SeededUser;
let tomClient: TestClient;
let mariaClient: TestClient;

const JOB = "<job-1@agency.example>";
const OTHER = "<newsletter-1@shop.example>";
const enc = encodeURIComponent;

beforeEach(async () => {
  deps = await createTestDeps();
  const mailbox = createFakeMailbox();
  deps.mail = mailbox.port;
  maria = await seedUser(deps, { name: "Maria Santos" });
  tom = await seedUser(deps, { name: "Tom Okafor" });
  await addMember(deps.db, maria.workspaceId, tom.id, "editor");
  await seedMailbox(deps, maria.workspaceId, {
    address: "maria.santos@inbox.example",
    conn: {
      host: "imap.inbox.example",
      port: 993,
      tlsMode: "tls",
      username: "maria",
      password: "E2E-SECRET-maria-imap",
    },
    sentFolderPath: "Sent",
  });
  for (const [messageId, category] of [
    [JOB, "recruiter_outreach"],
    [OTHER, "not_job"],
  ] as const) {
    const envelope = mailbox.deliver({ messageId, text: "BODYSENTINEL-scope" });
    await saveEnvelopes(deps.db, maria.workspaceId, [
      { envelope, verdict: "likely_job", reason: null },
    ]);
    await saveAnalysis(deps.db, maria.workspaceId, {
      messageId,
      scanId: null,
      category,
      roles: [],
    });
  }
  const app = createApp(deps);
  tomClient = await signedIn(app, deps, tom);
  mariaClient = await signedIn(app, deps, maria);
});
afterEach(() => deps.close());

const path = (rest: string) => `/api/workspaces/${maria.workspaceId}${rest}`;

describe("a member who sees everything", () => {
  it("gets bodies, drafts and non-job mail", async () => {
    expect((await tomClient.get(path(`/messages/${enc(JOB)}/body`))).status).toBe(200);
    expect((await tomClient.get(path(`/messages/${enc(OTHER)}`))).status).toBe(200);
    expect((await tomClient.get(path("/drafts"))).status).toBe(200);
    const list = MessageListSchema.parse(
      await (await tomClient.get(path("/messages?showNonJob=true"))).json(),
    );
    expect(list.items.map((m) => m.id).sort()).toEqual([JOB, OTHER].sort());
  });
});

describe("a member who sees the job pipeline only (F6.2)", () => {
  beforeEach(async () => {
    expect(await setMemberScope(deps.db, maria.workspaceId, tom.id, "pipeline")).toBe("ok");
  });

  it("lists job mail alone, with no draft status and no count of the rest", async () => {
    const list = MessageListSchema.parse(
      await (await tomClient.get(path("/messages?showNonJob=true"))).json(),
    );
    expect(list.items.map((m) => m.id)).toEqual([JOB]);
    expect(list.items[0]?.draft).toBeNull();
    expect(list.nonJobCount).toBe(0);
    const detail = (await (
      await tomClient.get(path(`/messages/${enc(JOB)}`))
    ).json()) as MessageDetail;
    expect(detail.id).toBe(JOB);
  });

  it("gets 404 for a message body, non-job mail and every drafts route", async () => {
    for (const url of [
      `/messages/${enc(JOB)}/body`,
      `/messages/${enc(OTHER)}`,
      "/drafts",
      "/drafts/6f1c2f4e-8d3a-4b5c-9e7f-0a1b2c3d4e5f",
    ]) {
      const res = await tomClient.get(path(url));
      expect([url, res.status]).toEqual([url, 404]);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
    const post = await tomClient.post(path("/drafts"), { messageId: JOB, position: 0 });
    expect(post.status).toBe(404);
  });

  it("leaves the owner seeing everything", async () => {
    expect((await mariaClient.get(path(`/messages/${enc(JOB)}/body`))).status).toBe(200);
  });
});
