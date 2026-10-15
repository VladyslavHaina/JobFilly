import { getMailboxConnection } from "@jobfilly/db";
import type { MailClient } from "@jobfilly/mail";
import {
  MailboxListSchema,
  MailboxPublicSchema,
  type MailConnection,
  MailPresetListSchema,
  type MailTestResult,
  MailTestResultSchema,
} from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import type { MailPort } from "../deps";
import { open } from "../secrets";
import {
  createTestDeps,
  type SeededUser,
  seedUser,
  seedWorkspace,
  signedIn,
  TEST_SECRET_KEY,
  type TestClient,
  type TestDeps,
} from "../testing";

// The mailbox routes (F2) on PGlite, with a fake mail port: no mailbox is reached.

const PASSWORD = "E2E-SECRET-maria-imap";

const form = {
  address: "Maria.Santos@Inbox.Example",
  host: "imap.inbox.example",
  port: 993,
  tlsMode: "tls",
  username: "maria.santos@inbox.example",
  password: PASSWORD,
};

const connected: MailTestResult = { ok: true, folders: ["INBOX", "Sent"], sentPath: "Sent" };

interface FakeMail {
  port: MailPort;
  connects: { conn: MailConnection; allowInsecure: boolean }[];
  closed: number;
  result: MailTestResult;
}

function fakeMail(): FakeMail {
  const fake: FakeMail = {
    connects: [],
    closed: 0,
    result: connected,
    port: {
      connect(conn, options) {
        fake.connects.push({ conn, allowInsecure: options.allowInsecure });
        const client: MailClient = {
          test: async () => fake.result,
          fetchEnvelopes: async () => [],
          fetchBody: async () => null,
          close: async () => {
            fake.closed += 1;
          },
        };
        return client;
      },
    },
  };
  return fake;
}

let deps: TestDeps;
let mail: FakeMail;
let owner: SeededUser;
let workspaceId: string;
let admin: TestClient;
let url: string;

async function setup(config: Parameters<typeof createTestDeps>[0] = {}) {
  mail = fakeMail();
  deps = await createTestDeps({ ...config, mail: mail.port });
  owner = await seedUser(deps, { name: "Maria Santos" });
  workspaceId = owner.workspaceId;
  admin = await signedIn(createApp(deps), deps, owner);
  url = `/api/workspaces/${workspaceId}/mailboxes`;
}

beforeEach(() => setup());
afterEach(() => deps.close());

describe("roles (F1.8)", () => {
  it("lets viewers read and only admins test, connect and disconnect", async () => {
    const app = createApp(deps);
    const viewer = await seedUser(deps);
    const editor = await seedUser(deps);
    const ws = await seedWorkspace(deps, {
      owner,
      members: [
        { user: viewer, role: "viewer" },
        { user: editor, role: "editor" },
      ],
    });
    const base = `/api/workspaces/${ws.workspaceId}/mailboxes`;
    const id = "8f0e1c62-0000-4000-8000-000000000000";
    for (const user of [viewer, editor]) {
      const client = await signedIn(app, deps, user);
      expect((await client.get(base)).status).toBe(200);
      expect((await client.get(`${base}/presets`)).status).toBe(200);
      expect((await client.post(`${base}/test`, form)).status).toBe(403);
      expect((await client.post(base, form)).status).toBe(403);
      expect((await client.delete(`${base}/${id}`)).status).toBe(403);
    }
    expect(mail.connects).toEqual([]);
  });
});

describe("presets (F2.1, F2.2)", () => {
  it("lists the presets with their app-password hints", async () => {
    const { items } = MailPresetListSchema.parse(await (await admin.get(`${url}/presets`)).json());
    expect(items.find((p) => p.id === "gmail")).toMatchObject({
      host: "imap.gmail.com",
      needsAppPassword: true,
      helpUrl: expect.stringMatching(/^https:/),
    });
    expect(items.at(-1)?.id).toBe("other");
  });
});

