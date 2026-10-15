import type {
  JobFacts,
  MessageBody,
  MessageDetail,
  MessageList,
  MessageListItem,
} from "@jobfilly/schema";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type FakeRequest,
  fakeApi,
  json,
  renderApp,
  TEST_USER,
  testWorkspace,
} from "../../components/testing";
import { paths } from "../../paths";

// The job inbox inside the app's own routes, against a fake API (F5.1, F5.2, F5.4, F5.5).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const facts = (overrides: Partial<JobFacts>): JobFacts => ({
  title: null,
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
  ...overrides,
});

const BERLIN = facts({
  title: "Senior Backend Engineer",
  company: "Nordlicht GmbH",
  places: [{ country: "DE", city: "Berlin" }],
  workMode: "hybrid",
  pay: { min: 75000, max: 85000, currency: "EUR", period: "year", asWritten: "75–85k € p.a." },
  contract: "unbefristet",
  skills: ["Go", "PostgreSQL"],
});

const item = (overrides: Partial<MessageListItem> & { id: string }): MessageListItem => ({
  from: { address: "someone@mail.example", name: null },
  subject: "Subject",
  date: "2026-09-20T09:30:00.000Z",
  category: "recruiter_outreach",
  categorySource: "scan",
  analysisStatus: "done",
  ...overrides,
});

const RECRUITER = item({
  id: "<rec-1@nordlicht.example>",
  from: { address: "anna@nordlicht.example", name: "Anna Weber" },
  subject: "Senior Backend Engineer in Berlin",
  date: "2026-09-25T09:30:00.000Z",
});
/** A job alert whose Message-ID carries angle brackets, '/', '+' and '%'. */
const ALERT = item({
  id: "<alert/2+x%y@jobs.example>",
  from: { address: "alerts@jobs.example", name: "Jobs Board" },
  subject: "3 new jobs for you",
  date: "2026-09-24T07:00:00.000Z",
  category: "job_alert",
});
const FAILED = item({
  id: "<odd-3@agency.example>",
  from: { address: "odd@agency.example", name: null },
  subject: "Quick question",
  date: "2026-09-23T12:00:00.000Z",
  category: null,
  categorySource: null,
  analysisStatus: "failed",
});
const INTERVIEW = item({
  id: "<int-4@acme.example>",
  from: { address: "hr@acme.example", name: "Acme HR" },
  subject: "Interview invitation",
  date: "2026-09-22T15:00:00.000Z",
  category: "interview",
});
const NEWSLETTER = item({
  id: "<news-5@shop.example>",
  from: { address: "news@shop.example", name: "Shop" },
  subject: "Weekly deals",
  date: "2026-09-21T08:00:00.000Z",
  category: "not_job",
});
/** The user's own reply: never listed, but intake evidence links open it. */
const REPLY = item({
  id: "<reply-6@inbox.example>",
  from: { address: TEST_USER.email, name: TEST_USER.name },
  subject: "Re: Senior Backend Engineer in Berlin",
  date: "2026-09-25T18:00:00.000Z",
  category: null,
  categorySource: null,
});

const DETAILS: Record<string, MessageDetail> = {
  [RECRUITER.id]: { ...RECRUITER, roles: [BERLIN], ownReply: false },
  [ALERT.id]: {
    ...ALERT,
    ownReply: false,
    roles: [
      facts({
        title: "Platform Engineer",
        places: [{ country: "PT", city: "Lisbon" }],
        pay: { min: 450, max: 550, currency: "EUR", period: "day", asWritten: "450-550 EUR/day" },
      }),
      facts({ title: "Go Developer", places: [{ country: "NL", city: "Amsterdam" }] }),
      facts({ title: "SRE", workMode: "remote", remoteScope: "EU" }),
    ],
  },
  [FAILED.id]: { ...FAILED, roles: [], ownReply: false },
  [INTERVIEW.id]: { ...INTERVIEW, roles: [BERLIN], ownReply: false },
  [NEWSLETTER.id]: { ...NEWSLETTER, roles: [], ownReply: false },
  [REPLY.id]: { ...REPLY, roles: [], ownReply: true },
};

