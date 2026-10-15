import type { MailboxPublic, MailPreset } from "@jobfilly/schema";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeApi, json, renderInWorkspace, testWorkspace } from "../../components/testing";
import { MailboxForm } from "./MailboxForm";

// MailboxForm in onboarding and settings mode, against a fake API (F2.1–F2.3, F2.5).

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
  },
  {
    id: "other",
    label: "Other IMAP",
    host: "",
    port: 993,
    tlsMode: "tls",
    needsAppPassword: false,
    helpUrl: null,
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

function api(routes: Record<string, unknown> = {}, items: MailboxPublic[] = []) {
  return fakeApi({
    [`GET ${base}`]: { items },
    [`GET ${base}/presets`]: { items: presets },
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

describe("a connected mailbox (F2.5)", () => {
  it("offers no way to add a second mailbox, only to disconnect this one", async () => {
    api({}, [mailbox]);
    renderInWorkspace(<MailboxForm workspaceId={ws.id} mode="settings" />);
    expect(await screen.findByText("maria.santos@inbox.example")).toBeTruthy();
    expect(screen.getByText("Inbox, Sent")).toBeTruthy();
    expect(screen.queryByLabelText("Mail provider")).toBeNull();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Disconnect"]);
  });

  it("disconnects after a confirmation and shows the form again", async () => {
    let items = [mailbox];
    const seen = fakeApi({
      [`GET ${base}`]: () => ({ items }),
      [`GET ${base}/presets`]: { items: presets },
      [`DELETE ${base}/:id`]: () => {
        items = [];
        return new Response(null, { status: 204 });
      },
    });
    const user = userEvent.setup();
    renderInWorkspace(<MailboxForm workspaceId={ws.id} mode="settings" />);
    await user.click(await screen.findByRole("button", { name: "Disconnect" }));
    await user.click(
      screen.getByRole("button", { name: "Disconnect and delete the stored password" }),
    );
    expect(await screen.findByLabelText("Mail provider")).toBeTruthy();
    expect(seen.find((r) => r.method === "DELETE")?.path).toBe(`${base}/${mailbox.id}`);
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
