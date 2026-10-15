import type { MessageDetail, MessageListItem } from "@jobfilly/schema";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type FakeRequest,
  fakeApi,
  renderApp,
  TEST_USER,
  testWorkspace,
} from "../../components/testing";
import { paths } from "../../paths";

// The inbox renders the slices' slots with the props the contract pins: the mailbox status in
// the header, the Hidden filter driving hidden=true, the fit score, sender badge and hidden reason
// on each row, and per role the match panel, CV choice and draft panel. The slots are probes here.

vi.mock("../sync", async (original) => ({
  ...(await original<object>()),
  MailboxStatus: (p: { workspaceId: string }) => <p>{`status ${p.workspaceId}`}</p>,
}));
vi.mock("../match", async (original) => ({
  ...(await original<object>()),
  FitScore: (p: { fit: MessageListItem["fit"] }) => <span>{`fit ${p.fit?.score ?? "-"}`}</span>,
  HiddenReason: (p: { hidden: MessageListItem["hidden"] }) => (
    <span>{`hidden ${p.hidden?.reason ?? "-"}`}</span>
  ),
  HiddenFilter: (p: { value: boolean; onChange: (v: boolean) => void }) => (
    <button type="button" aria-pressed={p.value} onClick={() => p.onChange(!p.value)}>
      Hidden
    </button>
  ),
  MatchPanel: (p: { position: number; evaluation: { match: { score: number } | null } | null }) => (
    <p>{`match ${p.position} ${p.evaluation?.match?.score ?? "none"}`}</p>
  ),
}));
vi.mock("../senders", async (original) => ({
  ...(await original<object>()),
  SenderBadge: (p: { sender: MessageListItem["sender"] }) => (
    <span>{`sender ${p.sender?.verdict ?? "-"}`}</span>
  ),
  SenderPanel: (p: { messageId: string; check: { verdict: string } | null }) => (
    <p>{`sender panel ${p.messageId} ${p.check?.verdict ?? "none"}`}</p>
  ),
}));
vi.mock("../cvs", async (original) => ({
  ...(await original<object>()),
  CvChoice: (p: { position: number; choice: { reason: string } | null }) => (
    <p>{`cv ${p.position} ${p.choice?.reason ?? "none"}`}</p>
  ),
}));
vi.mock("../drafts", async (original) => ({
  ...(await original<object>()),
  DraftPanel: (p: { messageId: string; position: number }) => (
    <p>{`draft ${p.messageId} ${p.position}`}</p>
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ws = testWorkspace();
const ID = "<rec-1@nordlicht.example>";
const row: MessageListItem = {
  id: ID,
  from: { address: "anna@nordlicht.example", name: "Anna Weber" },
  subject: "Senior Backend Engineer in Berlin",
  date: "2026-09-25T09:30:00.000Z",
  category: "recruiter_outreach",
  categorySource: "scan",
  analysisStatus: "done",
  fit: { score: 72, capped: false, stale: false },
  sender: { verdict: "caution", complete: true },
  hidden: null,
  draft: { status: "in_mailbox" },
};
const hiddenRow: MessageListItem = {
  ...row,
  id: "<apac@x.example>",
  subject: "Remote role, UTC+8",
  fit: null,
  hidden: { reason: "Hidden by your rule" },
};
const facts = {
  title: "Senior Backend Engineer",
  company: null,
  agency: null,
  places: [],
  workMode: null,
  remoteScope: null,
  timeZones: null,
  pay: null,
  contract: null,
  seniority: null,
  workPermit: null,
  skills: [],
  languages: [],
  applyUrl: null,
  extra: {},
};
const detail: MessageDetail = {
  ...row,
  ownReply: false,
  senderCheck: { verdict: "caution", complete: true, reasons: [], mark: null },
  roles: [
    {
      ...facts,
      evaluation: {
        position: 0,
        match: {
          score: 72,
          verdicts: [],
          skills: { matched: [], missing: [] },
          cvId: null,
          capped: false,
        },
        hidden: null,
        ruleEffects: [],
        cvChoice: { cvId: null, reason: "German backend role", source: "auto" },
        stale: false,
        evaluatedAt: "2026-10-01T10:00:00.000Z",
      },
      cvChoice: { cvId: null, reason: "German backend role", source: "auto" },
    },
    { ...facts, title: "Second role", evaluation: null, cvChoice: null },
  ],
};

function api() {
  return fakeApi({
    "GET /api/auth/session": { user: TEST_USER },
    "GET /api/workspaces": { items: [ws] },
    "GET /api/invites": { items: [] },
    "GET /api/workspaces/:id/scans/current": {
      progress: null,
      stopMessage: null,
      stoppedAt: null,
      totalTokens: 0,
    },
    "GET /api/workspaces/:id/messages": (req: FakeRequest) => ({
      items: req.search.get("hidden") === "true" ? [hiddenRow] : [row],
      nonJobCount: 0,
      page: 1,
      nextPage: null,
    }),
    "GET /api/workspaces/:id/messages/:messageId": detail,
    "GET /api/workspaces/:id/messages/:messageId/body": { text: "Hallo" },
  });
}

describe("the inbox's slots", () => {
  it("shows the mailbox status and each row's fit, sender and hidden reason", async () => {
    api();
    renderApp(paths.inbox(ws.id));
    expect(await screen.findByText(`status ${ws.id}`)).toBeTruthy();
    const list = await screen.findByRole("list", { name: "Messages" });
    expect(within(list).getByText("fit 72")).toBeTruthy();
    expect(within(list).getByText("sender caution")).toBeTruthy();
    expect(within(list).getByText("hidden -")).toBeTruthy();
  });

  it("asks for hidden=true while the Hidden filter is on", async () => {
    const requests = api();
    renderApp(paths.inbox(ws.id));
    await userEvent.setup().click(await screen.findByRole("button", { name: "Hidden" }));
    expect(await screen.findByText("hidden Hidden by your rule")).toBeTruthy();
    await waitFor(() =>
      expect(
        requests.some((r) => r.path.endsWith("/messages") && r.search.get("hidden") === "true"),
      ).toBe(true),
    );
  });

  it("gives the detail's sender panel the check, and each role its match, CV choice and draft", async () => {
    api();
    renderApp(paths.message(ws.id, ID));
    expect(await screen.findByText(`sender panel ${ID} caution`)).toBeTruthy();
    expect(screen.getByText("match 0 72")).toBeTruthy();
    expect(screen.getByText("cv 0 German backend role")).toBeTruthy();
    expect(screen.getByText(`draft ${ID} 0`)).toBeTruthy();
    expect(screen.getByText("match 1 none")).toBeTruthy();
    expect(screen.getByText("cv 1 none")).toBeTruthy();
    expect(screen.getByText(`draft ${ID} 1`)).toBeTruthy();
  });
});
