import type { MailboxPublic, MailPreset } from "@jobfilly/schema";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeApi, json, renderInWorkspace, testWorkspace } from "../../components/testing";
import { MailboxStatus } from "../sync";
import { MailboxForm } from "./MailboxForm";

// MailboxForm in onboarding and settings mode, against a fake API (F2.1–F2.3; MVP 3 F3.1,
// F3.2, F7.4: several mailboxes, Sign in with Google, Reconnect needed, and what a disconnect
// removes).

const ws = testWorkspace();
const base = `/api/workspaces/${ws.id}/mailboxes`;
const PASSWORD = "E2E-SECRET-maria-imap";

const presets: MailPreset[] = [
  {
    id: "gmail",
    label: "Gmail",
    host: "imap.gmail.com",
    port: 993,
    tlsMode: "tls",
    needsAppPassword: true,
    helpUrl: "https://support.google.com/accounts/answer/185833",
    smtp: { host: "smtp.gmail.com", port: 465, tlsMode: "tls", savesSentCopy: true },
  },
  {
    id: "other",
    label: "Other IMAP",
    host: "",
    port: 993,
    tlsMode: "tls",
    needsAppPassword: false,
    helpUrl: null,
    smtp: null,
  },
];

const mailbox: MailboxPublic = {
  id: "8f0e1c62-0000-4000-8000-000000000001",
  address: "maria.santos@inbox.example",
  host: "imap",
  port: 3143,
  tlsMode: "none",
  username: "maria.santos@inbox.example",
  sentFolderPath: "Sent",
  status: "connected",
};

const removal = {
  address: "maria.santos@inbox.example",
  messages: 12,
  roles: 9,
  drafts: 2,
  decisions: 1,
};

