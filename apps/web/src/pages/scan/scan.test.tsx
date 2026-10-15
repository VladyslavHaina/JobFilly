import type { CurrentScan, ScanProgress } from "@jobfilly/schema";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type FakeRequest,
  fakeApi,
  json,
  renderInWorkspace,
  testWorkspace,
} from "../../components/testing";
import { paths } from "../../paths";
import { ScanPage } from "./index";
import { NotAnalyzedBanner } from "./NotAnalyzedBanner";

// The scan screen and the inbox banner against a fake API (F4.2, F4.4, F4.6, F4.10, F3.6).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const W = testWorkspace().id;
const SCAN_ID = "00000000-0000-4000-8000-0000000000c1";
const CURRENT = "GET /api/workspaces/:id/scans/current";

function progress(overrides: Partial<ScanProgress> = {}): ScanProgress {
  return {
    scanId: SCAN_ID,
    kind: "first",
    status: "running",
    stopReason: null,
    handledWithoutAi: 275,
    likely: 345,
    analyzed: 20,
    jobFound: 16,
    answersFirm: 8,
    notAnalyzed: 325,
    calls: 18,
    tokens: 9000,
    ...overrides,
  };
}

const current = (p: ScanProgress | null, stopMessage: string | null = null): CurrentScan => ({
  progress: p,
  stopMessage,
  totalTokens: 9120,
});

const confident = current(
  progress({ status: "stopped", stopReason: "confident", analyzed: 40, notAnalyzed: 305 }),
  "Stopped: confident after 40 of 345 likely job emails",
);

