import { createHash } from "node:crypto";
import {
  createConfirmedProfile,
  getCv,
  getEvaluations,
  getRoleCvChoice,
  listProfileCvs,
  saveEvaluation,
} from "@jobfilly/db";
import {
  type Cv,
  CvListSchema,
  type CvReadOutput,
  CvSchema,
  type LiveEvent,
  MAX_CV_BYTES,
} from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type App, createApp } from "../app";
import { docxWithText, pdfWithText } from "../cvs/test-files";
import { requestRun } from "../pipeline/reevaluate";
import {
  createFakeAi,
  createFakeMailbox,
  createTestDeps,
  type FakeAiClient,
  type FakeMailbox,
  roleFacts,
  type SeededUser,
  seedAiSettings,
  seedJobMail,
  seedUser,
  seedWorkspace,
  sessionCookie,
  signedIn,
  TEST_AI_MODELS,
  type TestClient,
  type TestDeps,
} from "../testing";

// The CV routes (F2) on PGlite with the fake AI port: uploads through multipart (text read with
// unpdf and mammoth), cv.v1 keyed by the content hash, the skill check (F2.2), tags, download,
// delete (F2.5), the role guards, and the re-evaluations a read, a delete and an editor's CV
// choice for a role ask for (F2.3).

const NOW = new Date("2026-10-15T12:00:00Z");

const BACKEND_EN = [
  "Maria Santos",
  "Backend engineer, Berlin",
  "Skills: Go, PostgreSQL, Kubernetes",
];
const BACKEND_DE = ["Maria Santos", "Backend-Entwicklerin", "Kenntnisse: Go, PostgreSQL"];
const DATA_EN = ["Maria Santos", "Data engineer", "Skills: Python, Airflow, Spark"];

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const read = (overrides: Partial<CvReadOutput> = {}): CvReadOutput => ({
  language: "en",
  skills: ["Go", "PostgreSQL", "Kubernetes"],
  roleFamilies: ["Backend engineering"],
  seniority: "Senior",
  countryHints: ["DE"],
  formatHints: ["one page"],
  ...overrides,
});

let deps: TestDeps;
let ai: FakeAiClient;
let mailbox: FakeMailbox;
let app: App;
let maria: SeededUser;
let viewerUser: SeededUser;
let tom: SeededUser;
let ws: string;
let editor: TestClient;
let viewer: TestClient;
let outsider: TestClient;
let events: LiveEvent[];

beforeEach(async () => {
  deps = await createTestDeps({ now: NOW });
  ai = createFakeAi();
  deps.ai = ai.port;
  mailbox = createFakeMailbox();
  deps.mail = mailbox.port;
  app = createApp(deps);
  maria = await seedUser(deps, { name: "Maria Santos" });
  viewerUser = await seedUser(deps, { name: "Vera Viewer" });
  tom = await seedUser(deps, { name: "Tom Okafor" });
  ws = (
    await seedWorkspace(deps, { owner: maria, members: [{ user: viewerUser, role: "viewer" }] })
  ).workspaceId;
  await seedAiSettings(deps, ws, {
    provider: "openai-compatible",
    baseUrl: "http://fake-ai:8080/v1",
    models: TEST_AI_MODELS,
    apiKey: "E2E-SECRET-ai-key",
  });
  editor = await signedIn(app, deps, maria);
  viewer = await signedIn(app, deps, viewerUser);
  outsider = await signedIn(app, deps, tom);
  events = [];
  deps.live.subscribe(
    { workspaceId: ws, userId: maria.id, sessionId: "s" },
    (e) => events.push(e),
    () => {},
  );
});
afterEach(() => deps.close());

const cvsPath = (workspaceId = ws) => `/api/workspaces/${workspaceId}/cvs`;

/** A multipart upload as the browser's file input sends it. */
async function upload(
  user: SeededUser,
  file: { bytes: Uint8Array; name: string; type?: string },
  fields: { name?: string; workspaceId?: string } = {},
): Promise<Response> {
  // A second apart, so the CVs list in upload order.
  deps.clock.advance(1000);
  const form = new FormData();
  form.set("file", new File([new Uint8Array(file.bytes)], file.name, { type: file.type ?? "" }));
  if (fields.name) form.set("name", fields.name);
  return app.request(cvsPath(fields.workspaceId), {
    method: "POST",
    headers: { Origin: deps.config.origin, Cookie: await sessionCookie(deps, user) },
    body: form,
  });
}

async function uploaded(res: Response): Promise<Cv> {
  expect(res.status).toBe(201);
  return CvSchema.parse(await res.json());
}

/** Runs every queued job (cv.read, then the re-evaluations it asks for). */
async function drain() {
  for (let ran = 0; await deps.queue.runOnce(); ran++) {
    if (ran > 20) throw new Error("jobs keep coming");
  }
}