const BODIES: Record<string, MessageBody> = {
  [RECRUITER.id]: {
    text: "Hallo Maria,\n\n<b>wir suchen</b> <script>alert(1)</script>Verstärkung.",
  },
  [ALERT.id]: { text: "Three new jobs match your search." },
  [FAILED.id]: { gone: true },
  [INTERVIEW.id]: { text: "Would Tuesday work?" },
  [NEWSLETTER.id]: { text: "Deals!" },
  [REPLY.id]: { text: "Thanks, I'm open to hybrid roles in Berlin." },
};

const JOB_ITEMS = [RECRUITER, ALERT, FAILED, INTERVIEW];

/** A fake inbox API that filters and searches like the server. */
function inboxApi(options: { role?: "viewer" | "editor" | "admin"; pages?: number } = {}) {
  const ws = testWorkspace({ role: options.role ?? "admin" });
  const details = structuredClone(DETAILS);
  const requests = fakeApi({
    "GET /api/auth/session": { user: TEST_USER },
    "GET /api/workspaces": { items: [ws] },
    "GET /api/invites": { items: [] },
    "GET /api/workspaces/:id/messages": (req: FakeRequest): MessageList => {
      const category = req.search.get("category");
      const q = req.search.get("q")?.toLowerCase();
      const page = Number(req.search.get("page") ?? 1);
      let items = req.search.get("showNonJob") === "true" ? [...JOB_ITEMS, NEWSLETTER] : JOB_ITEMS;
      if (category) items = [...JOB_ITEMS, NEWSLETTER].filter((m) => m.category === category);
      const matches = (m: MessageListItem) =>
        !q || `${m.from.name ?? ""} ${m.from.address} ${m.subject}`.toLowerCase().includes(q);
      items = items.filter(matches).map((m) => ({ ...m, ...details[m.id] }));
      const pages = options.pages ?? 1;
      return {
        items: page === 1 ? items : [INTERVIEW],
        nonJobCount: [NEWSLETTER].filter(matches).length * 350,
        page,
        nextPage: page < pages ? page + 1 : null,
      };
    },
    "GET /api/workspaces/:id/messages/:messageId": (_req: FakeRequest, p: Record<string, string>) =>
      details[p.messageId ?? ""] ?? json({ error: "not_found" }, 404),
    "GET /api/workspaces/:id/messages/:messageId/body": (
      _req: FakeRequest,
      p: Record<string, string>,
    ) => BODIES[p.messageId ?? ""] ?? json({ error: "not_found" }, 404),
    "PUT /api/workspaces/:id/messages/:messageId/category": (
      req: FakeRequest,
      p: Record<string, string>,
    ) => {
      const id = p.messageId ?? "";
      const current = details[id];
      if (!current) return json({ error: "not_found" }, 404);
      const updated: MessageDetail = {
        ...current,
        category: (req.body as { category: MessageDetail["category"] }).category,
        categorySource: "you",
      };
      details[id] = updated;
      return updated;
    },
  });
  return { ws, requests };
}

const listRequests = (requests: FakeRequest[]) =>
  requests.filter((r) => r.method === "GET" && r.path.endsWith("/messages"));

const messageList = () => screen.findByRole("list", { name: "Messages" });

