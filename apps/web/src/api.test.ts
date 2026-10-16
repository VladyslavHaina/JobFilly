import { CvSchema } from "@jobfilly/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiDownload, apiUpload } from "./api";

// Uploads and downloads (F2): multipart with no JSON Content-Type, a file's bytes and name back.

afterEach(() => vi.unstubAllGlobals());

const cv = {
  id: "00000000-0000-4000-8000-0000000000c1",
  name: "Backend (EN)",
  fileName: "backend-en.pdf",
  mediaType: "pdf",
  sizeBytes: 4,
  contentHash: "a".repeat(64),
  language: null,
  skills: [],
  roleFamilies: [],
  seniority: null,
  countryHints: [],
  formatHints: [],
  tags: [],
  preferred: false,
  readStatus: "pending",
  uploadedAt: "2026-10-01T10:00:00.000Z",
};

function stubFetch(answer: Response) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return answer;
    }),
  );
  return calls;
}

describe("apiUpload", () => {
  it("posts the form as multipart, letting the browser set the Content-Type", async () => {
    const calls = stubFetch(Response.json(cv, { status: 201 }));
    const form = new FormData();
    form.set("file", new File(["%PDF"], "backend-en.pdf", { type: "application/pdf" }));
    const result = await apiUpload("/api/workspaces/w/cvs", form, CvSchema);
    expect(result).toEqual(cv);
    const [call] = calls;
    expect(call?.init?.method).toBe("POST");
    expect(call?.init?.body).toBe(form);
    expect(call?.init?.headers).toEqual({});
    expect(call?.init?.credentials).toBe("same-origin");
  });

  it("throws the server's error in plain words", async () => {
    stubFetch(
      Response.json({ error: "too_large", message: "A CV can be 5 MB at most" }, { status: 413 }),
    );
    const error = await apiUpload("/x", new FormData(), CvSchema).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 413,
      code: "too_large",
      message: "A CV can be 5 MB at most",
    });
  });
});

describe("apiDownload", () => {
  it("returns the bytes and the file name of Content-Disposition, UTF-8 name first", async () => {
    stubFetch(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="Lebenslauf.pdf"; filename*=UTF-8''Lebenslauf%20M%C3%BCller.pdf`,
        },
      }),
    );
    const { blob, fileName } = await apiDownload("/api/workspaces/w/cvs/c/file");
    expect(fileName).toBe("Lebenslauf Müller.pdf");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("falls back to the plain name, or none", async () => {
    stubFetch(
      new Response("x", { headers: { "Content-Disposition": 'attachment; filename="cv.docx"' } }),
    );
    expect((await apiDownload("/f")).fileName).toBe("cv.docx");
    stubFetch(new Response("x"));
    expect((await apiDownload("/f")).fileName).toBeNull();
  });

  it("throws on an error answer", async () => {
    stubFetch(Response.json({ error: "not_found" }, { status: 404 }));
    await expect(apiDownload("/f")).rejects.toMatchObject({ status: 404, code: "not_found" });
  });
});
