import type { Draft, Send, SendPreview } from "@jobfilly/schema";
import { cleanup, configure, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type FakeRequest,
  fakeApi,
  json,
  renderInWorkspace,
  testWorkspace,
} from "../../components/testing";
import { DraftsPage } from "../drafts";
import { SmtpSettings } from "./index";

// Send on a draft (F4.1–F4.5) and Settings › Sending against a fake API: the confirmation shows
// the message as it will leave, Send confirms with its token, the card counts down with Undo,
// a draft changed meanwhile asks to confirm again, and viewers can't send.

const SLOW_MS = 10_000;
vi.setConfig({ testTimeout: 3 * SLOW_MS });
beforeAll(() => {
  configure({ asyncUtilTimeout: SLOW_MS });
});
afterAll(() => {
  configure({ asyncUtilTimeout: 1000 });
  vi.resetConfig();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const W = testWorkspace().id;
const BASE = `/api/workspaces/${W}`;
const DRAFT_ID = "00000000-0000-4000-8000-000000000d01";
const MAILBOX_ID = "00000000-0000-4000-8000-0000000000b1";

const draft = (overrides: Partial<Draft> = {}): Draft => ({
  id: DRAFT_ID,
  messageId: "<berlin@talentbruecke.example>",
  position: 0,
  status: "in_mailbox",
  failureKind: null,
  failureReason: null,
  subject: "Re: Backend-Rolle in Berlin",
  body: "Hallo Herr Weber,\n\nvielen Dank.",
  language: "de",
  cvId: null,
  auto: true,
  updatedAt: "2026-10-15T12:00:00.000Z",
  send: null,
  ...overrides,
});

const PREVIEW: SendPreview = {
  draftId: DRAFT_ID,
  mailboxId: MAILBOX_ID,
  from: { address: "maria.santos@inbox.example", name: null },
  to: [{ address: "jonas.weber@talentbruecke.example", name: "Jonas Weber" }],
  cc: [],
  subject: "Re: Backend-Rolle in Berlin",
  text: "Hallo Herr Weber,\n\nvielen Dank.\n\n> Hallo Maria,\n",
  attachments: [{ fileName: "Maria Santos CV.pdf", sizeBytes: 48_000 }],
  token: "token-1",
  expiresAt: "2026-10-15T12:15:00.000Z",
};

const scheduled = (seconds: number): Send => ({
  id: "00000000-0000-4000-8000-0000000000e1",
  draftId: DRAFT_ID,
  status: "scheduled",
  sendAt: new Date(Date.now() + seconds * 1000).toISOString(),
  sentAt: null,
  failureReason: null,
});

describe("Send on a draft (F4.1, F4.2)", () => {
  it("shows the message as it will leave, confirms it with its token, then offers Undo", async () => {
    let current = draft();
    const seen = fakeApi({
      [`GET ${BASE}/drafts`]: () => ({ items: [current] }),
      [`GET ${BASE}/drafts/:id/send`]: PREVIEW,
      [`POST ${BASE}/drafts/:id/send`]: () => {
        current = draft({ send: scheduled(10) });
        return json(current.send, 202);
      },
      [`DELETE ${BASE}/drafts/:id/send`]: () => {
        current = draft({ send: { ...scheduled(10), status: "cancelled" } });
        return current.send;
      },
    });
    renderInWorkspace(<DraftsPage workspaceId={W} />);
    await userEvent.click(await screen.findByRole("button", { name: "Send…" }));
    const dialog = await screen.findByRole("dialog", { name: "Send this reply?" });
    expect(
      await within(dialog).findByText("Jonas Weber <jonas.weber@talentbruecke.example>"),
    ).toBeTruthy();
    expect(within(dialog).getByText("maria.santos@inbox.example")).toBeTruthy();
    expect(within(dialog).getByText("Maria Santos CV.pdf (47 KB)")).toBeTruthy();
    expect(within(dialog).getByRole("region", { name: "Message text" }).textContent).toBe(
      PREVIEW.text,
    );
    // Send, not "Send now": the 10 s wait with Undo is said beside it.
    const send = within(dialog).getByRole("button", { name: "Send" });
    expect(send.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(send.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "It leaves 10 seconds after you press Send; until then you can undo it.",
    );
    await userEvent.click(send);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(seen.find((r) => r.method === "POST")?.body).toEqual({ token: "token-1" });
    expect(await screen.findByText(/Sending in \d+ s/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Undone: nothing was sent.")).toBeTruthy();
    expect(seen.filter((r) => r.method === "DELETE")).toHaveLength(1);
  });

  it("drops “Undone: nothing was sent.” once the draft is edited", async () => {
    let current = draft({ send: scheduled(10) });
    fakeApi({
      [`GET ${BASE}/drafts`]: () => ({ items: [current] }),
      [`DELETE ${BASE}/drafts/:id/send`]: () => {
        current = { ...current, send: { ...scheduled(10), status: "cancelled" } };
        return current.send;
      },
      // Edited right away, well before the undone send was due: the server keeps the undone send.
      [`PATCH ${BASE}/drafts/:id`]: (req: FakeRequest) => {
        const updatedAt = new Date().toISOString();
        current = { ...current, ...(req.body as object), status: "edited", updatedAt };
        return current;
      },
    });
    renderInWorkspace(<DraftsPage workspaceId={W} />);
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Undone: nothing was sent.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.type(screen.getByLabelText("Reply"), " Bis bald.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("img", { name: "Draft status: Edited" })).toBeTruthy();
    expect(screen.queryByText("Undone: nothing was sent.")).toBeNull();
  });

  it("after a reload, says nothing of an undone send for a draft edited since", async () => {
    const send: Send = { ...scheduled(-60), status: "cancelled" };
    fakeApi({
      [`GET ${BASE}/drafts`]: {
        items: [
          draft({
            id: "00000000-0000-4000-8000-000000000d09",
            status: "edited",
            updatedAt: new Date().toISOString(),
            send: { ...send, draftId: "00000000-0000-4000-8000-000000000d09" },
          }),
        ],
      },
    });
    renderInWorkspace(<DraftsPage workspaceId={W} />);
    expect(await screen.findByRole("button", { name: "Send…" })).toBeTruthy();
    expect(screen.queryByText("Undone: nothing was sent.")).toBeNull();
  });

  it("asks to confirm again when the draft changed since the confirmation (F4.3)", async () => {
    let previews = 0;
    fakeApi({
      [`GET ${BASE}/drafts`]: { items: [draft()] },
      [`GET ${BASE}/drafts/:id/send`]: () => {
        previews += 1;
        return {
          ...PREVIEW,
          text: previews === 1 ? "Old text" : "New text",
          token: `t${previews}`,
        };
      },
      [`POST ${BASE}/drafts/:id/send`]: json(
        { error: "confirm_again", message: "The draft changed since you opened Send." },
        409,
      ),
    });
    renderInWorkspace(<DraftsPage workspaceId={W} />);
    await userEvent.click(await screen.findByRole("button", { name: "Send…" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Old text")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Send" }));
    expect(
      await within(dialog).findByText("The draft changed since you opened Send."),
    ).toBeTruthy();
    // It shows the draft as it is now, to confirm again.
    expect(await within(dialog).findByText("New text")).toBeTruthy();
  });

  it("says why a send failed, and sends a mailbox without SMTP settings to Settings › Sending", async () => {
    fakeApi({
      [`GET ${BASE}/drafts`]: {
        items: [
          draft({
            send: {
              ...scheduled(0),
              status: "failed",
              failureReason: "The SMTP server can't be reached.",
            },
          }),
        ],
      },
      [`GET ${BASE}/drafts/:id/send`]: json(
        { error: "no_smtp", message: "This mailbox can't send yet." },
        409,
      ),
    });
    renderInWorkspace(<DraftsPage workspaceId={W} />);
    expect(await screen.findByText("The SMTP server can't be reached.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Send…" }));
    const link = await screen.findByRole("link", { name: "Settings › Sending" });
    expect(link.getAttribute("href")).toBe(`/w/${W}/settings/sending`);
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", true);
  });

  it("is disabled for viewers, and gone once the draft was sent (F4.5)", async () => {
    fakeApi({
      [`GET ${BASE}/drafts`]: {
        items: [
          draft(),
          draft({
            id: "00000000-0000-4000-8000-000000000d02",
            messageId: "<other@x.example>",
            status: "sent",
            send: { ...scheduled(0), status: "sent" },
          }),
        ],
      },
    });
    renderInWorkspace(<DraftsPage workspaceId={W} />, { role: "viewer" });
    const buttons = await screen.findAllByRole("button", { name: "Send…" });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveProperty("disabled", true);
    expect(screen.getByRole("img", { name: "Draft status: Sent" })).toBeTruthy();
  });
});

describe("Settings › Sending", () => {
  const MAILBOX = {
    id: MAILBOX_ID,
    address: "maria.santos@inbox.example",
    host: "imap.gmail.com",
    port: 993,
    tlsMode: "tls",
    username: "maria.santos@inbox.example",
    sentFolderPath: "Sent",
    status: "connected",
  };
  const PRESETS = {
    items: [
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
        id: "gmx",
        label: "GMX",
        host: "imap.gmx.net",
        port: 993,
        tlsMode: "tls",
        needsAppPassword: false,
        helpUrl: null,
        smtp: { host: "mail.gmx.net", port: 587, tlsMode: "starttls", savesSentCopy: false },
      },
    ],
  };

  it("fills the server from the preset, tests and saves it", async () => {
    const seen = fakeApi({
      [`GET ${BASE}/mailboxes`]: { items: [MAILBOX] },
      [`GET ${BASE}/mailboxes/presets`]: PRESETS,
      [`GET ${BASE}/mailboxes/:id/smtp`]: { smtp: null, savesSentCopy: false },
      [`POST ${BASE}/mailboxes/:id/smtp/test`]: { ok: true },
      [`PUT ${BASE}/mailboxes/:id/smtp`]: (req: FakeRequest) => {
        const { password: _p, ...smtp } = req.body as Record<string, unknown>;
        return { smtp, savesSentCopy: true };
      },
    });
    renderInWorkspace(<SmtpSettings workspaceId={W} />);
    const server = (await screen.findByLabelText("SMTP server")) as HTMLInputElement;
    // The mailbox is on Gmail's IMAP server: Gmail's SMTP server is filled in.
    expect(server.value).toBe("smtp.gmail.com");
    await userEvent.selectOptions(screen.getByLabelText("Provider"), "gmx");
    expect(server.value).toBe("mail.gmx.net");
    expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe("587");
    await userEvent.type(screen.getByLabelText("Password"), "app-password");
    await userEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText("The SMTP server accepted the sign-in.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(seen.find((r) => r.method === "PUT")?.body).toEqual({
      host: "mail.gmx.net",
      port: 587,
      tlsMode: "starttls",
      username: "maria.santos@inbox.example",
      password: "app-password",
    });
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
  });

  it("is read-only for anyone but admins, and has nothing to set for a Google mailbox", async () => {
    fakeApi({
      [`GET ${BASE}/mailboxes`]: {
        items: [
          MAILBOX,
          {
            ...MAILBOX,
            id: "00000000-0000-4000-8000-0000000000b2",
            address: "m@gmail.example",
            auth: "google",
          },
        ],
      },
      [`GET ${BASE}/mailboxes/presets`]: PRESETS,
      [`GET ${BASE}/mailboxes/:id/smtp`]: {
        smtp: { host: "smtp.gmail.com", port: 465, tlsMode: "tls", username: "maria" },
        savesSentCopy: true,
      },
    });
    renderInWorkspace(<SmtpSettings workspaceId={W} />, { role: "editor" });
    expect(await screen.findByText("Only admins change how mail is sent.")).toBeTruthy();
    expect(screen.getByLabelText("SMTP server")).toHaveProperty("disabled", true);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByText(/Sends through Google with your sign-in/)).toBeTruthy();
  });

  it("is read-only, with a note, for an admin who sees the job pipeline only (TBD-450)", async () => {
    fakeApi({
      [`GET ${BASE}/mailboxes`]: { items: [MAILBOX] },
      [`GET ${BASE}/mailboxes/presets`]: PRESETS,
      [`GET ${BASE}/mailboxes/:id/smtp`]: { smtp: null, savesSentCopy: false },
    });
    renderInWorkspace(<SmtpSettings workspaceId={W} />, { workspace: { scope: "pipeline" } });
    expect(
      await screen.findByText("Only admins who see everything change how mail is sent."),
    ).toBeTruthy();
    expect(screen.getByLabelText("SMTP server")).toHaveProperty("disabled", true);
    expect(screen.queryByRole("button", { name: "Test" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