const list = async (client: TestClient) =>
  CvListSchema.parse(await (await client.get(cvsPath())).json());

/** Whether a pipeline.reevaluate is waiting (asking for one is a no-op while one waits). */
const reevaluationWaiting = async () => !(await requestRun(deps, ws, "probe")).enqueued;

describe("uploading and reading CVs (F2.1)", () => {
  it("reads a PDF and a DOCX, stores their text, and suggests tags from cv.v1", async () => {
    const pdf = pdfWithText(BACKEND_EN);
    const docx = docxWithText(BACKEND_DE);
    ai.answers.cv[sha256(pdf)] = read();
    ai.answers.cv[sha256(docx)] = read({ language: "de", countryHints: [], formatHints: [] });

    const en = await uploaded(
      await upload(
        maria,
        { bytes: pdf, name: "backend-en.pdf", type: "application/pdf" },
        {
          name: "Backend (EN)",
        },
      ),
    );
    expect(en).toMatchObject({
      name: "Backend (EN)",
      fileName: "backend-en.pdf",
      mediaType: "pdf",
      sizeBytes: pdf.byteLength,
      contentHash: sha256(pdf),
      readStatus: "pending",
      skills: [],
    });
    // No name given: the file's name without its extension. The type comes from the bytes.
    const de = await uploaded(await upload(maria, { bytes: docx, name: "Backend (DE).docx" }));
    expect(de).toMatchObject({ name: "Backend (DE)", mediaType: "docx" });
    expect((await getCv(deps.db, ws, en.id))?.text).toContain("Skills: Go, PostgreSQL, Kubernetes");
    expect((await getCv(deps.db, ws, de.id))?.text).toContain("Kenntnisse: Go, PostgreSQL");

    await drain();
    expect(ai.log.filter((l) => l.task === "cv.v1").map((l) => l.key)).toEqual([
      sha256(pdf),
      sha256(docx),
    ]);
    const { items } = await list(viewer);
    expect(items.map((c) => [c.name, c.readStatus, c.language, c.skills])).toEqual([
      ["Backend (EN)", "done", "en", ["Go", "PostgreSQL", "Kubernetes"]],
      ["Backend (DE)", "done", "de", ["Go", "PostgreSQL"]],
    ]);
    expect(items[0]?.tags).toEqual([
      { label: "English", source: "ai" },
      { label: "Backend engineering", source: "ai" },
      { label: "Senior", source: "ai" },
      { label: "one page", source: "ai" },
    ]);
    expect(events.filter((e) => e.type === "cvs.updated").length).toBeGreaterThanOrEqual(4);

    const logged = deps.logs.filter((l) => l.event === "cv.uploaded");
    expect(logged).toHaveLength(2);
    expect(logged[0]).toMatchObject({
      level: "info",
      workspaceId: ws,
      cvId: en.id,
      mediaType: "pdf",
    });
    // Neither the CV text nor the file name reaches the log.
    for (const raw of deps.rawLogs) {
      expect(raw).not.toContain("Kubernetes");
      expect(raw).not.toContain("backend-en.pdf");
    }
    // Two real files read by unpdf and mammoth, then cv.read and its re-evaluations.
  }, 60_000);

  it("reads the same file once: cv.v1 is keyed by the content hash", async () => {
    const pdf = pdfWithText(BACKEND_EN);
    ai.answers.cv[sha256(pdf)] = read();
    await uploaded(await upload(maria, { bytes: pdf, name: "a.pdf" }));
    await drain();
    await uploaded(await upload(maria, { bytes: pdf, name: "copy.pdf" }));
    await drain();
    expect(ai.calls.cv).toBe(1);
    expect((await list(editor)).items.map((c) => [c.name, c.readStatus, c.skills.length])).toEqual([
      ["a", "done", 3],
      ["copy", "done", 3],
    ]);
  });

  it("drops a skill the CV doesn't contain and logs cv.skill_dropped as a warning (F2.2)", async () => {
    const pdf = pdfWithText(DATA_EN);
    ai.answers.cv[sha256(pdf)] = read({ skills: ["Python", "Airflow", "Spark", "Kafka"] });
    const cv = await uploaded(
      await upload(maria, { bytes: pdf, name: "Data engineering (EN).pdf" }),
    );
    await drain();
    expect((await getCv(deps.db, ws, cv.id))?.skills).toEqual(["Python", "Airflow", "Spark"]);
    const dropped = deps.logs.filter((l) => l.event === "cv.skill_dropped");
    expect(dropped).toEqual([expect.objectContaining({ level: "warn", cvId: cv.id, dropped: 1 })]);
    expect(deps.rawLogs.join("\n")).not.toContain("Kafka");
  });

  it("marks a CV whose read failed, and one in a workspace without AI settings", async () => {
    const pdf = pdfWithText(BACKEND_EN);
    // The fake AI has no answer for it: a provider error.
    const cv = await uploaded(await upload(maria, { bytes: pdf, name: "cv.pdf" }));
    await drain();
    expect((await getCv(deps.db, ws, cv.id))?.readStatus).toBe("failed");

    const own = tom.workspaceId;
    const res = await upload(tom, { bytes: pdf, name: "cv.pdf" }, { workspaceId: own });
    const toms = await uploaded(res);
    await drain();
    expect((await getCv(deps.db, own, toms.id))?.readStatus).toBe("failed");
    expect(ai.calls.cv).toBe(1);
  });

  it("refuses a file over 5 MB, a file that is neither PDF nor DOCX, and one without text", async () => {
    const big = new Uint8Array(MAX_CV_BYTES + 1);
    big.set(new TextEncoder().encode("%PDF-1.4"));
    const tooBig = await upload(maria, { bytes: big, name: "big.pdf" });
    expect(tooBig.status).toBe(413);
    expect(await tooBig.json()).toMatchObject({ error: "too_large" });
    const text = await upload(maria, { bytes: new TextEncoder().encode("hello"), name: "cv.pdf" });
    expect(text.status).toBe(415);
    const empty = await upload(maria, { bytes: pdfWithText([]), name: "scan.pdf" });
    expect(empty.status).toBe(422);
    const noFile = await editor.post(cvsPath(), {});
    expect(noFile.status).toBe(400);
    expect((await list(editor)).items).toEqual([]);
  });

  it("links an upload to the workspace's profile", async () => {
    const created = await createConfirmedProfile(deps.db, ws, {
      name: "My job search",
      entries: [],
      createdBy: maria.id,
      at: NOW,
    });
    if (!created.ok) throw new Error("expected a profile");
    const cv = await uploaded(
      await upload(maria, { bytes: pdfWithText(BACKEND_EN), name: "a.pdf" }),
    );
    expect((await listProfileCvs(deps.db, ws, created.profile.id)).map((c) => c.id)).toEqual([
      cv.id,
    ]);
  });
});

