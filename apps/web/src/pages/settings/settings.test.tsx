import type { AiUsageList, MailboxSyncStatus } from "@jobfilly/schema";
import { cleanup, screen, within } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeApi, renderInWorkspace, testWorkspace } from "../../components/testing";
import { SettingsPage } from "./SettingsPage";

// Settings shows the continuous sync: the mailbox's sync status on the Mailbox tab (F1.4) and the
// model usage per day on the AI tab (F1.5), against a fake API.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const W = testWorkspace().id;

function mailboxes(sync: MailboxSyncStatus) {
  return {
    items: [
      {
        id: "00000000-0000-4000-8000-0000000000b1",
        address: "maria.santos@inbox.example",
        host: "imap.inbox.example",
        port: 993,
        tlsMode: "tls",
        username: "maria.santos@inbox.example",
        sentFolderPath: "Sent",
        status: sync.state === "failing" ? "failing" : "connected",
        sync,
      },
    ],
  };
}

const settings = (tab: "mailbox" | "ai") =>
  renderInWorkspace(
    <Routes>
      <Route path="/settings/:tab" element={<SettingsPage />} />
    </Routes>,
    { path: `/settings/${tab}` },
  );

describe("Settings › Mailbox (F1.4)", () => {
  it("shows when the mailbox last synced", async () => {
    fakeApi({
      "GET /api/workspaces/:id/mailboxes": mailboxes({
        state: "ok",
        lastSyncedAt: new Date(Date.now() - 5_000).toISOString(),
        failingSince: null,
        reason: null,
        message: null,
      }),
    });
    settings("mailbox");
    const line = await screen.findByText("Synced just now");
    expect(line.closest('[role="status"]')).not.toBeNull();
  });

  it("shows that the mail server can't be reached, and that it is tried again", async () => {
    fakeApi({
      "GET /api/workspaces/:id/mailboxes": mailboxes({
        state: "failing",
        lastSyncedAt: null,
        failingSince: new Date().toISOString(),
        reason: "unreachable",
        message: "Couldn't reach the mail server",
      }),
    });
    settings("mailbox");
    const line = await screen.findByText(/^Can't reach the mail server since /);
    const status = line.closest<HTMLElement>('[role="status"]');
    expect(status && within(status).getByText("It's tried again on its own.")).toBeTruthy();
  });
});

describe("Settings › AI (F1.5)", () => {
  it("shows the model calls and tokens per day", async () => {
    const usage: AiUsageList = {
      items: [{ day: "2026-10-15", calls: 12, inputTokens: 3_000, outputTokens: 400 }],
    };
    const requests = fakeApi({ "GET /api/workspaces/:id/ai/usage": usage });
    settings("ai");
    expect(await screen.findByRole("heading", { name: "Model usage" })).toBeTruthy();
    const row = (await screen.findByText("12")).closest("tr");
    expect(row && within(row).getByText((3_400).toLocaleString())).toBeTruthy();
    expect(requests.some((r) => r.path === `/api/workspaces/${W}/ai/usage`)).toBe(true);
  });
});
