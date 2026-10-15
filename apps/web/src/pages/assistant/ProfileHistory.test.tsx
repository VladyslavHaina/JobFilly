import type { ProfileHistoryItem, Role } from "@jobfilly/schema";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type FakeRequest,
  fakeApi,
  renderInWorkspace,
  testWorkspace,
} from "../../components/testing";
import { ProfileHistory } from ".";

// The profile history (F8.4): each change with who, when, where it came from and the request
// behind it, before and after in plain words, and Undo for editors only.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const WS = testWorkspace().id;
const PROFILE = "00000000-0000-4000-8000-0000000000f1";
const ENTRY = "00000000-0000-4000-8000-0000000000a7";

const item = (overrides: Partial<ProfileHistoryItem> = {}): ProfileHistoryItem => ({
  id: ENTRY,
  at: "2026-10-15T12:00:00.000Z",
  by: "00000000-0000-4000-8000-000000000001",
  byName: "Maria Santos",
  source: "assistant",
  request: "Lately I don't want jobs in Asian time zones anymore, ignore them",
  changes: [],
  before: { entries: [], rules: [] },
  after: { entries: [], rules: [] },
  lines: [
    {
      target: "rule",
      label: "Rule",
      before: null,
      after: "Hide roles whose working hours are UTC+5 or later",
    },
  ],
  undoneAt: null,
  ...overrides,
});

const HISTORY = "/api/workspaces/:ws/profiles/:pid/history";

function setup(role: Role) {
  let current = item();
  const requests = fakeApi({
    [`GET ${HISTORY}`]: () => ({ items: [current] }),
    [`POST ${HISTORY}/:id/undo`]: (_req: FakeRequest, params: Record<string, string>) => {
      current = item({ id: params.id, undoneAt: "2026-10-15T12:05:00.000Z" });
      return current;
    },
  });
  renderInWorkspace(<ProfileHistory workspaceId={WS} profileId={PROFILE} />, { role });
  return requests;
}

const entry = async () =>
  within(await screen.findByRole("list", { name: "Profile history" })).getAllByRole("listitem")[0];

describe("ProfileHistory", () => {
  it("shows who, when, the source, the request and the change in plain words", async () => {
    setup("viewer");
    const row = await entry();
    expect(row?.textContent).toContain("Maria Santos");
    expect(row?.textContent).toContain("From the assistant");
    expect(row?.textContent).toContain(
      "“Lately I don't want jobs in Asian time zones anymore, ignore them”",
    );
    expect(row?.textContent).toContain(
      "Rule: no such rule → Hide roles whose working hours are UTC+5 or later",
    );
    expect(row?.querySelector("time")?.getAttribute("dateTime")).toBe("2026-10-15T12:00:00.000Z");
  });

  it("lets an editor undo a change, which then shows as undone", async () => {
    const requests = setup("editor");
    const row = await entry();
    if (!row) throw new Error("expected an entry");
    await userEvent.click(within(row).getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(requests.some((r) => r.method === "POST" && r.path.endsWith(`${ENTRY}/undo`))).toBe(
        true,
      ),
    );
    expect(await screen.findByText("Undone")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("shows Undo disabled to a viewer", async () => {
    const requests = setup("viewer");
    const row = await entry();
    if (!row) throw new Error("expected an entry");
    const undo = within(row).getByRole("button", { name: "Undo" }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    expect(screen.getByText(/Only editors and admins can undo/)).toBeTruthy();
    expect(requests.some((r) => r.method === "POST")).toBe(false);
  });
});
