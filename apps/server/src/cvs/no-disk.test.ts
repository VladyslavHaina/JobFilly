import { createHash } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { type App, createApp } from "../app";
import {
  createFakeAi,
  createTestDeps,
  type SeededUser,
  seedAiSettings,
  seedUser,
  sessionCookie,
  TEST_AI_MODELS,
  type TestDeps,
} from "../testing";
import { docxWithText, pdfWithText } from "./test-files";

// F2.4: CV files live in Postgres and no replica writes them to disk. Every fs function that
// writes, creates or opens a file for writing is spied (the CommonJS object, with the ES module
// bindings synced to it, so `import { writeFile } from "node:fs"` sees the spy too) while a PDF
// and a DOCX are uploaded, read by cv.read, listed and downloaded; none is called. The test
// stack's read-only root filesystem proves the same for the image.

const WRITERS = [
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "createWriteStream",
  "mkdtemp",
  "mkdtempSync",
  "mkdir",
  "mkdirSync",
  "copyFile",
  "copyFileSync",
  "rename",
  "renameSync",
  "cp",
  "cpSync",
] as const;
const PROMISE_WRITERS = [
  "writeFile",
  "appendFile",
  "mkdtemp",
  "mkdir",
  "copyFile",
  "rename",
  "cp",
] as const;
const OPENERS = ["open", "openSync"] as const;

/** Whether fs open flags ask for writing ("w", "a", "r+", or a number with O_WRONLY/O_RDWR). */
function writes(flags: unknown): boolean {
  if (typeof flags === "number") {
    return (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT)) !== 0;
  }
  return typeof flags === "string" && /[wa+]/.test(flags);
}

let deps: TestDeps;
let app: App;
let maria: SeededUser;
let spies: MockInstance[] = [];
let opens: MockInstance[] = [];

beforeEach(async () => {
  deps = await createTestDeps();
  maria = await seedUser(deps);
  app = createApp(deps);
});
afterEach(async () => {
  for (const spy of [...spies, ...opens]) spy.mockRestore();
  spies = [];
  opens = [];
  syncBuiltinESMExports();
  await deps.close();
});

function spyOnDisk() {
  spies = [
    ...WRITERS.map((name) => vi.spyOn(fs, name)),
    ...PROMISE_WRITERS.map((name) => vi.spyOn(fs.promises, name)),
  ];
  opens = [...OPENERS.map((name) => vi.spyOn(fs, name)), vi.spyOn(fs.promises, "open")];
  syncBuiltinESMExports();
}

describe("CV uploads never touch the disk (F2.4)", () => {
  it("uploads, reads, lists and downloads a PDF and a DOCX without writing a file", async () => {
    const ws = maria.workspaceId;
    const ai = createFakeAi();
    deps.ai = ai.port;
    await seedAiSettings(deps, ws, {
      provider: "openai-compatible",
      baseUrl: "http://fake-ai:8080/v1",
      models: TEST_AI_MODELS,
      apiKey: "E2E-SECRET-ai-key",
    });
    const files = [
      { bytes: pdfWithText(["Maria Santos", "Skills: Go"]), name: "cv.pdf" },
      { bytes: docxWithText(["Maria Santos", "Skills: Go"]), name: "cv.docx" },
    ];
    for (const f of files) {
      ai.answers.cv[createHash("sha256").update(f.bytes).digest("hex")] = {
        language: "en",
        skills: ["Go"],
        roleFamilies: [],
        seniority: null,
        countryHints: [],
        formatHints: [],
      };
    }
    const cookie = await sessionCookie(deps, maria);
    const headers = { Origin: deps.config.origin, Cookie: cookie };

    spyOnDisk();
    const ids: string[] = [];
    for (const f of files) {
      const form = new FormData();
      form.set("file", new File([new Uint8Array(f.bytes)], f.name));
      const res = await app.request(`/api/workspaces/${ws}/cvs`, {
        method: "POST",
        headers,
        body: form,
      });
      expect(res.status).toBe(201);
      ids.push(((await res.json()) as { id: string }).id);
    }
    while (await deps.queue.runOnce()) {
      // Runs cv.read for both, and the re-evaluations they ask for.
    }
    const listed = await app.request(`/api/workspaces/${ws}/cvs`, { headers });
    expect(
      ((await listed.json()) as { items: { readStatus: string }[] }).items.map((c) => c.readStatus),
    ).toEqual(["done", "done"]);
    for (const [i, id] of ids.entries()) {
      const file = await app.request(`/api/workspaces/${ws}/cvs/${id}/file`, { headers });
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(files[i]?.bytes);
    }

    for (const spy of spies) expect(spy, spy.getMockName()).not.toHaveBeenCalled();
    for (const spy of opens) {
      const writing = spy.mock.calls.filter((args) => writes(args[1]));
      expect(writing, spy.getMockName()).toEqual([]);
    }
  }, 60_000);
});
