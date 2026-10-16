import type { Cv, CvChoice as CvChoiceValue } from "@jobfilly/schema";
import { cleanup, configure, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type FakeRequest,
  type FakeRoutes,
  fakeApi,
  renderInWorkspace,
  testWorkspace,
} from "../../components/testing";
import { CvChoice } from "./CvChoice";
import { CvsPage } from "./CvsPage";
import { ProfileCvPrompt } from "./ProfileCvPrompt";

// The CVs page (F2.1), a role's CV choice (F2.3) and the profile's CV prompt, against a fake API.
// An upload is two round trips (the upload, then the list), so waits get more than the default.
configure({ asyncUtilTimeout: 4000 });

const ws = testWorkspace();
const url = `/api/workspaces/${ws.id}/cvs`;

function cv(overrides: Partial<Cv> = {}): Cv {
  return {
    id: "8f0e1c62-0000-4000-8000-0000000000c1",
    name: "Backend (EN)",
    fileName: "backend-en.pdf",
    mediaType: "pdf",
    sizeBytes: 48_000,
    contentHash: "a".repeat(64),
    language: "en",
    skills: ["Go", "PostgreSQL"],
    roleFamilies: ["Backend engineering"],
    seniority: "Senior",
    countryHints: [],
    formatHints: [],
    tags: [
      { label: "en", source: "ai" },
      { label: "Backend engineering", source: "ai" },
    ],
    readStatus: "done",
    uploadedAt: "2026-10-14T10:00:00.000Z",
    ...overrides,
  };
}
const backendEn = cv();
const backendDe = cv({
  id: "8f0e1c62-0000-4000-8000-0000000000c2",
  name: "Backend (DE)",
  language: "de",
  tags: [{ label: "de", source: "ai" }],
});