describe("the list (F5.1)", () => {
  it("shows job messages newest first with sender, subject, date and a category chip", async () => {
    const { ws } = inboxApi();
    renderApp(paths.inbox(ws.id));
    const rows = within(await messageList()).getAllByRole("link");
    expect(rows.map((r) => r.getAttribute("href"))).toEqual(
      JOB_ITEMS.map((m) => paths.message(ws.id, m.id)),
    );
    const first = rows[0] as HTMLElement;
    expect(first.textContent).toContain("Anna Weber");
    expect(first.textContent).toContain("Senior Backend Engineer in Berlin");
    expect(within(first).getByText("Recruiter outreach")).toBeTruthy();
    expect(first.querySelector("time")?.getAttribute("dateTime")).toBe(RECRUITER.date);
    expect(first.querySelector("time")?.textContent).toBe(
      new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(RECRUITER.date)),
    );
    expect(within(rows[1] as HTMLElement).getByText("Job alert")).toBeTruthy();
    expect(within(rows[3] as HTMLElement).getByText("Interview")).toBeTruthy();
  });

  it("marks a message the model failed on as Couldn't analyze", async () => {
    const { ws } = inboxApi();
    renderApp(paths.inbox(ws.id));
    const rows = within(await messageList()).getAllByRole("link");
    expect(within(rows[2] as HTMLElement).getByText("Couldn't analyze")).toBeTruthy();
  });

  it("hides non-job mail behind a count and a Show toggle", async () => {
    const { ws, requests } = inboxApi();
    renderApp(paths.inbox(ws.id));
    expect(await screen.findByText("350 non-job emails hidden")).toBeTruthy();
    expect(within(await messageList()).queryByText("Weekly deals")).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Show" }));
    expect(await within(await messageList()).findByText("Weekly deals")).toBeTruthy();
    expect(screen.getByText("350 non-job emails shown")).toBeTruthy();
    expect(listRequests(requests).at(-1)?.search.get("showNonJob")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Hide" }));
    await waitFor(() => expect(screen.queryByText("Weekly deals")).toBeNull());
  });

  it("filters by category with the chips (F5.5)", async () => {
    const { ws, requests } = inboxApi();
    renderApp(paths.inbox(ws.id));
    await messageList();
    const chips = screen.getByRole("group", { name: "Filter by category" });
    expect(
      within(chips)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual([
      "All",
      "Recruiter outreach",
      "Job alert",
      "Application update",
      "Interview",
      "Assessment",
      "Offer",
      "Rejection",
      "Other job mail",
    ]);
    const user = userEvent.setup();
    await user.click(within(chips).getByRole("button", { name: "Interview" }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("list", { name: "Messages" })).getAllByRole("link"),
      ).toHaveLength(1),
    );
    expect(screen.getByText("Interview invitation")).toBeTruthy();
    expect(
      within(chips).getByRole("button", { name: "Interview" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(listRequests(requests).at(-1)?.search.get("category")).toBe("interview");
    await user.click(within(chips).getByRole("button", { name: "All" }));
    await waitFor(() => expect(screen.getByText("Quick question")).toBeTruthy());
    expect(listRequests(requests).at(-1)?.search.has("category")).toBe(false);
  });

  it("searches by sender or subject (F5.5)", async () => {
    const { ws, requests } = inboxApi();
    renderApp(paths.inbox(ws.id));
    await messageList();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Search sender or subject"), "acme");
    await waitFor(() => expect(screen.queryByText("Anna Weber")).toBeNull());
    expect(screen.getByText("Interview invitation")).toBeTruthy();
    expect(listRequests(requests).at(-1)?.search.get("q")).toBe("acme");
    // Typing doesn't send a request per key.
    expect(listRequests(requests).filter((r) => r.search.has("q")).length).toBeLessThan(4);
    await user.clear(screen.getByLabelText("Search sender or subject"));
    await user.type(screen.getByLabelText("Search sender or subject"), "nothing like it");
    expect(await screen.findByText("No messages match.")).toBeTruthy();
  });

  it("pages by asking the server for the next page", async () => {
    const { ws, requests } = inboxApi({ pages: 2 });
    renderApp(paths.inbox(ws.id));
    await messageList();
    const user = userEvent.setup();
    expect(screen.getByRole("button", { name: "Newer" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: "Older" }));
    expect(await screen.findByText("Page 2")).toBeTruthy();
    expect(listRequests(requests).at(-1)?.search.get("page")).toBe("2");
    expect(screen.getByRole("button", { name: "Older" })).toHaveProperty("disabled", true);
  });
});

describe("opening a message (F5.2)", () => {
  it("navigates to the message's link and Esc goes back to the list", async () => {
    const { ws } = inboxApi();
    const { router } = renderApp(paths.inbox(ws.id));
    const user = userEvent.setup();
    await user.click(within(await messageList()).getByText("3 new jobs for you"));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(paths.message(ws.id, ALERT.id)),
    );
    expect(await screen.findByRole("heading", { name: "3 new jobs for you" })).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(router.state.location.pathname).toBe(paths.inbox(ws.id)));
    expect(screen.queryByRole("heading", { name: "3 new jobs for you" })).toBeNull();
  });

  it("opens a listed message straight from its link, Message-ID with '/', '+' and '%'", async () => {
    const { ws, requests } = inboxApi();
    renderApp(paths.message(ws.id, ALERT.id));
    expect(await screen.findByRole("heading", { name: "3 new jobs for you" })).toBeTruthy();
    expect(screen.getByText("3 roles")).toBeTruthy();
    for (const title of ["Platform Engineer", "Go Developer", "SRE"]) {
      expect(screen.getAllByRole("heading", { name: title })).toHaveLength(1);
    }
    expect(
      requests.some(
        (r) => r.path === `/api/workspaces/${ws.id}/messages/${encodeURIComponent(ALERT.id)}`,
      ),
    ).toBe(true);
  });

  it("opens the user's own reply, which isn't listed, and says it is theirs", async () => {
    const { ws } = inboxApi();
    renderApp(paths.message(ws.id, REPLY.id));
    expect(await screen.findByRole("heading", { name: REPLY.subject })).toBeTruthy();
    expect(screen.getByText("Your reply")).toBeTruthy();
    expect((await screen.findByTestId("message-body")).textContent).toBe(
      "Thanks, I'm open to hybrid roles in Berlin.",
    );
    // A reply has no category to correct, and isn't in the list.
    expect(screen.queryByLabelText("Category")).toBeNull();
    expect(within(await messageList()).queryByText(REPLY.subject)).toBeNull();
  });

  it("says so when the message isn't in the workspace", async () => {
    const { ws } = inboxApi();
    renderApp(paths.message(ws.id, "<unknown@mail.example>"));
    expect(await screen.findByText("This message isn't in this workspace.")).toBeTruthy();
  });
});

describe("the detail (F5.2)", () => {
  it("shows the facts, with Not stated for what the mail doesn't say", async () => {
    const { ws } = inboxApi();
    renderApp(paths.message(ws.id, RECRUITER.id));
    const role = await screen.findByRole("region", { name: "Role 1" });
    const fact = (label: string) =>
      within(role).getByText(label, { selector: "dt" }).nextElementSibling?.textContent;
    expect(fact("Title")).toBe("Senior Backend Engineer");
    expect(fact("Company")).toBe("Nordlicht GmbH");
    expect(fact("Places")).toBe("Berlin, Germany");
    expect(fact("Work mode")).toBe("Hybrid");
    expect(fact("Contract")).toBe("unbefristet");
    expect(fact("Skills")).toBe("Go, PostgreSQL");
    for (const missing of ["Agency", "Remote scope", "Time zones", "Seniority", "Work permit"]) {
      expect(fact(missing)).toBe("Not stated");
    }
    expect(fact("Languages")).toBe("Not stated");
    expect(fact("Apply")).toBe("Not stated");
  });

  it("shows pay as written and normalised", async () => {
    const { ws } = inboxApi();
    renderApp(paths.message(ws.id, RECRUITER.id));
    const role = await screen.findByRole("region", { name: "Role 1" });
    expect(within(role).getByText("€75,000–85,000 per year")).toBeTruthy();
    expect(within(role).getByText("As written: “75–85k € p.a.”")).toBeTruthy();
  });

  it("names countries and lists every role of a job alert", async () => {
    const { ws } = inboxApi();
    renderApp(paths.message(ws.id, ALERT.id));
    const first = await screen.findByRole("region", { name: "Role 1" });
    expect(within(first).getByText("Lisbon, Portugal")).toBeTruthy();
    expect(within(first).getByText("€450–550 per day")).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Role 2" })).getByText("Amsterdam, Netherlands"),
    ).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Role 3" })).getByText("EU")).toBeTruthy();
  });

  it("shows the body as text, never as HTML", async () => {
    const { ws } = inboxApi();
    renderApp(paths.message(ws.id, RECRUITER.id));
    const body = await screen.findByTestId("message-body");
    expect(body.textContent).toBe(
      "Hallo Maria,\n\n<b>wir suchen</b> <script>alert(1)</script>Verstärkung.",
    );
    expect(body.querySelector("b")).toBeNull();
    expect(body.querySelector("script")).toBeNull();
    expect(body.children).toHaveLength(0);
  });

  it("says plainly when the message is no longer in the mailbox", async () => {
    const { ws } = inboxApi();
    renderApp(paths.message(ws.id, FAILED.id));
    expect(await screen.findByText(/no longer in the mailbox/)).toBeTruthy();
  });

  it("says Couldn't analyze for a message the model failed on", async () => {
    const { ws } = inboxApi();
    renderApp(paths.message(ws.id, FAILED.id));
    const heading = await screen.findByRole("heading", { name: "Quick question" });
    const card = heading.closest("section") as HTMLElement;
    expect(within(card).getAllByText("Couldn't analyze").length).toBeGreaterThan(0);
    expect(within(card).getByText(/nothing was guessed/)).toBeTruthy();
  });
});

