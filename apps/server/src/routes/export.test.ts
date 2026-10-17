import { addMember, saveAnalysis, saveEnvelopes, setMemberScope } from "@jobfilly/db";
import { activityRows } from "@jobfilly/db/testing";
import {
  EXPORT_PARTS,
  ExportManifestSchema,
  type PipelineItem,
  type StageOneResult,
} from "@jobfilly/schema";
import { unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { loadPipeline } from "../applications/load";
import {
  createFakeMailbox,
  createTestDeps,
  roleFacts,
  type SeededUser,
  seedAiSettings,
  seedCv,
  seedMailbox,
  seedUser,
  signedIn,
  TEST_AI_MODELS,
  type TestClient,
  type TestDeps,
} from "../testing";

// The export (MVP 3, F7.1): an admin downloads the whole workspace as one ZIP, JSON for every
// part plus the CV files and a schema version, streamed so memory stays flat; no secret is in it.

let deps: TestDeps;
let app: ReturnType<typeof createApp>;
let maria: SeededUser;
let tom: SeededUser;
let mariaApi: TestClient;
let tomApi: TestClient;

const IMAP_PASSWORD = "E2E-SECRET-maria-imap";
const AI_KEY = "E2E-SECRET-ai-key";

beforeEach(async () => {
  deps = await createTestDeps();
  app = createApp(deps);
  maria = await seedUser(deps, { name: "Maria Santos", email: "maria.santos@inbox.example" });
  tom = await seedUser(deps, { name: "Tom Okafor", email: "tom.okafor@inbox.example" });
  mariaApi = await signedIn(app, deps, maria);
  tomApi = await signedIn(app, deps, tom);
});
afterEach(() => deps.close());

const exportPath = (ws = maria.workspaceId) => `/api/workspaces/${ws}/export`;

async function download(api: TestClient) {
  const res = await api.get(exportPath());
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("application/zip");
  expect(res.headers.get("Content-Disposition")).toBe(
    'attachment; filename="jobfilly-export-2026-10-01.zip"',
  );
  return unzipSync(new Uint8Array(await res.arrayBuffer()));
}

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);
const json = (bytes: Uint8Array | undefined): unknown => JSON.parse(text(bytes));

function mail(count: number, start = 0): StageOneResult[] {
  const mailbox = createFakeMailbox();
  return Array.from({ length: count }, (_, i) => ({
    envelope: mailbox.deliver({
      messageId: `<job-${start + i}@agency.example>`,
      from: { address: `recruiter${i}@agency.example`, name: `Recruiter ${i}` },
      subject: `Senior Backend Engineer ${start + i}`,
    }),
    verdict: "likely_job" as const,
    reason: null,
  }));
}