describe("tags, download and delete", () => {
  it("edits tags, downloads the exact file and deletes it with its file (F2.1, F2.5)", async () => {
    const pdf = pdfWithText(BACKEND_EN);
    ai.answers.cv[sha256(pdf)] = read();
    const cv = await uploaded(await upload(maria, { bytes: pdf, name: "Backend (EN).pdf" }));
    await drain();

    const tags = [
      { label: "English", source: "ai" as const },
      { label: "preferred", source: "you" as const },
    ];
    const patched = await editor.patch(`${cvsPath()}/${cv.id}`, { tags });
    expect(patched.status).toBe(200);
    expect(CvSchema.parse(await patched.json()).tags).toEqual(tags);
    expect((await list(viewer)).items[0]?.tags).toEqual(tags);
    expect((await editor.patch(`${cvsPath()}/${cv.id}`, { tags: [{ label: "" }] })).status).toBe(
      400,
    );

    const file = await viewer.get(`${cvsPath()}/${cv.id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get("Content-Type")).toBe("application/pdf");
    expect(file.headers.get("Content-Disposition")).toBe(
      `attachment; filename="Backend (EN).pdf"; filename*=UTF-8''Backend%20(EN).pdf`,
    );
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(pdf);

    expect((await editor.delete(`${cvsPath()}/${cv.id}`)).status).toBe(204);
    expect((await list(editor)).items).toEqual([]);
    expect((await viewer.get(`${cvsPath()}/${cv.id}/file`)).status).toBe(404);
    expect((await editor.delete(`${cvsPath()}/${cv.id}`)).status).toBe(404);
  });

  it("lets a viewer read and download but not upload, tag or delete (403)", async () => {
    const cv = await uploaded(
      await upload(maria, { bytes: pdfWithText(BACKEND_EN), name: "a.pdf" }),
    );
    expect((await viewer.get(cvsPath())).status).toBe(200);
    expect((await viewer.get(`${cvsPath()}/${cv.id}/file`)).status).toBe(200);
    expect(
      (await upload(viewerUser, { bytes: pdfWithText(BACKEND_EN), name: "b.pdf" })).status,
    ).toBe(403);
    expect((await viewer.patch(`${cvsPath()}/${cv.id}`, { tags: [] })).status).toBe(403);
    expect((await viewer.delete(`${cvsPath()}/${cv.id}`)).status).toBe(403);
    expect((await list(editor)).items.map((c) => c.id)).toEqual([cv.id]);
  });

  it("gives a member of another workspace a 404 for the CV, by either workspace", async () => {
    const cv = await uploaded(
      await upload(maria, { bytes: pdfWithText(BACKEND_EN), name: "a.pdf" }),
    );
    expect((await outsider.get(`${cvsPath()}/${cv.id}/file`)).status).toBe(404);
    expect((await outsider.get(cvsPath())).status).toBe(404);
    expect((await outsider.get(`${cvsPath(tom.workspaceId)}/${cv.id}/file`)).status).toBe(404);
    expect((await outsider.delete(`${cvsPath(tom.workspaceId)}/${cv.id}`)).status).toBe(404);
    expect((await list(editor)).items).toHaveLength(1);
  });
});

describe("re-evaluation after a CV change (requestReevaluation)", () => {
  const messageId = "<berlin@rheinpfad.example>";

  async function evaluatedRoles() {
    await seedJobMail(deps, ws, mailbox, {
      messageId,
      receivedAt: NOW,
      roles: [roleFacts({ title: "Backend Engineer" }), roleFacts({ title: "Data Engineer" })],
    });
    for (const position of [0, 1]) {
      await saveEvaluation(
        deps.db,
        ws,
        messageId,
        {
          position,
          match: null,
          hidden: null,
          ruleEffects: [],
          cvChoice: { cvId: null, reason: "No CV uploaded yet", source: "auto" },
        },
        NOW,
      );
    }
  }
  const stale = async () =>
    (await getEvaluations(deps.db, ws, [messageId])).map((e) => [e.position, e.stale]);

  it("a finished cv.read marks the profile's roles stale and enqueues a re-evaluation", async () => {
    await evaluatedRoles();
    const pdf = pdfWithText(BACKEND_EN);
    ai.answers.cv[sha256(pdf)] = read();
    await uploaded(await upload(maria, { bytes: pdf, name: "a.pdf" }));
    // The upload alone changes nothing yet: the CV isn't read.
    expect(await stale()).toEqual([
      [0, false],
      [1, false],
    ]);
    expect(await deps.queue.runOnce()).toBe(true);
    expect(await stale()).toEqual([
      [0, true],
      [1, true],
    ]);
    expect(await reevaluationWaiting()).toBe(true);
  });

  it("a CV delete marks the roles stale and enqueues a re-evaluation (F2.5)", async () => {
    const cv = await uploaded(
      await upload(maria, { bytes: pdfWithText(BACKEND_EN), name: "a.pdf" }),
    );
    await evaluatedRoles();
    expect((await editor.delete(`${cvsPath()}/${cv.id}`)).status).toBe(204);
    expect(await stale()).toEqual([
      [0, true],
      [1, true],
    ]);
    expect(await reevaluationWaiting()).toBe(true);
  });

  it("an editor's CV for one role re-evaluates that role (F2.3)", async () => {
    const cv = await uploaded(
      await upload(maria, { bytes: pdfWithText(DATA_EN), name: "x.pdf" }, { name: "Data (EN)" }),
    );
    await evaluatedRoles();
    const rolePath = (p: number | string) =>
      `/api/workspaces/${ws}/messages/${encodeURIComponent(messageId)}/roles/${p}/cv`;

    expect((await viewer.put(rolePath(1), { cvId: cv.id })).status).toBe(403);
    const chosen = await editor.put(rolePath(1), { cvId: cv.id });
    expect(chosen.status).toBe(200);
    expect(await chosen.json()).toEqual({
      cvId: cv.id,
      reason: "You chose Data (EN) for this role",
      source: "you",
    });
    expect(await getRoleCvChoice(deps.db, ws, { messageId, position: 1 })).toBe(cv.id);
    expect(await stale()).toEqual([
      [0, false],
      [1, true],
    ]);
    expect(await reevaluationWaiting()).toBe(true);

    const back = await editor.put(rolePath(1), { cvId: null });
    expect(back.status).toBe(200);
    expect(await back.json()).toBeNull();
    expect(await getRoleCvChoice(deps.db, ws, { messageId, position: 1 })).toBeNull();
    // An unknown CV, a role the message doesn't have, and another workspace's CV: 404.
    expect(
      (await editor.put(rolePath(1), { cvId: "8f0e1c62-0000-4000-8000-000000000001" })).status,
    ).toBe(404);
    expect((await editor.put(rolePath(5), { cvId: cv.id })).status).toBe(404);
    const toms = await uploaded(
      await upload(
        tom,
        { bytes: pdfWithText(DATA_EN), name: "t.pdf" },
        { workspaceId: tom.workspaceId },
      ),
    );
    expect((await editor.put(rolePath(1), { cvId: toms.id })).status).toBe(404);
  });
});
