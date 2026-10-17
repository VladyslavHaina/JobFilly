import { saveAnalysis, saveEnvelopes } from "@jobfilly/db";
import type { MailConnection, MessageBody } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import type { MailPort } from "./deps";
import { connectMailbox } from "./mailbox";
import { mailboxSession } from "./pipeline/evaluate";
import {
  createFakeMailbox,
  createTestDeps,
  type FakeMailbox,
  type SeededUser,
  seedMailbox,
  seedUser,
  signedIn,
  type TestDeps,
} from "./testing";

// MVP 3 (F3.1): a workspace has several mailboxes, and a message is read from the one it came
// from — its body, a draft's original, the pipeline's sender stage — through connectMailbox and
// the pipeline's mailbox session. Mail stored without a mailbox (before MVP 3) reads as the
// workspace's first mailbox.

const conn = (host: string): MailConnection => ({
  host,
  port: 993,
  tlsMode: "tls",
  username: "maria",
  password: "E2E-SECRET-maria-imap",
});

let deps: TestDeps;
let maria: SeededUser;
let work: FakeMailbox;
let home: FakeMailbox;
let workId: string;
let homeId: string;

beforeEach(async () => {
  deps = await createTestDeps();
  work = createFakeMailbox({ address: "maria.santos@inbox.example" });
  home = createFakeMailbox({ address: "maria.home@post.example" });
  // One port, two servers: the connection's host says which.
  const port: MailPort = {
    connect: (c, options) =>
      (c.host === "imap.post.example" ? home : work).port.connect(c, options),
  };
  deps.mail = port;
  maria = await seedUser(deps);
  workId = await seedMailbox(deps, maria.workspaceId, {
    address: "maria.santos@inbox.example",
    conn: conn("imap.inbox.example"),
    sentFolderPath: "Sent",
  });
  homeId = await seedMailbox(deps, maria.workspaceId, {
    address: "maria.home@post.example",
    conn: conn("imap.post.example"),
    sentFolderPath: "Sent",
  });
});
afterEach(() => deps.close());

/** A job message delivered to `box` and stored under `mailboxId` (none: as before MVP 3). */
async function deliver(box: FakeMailbox, messageId: string, mailboxId?: string) {
  const envelope = box.deliver({ messageId, text: `The text of ${messageId}` });
  await saveEnvelopes(
    deps.db,
    maria.workspaceId,
    [{ envelope, verdict: "likely_job", reason: null }],
    {
      mailboxId,
    },
  );
  await saveAnalysis(deps.db, maria.workspaceId, {
    messageId,
    scanId: null,
    category: "recruiter_outreach",
    roles: [],
  });
}

describe("connecting to one mailbox of several (F3.1)", () => {
  it("opens the mailbox named, and the first one when none is", async () => {
    const homeClient = await connectMailbox(deps, maria.workspaceId, homeId);
    const firstClient = await connectMailbox(deps, maria.workspaceId);
    expect(home.connections.map((c) => c.host)).toEqual(["imap.post.example"]);
    expect(work.connections.map((c) => c.host)).toEqual(["imap.inbox.example"]);
    expect(home.addresses).toEqual(["maria.home@post.example"]);
    await homeClient?.close();
    await firstClient?.close();
  });

  it("keeps one connection per mailbox for a pipeline run", async () => {
    const session = mailboxSession(deps, maria.workspaceId);
    await session.get(homeId);
    await session.get(homeId);
    await session.get(workId);
    await session.get(null);
    expect(home.calls.connect).toBe(1);
    // The first mailbox by id, and again as the default: two keys, the same server.
    expect(work.calls.connect).toBe(2);
    await session.close();
  });
});

describe("GET /messages/:messageId/body from the message's own mailbox (F3.1)", () => {
  it("fetches each message's text from the mailbox it came from", async () => {
    await deliver(home, "<home-1@agency.example>", homeId);
    await deliver(work, "<work-1@agency.example>", workId);
    const client = await signedIn(createApp(deps), deps, maria);
    const body = async (id: string) =>
      (await (
        await client.get(
          `/api/workspaces/${maria.workspaceId}/messages/${encodeURIComponent(id)}/body`,
        )
      ).json()) as MessageBody;
    expect(await body("<home-1@agency.example>")).toEqual({
      text: "The text of <home-1@agency.example>",
    });
    expect(await body("<work-1@agency.example>")).toEqual({
      text: "The text of <work-1@agency.example>",
    });
    expect(home.calls.fetchBody).toBe(1);
    expect(work.calls.fetchBody).toBe(1);
  });

  it("reads mail stored without a mailbox from the workspace's first one", async () => {
    await deliver(work, "<old-1@agency.example>");
    const client = await signedIn(createApp(deps), deps, maria);
    const res = await client.get(
      `/api/workspaces/${maria.workspaceId}/messages/${encodeURIComponent("<old-1@agency.example>")}/body`,
    );
    expect(await res.json()).toEqual({ text: "The text of <old-1@agency.example>" });
    expect(home.calls.connect).toBe(0);
  });
});
