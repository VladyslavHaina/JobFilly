import type { MatchVerdict, MessageList, MessageListItem, RoleEvaluation } from "@jobfilly/schema";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type FakeRequest,
  fakeApi,
  renderInWorkspace,
  testWorkspace,
} from "../../components/testing";
import { InboxPage } from "../inbox";
import { FitScore, HiddenFilter, HiddenReason, MatchPanel } from ".";

// The explainable match in the UI (F3.3, F3.4, F4.1, F4.2, F4.5, F4.6): the fit score (never an
// ATS score) with its stale state, the match panel with hard conflicts first, why a message is
// hidden, and the Hidden filter switching the inbox list.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const RULE = "00000000-0000-4000-8000-0000000000e1";
const CV = "00000000-0000-4000-8000-0000000000c1";

const verdict = (overrides: Partial<MatchVerdict>): MatchVerdict => ({
  entryKey: null,
  ruleId: null,
  verdict: "fits",
  reason: "",
  hard: false,
  need: null,
  ...overrides,
});

const evaluation = (overrides: Partial<RoleEvaluation> = {}): RoleEvaluation => ({
  position: 0,
  match: {
    score: 40,
    capped: true,
    cvId: CV,
    skills: { matched: ["Go", "PostgreSQL"], missing: ["Kafka"] },
    verdicts: [
      verdict({
        entryKey: "target_roles",
        reason: '"Senior Backend Engineer" — a backend engineer role',
      }),
      verdict({
        entryKey: "min_pay",
        verdict: "unknown",
        reason: "CHF 110–130k a year — different currency",
      }),
      verdict({
        entryKey: "places",
        verdict: "conflicts",
        hard: true,
        reason: "Amsterdam, hybrid — not one of your places ('Berlin, hybrid')",
      }),
      verdict({
        ruleId: RULE,
        verdict: "conflicts",
        reason: 'No automatic reply, by your rule "No drafts for agencies"',
      }),
    ],
  },
  hidden: null,
  ruleEffects: [
    {
      ruleId: RULE,
      action: "no_draft",
      reason: 'No automatic reply, by your rule "No drafts for agencies"',
      need: null,
    },
  ],
  cvChoice: { cvId: CV, reason: "English backend role → Backend (EN)", source: "auto" },
  stale: false,
  evaluatedAt: "2026-10-15T12:00:00.000Z",
  ...overrides,
});

const noAts = (container: HTMLElement) => expect(container.textContent ?? "").not.toMatch(/ATS/i);