describe("test connection (F2.1)", () => {
  it("lists the folders found, Inbox and Sent", async () => {
    const res = await admin.post(`${url}/test`, form);
    expect(res.status).toBe(200);
    expect(MailTestResultSchema.parse(await res.json())).toEqual(connected);
    expect(mail.connects).toEqual([
      {
        conn: {
          host: "imap.inbox.example",
          port: 993,
          tlsMode: "tls",
          username: "maria.santos@inbox.example",
          password: PASSWORD,
        },
        allowInsecure: false,
      },
    ]);
    expect(mail.closed).toBe(1);
  });

  it("gives a plain reason on failure and logs mailbox.test_failed without the secret", async () => {
    mail.result = { ok: false, reason: "wrong_password", message: "The server didn't accept it." };
    const res = await admin.post(`${url}/test`, form);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual(mail.result);
    expect(body).not.toContain(PASSWORD);
    const line = deps.logs.find((l) => l.event === "mailbox.test_failed");
    expect(line).toMatchObject({ level: "warn", reason: "wrong_password", workspaceId });
    expect(deps.rawLogs.join("\n")).not.toContain(PASSWORD);
    expect(deps.rawLogs.join("\n")).not.toContain("inbox.example");
  });

  it("answers 400 with the first problem when a field is missing", async () => {
    const res = await admin.post(`${url}/test`, { ...form, host: "" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", message: "Enter the server name" });
  });
});

describe("connect (F2.1, F2.3)", () => {
  it("stores the address, the Sent folder and the sealed password, and logs mailbox.connected", async () => {
    const res = await admin.post(url, form);
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain(PASSWORD);
    const mailbox = MailboxPublicSchema.parse(JSON.parse(text));
    expect(mailbox).toMatchObject({
      address: "maria.santos@inbox.example",
      sentFolderPath: "Sent",
      status: "connected",
    });
    const stored = await getMailboxConnection(deps.db, workspaceId);
    expect(stored).toMatchObject({
      mailboxId: mailbox.id,
      address: "maria.santos@inbox.example",
      host: "imap.inbox.example",
      username: "maria.santos@inbox.example",
      sentFolderPath: "Sent",
    });
    expect(stored?.secretCiphertext).not.toContain(PASSWORD);
    expect(open(TEST_SECRET_KEY, stored?.secretCiphertext ?? "")).toBe(PASSWORD);
    expect(deps.logs.find((l) => l.event === "mailbox.connected")).toMatchObject({
      level: "info",
      mailboxId: mailbox.id,
      workspaceId,
    });
    expect(deps.rawLogs.join("\n")).not.toContain(PASSWORD);
  });

  it("seals with AES-256-GCM and a fresh nonce: the same password stored twice differs", async () => {
    await admin.post(url, form);
    const first = await getMailboxConnection(deps.db, workspaceId);
    await admin.delete(`${url}/${first?.mailboxId}`);
    await admin.post(url, form);
    const second = await getMailboxConnection(deps.db, workspaceId);
    expect(second?.secretCiphertext).not.toBe(first?.secretCiphertext);
    expect(open(TEST_SECRET_KEY, second?.secretCiphertext ?? "")).toBe(PASSWORD);
    expect(() => open(new Uint8Array(32).fill(7), second?.secretCiphertext ?? "")).toThrow();
  });

  it("stores nothing when the connection doesn't work", async () => {
    mail.result = {
      ok: false,
      reason: "unreachable",
      message: "The mail server can't be reached.",
    };
    const res = await admin.post(url, form);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "unreachable",
      message: "The mail server can't be reached.",
    });
    expect(await getMailboxConnection(deps.db, workspaceId)).toBeNull();
  });

  it("never returns the password or the sealed secret", async () => {
    await admin.post(url, form);
    const stored = await getMailboxConnection(deps.db, workspaceId);
    const text = await (await admin.get(url)).text();
    const list = MailboxListSchema.parse(JSON.parse(text));
    expect(list.items).toHaveLength(1);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(stored?.secretCiphertext ?? "-");
    expect(Object.keys(list.items[0] ?? {})).not.toContain("password");
  });
});

describe("one mailbox per workspace (F2.5)", () => {
  it("refuses a second mailbox with a plain message", async () => {
    expect((await admin.post(url, form)).status).toBe(201);
    const res = await admin.post(url, { ...form, address: "other@inbox.example" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "exists",
      message: "This workspace already has a mailbox. Disconnect it first to connect another one.",
    });
    expect((await getMailboxConnection(deps.db, workspaceId))?.address).toBe(
      "maria.santos@inbox.example",
    );
  });

  it("disconnecting deletes the row and its secret", async () => {
    const { id } = MailboxPublicSchema.parse(await (await admin.post(url, form)).json());
    expect((await admin.delete(`${url}/${id}`)).status).toBe(204);
    expect(await getMailboxConnection(deps.db, workspaceId)).toBeNull();
    expect(MailboxListSchema.parse(await (await admin.get(url)).json()).items).toEqual([]);
    expect((await admin.delete(`${url}/${id}`)).status).toBe(404);
    // and a mailbox can be connected again
    expect((await admin.post(url, form)).status).toBe(201);
  });

  it("can't disconnect another workspace's mailbox", async () => {
    const tom = await seedUser(deps, { name: "Tom Okafor" });
    const tomClient = await signedIn(createApp(deps), deps, tom);
    const tomUrl = `/api/workspaces/${tom.workspaceId}/mailboxes`;
    const { id } = MailboxPublicSchema.parse(await (await tomClient.post(tomUrl, form)).json());
    expect((await admin.delete(`${url}/${id}`)).status).toBe(404);
    expect(await getMailboxConnection(deps.db, tom.workspaceId)).not.toBeNull();
  });
});

describe("plain-text IMAP (F2.4)", () => {
  const plain = { ...form, tlsMode: "none", port: 143 };

  it("is refused without JOBFILLY_ALLOW_INSECURE_MAIL", async () => {
    const tested = await admin.post(`${url}/test`, plain);
    expect(MailTestResultSchema.parse(await tested.json())).toMatchObject({
      ok: false,
      reason: "insecure_refused",
    });
    const created = await admin.post(url, plain);
    expect(created.status).toBe(400);
    expect(await created.json()).toMatchObject({ error: "insecure_refused" });
    expect(mail.connects).toEqual([]);
    expect(await getMailboxConnection(deps.db, workspaceId)).toBeNull();
  });

  it("is allowed when JOBFILLY_ALLOW_INSECURE_MAIL=true", async () => {
    await deps.close();
    await setup({ config: { allowInsecureMail: true } });
    expect((await admin.post(url, plain)).status).toBe(201);
    expect(mail.connects.map((c) => c.allowInsecure)).toEqual([true]);
    expect((await getMailboxConnection(deps.db, workspaceId))?.tlsMode).toBe("none");
  });
});