describe("category correction (F5.4)", () => {
  it("is disabled for viewers", async () => {
    const { ws } = inboxApi({ role: "viewer" });
    renderApp(paths.message(ws.id, RECRUITER.id));
    const select = await screen.findByLabelText("Category");
    expect(select).toHaveProperty("disabled", true);
    expect(screen.getByText("Only editors and admins can correct the category.")).toBeTruthy();
  });

  it("lets an editor correct the category, and the list follows", async () => {
    const { ws, requests } = inboxApi({ role: "editor" });
    renderApp(paths.message(ws.id, RECRUITER.id));
    const select = (await screen.findByLabelText("Category")) as HTMLSelectElement;
    expect(select.value).toBe("recruiter_outreach");
    const user = userEvent.setup();
    await user.selectOptions(select, "offer");
    await waitFor(() =>
      expect(screen.getByText("Corrected by hand: later analysis keeps it.")).toBeTruthy(),
    );
    const put = requests.find((r) => r.method === "PUT");
    expect(put?.path).toBe(
      `/api/workspaces/${ws.id}/messages/${encodeURIComponent(RECRUITER.id)}/category`,
    );
    expect(put?.body).toEqual({ category: "offer" });
    const row = within(await messageList()).getAllByRole("link")[0] as HTMLElement;
    await waitFor(() => expect(within(row).getByText("Offer")).toBeTruthy());
  });
});

describe("keyboard use", () => {
  it("Tab reaches the list, Enter opens a message and Esc closes it", async () => {
    const { ws } = inboxApi();
    const { router } = renderApp(paths.inbox(ws.id));
    const list = await messageList();
    const first = within(list).getAllByRole("link")[0] as HTMLElement;
    const user = userEvent.setup();
    screen.getByLabelText("Search sender or subject").focus();
    for (let i = 0; i < 5 && document.activeElement !== first; i++) await user.tab();
    expect(document.activeElement).toBe(first);
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(paths.message(ws.id, RECRUITER.id)),
    );
    // Focus moves into the message that opened.
    const heading = await screen.findByRole("heading", { name: RECRUITER.subject });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(router.state.location.pathname).toBe(paths.inbox(ws.id)));
    // And back on the list, to the message that was open.
    await waitFor(() =>
      expect((document.activeElement as HTMLElement | null)?.dataset.messageId).toBe(RECRUITER.id),
    );
  });
});