describe("FitScore (F4.5, F4.6)", () => {
  it("is labelled a fit score", () => {
    const { container } = render(<FitScore fit={{ score: 82, capped: false, stale: false }} />);
    expect(screen.getByRole("img", { name: "Fit score 82" }).textContent).toContain("fit score 82");
    noAts(container);
  });

  it("says when a conflict capped it", () => {
    render(<FitScore fit={{ score: 40, capped: true, stale: false }} />);
    expect(
      screen.getByRole("img", { name: "Fit score 40, capped at 40 by a conflict" }),
    ).toBeTruthy();
  });

  it("never shows a stale score as current", () => {
    const { container } = render(<FitScore fit={{ score: 82, capped: false, stale: true }} />);
    const chip = screen.getByRole("img", { name: "Fit score 82, out of date: being updated" });
    expect(chip.textContent).toContain("updating…");
    expect(screen.queryByRole("img", { name: "Fit score 82" })).toBeNull();
    noAts(container);
  });

  it("shows nothing before a role is scored", () => {
    const { container } = render(<FitScore fit={null} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("MatchPanel (F4.1, F4.2, F4.4)", () => {
  const panel = (e: RoleEvaluation | null) =>
    render(
      <MatchPanel
        workspaceId={testWorkspace().id}
        messageId="<m@x.example>"
        position={0}
        evaluation={e}
      />,
    );

  it("lists hard conflicts first, each verdict with its reason", () => {
    const { container } = panel(evaluation());
    const items = within(screen.getByRole("list", { name: "Why this fit score" })).getAllByRole(
      "listitem",
    );
    expect(items.map((li) => li.textContent)).toEqual([
      "Hard conflictPlaces you'd work onsite or hybridAmsterdam, hybrid — not one of your places ('Berlin, hybrid')",
      'FitsRoles you\'re looking for"Senior Backend Engineer" — a backend engineer role',
      "UnknownMinimum payCHF 110–130k a year — different currency",
      'ConflictsYour ruleNo automatic reply, by your rule "No drafts for agencies"',
    ]);
    expect(
      screen.getByRole("img", { name: "Fit score 40, capped at 40 by a conflict" }),
    ).toBeTruthy();
    expect(screen.getByText("Capped at 40: a hard conflict")).toBeTruthy();
    noAts(container);
  });

  it("shows the matched and missing skills, and the rules that apply", () => {
    panel(evaluation());
    expect(screen.getByText("Skills you have").nextSibling?.textContent).toContain(
      "Go, PostgreSQL",
    );
    expect(screen.getByText("Skills missing").nextSibling?.textContent).toContain("Kafka");
    const why = within(screen.getByRole("list", { name: "Why this fit score" }));
    expect(why.getByText('No automatic reply, by your rule "No drafts for agencies"')).toBeTruthy();
  });

  it("names the rule that hides the role, and a stale score is marked as being updated", () => {
    panel(
      evaluation({
        stale: true,
        hidden: { ruleId: RULE, reason: 'Hidden by your rule "No Asian hours"' },
      }),
    );
    expect(screen.getByText('Hidden by your rule "No Asian hours"')).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("this score is being updated");
    expect(
      screen.getByRole("img", { name: "Fit score 40, out of date: being updated" }),
    ).toBeTruthy();
  });

  it("says the fit score is pending while the role isn't scored yet", () => {
    const { container } = panel(null);
    const region = screen.getByRole("region", { name: "Fit for role 1" });
    expect(within(region).getByText("fit score pending")).toBeTruthy();
    expect(region.textContent).toContain("This role hasn't been scored yet");
    noAts(container);
  });

  it("says when the role couldn't be scored, and pending again once a change re-scores it", () => {
    panel(evaluation({ match: null }));
    const region = screen.getByRole("region", { name: "Fit for role 1" });
    expect(within(region).getByText("no fit score")).toBeTruthy();
    expect(region.textContent).toContain("This role couldn't be scored");
    cleanup();

    panel(evaluation({ match: null, stale: true }));
    expect(screen.getByText("fit score pending")).toBeTruthy();
  });
});

describe("HiddenReason (F3.3)", () => {
  it("names the rule that hides the message", () => {
    render(<HiddenReason hidden={{ reason: 'Hidden by your rule "No Asian hours"' }} />);
    expect(screen.getByText(/^Hidden by your rule /).textContent).toContain(
      'Hidden by your rule "No Asian hours"',
    );
  });

  it("shows nothing for a message that isn't hidden", () => {
    const { container } = render(<HiddenReason hidden={null} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("HiddenFilter (F3.4)", () => {
  const item = (id: string, overrides: Partial<MessageListItem> = {}): MessageListItem => ({
    id,
    from: { address: "someone@agency.example", name: null },
    subject: `Role ${id}`,
    date: "2026-10-14T09:30:00.000Z",
    category: "recruiter_outreach",
    categorySource: "scan",
    analysisStatus: "done",
    fit: { score: 75, capped: false, stale: false },
    sender: null,
    hidden: null,
    draft: null,
    ...overrides,
  });
  const page = (items: MessageListItem[]): MessageList => ({
    items,
    nonJobCount: 0,
    page: 1,
    nextPage: null,
  });

  it("switches the inbox to the hidden mail, each with its reason, and back", async () => {
    const reason = 'Hidden by your rule "No Asian hours"';
    const requests = fakeApi({
      "GET /api/workspaces/:id/messages": (req: FakeRequest) =>
        req.search.get("hidden") === "true"
          ? page([item("<asia@x.example>", { hidden: { reason } })])
          : page([item("<cet@x.example>")]),
    });
    const ws = testWorkspace();
    renderInWorkspace(<InboxPage workspaceId={ws.id} messageId={null} />);
    expect(await screen.findByText("Role <cet@x.example>")).toBeTruthy();
    expect(screen.queryByText(reason)).toBeNull();

    const filter = screen.getByRole("button", { name: "Hidden" });
    expect(filter.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(filter);
    expect(await screen.findByText("Role <asia@x.example>")).toBeTruthy();
    expect(screen.getByText(reason)).toBeTruthy();
    expect(screen.queryByText("Role <cet@x.example>")).toBeNull();
    expect(filter.getAttribute("aria-pressed")).toBe("true");
    expect(requests.some((r) => r.search.get("hidden") === "true")).toBe(true);

    await userEvent.click(filter);
    expect(await screen.findByText("Role <cet@x.example>")).toBeTruthy();
    expect(filter.getAttribute("aria-pressed")).toBe("false");
  });

  it("calls back with the new value", async () => {
    const onChange = vi.fn();
    render(<HiddenFilter value={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Hidden" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
