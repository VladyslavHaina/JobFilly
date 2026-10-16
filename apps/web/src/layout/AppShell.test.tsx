import { act, cleanup, screen, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeApi, renderApp, TEST_USER, testWorkspace } from "../components/testing";
import { paths } from "../paths";

// The slices' pages, as the shell may meet them: one that shows nothing, one that shows
// something late, one that throws.
vi.mock("../pages/drafts", () => ({ DraftsPage: () => null, DraftPanel: () => null }));
vi.mock("../pages/cvs", () => ({
  CvsPage: () => {
    const [ready, setReady] = useState(false);
    useEffect(() => {
      const timer = setTimeout(() => setReady(true), 50);
      return () => clearTimeout(timer);
    }, []);
    return ready ? <h1>Your CVs</h1> : <div className="flex flex-col" />;
  },
  CvChoice: () => null,
  ProfileCvPrompt: () => null,
}));
vi.mock("../pages/decisions", () => ({
  DecisionsPage: () => {
    throw new Error("broken slot");
  },
  DecisionCount: () => null,
}));
vi.mock("../pages/assistant", () => ({
  AssistantLauncher: () => null,
  ProfileHistory: () => null,
}));

const ws = testWorkspace();

function signedIn() {
  fakeApi({
    "GET /api/auth/session": { user: TEST_USER },
    "GET /api/workspaces": { items: [ws] },
    "GET /api/invites": { items: [] },
  });
}

const main = () => screen.getByRole("main");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a page that shows nothing", () => {
  it("keeps its heading on screen, loading first, then says there's nothing yet", async () => {
    signedIn();
    renderApp(paths.drafts(ws.id));
    const heading = await screen.findByRole("heading", { name: "Drafts" });
    expect(main().contains(heading)).toBe(true);
    expect(within(main()).getByText("Loading…")).toBeTruthy();
    expect(
      await within(main()).findByText("Nothing to show here yet.", {}, { timeout: 3000 }),
    ).toBeTruthy();
  });

  it("gives way to the page once it renders", async () => {
    signedIn();
    renderApp(paths.cvs(ws.id));
    expect(await screen.findByRole("heading", { name: "CVs" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Your CVs" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "CVs" })).toBeNull();
  });

  it("shows its heading and an error when it throws, and the shell stays", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    signedIn();
    const { router } = renderApp(paths.decisions(ws.id));
    expect(await screen.findByRole("heading", { name: "Decisions" })).toBeTruthy();
    expect(within(main()).getByText("This page couldn't be shown")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
    // Moving on to another page leaves the error behind.
    await act(() => router.navigate(paths.cvs(ws.id)));
    expect(await screen.findByRole("heading", { name: "Your CVs" })).toBeTruthy();
    expect(screen.queryByText("This page couldn't be shown")).toBeNull();
  });
});