/** The fake API, and every multipart form the page uploads. */
function api(routes: FakeRoutes) {
  const seen = fakeApi(routes);
  const forms: FormData[] = [];
  const inner = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body instanceof FormData) forms.push(init.body);
    return inner(input, init);
  });
  return { seen, forms };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the CVs page (F2.1)", () => {
  it("explains what CVs are for and offers the upload when there are none yet", async () => {
    let items: Cv[] = [];
    api({
      [`GET ${url}`]: () => ({ items }),
      [`POST ${url}`]: () => {
        items = [backendEn];
        return Response.json(backendEn, { status: 201 });
      },
    });
    renderInWorkspace(<CvsPage workspaceId={ws.id} />, { role: "editor" });
    const empty = await screen.findByText(/No CVs uploaded yet/);
    expect(empty.textContent).toMatch(/matched against the skills in your CVs/);
    expect(empty.textContent).toMatch(/attached to its draft reply/);
    expect(screen.queryByText("Nothing to show here yet.")).toBeNull();
    const input = screen.getByLabelText("Upload CVs") as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.multiple).toBe(true);
    await userEvent.upload(
      input,
      new File(["%PDF-1.4"], "backend-en.pdf", { type: "application/pdf" }),
    );
    expect(await screen.findByRole("heading", { name: "Backend (EN)" })).toBeTruthy();
    expect(screen.queryByText(/No CVs uploaded yet/)).toBeNull();
  });

  it("uploads the chosen files through the file input with apiUpload", async () => {
    let items = [backendEn];
    const { seen, forms } = api({
      [`GET ${url}`]: () => ({ items }),
      [`POST ${url}`]: () => {
        items = [...items, backendDe];
        return Response.json(backendDe, { status: 201 });
      },
    });
    renderInWorkspace(<CvsPage workspaceId={ws.id} />, { role: "editor" });
    expect(await screen.findByRole("heading", { name: "Backend (EN)" })).toBeTruthy();

    const file = new File(["%PDF-1.4"], "Backend (DE).docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    await userEvent.upload(screen.getByLabelText("Upload CVs"), file);
    expect(await screen.findByRole("heading", { name: "Backend (DE)" })).toBeTruthy();
    expect(seen.filter((r) => r.method === "POST").map((r) => r.path)).toEqual([url]);
    expect(forms).toHaveLength(1);
    expect((forms[0]?.get("file") as File | undefined)?.name).toBe("Backend (DE).docx");
  });

  it("shows the suggested tags as an editable tag field, and adds a user tag", async () => {
    const { seen } = api({
      [`GET ${url}`]: { items: [backendEn] },
      [`PATCH ${url}/:id`]: (req: FakeRequest) => ({ ...backendEn, ...(req.body as object) }),
    });
    renderInWorkspace(<CvsPage workspaceId={ws.id} />, { role: "editor" });
    const tags = await screen.findByRole("list", { name: "Tags for Backend (EN)" });
    expect(
      within(tags)
        .getAllByRole("listitem")
        .map((li) => li.textContent?.replace("×", "")),
    ).toEqual(["en", "Backend engineering"]);
    expect(screen.getByRole("list", { name: "Skills in Backend (EN)" }).textContent).toContain(
      "Go",
    );

    await userEvent.type(
      screen.getByRole("textbox", { name: "Tags for Backend (EN)" }),
      "preferred{Enter}",
    );
    await waitFor(() => expect(seen.some((r) => r.method === "PATCH")).toBe(true));
    const patch = seen.find((r) => r.method === "PATCH");
    expect(patch?.path).toBe(`${url}/${backendEn.id}`);
    expect(patch?.body).toEqual({
      tags: [
        { label: "en", source: "ai" },
        { label: "Backend engineering", source: "ai" },
        { label: "preferred", source: "you" },
      ],
    });
  });

  it("edits the skills as tags: removes one, adds one, and says why one can't be added", async () => {
    const { seen } = api({
      [`GET ${url}`]: { items: [cv({ formatHints: ["one page"] })] },
      [`PATCH ${url}/:id`]: (req: FakeRequest) => {
        const body = req.body as { skills?: string[] };
        if (body.skills?.includes("Rust")) {
          return Response.json(
            { error: "skill_not_in_cv", message: `"Rust" isn't in the CV's text` },
            { status: 422 },
          );
        }
        return { ...backendEn, formatHints: ["one page"], ...body };
      },
    });
    renderInWorkspace(<CvsPage workspaceId={ws.id} />, { role: "editor" });
    const skills = await screen.findByRole("list", { name: "Skills in Backend (EN)" });
    const labels = () =>
      within(screen.getByRole("list", { name: "Skills in Backend (EN)" }))
        .getAllByRole("listitem")
        .map((li) => li.textContent?.replace("×", ""));
    expect(labels()).toEqual(["Go", "PostgreSQL"]);
    await userEvent.click(within(skills).getByRole("button", { name: "Remove PostgreSQL" }));
    await waitFor(() => expect(labels()).toEqual(["Go"]));
    const patches = () => seen.filter((r) => r.method === "PATCH").map((r) => r.body);
    expect(patches()).toEqual([{ skills: ["Go"] }]);

    const field = screen.getByRole("textbox", { name: "Skills in Backend (EN)" });
    await waitFor(() => expect((field as HTMLInputElement).disabled).toBe(false));
    await userEvent.type(field, "Kafka{Enter}");
    await waitFor(() => expect(labels()).toEqual(["Go", "Kafka"]));
    await waitFor(() => expect((field as HTMLInputElement).disabled).toBe(false));
    await userEvent.type(field, "Rust{Enter}");
    expect(await screen.findByText(`"Rust" isn't in the CV's text`)).toBeTruthy();
    expect(labels()).toEqual(["Go", "Kafka"]);
    expect(patches()).toEqual([
      { skills: ["Go"] },
      { skills: ["Go", "Kafka"] },
      { skills: ["Go", "Kafka", "Rust"] },
    ]);

    // The format hints are editable tags too.
    const format = screen.getByRole("list", { name: "Format of Backend (EN)" });
    await userEvent.click(within(format).getByRole("button", { name: "Remove one page" }));
    await waitFor(() => expect(patches().at(-1)).toEqual({ formatHints: [] }));
  });

  it("shows a CV still being read, and one that couldn't be read", async () => {
    api({
      [`GET ${url}`]: {
        items: [
          cv({ readStatus: "pending", tags: [], skills: [] }),
          cv({ id: backendDe.id, name: "Broken", readStatus: "failed", tags: [], skills: [] }),
        ],
      },
    });
    renderInWorkspace(<CvsPage workspaceId={ws.id} />, { role: "editor" });
    expect(await screen.findByText("Reading…")).toBeTruthy();
    expect(screen.getByText("Couldn't read")).toBeTruthy();
    // Nothing was read, so there are no skills or format hints to edit.
    expect(screen.queryByRole("textbox", { name: /^Skills in/ })).toBeNull();
  });

  it("lets a viewer see the CVs but not upload, tag or delete", async () => {
    api({ [`GET ${url}`]: { items: [backendEn] } });
    renderInWorkspace(<CvsPage workspaceId={ws.id} />, { role: "viewer" });
    expect(await screen.findByRole("heading", { name: "Backend (EN)" })).toBeTruthy();
    expect(screen.queryByLabelText("Upload CVs")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    for (const name of ["Tags for", "Skills in", "Format of"]) {
      const field = screen.getByRole("textbox", { name: `${name} Backend (EN)` });
      expect((field as HTMLInputElement).disabled).toBe(true);
    }
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
  });

  it("downloads the stored file under its own name, for a viewer too", async () => {
    const { seen } = api({
      [`GET ${url}`]: { items: [backendEn] },
      [`GET ${url}/:id/file`]: () =>
        new Response(new Uint8Array([37, 80, 68, 70]), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="Backend (EN).pdf"; filename*=UTF-8''Backend%20(EN).pdf`,
          },
        }),
    });
    const saved: { href: string; download: string }[] = [];
    // jsdom has no object URLs; the page's own URL functions are put back below.
    const { createObjectURL, revokeObjectURL } = URL;
    URL.createObjectURL = () => "blob:cv";
    URL.revokeObjectURL = () => {};
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push({ href: this.href, download: this.download });
    });
    try {
      renderInWorkspace(<CvsPage workspaceId={ws.id} />, { role: "viewer" });
      await userEvent.click(await screen.findByRole("button", { name: "Download" }));
      await waitFor(() =>
        expect(saved).toEqual([{ href: "blob:cv", download: "Backend (EN).pdf" }]),
      );
      expect(seen.find((r) => r.path.endsWith("/file"))?.path).toBe(`${url}/${backendEn.id}/file`);
    } finally {
      click.mockRestore();
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    }
  });

  it("deletes a CV after confirming, saying drafts in the mailbox stay", async () => {
    let items = [backendEn];
    const { seen } = api({
      [`GET ${url}`]: () => ({ items }),
      [`DELETE ${url}/:id`]: () => {
        items = [];
        return undefined;
      },
    });
    renderInWorkspace(<CvsPage workspaceId={ws.id} />, { role: "editor" });
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Backend (EN)?" });
    expect(dialog.textContent).toContain("Drafts already in your mailbox stay there.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText(/^No CVs uploaded yet\./)).toBeTruthy();
    expect(seen.find((r) => r.method === "DELETE")?.path).toBe(`${url}/${backendEn.id}`);
  });
});

describe("a role's CV choice (F2.3)", () => {
  const messageId = "<berlin@rheinpfad.example>";
  const choiceUrl = `/api/workspaces/${ws.id}/messages/${encodeURIComponent(messageId)}/roles/0/cv`;
  const choice: CvChoiceValue = {
    cvId: backendDe.id,
    reason: "German backend role → Backend (DE)",
    source: "auto",
  };

  it("shows the CV with its reason, and lets an editor choose another for the role", async () => {
    const { seen } = api({
      [`GET ${url}`]: { items: [backendEn, backendDe] },
      [`PUT ${choiceUrl}`]: (req: FakeRequest) => ({
        cvId: (req.body as { cvId: string }).cvId,
        reason: "You chose Backend (EN) for this role",
        source: "you",
      }),
    });
    renderInWorkspace(
      <CvChoice workspaceId={ws.id} messageId={messageId} position={0} choice={choice} />,
      { role: "editor" },
    );
    expect(screen.getByText("German backend role → Backend (DE)")).toBeTruthy();
    const select = await screen.findByLabelText("Use another CV for role 1");
    await userEvent.selectOptions(select, "Backend (EN)");
    expect(await screen.findByText("You chose Backend (EN) for this role")).toBeTruthy();
    expect(seen.find((r) => r.method === "PUT")).toMatchObject({
      path: choiceUrl,
      body: { cvId: backendEn.id },
    });
  });

  it("is read-only for viewers", async () => {
    const { seen } = api({ [`GET ${url}`]: { items: [backendEn, backendDe] } });
    renderInWorkspace(
      <CvChoice workspaceId={ws.id} messageId={messageId} position={0} choice={choice} />,
      { role: "viewer" },
    );
    expect(screen.getByText("German backend role → Backend (DE)")).toBeTruthy();
    await waitFor(() => expect(seen.some((r) => r.path === url)).toBe(true));
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("the profile's CV prompt", () => {
  it("lists the CVs with their tags", async () => {
    api({ [`GET ${url}`]: { items: [backendEn, backendDe] } });
    renderInWorkspace(<ProfileCvPrompt workspaceId={ws.id} profileId="p1" />);
    const list = await screen.findByRole("list", { name: "CVs" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Backend (EN)en · Backend engineering", "Backend (DE)de"]);
    expect(screen.getByRole("link", { name: "Manage CVs" })).toBeTruthy();
  });

  it("asks for CVs when there are none", async () => {
    api({ [`GET ${url}`]: { items: [] } });
    renderInWorkspace(<ProfileCvPrompt workspaceId={ws.id} profileId="p1" />);
    expect(await screen.findByText("Add your CVs")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Upload CVs" }).getAttribute("href")).toBe(
      `/w/${ws.id}/cvs`,
    );
  });
});
