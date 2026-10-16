import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeApi, json, renderApp, TEST_USER, testWorkspace } from "../components/testing";
import { paths } from "../paths";

// The real Drafts and Decisions pages in the app shell (F6.7, F7.2): each asks the server and,
// when there is nothing, says why and what happens next in its own words. PageFrame's "Nothing
// to show here yet." is only for a page that renders nothing; it must never stand in for these,
// or "no drafts" and "not working" would look the same.

const ws = testWorkspace();
const api = `/api/workspaces/${ws.id}`;

/** Longer than PageFrame waits before it says a blank page has nothing to show. */
const PAST_FALLBACK_MS = 1800;
// The shell signs in through the fake API first (its <main> is replaced then, so each wait looks
// it up again), which under heavy CPU load can take longer than Testing Library's 1-second
// default; a wait that would never succeed still fails, later.
const SLOW = { timeout: 10_000 };
vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function serve(routes: Record<string, unknown>) {
  return fakeApi({
    "GET /api/auth/session": { user: TEST_USER },
    "GET /api/workspaces": { items: [ws] },
    "GET /api/invites": { items: [] },
    [`GET ${api}/decisions/count`]: { open: 0 },
    ...routes,
  });
}

const main = () => within(screen.getByRole("main"));

async function neverTheFallback() {
  await new Promise((resolve) => setTimeout(resolve, PAST_FALLBACK_MS));
  expect(screen.queryByText("Nothing to show here yet.")).toBeNull();
}

describe("the Drafts page in the shell", () => {
  it("asks the server and says why it's empty, never the blank-page fallback", async () => {
    const seen = serve({ [`GET ${api}/drafts`]: { items: [] } });
    renderApp(paths.drafts(ws.id));
    await waitFor(() => main().getByText(/No drafts yet\. Good matches get a reply here/), SLOW);
    expect(seen.some((r) => r.method === "GET" && r.path === `${api}/drafts`)).toBe(true);
    await neverTheFallback();
  });

  it("says when the server can't list them", async () => {
    serve({ [`GET ${api}/drafts`]: () => json({ error: "internal" }, 500) });
    renderApp(paths.drafts(ws.id));
    await waitFor(() => expect(main().getByRole("alert")).toBeTruthy(), SLOW);
    expect(screen.queryByText(/No drafts yet/)).toBeNull();
    await neverTheFallback();
  });
});

describe("the Decisions page in the shell", () => {
  it("asks the server and says why it's empty, never the blank-page fallback", async () => {
    const seen = serve({ [`GET ${api}/decisions`]: { items: [] } });
    renderApp(paths.decisions(ws.id));
    await waitFor(() => main().getByText(/Nothing to decide\./), SLOW);
    expect(seen.some((r) => r.method === "GET" && r.path === `${api}/decisions`)).toBe(true);
    await neverTheFallback();
  });

  it("says when the server can't list them", async () => {
    serve({ [`GET ${api}/decisions`]: () => json({ error: "internal" }, 500) });
    renderApp(paths.decisions(ws.id));
    await waitFor(() => expect(main().getByRole("alert")).toBeTruthy(), SLOW);
    expect(screen.queryByText(/Nothing to decide/)).toBeNull();
    await neverTheFallback();
  });
});