describe("ScanPage", () => {
  it("lets an admin start the first scan", async () => {
    let started = false;
    const seen = fakeApi({
      [CURRENT]: () => current(started ? progress({ status: "queued", analyzed: 0 }) : null),
      "POST /api/workspaces/:id/scans": () => {
        started = true;
        return json(current(progress({ status: "queued", analyzed: 0 })), 201);
      },
    });
    renderInWorkspace(<ScanPage workspaceId={W} />);
    expect(await screen.findByText(/No scan yet/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Start scan" }));
    expect(await screen.findByText("Starting the scan…")).toBeTruthy();
    expect(seen.some((r) => r.method === "POST" && r.path.endsWith("/scans"))).toBe(true);
    expect(screen.getByRole("button", { name: "Cancel scan" })).toBeTruthy();
  });

  it("shows the counts as they change: handled without AI, analysed, jobs found, answers, tokens", async () => {
    fakeApi({ [CURRENT]: current(progress()) });
    renderInWorkspace(<ScanPage workspaceId={W} />, { role: "viewer" });
    expect(await screen.findByText(/Scanning the last 90 days/)).toBeTruthy();
    const stat = (label: string) => screen.getByText(label).parentElement?.textContent;
    expect(stat("Handled without AI")).toContain("275");
    expect(stat("Likely job emails")).toContain("345");
    expect(stat("Analyzed")).toContain("20");
    expect(stat("Job emails found")).toContain("16");
    expect(stat("Answers firming up")).toContain("8");
    expect(stat("Tokens used")).toContain("9,120");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("20");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says why the scan stopped, and leads on to the answers and the inbox", async () => {
    fakeApi({ [CURRENT]: confident });
    renderInWorkspace(<ScanPage workspaceId={W} />);
    expect(
      await screen.findByText("Stopped: confident after 40 of 345 likely job emails"),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review your answers" }).getAttribute("href")).toBe(
      paths.intake(W),
    );
    expect(screen.getByRole("link", { name: "Open the job inbox" }).getAttribute("href")).toBe(
      paths.inbox(W),
    );
    expect(screen.queryByRole("button", { name: "Start scan" })).toBeNull();
    expect(screen.getByRole("button", { name: "Analyze them" })).toBeTruthy();
  });

  it("cancels a running scan", async () => {
    let cancelled = false;
    fakeApi({
      [CURRENT]: () =>
        cancelled
          ? current(
              progress({ status: "stopped", stopReason: "cancelled" }),
              "Stopped: cancelled after 20 of 345 likely job emails",
            )
          : current(progress()),
      "POST /api/workspaces/:id/scans/:scanId/cancel": (
        _req: FakeRequest,
        params: Record<string, string>,
      ) => {
        expect(params.scanId).toBe(SCAN_ID);
        cancelled = true;
        return current(
          progress({ status: "stopped", stopReason: "cancelled" }),
          "Stopped: cancelled after 20 of 345 likely job emails",
        );
      },
    });
    renderInWorkspace(<ScanPage workspaceId={W} />);
    await userEvent.click(await screen.findByRole("button", { name: "Cancel scan" }));
    expect(
      await screen.findByText("Stopped: cancelled after 20 of 345 likely job emails"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start scan again" })).toBeTruthy();
  });

  it("shows the server's plain reason when the scan can't start", async () => {
    fakeApi({
      [CURRENT]: current(null),
      "POST /api/workspaces/:id/scans": json(
        { error: "no_mailbox", message: "Connect a mailbox before starting a scan" },
        409,
      ),
    });
    renderInWorkspace(<ScanPage workspaceId={W} />);
    await userEvent.click(await screen.findByRole("button", { name: "Start scan" }));
    expect(await screen.findByText("Connect a mailbox before starting a scan")).toBeTruthy();
  });

  it("names the scan window from SCAN_WINDOW_DAYS, the constant the scan worker reads (F4.1)", async () => {
    // A window other than the real one proves the page follows the constant instead of repeating
    // its value. The page and its test helpers are loaded fresh so they see the replaced schema.
    vi.resetModules();
    vi.doMock("@jobfilly/schema", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@jobfilly/schema")>()),
      SCAN_WINDOW_DAYS: 37,
    }));
    try {
      const testing = await import("../../components/testing");
      const { ScanPage: Page } = await import("./index");
      testing.fakeApi({ [CURRENT]: current(progress()) });
      testing.renderInWorkspace(<Page workspaceId={W} />, { role: "viewer" });
      expect(
        await screen.findByText("Scanning the last 37 days of your Inbox and Sent mail…"),
      ).toBeTruthy();
      expect(screen.getByText(/The first scan reads the last 37 days of your Inbox/)).toBeTruthy();
      expect(screen.queryByText(/90 days/)).toBeNull();
    } finally {
      vi.doUnmock("@jobfilly/schema");
      vi.resetModules();
    }
  });

  it("tells members who can't start a scan who can", async () => {
    fakeApi({ [CURRENT]: current(null) });
    renderInWorkspace(<ScanPage workspaceId={W} />, { role: "editor" });
    expect(await screen.findByText(/An admin of this workspace can start it/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("NotAnalyzedBanner (F4.10)", () => {
  it("shows how many likely job emails are left, and lets an admin analyze them", async () => {
    let started = false;
    const seen = fakeApi({
      [CURRENT]: () =>
        started ? current(progress({ kind: "analyze_rest", likely: 305, analyzed: 0 })) : confident,
      "POST /api/workspaces/:id/scans/analyze-rest": () => {
        started = true;
        return json(current(progress({ kind: "analyze_rest", likely: 305, analyzed: 0 })), 201);
      },
    });
    renderInWorkspace(<NotAnalyzedBanner workspaceId={W} />);
    expect(await screen.findByText("305 more likely job emails not analyzed")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Analyze them" }));
    expect(await screen.findByText(/Analyzing the rest: 0 of 305 likely job emails/)).toBeTruthy();
    expect(seen.filter((r) => r.path.endsWith("/analyze-rest"))).toHaveLength(1);
    expect(screen.getByRole("link", { name: "See progress" }).getAttribute("href")).toBe(
      paths.scan(W),
    );
  });

  it("shows the count without the button to members who aren't admins", async () => {
    fakeApi({ [CURRENT]: confident });
    renderInWorkspace(<NotAnalyzedBanner workspaceId={W} />, { role: "viewer" });
    expect(await screen.findByText("305 more likely job emails not analyzed")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says how a budget stop ended, with the count that is still left (S8)", async () => {
    fakeApi({
      [CURRENT]: current(
        progress({
          kind: "analyze_rest",
          status: "stopped",
          stopReason: "budget",
          likely: 305,
          analyzed: 4,
          notAnalyzed: 297,
        }),
        "Stopped: the AI budget for this run was used up after 4 of 305 likely job emails",
      ),
    });
    renderInWorkspace(<NotAnalyzedBanner workspaceId={W} />);
    expect(await screen.findByText("297 more likely job emails not analyzed")).toBeTruthy();
    expect(screen.getByText(/the AI budget for this run was used up/)).toBeTruthy();
  });

  it("shows how an Analyze them run ended once nothing is left, and nothing before any scan", async () => {
    fakeApi({
      [CURRENT]: current(
        progress({ kind: "analyze_rest", status: "stopped", stopReason: "done", notAnalyzed: 0 }),
        "Stopped: done, all 305 likely job emails analyzed",
      ),
    });
    renderInWorkspace(<NotAnalyzedBanner workspaceId={W} />);
    expect(
      await screen.findByText("Stopped: done, all 305 likely job emails analyzed"),
    ).toBeTruthy();
    cleanup();

    const seen = fakeApi({ [CURRENT]: current(null) });
    const { container } = renderInWorkspace(<NotAnalyzedBanner workspaceId={W} />);
    await waitFor(() => expect(seen.length).toBe(1));
    expect(container.textContent).toBe("");
  });
});