function api(routes: Record<string, unknown> = {}, items: MailboxPublic[] = []) {
  return fakeApi({
    [`GET ${base}`]: { items },
    [`GET ${base}/presets`]: { items: presets },
    "GET /api/oauth/providers": { google: false },
    [`GET ${base}/:id/removal`]: removal,
    ...routes,
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function chooseOther(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(await screen.findByLabelText("Mail provider"), "Other IMAP");
  await user.type(screen.getByLabelText("Email address"), "maria.santos@inbox.example");
  await user.clear(screen.getByLabelText("IMAP server"));
  await user.type(screen.getByLabelText("IMAP server"), "imap");
  await user.clear(screen.getByLabelText("Port"));
  await user.type(screen.getByLabelText("Port"), "3143");
  await user.selectOptions(screen.getByLabelText("Security"), "None (plain text)");
}

describe.each(["onboarding", "settings"] as const)("MailboxForm in %s mode", (mode) => {
  it("fills host, port and TLS from a preset and shows Gmail's app-password hint and link", async () => {
    api();
    const user = userEvent.setup();
    renderInWorkspace(<MailboxForm workspaceId={ws.id} mode={mode} />);
    await user.selectOptions(await screen.findByLabelText("Mail provider"), "Gmail");
    expect(screen.getByText("Gmail needs an app password")).toBeTruthy();
    const link = screen.getByRole("link", { name: /How to create an app password/ });
    expect(link.getAttribute("href")).toBe("https://support.google.com/accounts/answer/185833");
    expect(screen.getByText("Server: imap.gmail.com:993 · TLS")).toBeTruthy();
    expect(screen.getByLabelText("App password")).toBeTruthy();
    // The preset's server fields are filled in for the user, not typed.
    expect(screen.queryByLabelText("IMAP server")).toBeNull();
  });

  it("shows editable host, port and TLS for Other IMAP", async () => {
    const seen = api({ [`POST ${base}/test`]: { ok: true, folders: ["INBOX"], sentPath: null } });
    const user = userEvent.setup();
    renderInWorkspace(<MailboxForm workspaceId={ws.id} mode={mode} />);
    await chooseOther(user);
    await user.type(screen.getByLabelText("Password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    await screen.findByText(/Connected: Inbox\./);
    expect(seen.find((r) => r.method === "POST")?.body).toEqual({
      address: "maria.santos@inbox.example",
      username: "maria.santos@inbox.example",
      password: PASSWORD,
      host: "imap",
      port: 3143,
      tlsMode: "none",
    });
  });

  it("says 'Connected: Inbox, Sent' after a successful test", async () => {
    api({ [`POST ${base}/test`]: { ok: true, folders: ["INBOX", "Sent"], sentPath: "Sent" } });
    const user = userEvent.setup();
    renderInWorkspace(<MailboxForm workspaceId={ws.id} mode={mode} />);
    await chooseOther(user);
    await user.type(screen.getByLabelText("Password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Connected: Inbox, Sent")).toBeTruthy();
  });

  it("shows the plain reason of a failed test, never the password", async () => {
    let answer: (r: Response) => void = () => {};
    api({
      [`POST ${base}/test`]: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    const user = userEvent.setup();
    const { container } = renderInWorkspace(<MailboxForm workspaceId={ws.id} mode={mode} />);
    await chooseOther(user);
    await user.type(screen.getByLabelText("Password"), "E2E-SECRET-wrong");
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByRole("button", { name: /Testing/ })).toBeTruthy();
    answer(
      json({
        ok: false,
        reason: "wrong_password",
        message: "The mail server didn't accept the user name or password.",
      }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("didn't accept the user name or password");
    expect(container.textContent).not.toContain("E2E-SECRET");
  });

  it("saves, empties the password field and shows the connected mailbox", async () => {
    let items: MailboxPublic[] = [];
    const onConnected = vi.fn();
    const seen = fakeApi({
      [`GET ${base}`]: () => ({ items }),
      [`GET ${base}/presets`]: { items: presets },
      [`POST ${base}`]: () => {
        items = [mailbox];
        return json(mailbox, 201);
      },
    });
    const user = userEvent.setup();
    const { container } = renderInWorkspace(
      <MailboxForm workspaceId={ws.id} mode={mode} onConnected={onConnected} />,
    );
    await chooseOther(user);
    await user.type(screen.getByLabelText("Password"), PASSWORD);
    await user.click(
      screen.getByRole("button", { name: mode === "onboarding" ? "Save and continue" : "Save" }),
    );
    expect(await screen.findByText("Connected mailbox")).toBeTruthy();
    expect(onConnected).toHaveBeenCalledOnce();
    expect(seen.filter((r) => r.method === "POST")).toHaveLength(1);
    expect(screen.queryByDisplayValue(PASSWORD)).toBeNull();
    expect(container.textContent).not.toContain(PASSWORD);
  });
});

describe("connected mailboxes (MVP 3 F3.1, F7.4; replacing F2.5's one)", () => {
  it("shows the mailbox with Disconnect, and lets an admin connect another one", async () => {
    api({}, [mailbox]);
    const user = userEvent.setup();
    renderInWorkspace(<MailboxForm workspaceId={ws.id} mode="settings" />);
    expect(await screen.findByText("maria.santos@inbox.example")).toBeTruthy();
    expect(screen.getByText("Inbox, Sent")).toBeTruthy();
    expect(screen.getByText("Password")).toBeTruthy();
    expect(screen.queryByLabelText("Mail provider")).toBeNull();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Disconnect",
      "Connect another mailbox",
    ]);
    await user.click(screen.getByRole("button", { name: "Connect another mailbox" }));
    expect(await screen.findByLabelText("Mail provider")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Mail provider")).toBeNull();
  });

  it("lists every mailbox of the workspace, a Google one's sign-in named", async () => {
    api({}, [
      mailbox,
      {
        ...mailbox,
        id: "8f0e1c62-0000-4000-8000-000000000002",
        address: "maria.gmail@gmail.example",
        host: "imap.gmail.com",
        port: 993,
        tlsMode: "tls",
        sentFolderPath: "[Gmail]/Sent Mail",
        auth: "google",
      },
    ]);
    renderInWorkspace(<MailboxForm workspaceId={ws.id} mode="settings" />);
    expect(await screen.findByText("maria.gmail@gmail.example")).toBeTruthy();
    expect(screen.getAllByText("Connected mailbox")).toHaveLength(2);
    expect(screen.getByText("Google")).toBeTruthy();
    expect(screen.getByText("Inbox, Sent ([Gmail]/Sent Mail)")).toBeTruthy();
  });

  it("says what a disconnect removes before it does, then shows the form again", async () => {
    let items = [mailbox];
    const seen = fakeApi({
      [`GET ${base}`]: () => ({ items }),
      [`GET ${base}/presets`]: { items: presets },
      [`GET ${base}/:id/removal`]: removal,
      [`DELETE ${base}/:id`]: () => {
        items = [];
        return new Response(null, { status: 204 });
      },
    });
    const user = userEvent.setup();
    renderInWorkspace(<MailboxForm workspaceId={ws.id} mode="settings" />);
    await user.click(await screen.findByRole("button", { name: "Disconnect" }));
    const warning = await screen.findByText("Disconnect maria.santos@inbox.example?");
    const note = warning.closest("[role=status]") as HTMLElement;
    expect(note.textContent).toContain(
      "This deletes its stored sign-in and the 12 messages synced from it, with their 9 roles, 2 drafts and 1 open decision.",
    );
    expect(note.textContent).toContain("Mail and drafts in the mailbox itself stay there.");
    expect(seen.some((r) => r.method === "DELETE")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Disconnect and delete its data" }));
    expect(await screen.findByLabelText("Mail provider")).toBeTruthy();
    expect(seen.find((r) => r.method === "DELETE")?.path).toBe(`${base}/${mailbox.id}`);
  });

  it("keeps the mailbox when the user changes their mind", async () => {
    const seen = api({}, [mailbox]);
    const user = userEvent.setup();
    renderInWorkspace(<MailboxForm workspaceId={ws.id} mode="settings" />);
    await user.click(await screen.findByRole("button", { name: "Disconnect" }));
    await screen.findByText("Disconnect maria.santos@inbox.example?");
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.queryByText("Disconnect maria.santos@inbox.example?")).toBeNull();
    expect(seen.some((r) => r.method === "DELETE")).toBe(false);
  });

  /** Settings › Mailbox: the status (F1.4) above the form, as the settings page shows them. */
  function SettingsMailbox() {
    return (
      <>
        <MailboxStatus workspaceId={ws.id} align="start" />
        <MailboxForm workspaceId={ws.id} mode="settings" />
      </>
    );
  }

  it("refreshes the mailbox status on connect and on disconnect (F1.4)", async () => {
    let items: MailboxPublic[] = [];
    fakeApi({
      [`GET ${base}`]: () => ({ items }),
      [`GET ${base}/presets`]: { items: presets },
      [`GET ${base}/:id/removal`]: removal,
      [`POST ${base}`]: () => {
        items = [mailbox];
        return json(mailbox, 201);
      },
      [`DELETE ${base}/:id`]: () => {
        items = [];
        return new Response(null, { status: 204 });
      },
    });
    const user = userEvent.setup();
    renderInWorkspace(<SettingsMailbox />);
    await chooseOther(user);
    expect(screen.queryByRole("status")).toBeNull();

    await user.type(screen.getByLabelText("Password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("status")).textContent).toContain("Waiting for the first sync");

    await user.click(await screen.findByRole("button", { name: "Disconnect" }));
    await user.click(await screen.findByRole("button", { name: "Disconnect and delete its data" }));
    expect(await screen.findByLabelText("Mail provider")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("lets onboarding continue with the mailbox already connected", async () => {
    api({}, [mailbox]);
    const onConnected = vi.fn();
    const user = userEvent.setup();
    renderInWorkspace(
      <MailboxForm workspaceId={ws.id} mode="onboarding" onConnected={onConnected} />,
    );
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    expect(onConnected).toHaveBeenCalledOnce();
  });

  it("shows viewers the mailbox without Disconnect", async () => {
    api({}, [mailbox]);
    renderInWorkspace(<MailboxForm workspaceId={ws.id} mode="settings" />, { role: "viewer" });
    const card = (await screen.findByText("Connected mailbox")).closest("section");
    expect(within(card as HTMLElement).queryByRole("button")).toBeNull();
  });
});

describe("Sign in with Google (MVP 3, F3.2)", () => {
  const google: MailboxPublic = {
    ...mailbox,
    address: "maria.gmail@gmail.example",
    host: "imap.gmail.com",
    port: 993,
    tlsMode: "tls",
    auth: "google",
  };
  const authorize = "https://accounts.google.com/o/oauth2/v2/auth?state=s";

  it("appears only when the server has Google's client settings", async () => {
    api();
    const first = renderInWorkspace(<MailboxForm workspaceId={ws.id} mode="settings" />);
    await screen.findByLabelText("Mail provider");
    expect(screen.queryByRole("button", { name: "Sign in with Google" })).toBeNull();
    first.unmount();
    api({ "GET /api/oauth/providers": { google: true } });
    renderInWorkspace(<MailboxForm workspaceId={ws.id} mode="settings" />);
    expect(await screen.findByRole("button", { name: "Sign in with Google" })).toBeTruthy();
  });

  it("starts the sign-in and sends the browser to Google's page", async () => {
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    const seen = api({
      "GET /api/oauth/providers": { google: true },
      [`POST /api/workspaces/${ws.id}/oauth/google/start`]: { url: authorize },
    });
    const user = userEvent.setup();
    renderInWorkspace(<MailboxForm workspaceId={ws.id} mode="onboarding" />);
    await user.click(await screen.findByRole("button", { name: "Sign in with Google" }));
    await waitFor(() => expect(opened).toHaveBeenCalledWith(authorize, "_self"));
    expect(seen.find((r) => r.method === "POST")?.body).toEqual({});
    opened.mockRestore();
  });

  it.each([
    ["connected", "Your Gmail mailbox is connected."],
    ["denied", "Google sign-in was cancelled, so nothing was connected."],
    ["failed", "Google sign-in didn't work. Try again."],
  ])("says how the sign-in went when Google sends the browser back (%s)", async (outcome, text) => {
    api({}, outcome === "connected" ? [google] : []);
    renderInWorkspace(<MailboxForm workspaceId={ws.id} mode="settings" />, {
      path: `/?oauth=${outcome}`,
    });
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it("shows Reconnect needed with Reconnect with Google for that mailbox", async () => {
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    const seen = api({ [`POST /api/workspaces/${ws.id}/oauth/google/start`]: { url: authorize } }, [
      { ...google, status: "reconnect_needed" },
    ]);
    const user = userEvent.setup();
    renderInWorkspace(<MailboxForm workspaceId={ws.id} mode="settings" />);
    expect(await screen.findByText("Reconnect needed")).toBeTruthy();
    expect(screen.getByText(/Nothing stored is lost/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Reconnect with Google" }));
    await waitFor(() => expect(opened).toHaveBeenCalledWith(authorize, "_self"));
    expect(seen.find((r) => r.method === "POST")?.body).toEqual({ mailboxId: google.id });
    opened.mockRestore();
  });

  it("shows viewers Reconnect needed without the button", async () => {
    api({}, [{ ...google, status: "reconnect_needed" }]);
    renderInWorkspace(<MailboxForm workspaceId={ws.id} mode="settings" />, { role: "viewer" });
    expect(await screen.findByText("Reconnect needed")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
