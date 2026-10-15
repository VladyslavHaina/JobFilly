import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeApi,
  json,
  renderApp,
  renderInWorkspace,
  TEST_USER,
  testWorkspace,
} from "./components/testing";
import { MembersPage } from "./pages/members";
import { paths } from "./paths";

// The slice-owned pages are replaced by probes that show the props the routes pass them.
vi.mock("./pages/inbox", () => ({
  InboxPage: (p: { workspaceId: string; messageId: string | null }) => (
    <p data-testid="inbox">{`inbox ${p.workspaceId} ${p.messageId === null ? "(list)" : p.messageId}`}</p>
  ),
}));
vi.mock("./pages/scan/NotAnalyzedBanner", () => ({
  NotAnalyzedBanner: () => <p data-testid="banner">banner</p>,
}));
vi.mock("./pages/mailbox", () => ({
  MailboxForm: (p: { mode: string; onConnected?: () => void }) => (
    <button type="button" onClick={p.onConnected}>{`mailbox form (${p.mode})`}</button>
  ),
}));
vi.mock("./pages/ai", () => ({
  AiForm: (p: { mode: string; onSaved?: () => void }) => (
    <button type="button" onClick={p.onSaved}>{`ai form (${p.mode})`}</button>
  ),
}));
vi.mock("./pages/scan", () => ({
  ScanPage: (p: { workspaceId: string }) => <p>{`scan page ${p.workspaceId}`}</p>,
}));

const ws = testWorkspace();
const other = testWorkspace({
  id: "00000000-0000-4000-8000-0000000000bb",
  name: "Tom's workspace",
  ownerId: "00000000-0000-4000-8000-000000000002",
  role: "viewer",
  isOwner: false,
});

function signedIn(extra: Record<string, unknown> = {}, workspaces = [ws, other]) {
  return fakeApi({
    "GET /api/auth/session": { user: TEST_USER },
    "GET /api/workspaces": { items: workspaces },
    "GET /api/invites": { items: [] },
    "GET /api/workspaces/:id/mailboxes": { items: [] },
    ...extra,
  });
}

