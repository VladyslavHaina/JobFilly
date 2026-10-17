import type {
  AssistantMessage,
  AssistantState,
  AssistantTurn,
  Proposal,
  Role,
} from "@jobfilly/schema";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type FakeRequest,
  fakeApi,
  renderApp,
  renderInWorkspace,
  TEST_USER,
  testWorkspace,
} from "../../components/testing";
import { paths } from "../../paths";
import { AssistantLauncher } from ".";

// The assistant panel (F8.1, F8.2, F8.6, F8.8, F8.9): it opens from every page, shows a
// "Thinking…" state while the model answers, renders the reply as written (in the user's
// language), offers a clarifying question's answers as buttons, and shows proposal cards that an
// editor can edit and apply, and a viewer can only read or discard.

// The pages around the launcher are probes: only the shell's launcher is under test.
vi.mock("../inbox", () => ({
  InboxPage: ({ messageId }: { messageId: string | null }) => (
    <p>{messageId ? `message ${messageId}` : "inbox page"}</p>
  ),
}));
vi.mock("../profile", () => ({ ProfilePage: () => <p>profile page</p> }));
vi.mock("../scan/NotAnalyzedBanner", () => ({ NotAnalyzedBanner: () => null }));
vi.mock("../sync", () => ({ MailboxStatus: () => null, UsagePerDay: () => null }));
vi.mock("../drafts", () => ({ DraftsPage: () => <p>drafts page</p>, DraftPanel: () => null }));
vi.mock("../decisions", () => ({
  DecisionsPage: () => <p>decisions page</p>,
  DecisionCount: () => null,
}));
vi.mock("../cvs", () => ({
  CvsPage: () => <p>cvs page</p>,
  CvChoice: () => null,
  ProfileCvPrompt: () => null,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const WS = testWorkspace().id;
const THREAD = "00000000-0000-4000-8000-0000000000d1";
const PROPOSAL = "00000000-0000-4000-8000-0000000000d2";
const AT = "2026-10-15T12:00:00.000Z";

const message = (
  id: string,
  role: AssistantMessage["role"],
  text: string,
  extra: Partial<AssistantMessage> = {},
): AssistantMessage => ({
  id: `00000000-0000-4000-8000-0000000001${id}`,
  role,
  text,
  clarify: null,
  proposalId: null,
  at: AT,
  ...extra,
});

const card = (overrides: Partial<Proposal> = {}): Proposal => ({
  id: PROPOSAL,
  summary: "Hide roles whose working hours are UTC+5 or later",
  changes: [
    {
      op: "add",
      target: "rule",
      rule: {
        description: "Hide roles whose working hours are UTC+5 or later",
        when: [{ fact: "timeZones", op: "within", value: { from: "UTC+05:00", to: "UTC+14:00" } }],
        then: "hide",
        enabled: true,
      },
    },
  ],
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
  impact: { hides: 3, shows: 0, scoreMoves: 0, draftsNotCreated: 0, draftsInMailbox: 1 },
  status: "open",
  createdAt: AT,
  ...overrides,
});

const withProposal = (proposal: Proposal): AssistantState => ({
  thread: {
    id: THREAD,
    messages: [
      message("01", "user", "Lately I don't want jobs in Asian time zones anymore, ignore them"),
      message("02", "assistant", "Here is a proposal.", { proposalId: proposal.id }),
    ],
    proposals: [proposal],
  },
});

const ASSISTANT = "/api/workspaces/:ws/assistant";

function open(role: Role, state: AssistantState, routes: Record<string, unknown> = {}) {
  const requests = fakeApi({ [`GET ${ASSISTANT}`]: () => state, ...routes });
  renderInWorkspace(<AssistantLauncher workspaceId={WS} />, { role });
  return requests;
}

async function openPanel() {
  await userEvent.click(await screen.findByRole("button", { name: "Assistant" }));
  return screen.findByRole("dialog", { name: "Assistant" });
}

describe("the launcher (F8.1)", () => {
  it.each([
    ["inbox page", paths.inbox(WS)],
    ["message <role@berlin.example>", paths.message(WS, "<role@berlin.example>")],
    ["profile page", paths.profile(WS)],
    ["drafts page", paths.drafts(WS)],
    ["decisions page", paths.decisions(WS)],
    ["cvs page", paths.cvs(WS)],
  ])("opens the assistant from the %s", async (page, path) => {
    fakeApi({
      "GET /api/auth/session": { user: TEST_USER },
      "GET /api/workspaces": { items: [testWorkspace()] },
      "GET /api/invites": { items: [] },
      [`GET ${ASSISTANT}`]: { thread: null },
    });
    renderApp(path);
    expect(await screen.findByText(page)).toBeTruthy();
    const panel = await openPanel();
    expect(await within(panel).findByText(/nothing changes until you apply it/)).toBeTruthy();
    await userEvent.click(within(panel).getByRole("button", { name: "Close the assistant" }));
    expect(screen.queryByRole("dialog", { name: "Assistant" })).toBeNull();
  });
});

describe("sending a message (F8.9)", () => {
  it("shows the message and a thinking state until the reply, written as the model wrote it", async () => {
    let state: AssistantState = { thread: null };
    let answer: (turn: AssistantTurn) => void = () => {};
    const requests = open("viewer", state, {
      [`GET ${ASSISTANT}`]: () => state,
      [`POST ${ASSISTANT}`]: (req: FakeRequest) =>
        new Promise<AssistantTurn>((resolve) => {
          answer = (turn) => {
            const text = (req.body as { text: string }).text;
            state = {
              thread: {
                id: THREAD,
                messages: [message("01", "user", text), message("02", "assistant", turn.reply)],
                proposals: [],
              },
            };
            resolve(turn);
          };
        }),
    });
    const panel = await openPanel();
    await userEvent.type(within(panel).getByLabelText("Message"), "Was kannst du für mich tun?");
    await userEvent.click(within(panel).getByRole("button", { name: "Send" }));
    expect(await within(panel).findByText("Thinking…")).toBeTruthy();
    expect(within(panel).getByText("Was kannst du für mich tun?")).toBeTruthy();
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({
      threadId: null,
      text: "Was kannst du für mich tun?",
    });

    answer({
      threadId: THREAD,
      reply: "Ich kann deine Regeln und dein Profil ändern.",
      clarify: null,
      proposal: null,
    });
    expect(
      await within(panel).findByText("Ich kann deine Regeln und dein Profil ändern."),
    ).toBeTruthy();
    await waitFor(() => expect(within(panel).queryByText("Thinking…")).toBeNull());
    expect((within(panel).getByLabelText("Message") as HTMLTextAreaElement).value).toBe("");
  });

  it("offers a clarifying question's answers as buttons, and sends the one picked (F8.6)", async () => {
    const state: AssistantState = {
      thread: {
        id: THREAD,
        messages: [
          message("01", "user", "stop showing me bad jobs"),
          message("02", "assistant", "What makes a job bad for you?", {
            clarify: {
              question: "What makes a job bad for you?",
              choices: ["Pay under my minimum", "Hours outside my time zones"],
            },
          }),
        ],
        proposals: [],
      },
    };
    const requests = open("editor", state, {
      [`POST ${ASSISTANT}`]: { threadId: THREAD, reply: "OK", clarify: null, proposal: null },
    });
    const panel = await openPanel();
    const group = await within(panel).findByRole("group", {
      name: "What makes a job bad for you?",
    });
    await userEvent.click(
      within(group).getByRole("button", { name: "Hours outside my time zones" }),
    );
    await waitFor(() =>
      expect(requests.find((r) => r.method === "POST")?.body).toEqual({
        threadId: THREAD,
        text: "Hours outside my time zones",
      }),
    );
  });

  it("sends the next message to the first reply's thread before the refetch brings it", async () => {
    let posted = false;
    const requests = open(
      "editor",
      { thread: null },
      {
        // The refetch after the first reply doesn't bring the thread (here it fails).
        [`GET ${ASSISTANT}`]: () =>
          posted ? Response.json({ error: "unavailable" }, { status: 503 }) : { thread: null },
        [`POST ${ASSISTANT}`]: () => {
          posted = true;
          return { threadId: THREAD, reply: "OK", clarify: null, proposal: null };
        },
      },
    );
    const panel = await openPanel();
    const field = within(panel).getByLabelText("Message");
    await userEvent.type(field, "Ignore agencies{Enter}");
    await waitFor(() =>
      expect(requests.filter((r) => r.method === "GET").length).toBeGreaterThan(1),
    );
    await waitFor(() => expect(within(panel).queryByText("Thinking…")).toBeNull());
    await userEvent.type(field, "Only remote ones{Enter}");
    await waitFor(() => expect(requests.filter((r) => r.method === "POST")).toHaveLength(2));
    expect(requests.filter((r) => r.method === "POST").map((r) => r.body)).toEqual([
      { threadId: null, text: "Ignore agencies" },
      { threadId: THREAD, text: "Only remote ones" },
    ]);
  });
});

describe("an answer to a question (MVP 3, F8.1)", () => {
  it("links the roles, messages, decisions and drafts it used to their pages", async () => {
    const role = "<sg@merlion.example>";
    open("viewer", {
      thread: {
        id: THREAD,
        messages: [
          message("01", "user", "What's waiting on me?"),
          message("02", "assistant", "One decision and one draft wait on you.", {
            links: [
              { kind: "role", label: "Backend Engineer at Merlion", messageId: role, position: 0 },
              { kind: "message", label: "A role for you", messageId: role, position: null },
              { kind: "decision", label: "Minimum pay?", messageId: null, position: null },
              { kind: "draft", label: "Draft: Backend Engineer", messageId: role, position: 0 },
            ],
          }),
        ],
        proposals: [],
      },
    });
    const panel = await openPanel();
    const list = await within(panel).findByRole("list", { name: "Used in this answer" });
    const links = within(list)
      .getAllByRole("link")
      .map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["Role: Backend Engineer at Merlion", paths.message(WS, role)],
      ["Message: A role for you", paths.message(WS, role)],
      ["Decision: Minimum pay?", paths.decisions(WS)],
      ["Draft: Backend Engineer", paths.drafts(WS)],
    ]);
  });

  it("shows no links under a reply that has none", async () => {
    open("viewer", withProposal(card()));
    const panel = await openPanel();
    await within(panel).findByText("Here is a proposal.");
    expect(within(panel).queryByRole("list", { name: "Used in this answer" })).toBeNull();
  });
});

describe("a proposal card (F8.2, F8.5, F8.8)", () => {
  it("shows the change before and after and its impact, with the mailbox's drafts staying", async () => {
    open("editor", withProposal(card()));
    const panel = await openPanel();
    const article = await within(panel).findByRole("article", {
      name: "Proposal: Hide roles whose working hours are UTC+5 or later",
    });
    const lines = within(article).getByRole("list", { name: "Before and after" });
    expect(lines.textContent).toContain("No such rule");
    expect(lines.textContent).toContain("Hide roles whose working hours are UTC+5 or later");
    expect(article.textContent).toContain(
      "hides 3 roles; 1 draft is already in your mailbox and stays there",
    );
  });

  it("is edited before Apply: the time-zone range typed as people write it", async () => {
    let current = card();
    const requests = open("editor", withProposal(current), {
      [`GET ${ASSISTANT}`]: () => withProposal(current),
      [`PATCH ${ASSISTANT}/proposals/:id`]: (req: FakeRequest) => {
        current = card({
          changes: (req.body as { changes: Proposal["changes"] }).changes,
          summary: "Hide roles whose hours are within UTC+4 to UTC+14",
        });
        return current;
      },
      [`POST ${ASSISTANT}/proposals/:id/apply`]: () => {
        current = card({ ...current, status: "applied" });
        return current;
      },
    });
    const panel = await openPanel();
    const article = await within(panel).findByRole("article");
    await userEvent.click(within(article).getByRole("button", { name: "Edit" }));
    const form = within(article).getByRole("form", { name: "Edit the proposal" });
    const from = within(form).getByLabelText("Hours from");
    expect((from as HTMLInputElement).value).toBe("UTC+5");
    await userEvent.clear(from);
    await userEvent.type(from, "UTC+4");
    await userEvent.click(within(form).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    const patch = requests.find((r) => r.method === "PATCH");
    expect(patch?.body).toMatchObject({
      changes: [
        {
          op: "add",
          target: "rule",
          rule: {
            when: [
              { fact: "timeZones", op: "within", value: { from: "UTC+04:00", to: "UTC+14:00" } },
            ],
          },
        },
      ],
    });
    expect(
      await within(panel).findByRole("article", {
        name: "Proposal: Hide roles whose hours are within UTC+4 to UTC+14",
      }),
    ).toBeTruthy();

    await userEvent.click(within(panel).getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(requests.some((r) => r.method === "POST" && r.path.endsWith("/apply"))).toBe(true),
    );
    expect(await within(panel).findByText("Applied")).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Apply" })).toBeNull();
  });

  it("refuses an offset that isn't one, without asking the server", async () => {
    const requests = open("editor", withProposal(card()));
    const panel = await openPanel();
    await userEvent.click(await within(panel).findByRole("button", { name: "Edit" }));
    const from = within(panel).getByLabelText("Hours from");
    await userEvent.clear(from);
    await userEvent.type(from, "Asia");
    await userEvent.click(within(panel).getByRole("button", { name: "Save changes" }));
    expect(
      await within(panel).findByText("Write each offset like UTC+4 or UTC−1:30."),
    ).toBeTruthy();
    expect(requests.some((r) => r.method === "PATCH")).toBe(false);
  });

  it("can't be applied or edited by a viewer, who may still discard it", async () => {
    const requests = open("viewer", withProposal(card()), {
      [`POST ${ASSISTANT}/proposals/:id/discard`]: () => card({ status: "discarded" }),
    });
    const panel = await openPanel();
    const apply = await within(panel).findByRole("button", { name: "Apply" });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    expect(
      (within(panel).getByRole("button", { name: "Edit" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(within(panel).getByText("Only editors and admins can apply changes.")).toBeTruthy();
    await userEvent.click(within(panel).getByRole("button", { name: "Discard" }));
    await waitFor(() =>
      expect(requests.some((r) => r.method === "POST" && r.path.endsWith("/discard"))).toBe(true),
    );
    expect(requests.some((r) => r.path.endsWith("/apply"))).toBe(false);
  });
});
