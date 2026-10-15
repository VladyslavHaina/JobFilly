import type { Draft } from "@jobfilly/schema";
import { cleanup, configure, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type FakeRequest,
  fakeApi,
  json,
  renderInWorkspace,
  testWorkspace,
} from "../../components/testing";
import { DraftPanel, DraftsPage } from "./index";

// The Drafts page and the draft panel (F6.4, F6.5, F6.7) against a fake API.

// Each step waits for a refetch through the fake API, which under heavy CPU load can take longer
// than Testing Library's 1-second default; a wait that would never succeed still fails, later.
const SLOW_MS = 10_000;
vi.setConfig({ testTimeout: 3 * SLOW_MS });
beforeAll(() => {
  configure({ asyncUtilTimeout: SLOW_MS });
});
afterAll(() => {
  configure({ asyncUtilTimeout: 1000 });
  vi.resetConfig();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const W = testWorkspace().id;
const BASE = `/api/workspaces/${W}/drafts`;
const BERLIN = "<berlin@talentbruecke.example>";

const draft = (overrides: Partial<Draft>): Draft => ({
  id: "00000000-0000-4000-8000-000000000d01",
  messageId: BERLIN,
  position: 0,
  status: "in_mailbox",
  failureKind: null,
  failureReason: null,
  subject: "Re: Backend-Rolle in Berlin",
  body: "Hallo Herr Weber,\n\nvielen Dank.",
  language: "de",
  cvId: null,
  auto: true,
  updatedAt: "2026-10-15T12:00:00.000Z",
  ...overrides,
});

const ALL: Draft[] = [
  draft({}),
  draft({
    id: "00000000-0000-4000-8000-000000000d02",
    messageId: "<remote@x.example>",
    status: "edited",
    subject: "Re: Remote role",
    body: "Edited text",
    language: "en",
  }),
  draft({
    id: "00000000-0000-4000-8000-000000000d03",
    messageId: "<amsterdam@x.example>",
    status: "discarded",
    subject: "Re: Amsterdam",
  }),
  draft({
    id: "00000000-0000-4000-8000-000000000d04",
    messageId: "<zurich@x.example>",
    status: "failed",
    failureKind: "mailbox",
    failureReason: "Couldn't reach the mail server",
    subject: null,
    body: null,
  }),
];

describe("the Drafts page (F6.7)", () => {
  it("shows each draft's status and the failed reason", async () => {
    fakeApi({ [`GET ${BASE}`]: { items: ALL } });
    renderInWorkspace(<DraftsPage workspaceId={W} />);
    expect(await screen.findByRole("img", { name: "Draft status: In mailbox" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Draft status: Edited" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Draft status: Discarded" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Draft status: Failed" })).toBeTruthy();
    expect(screen.getByText("Couldn't reach the mail server")).toBeTruthy();
    expect(screen.getByText("Edited text")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Open the message" })[0]?.getAttribute("href")).toBe(
      `/w/${W}/inbox/${encodeURIComponent(BERLIN)}`,
    );
  });

  it("is read-only for viewers", async () => {
    fakeApi({ [`GET ${BASE}`]: { items: ALL } });
    renderInWorkspace(<DraftsPage workspaceId={W} />, { role: "viewer" });
    const edits = await screen.findAllByRole("button", { name: "Edit" });
    for (const b of [...edits, ...screen.getAllByRole("button", { name: "Discard" })]) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getAllByText("Viewers can read drafts but not change them.")).not.toHaveLength(0);
  });

  it("says so when there are none", async () => {
    fakeApi({ [`GET ${BASE}`]: { items: [] } });
    renderInWorkspace(<DraftsPage workspaceId={W} />);
    expect(await screen.findByText(/No drafts yet/)).toBeTruthy();
  });
});

describe("the draft panel (F6.4, F6.5)", () => {
  it("edits and saves the draft", async () => {
    let current = draft({});
    const seen = fakeApi({
      [`GET ${BASE}`]: () => ({ items: [current] }),
      [`PATCH ${BASE}/:id`]: (req: FakeRequest) => {
        current = { ...current, ...(req.body as object), status: "edited" };
        return current;
      },
    });
    renderInWorkspace(<DraftPanel workspaceId={W} messageId={BERLIN} position={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const body = screen.getByLabelText("Reply");
    await userEvent.clear(body);
    await userEvent.type(body, "Danke, gerne.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Danke, gerne.")).toBeTruthy());
    expect(screen.getByRole("img", { name: "Draft status: Edited" })).toBeTruthy();
    const patch = seen.find((r) => r.method === "PATCH");
    expect(patch?.path).toBe(`${BASE}/${current.id}`);
    expect(patch?.body).toEqual({ subject: "Re: Backend-Rolle in Berlin", body: "Danke, gerne." });
    expect(seen.find((r) => r.method === "GET")?.search.get("messageId")).toBe(BERLIN);
  });

  it("discards the draft after confirming, then offers Draft a reply", async () => {
    let current = draft({});
    const seen = fakeApi({
      [`GET ${BASE}`]: () => ({ items: [current] }),
      [`POST ${BASE}/:id/discard`]: () => {
        current = { ...current, status: "discarded" };
        return current;
      },
    });
    renderInWorkspace(<DraftPanel workspaceId={W} messageId={BERLIN} position={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Discard" }));
    const dialog = screen.getByRole("dialog", { name: "Discard this draft?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
    expect(await screen.findByText(/You discarded the draft for this role/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Draft a reply" })).toBeTruthy();
    expect(seen.filter((r) => r.method === "POST").map((r) => r.path)).toEqual([
      `${BASE}/${current.id}/discard`,
    ]);
  });

  it("has Draft a reply for a role without a draft, and for a failed one", async () => {
    let items: Draft[] = [];
    const seen = fakeApi({
      [`GET ${BASE}`]: () => ({ items }),
      [`POST ${BASE}`]: (req: FakeRequest) => {
        items = [draft({ ...(req.body as object), status: "saving", subject: null, body: null })];
        return json(items[0], 202);
      },
    });
    renderInWorkspace(<DraftPanel workspaceId={W} messageId={BERLIN} position={1} />);
    expect(await screen.findByText("No draft for this role.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Draft a reply" }));
    expect(
      await screen.findByRole("img", { name: "Draft status: Saving to your mailbox…" }),
    ).toBeTruthy();
    expect(seen.find((r) => r.method === "POST")?.body).toEqual({ messageId: BERLIN, position: 1 });
    cleanup();

    fakeApi({ [`GET ${BASE}`]: { items: [ALL[3] && { ...ALL[3], messageId: BERLIN }] } });
    renderInWorkspace(<DraftPanel workspaceId={W} messageId={BERLIN} position={0} />);
    expect(await screen.findByText("Couldn't reach the mail server")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Draft a reply" })).toBeTruthy();
  });

  it("is read-only for viewers", async () => {
    fakeApi({ [`GET ${BASE}`]: { items: [] } });
    renderInWorkspace(<DraftPanel workspaceId={W} messageId={BERLIN} position={0} />, {
      role: "viewer",
    });
    const ask = await screen.findByRole("button", { name: "Draft a reply" });
    expect((ask as HTMLButtonElement).disabled).toBe(true);
  });
});