beforeEach(() => {
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn(async () => {}) } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("paths", () => {
  it("builds every in-app URL, encoding the Message-ID as one segment", () => {
    expect(paths.inbox("w1")).toBe("/w/w1/inbox");
    expect(paths.message("w1", "<a+b/c%d@mail.example>")).toBe(
      "/w/w1/inbox/%3Ca%2Bb%2Fc%25d%40mail.example%3E",
    );
    expect(paths.scan("w1")).toBe("/w/w1/scan");
    expect(paths.intake("w1")).toBe("/w/w1/intake");
    expect(paths.profile("w1")).toBe("/w/w1/profile");
    expect(paths.members("w1")).toBe("/w/w1/members");
    expect(paths.settings("w1", "ai")).toBe("/w/w1/settings/ai");
  });
});

describe("the message deep link", () => {
  it("passes a Message-ID with <, >, @, /, + and % through to InboxPage unchanged", async () => {
    signedIn();
    const messageId = "<a+b/c%d@mail.example>";
    renderApp(paths.message(ws.id, messageId));
    expect(await screen.findByTestId("inbox")).toHaveProperty(
      "textContent",
      `inbox ${ws.id} ${messageId}`,
    );
    expect(screen.getByTestId("banner")).toBeTruthy();
  });

  it("gives InboxPage a null messageId on the list route", async () => {
    signedIn();
    const { router } = renderApp(paths.inbox(ws.id));
    expect((await screen.findByTestId("inbox")).textContent).toBe(`inbox ${ws.id} (list)`);
    await router.navigate(paths.message(ws.id, "<x/y@z>"));
    expect((await screen.findByTestId("inbox")).textContent).toBe(`inbox ${ws.id} <x/y@z>`);
    await router.navigate(paths.inbox(ws.id));
    expect((await screen.findByTestId("inbox")).textContent).toBe(`inbox ${ws.id} (list)`);
  });
});

describe("signed out", () => {
  it("sends every page to Sign in, with a way to create an account", async () => {
    fakeApi({ "GET /api/auth/session": { user: null } });
    const { router } = renderApp(paths.inbox(ws.id));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create account" })).toBeTruthy();
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent(paths.inbox(ws.id))}`);
    expect(screen.queryByTestId("inbox")).toBeNull();
  });

  it("shows the one generic message for wrong credentials", async () => {
    fakeApi({
      "GET /api/auth/session": { user: null },
      "POST /api/auth/sign-in": json(
        { error: "invalid_credentials", message: "Email or password is incorrect" },
        401,
      ),
    });
    renderApp("/sign-in");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "maria.santos@inbox.example");
    await user.type(screen.getByLabelText("Password"), "wrong password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Email or password is incorrect");
  });
});

describe("registration (F1.1)", () => {
  it("lands on Connect your mailbox in the new personal workspace", async () => {
    let registered = false;
    const requests = fakeApi({
      "GET /api/auth/session": () => ({ user: registered ? TEST_USER : null }),
      "POST /api/auth/register": () => {
        registered = true;
        return json({ user: TEST_USER }, 201);
      },
      "GET /api/workspaces": { items: [ws] },
      "GET /api/invites": { items: [] },
    });
    const { router } = renderApp("/sign-in");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "Create account" }));
    await user.type(screen.getByLabelText("Name"), "Maria Santos");
    await user.type(screen.getByLabelText("Email"), "maria.santos@inbox.example");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("Use at least 12 characters")).toBeTruthy();
    await user.clear(screen.getByLabelText("Password"));
    await user.type(screen.getByLabelText("Password"), "E2E-SECRET-maria-login");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("heading", { name: "Connect your mailbox" })).toBeTruthy();
    expect(screen.getByText("in Maria's workspace")).toBeTruthy();
    expect(screen.getByRole("button", { name: "mailbox form (onboarding)" })).toBeTruthy();
    expect(router.state.location.pathname).toBe(paths.onboarding(ws.id, "mailbox"));
    expect(requests.find((r) => r.path === "/api/auth/register")?.body).toEqual({
      name: "Maria Santos",
      email: "maria.santos@inbox.example",
      password: "E2E-SECRET-maria-login",
    });
  });
});

describe("onboarding", () => {
  it("goes mailbox, then AI, then the scan", async () => {
    signedIn();
    renderApp(paths.workspace(ws.id));
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Connect your mailbox" })).toBeTruthy();
    const steps = screen.getByRole("list", { name: "Setup steps" });
    expect(
      within(steps)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["1 Connect your mailbox", "2 Pick your AI", "3 Start scan"]);
    await user.click(screen.getByRole("button", { name: "mailbox form (onboarding)" }));
    expect(await screen.findByRole("heading", { name: "Pick your AI" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "ai form (onboarding)" }));
    expect(await screen.findByRole("heading", { name: "Start scan" })).toBeTruthy();
    expect(screen.getByText(`scan page ${ws.id}`)).toBeTruthy();
  });

  it("sends a workspace with a mailbox, or a non-admin, to the inbox", async () => {
    signedIn({ "GET /api/workspaces/:id/mailboxes": { items: [{ id: "m" }] } });
    renderApp(paths.workspace(other.id));
    expect((await screen.findByTestId("inbox")).textContent).toBe(`inbox ${other.id} (list)`);
  });
});

describe("the app shell (F1.7, F1.8)", () => {
  it("always shows the current workspace and switches to another", async () => {
    signedIn();
    const { router } = renderApp(paths.inbox(ws.id));
    const switcher = (await screen.findByLabelText("Workspace")) as HTMLSelectElement;
    expect(switcher.selectedOptions[0]?.textContent).toBe("Maria's workspace");
    expect(Array.from(switcher.options).map((o) => o.textContent)).toEqual([
      "Maria's workspace",
      "Tom's workspace",
    ]);
    await userEvent.setup().selectOptions(switcher, other.id);
    await waitFor(() => expect(router.state.location.pathname).toBe(paths.inbox(other.id)));
    expect(
      (screen.getByLabelText("Workspace") as HTMLSelectElement).selectedOptions[0]?.textContent,
    ).toBe("Tom's workspace");
  });

  it("shows Members and Settings to admins only", async () => {
    signedIn();
    const { router } = renderApp(paths.inbox(ws.id));
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual(["Inbox", "Scan", "Intake", "Profile", "Members", "Settings"]);
    await router.navigate(paths.inbox(other.id));
    await waitFor(() =>
      expect(
        within(screen.getByRole("navigation", { name: "Main" })).queryByText("Members"),
      ).toBeNull(),
    );
    expect(
      within(screen.getByRole("navigation", { name: "Main" })).queryByText("Settings"),
    ).toBeNull();
  });

  it("says so for a workspace the user isn't a member of", async () => {
    signedIn();
    renderApp(paths.inbox("00000000-0000-4000-8000-0000000000cc"));
    expect(await screen.findByRole("heading", { name: "Workspace not found" })).toBeTruthy();
  });

  it("signing out leaves nothing of the workspace on screen, even after Back", async () => {
    let signedOut = false;
    signedIn({
      "GET /api/auth/session": () => ({ user: signedOut ? null : TEST_USER }),
      "POST /api/auth/sign-out": () => {
        signedOut = true;
        return new Response(null, { status: 204 });
      },
    });
    const { router } = renderApp(paths.inbox(ws.id));
    await screen.findByTestId("inbox");
    await userEvent.setup().click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    await router.navigate(-1);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByTestId("inbox")).toBeNull();
  });
});

describe("settings", () => {
  it("mounts the mailbox and AI forms in settings mode under their tabs", async () => {
    signedIn();
    renderApp(paths.settings(ws.id, "mailbox"));
    const user = userEvent.setup();
    expect(await screen.findByRole("button", { name: "mailbox form (settings)" })).toBeTruthy();
    await user.click(
      within(screen.getByRole("navigation", { name: "Settings" })).getByRole("link", {
        name: "AI",
      }),
    );
    expect(await screen.findByRole("button", { name: "ai form (settings)" })).toBeTruthy();
  });
});

describe("invitations (F1.6)", () => {
  const invitation = {
    id: "00000000-0000-4000-8000-0000000000ee",
    workspaceId: other.id,
    workspaceName: "Maria's workspace",
    invitedBy: "Maria Santos",
    role: "viewer",
    expiresAt: "2026-10-08T10:00:00.000Z",
  };

  it("shows the invitation on every page; accepting opens that workspace", async () => {
    let accepted = false;
    const requests = signedIn({
      "GET /api/invites": () => ({ items: accepted ? [] : [invitation] }),
      "POST /api/invites/:id/accept": () => {
        accepted = true;
        return { workspace: other };
      },
    });
    const { router } = renderApp(paths.inbox(ws.id));
    expect(
      await screen.findByText("Maria invited you to “Maria's workspace” as a viewer"),
    ).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(paths.inbox(other.id)));
    expect(
      requests.some(
        (r) => r.method === "POST" && r.path === `/api/invites/${invitation.id}/accept`,
      ),
    ).toBe(true);
    await waitFor(() => expect(screen.queryByText(/invited you/)).toBeNull());
  });

  it("an invite link shows the invitation and accepts it with the link's token", async () => {
    const requests = signedIn({
      [`GET /api/invites/${invitation.id}`]: invitation,
      "POST /api/invites/:id/accept": { workspace: other },
    });
    renderApp(paths.invite(invitation.id, "tok-123"));
    expect(
      await screen.findByText("Maria invited you to “Maria's workspace” as a viewer"),
    ).toBeTruthy();
    expect(
      requests.find((r) => r.path === `/api/invites/${invitation.id}`)?.search.get("token"),
    ).toBe("tok-123");
    await userEvent.setup().click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() =>
      expect(requests.find((r) => r.method === "POST")?.body).toEqual({ token: "tok-123" }),
    );
  });
});

describe("members (F1.6, F1.8)", () => {
  const members = [
    {
      userId: TEST_USER.id,
      name: "Maria Santos",
      email: TEST_USER.email,
      role: "admin",
      isOwner: true,
    },
    {
      userId: "00000000-0000-4000-8000-000000000002",
      name: "Tom Okafor",
      email: "tom.okafor@inbox.example",
      role: "viewer",
      isOwner: false,
    },
  ];

  it("an admin invites with a role, gets a link to copy, and changes roles", async () => {
    const requests = signedIn({
      "GET /api/workspaces/:id/members": { items: members },
      "GET /api/workspaces/:id/invites": { items: [] },
      "POST /api/workspaces/:id/invites": json(
        {
          invite: {
            id: "00000000-0000-4000-8000-0000000000ff",
            email: "tom.okafor@inbox.example",
            role: "editor",
            status: "pending",
            createdAt: "2026-10-01T10:00:00.000Z",
            expiresAt: "2026-10-08T10:00:00.000Z",
          },
          link: "http://jobfilly.test/invites/00000000-0000-4000-8000-0000000000ff?token=abc",
        },
        201,
      ),
      "PATCH /api/workspaces/:id/members/:userId": { items: members },
    });
    renderApp(paths.members(ws.id));
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "tom.okafor@inbox.example");
    await user.selectOptions(screen.getByLabelText("Role"), "editor");
    await user.click(screen.getByRole("button", { name: "Send invite" }));
    const link = (await screen.findByLabelText("Invite link")) as HTMLInputElement;
    expect(link.value).toBe(
      "http://jobfilly.test/invites/00000000-0000-4000-8000-0000000000ff?token=abc",
    );
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({
      email: "tom.okafor@inbox.example",
      role: "editor",
    });

    // The owner's role is fixed; Tom's can change.
    expect(screen.queryByLabelText("Role for Maria Santos")).toBeNull();
    await user.selectOptions(screen.getByLabelText("Role for Tom Okafor"), "editor");
    await waitFor(() =>
      expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({ role: "editor" }),
    );
  });

  it("a viewer sees the members but can't manage them", async () => {
    signedIn({ "GET /api/workspaces/:id/members": { items: members } });
    renderInWorkspace(<MembersPage />, { role: "viewer" });
    expect(await screen.findByText("Tom Okafor")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send invite" })).toBeNull();
    expect(screen.queryByLabelText("Role for Tom Okafor")).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });
});
