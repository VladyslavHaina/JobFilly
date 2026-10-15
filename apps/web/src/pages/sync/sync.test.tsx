import type { AiUsageList, MailboxSyncStatus } from "@jobfilly/schema";
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi, renderInWorkspace, testWorkspace } from "../../components/testing";
import { useLiveInvalidation } from "../../hooks";
import { MailboxStatus, UsagePerDay } from "./index";

// The mailbox status in the inbox header (F1.4) and the model usage per day in Settings › AI
// (F1.5), against a fake API and a stand-in for the browser's EventSource.

class FakeEventSource {
  static CLOSED = 2;
  static all: FakeEventSource[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, ((e: { data: string }) => void)[]>();
  constructor(readonly url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, cb: (e: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), cb]);
  }
  close() {}
  emit(type: string, data: string) {
    for (const cb of this.listeners.get(type) ?? []) cb({ data });
  }
}

beforeEach(() => {
  FakeEventSource.all = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const W = testWorkspace().id;
const MAILBOXES = "GET /api/workspaces/:id/mailboxes";

function mailbox(sync: MailboxSyncStatus | undefined) {
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
        status: sync?.state === "failing" ? "failing" : "connected",
        ...(sync ? { sync } : {}),
      },
    ],
  };
}

const ok = (lastSyncedAt: Date): MailboxSyncStatus => ({
  state: "ok",
  lastSyncedAt: lastSyncedAt.toISOString(),
  failingSince: null,
  reason: null,
  message: null,
});

/** Today at 10:42 in the browser's own time zone. */
function todayAt1042(): Date {
  const at = new Date();
  at.setHours(10, 42, 0, 0);
  return at;
}

/** The status as the inbox header mounts it, with the app shell's live updates. */
function Header() {
  useLiveInvalidation(W);
  return <MailboxStatus workspaceId={W} />;
}

describe("MailboxStatus (F1.4)", () => {
  it("says when the mailbox last synced", async () => {
    fakeApi({ [MAILBOXES]: mailbox(ok(new Date(Date.now() - 5_000))) });
    renderInWorkspace(<MailboxStatus workspaceId={W} />);
    expect(await screen.findByText("Synced just now")).toBeTruthy();
  });

  it("says since when the mail server can't be reached, and that it is tried again", async () => {
    fakeApi({
      [MAILBOXES]: mailbox({
        state: "failing",
        lastSyncedAt: null,
        failingSince: todayAt1042().toISOString(),
        reason: "unreachable",
        message: "Couldn't reach the mail server",
      }),
    });
    renderInWorkspace(<MailboxStatus workspaceId={W} />);
    const status = await screen.findByRole("status");
    expect(await within(status).findByText("Can't reach the mail server since 10:42")).toBeTruthy();
    expect(within(status).getByText("It's tried again on its own.")).toBeTruthy();
    // The server being away needs no detail, whatever its words.
    expect(within(status).queryByText("Couldn't reach the mail server")).toBeNull();
  });

  it("names a reason the user can act on, like a refused password", async () => {
    fakeApi({
      [MAILBOXES]: mailbox({
        state: "failing",
        lastSyncedAt: null,
        failingSince: todayAt1042().toISOString(),
        reason: "wrong_password",
        message: "The mail server didn't accept the user name or password.",
      }),
    });
    renderInWorkspace(<MailboxStatus workspaceId={W} />);
    expect(
      await screen.findByText("The mail server didn't accept the user name or password."),
    ).toBeTruthy();
  });

  it("updates live when the sync fails and when it recovers", async () => {
    let sync: MailboxSyncStatus = ok(new Date(Date.now() - 10_000));
    fakeApi({ [MAILBOXES]: () => mailbox(sync) });
    renderInWorkspace(<Header />);
    expect(await screen.findByText("Synced just now")).toBeTruthy();
    const stream = FakeEventSource.all[0];
    expect(stream?.url).toBe(`/api/workspaces/${W}/events`);

    sync = {
      state: "failing",
      lastSyncedAt: sync.lastSyncedAt,
      failingSince: todayAt1042().toISOString(),
      reason: "unreachable",
      message: "Couldn't reach the mail server",
    };
    act(() => stream?.emit("mailbox.updated", "{}"));
    expect(await screen.findByText("Can't reach the mail server since 10:42")).toBeTruthy();

    sync = ok(new Date());
    act(() => stream?.emit("mailbox.updated", "{}"));
    expect(await screen.findByText("Synced just now")).toBeTruthy();
    expect(screen.queryByText(/Can't reach/)).toBeNull();
  });

  it("follows the clock: 'just now' becomes '2 minutes ago'", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setInterval", "Date"] });
    fakeApi({ [MAILBOXES]: mailbox(ok(new Date())) });
    renderInWorkspace(<MailboxStatus workspaceId={W} />);
    expect(await screen.findByText("Synced just now")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(await screen.findByText("Synced 2 minutes ago")).toBeTruthy();
  });

  it("waits for the first sync, and shows nothing without a mailbox", async () => {
    fakeApi({ [MAILBOXES]: mailbox(undefined) });
    const first = renderInWorkspace(<MailboxStatus workspaceId={W} />);
    expect(await screen.findByText("Waiting for the first sync")).toBeTruthy();
    first.unmount();
    fakeApi({ [MAILBOXES]: { items: [] } });
    const { container } = renderInWorkspace(<MailboxStatus workspaceId={W} />);
    await act(async () => {});
    expect(container.textContent).toBe("");
  });
});

describe("UsagePerDay (F1.5)", () => {
  it("shows model calls and tokens per day, newest first", async () => {
    const usage: AiUsageList = {
      items: [
        { day: "2026-10-15", calls: 12, inputTokens: 9000, outputTokens: 1200 },
        { day: "2026-10-14", calls: 3, inputTokens: 400, outputTokens: 50 },
      ],
    };
    const seen = fakeApi({ "GET /api/workspaces/:id/ai/usage": usage });
    renderInWorkspace(<UsagePerDay workspaceId={W} />);
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows.map((r) => [...r.querySelectorAll("th, td")].map((c) => c.textContent))).toEqual([
      ["Day", "Model calls", "Tokens"],
      [expect.stringMatching(/Oct 15, 2026|15 Oct 2026/), "12", (10200).toLocaleString()],
      [expect.stringMatching(/Oct 14, 2026|14 Oct 2026/), "3", "450"],
    ]);
    expect(seen.map((r) => r.path)).toContain(`/api/workspaces/${W}/ai/usage`);
  });

  it("says when no model was called yet", async () => {
    fakeApi({ "GET /api/workspaces/:id/ai/usage": { items: [] } });
    renderInWorkspace(<UsagePerDay workspaceId={W} />);
    expect(await screen.findByText("No model calls yet.")).toBeTruthy();
  });
});