describe("the export (F7.1)", () => {
  it("holds every part, the CV files and a schema version, and no secret", async () => {
    await seedMailbox(deps, maria.workspaceId, {
      address: "maria.santos@inbox.example",
      conn: {
        host: "imap.inbox.example",
        port: 993,
        tlsMode: "tls",
        username: "maria",
        password: IMAP_PASSWORD,
      },
      sentFolderPath: "Sent",
    });
    await seedAiSettings(deps, maria.workspaceId, {
      provider: "openai-compatible",
      baseUrl: "http://ai.example/v1",
      models: TEST_AI_MODELS,
      apiKey: AI_KEY,
    });
    await saveEnvelopes(deps.db, maria.workspaceId, mail(2));
    await saveAnalysis(deps.db, maria.workspaceId, {
      messageId: "<job-0@agency.example>",
      scanId: null,
      category: "recruiter_outreach",
      roles: [],
    });
    const bytes = new TextEncoder().encode("%PDF-1.4 the backend CV");
    const cv = await seedCv(deps, maria.workspaceId, {
      name: "Backend",
      fileName: "maria-backend.pdf",
      bytes,
    });

    const files = await download(mariaApi);
    const manifest = ExportManifestSchema.parse(json(files["manifest.json"]));
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      workspaceId: maria.workspaceId,
      workspaceName: "Maria Santos's workspace",
      exportedAt: "2026-10-01T10:00:00.000Z",
      parts: [...EXPORT_PARTS],
      cvFiles: [`cvs/${cv.id}-maria-backend.pdf`],
    });
    expect(Object.keys(files).sort()).toEqual(
      [
        "manifest.json",
        ...EXPORT_PARTS.map((p) => `${p}.json`),
        `cvs/${cv.id}-maria-backend.pdf`,
      ].sort(),
    );
    for (const part of EXPORT_PARTS) expect(Array.isArray(json(files[`${part}.json`]))).toBe(true);
    expect(files[`cvs/${cv.id}-maria-backend.pdf`]).toEqual(bytes);
    const messages = json(files["messages.json"]) as { messageId: string; subject: string }[];
    expect(messages.map((m) => m.messageId).sort()).toEqual([
      "<job-0@agency.example>",
      "<job-1@agency.example>",
    ]);
    expect(json(files["cvs.json"])).toMatchObject([{ id: cv.id, fileName: "maria-backend.pdf" }]);

    const all = Object.values(files).map(text).join("\n");
    expect(all).not.toContain(IMAP_PASSWORD);
    expect(all).not.toContain(AI_KEY);
    expect(deps.rawLogs.join("\n")).not.toContain(IMAP_PASSWORD);

    // The export is logged and in the activity log, which the next export holds.
    expect(deps.logs.find((l) => l.event === "export.completed")).toMatchObject({
      workspaceId: maria.workspaceId,
      userId: maria.id,
    });
    expect((await activityRows(deps.db, maria.workspaceId)).map((r) => r.kind)).toEqual([
      "export.downloaded",
    ]);
    const again = await download(mariaApi);
    expect(json(again["activity.json"])).toMatchObject([
      { kind: "export.downloaded", actor: { userId: maria.id, name: "Maria Santos" } },
    ]);
  });

  it("holds the whole pipeline, the derived stages and those set by hand", async () => {
    await saveEnvelopes(deps.db, maria.workspaceId, mail(2));
    for (const [i, company] of ["Nordlicht", "Globex"].entries()) {
      await saveAnalysis(deps.db, maria.workspaceId, {
        messageId: `<job-${i}@agency.example>`,
        scanId: null,
        category: "recruiter_outreach",
        roles: [roleFacts({ company })],
      });
    }
    const role = { messageId: "<job-1@agency.example>", position: 0 };
    const set = await mariaApi.put(`/api/workspaces/${maria.workspaceId}/pipeline/stage`, {
      role,
      stage: "interview",
    });
    expect(set.status).toBe(200);

    const files = await download(mariaApi);
    const items = json(files["pipeline.json"]) as PipelineItem[];
    const pipeline = await loadPipeline(deps, maria.workspaceId);
    expect(items).toEqual(pipeline.stages.flatMap((s) => s.items));
    expect(items.map((i) => [i.company, i.stage, i.stageSource]).sort()).toEqual([
      ["Globex", "interview", "you"],
      ["Nordlicht", "new", "derived"],
    ]);
  });

  it("is for admins who see everything: 404 to others and to a removed member", async () => {
    expect((await tomApi.get(exportPath())).status).toBe(404);
    await addMember(deps.db, maria.workspaceId, tom.id, "editor");
    expect((await tomApi.get(exportPath())).status).toBe(403);
    await addMember(deps.db, maria.workspaceId, tom.id, "admin");
    expect((await tomApi.get(exportPath())).status).toBe(200);
    await setMemberScope(deps.db, maria.workspaceId, tom.id, "pipeline");
    expect((await tomApi.get(exportPath())).status).toBe(404);
    await mariaApi.delete(`/api/workspaces/${maria.workspaceId}/members/${tom.id}`);
    expect((await tomApi.get(exportPath())).status).toBe(404);
  });

  it("streams 5,000 messages while memory grows by less than 50 MB", async () => {
    for (let i = 0; i < 5000; i += 1000) {
      await saveEnvelopes(deps.db, maria.workspaceId, mail(1000, i));
    }
    /** Reads one export as the browser would, with how much the process's memory grew meanwhile. */
    const stream = async () => {
      const res = await mariaApi.get(exportPath());
      expect(res.status).toBe(200);
      if (!res.body) throw new Error("no body");
      const start = process.memoryUsage().rss;
      let peak = start;
      const chunks: Uint8Array[] = [];
      for await (const chunk of res.body) {
        chunks.push(chunk);
        peak = Math.max(peak, process.memoryUsage().rss);
      }
      return { chunks, growth: peak - start };
    };
    // The first export also grows the in-process test database's WebAssembly memory to its size
    // for these reads (a real Postgres runs elsewhere); the second shows the export's own memory.
    await stream();
    const { chunks, growth } = await stream();
    expect(growth).toBeLessThan(50 * 1024 * 1024);
    const zip = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of chunks) {
      zip.set(c, at);
      at += c.length;
    }
    const files = unzipSync(zip);
    expect((json(files["messages.json"]) as unknown[]).length).toBe(5000);
    // It came in many pieces, not one buffer.
    expect(chunks.length).toBeGreaterThan(5);
  }, 120_000);
});
