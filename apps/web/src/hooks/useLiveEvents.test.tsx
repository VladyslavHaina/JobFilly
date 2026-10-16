import type { CurrentScan, LiveEvent } from "@jobfilly/schema";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "./queryKeys";
import {
  LIVE_MAX_WAIT_MS,
  LIVE_SETTLE_MS,
  useLiveEvents,
  useLiveInvalidation,
} from "./useLiveEvents";

/** A stand-in for the browser's EventSource. */
class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static all: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, ((e: { data: string }) => void)[]>();
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, cb: (e: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), cb]);
  }
  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }
  emit(type: string, data: string) {
    for (const cb of this.listeners.get(type) ?? []) cb({ data });
  }
  fail(closed: boolean) {
    this.readyState = closed ? FakeEventSource.CLOSED : FakeEventSource.CONNECTING;
    this.onerror?.();
  }
}

beforeEach(() => {
  FakeEventSource.all = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const W = "00000000-0000-4000-8000-0000000000aa";

describe("useLiveEvents", () => {
  it("subscribes to the workspace's stream and hands over valid events", () => {
    const got: LiveEvent[] = [];
    const { result, unmount } = renderHook(() => useLiveEvents(W, (e) => got.push(e)));
    const es = FakeEventSource.all[0];
    expect(es?.url).toBe(`/api/workspaces/${W}/events`);
    act(() => es?.open());
    expect(result.current.connected).toBe(true);
    act(() => {
      es?.emit("intake.updated", "{}");
      es?.emit("scan.progress", '{"not":"progress"}');
      es?.emit("messages.updated", "not json");
    });
    expect(got).toEqual([{ type: "intake.updated", data: {} }]);
    unmount();
    expect(es?.closed).toBe(true);
  });

  it("reconnects with a backoff when the stream is refused, not when it merely drops", () => {
    renderHook(() => useLiveEvents(W, () => {}));
    const first = FakeEventSource.all[0];
    act(() => first?.fail(false));
    act(() => vi.advanceTimersByTime(5000));
    expect(FakeEventSource.all).toHaveLength(1);
    act(() => first?.fail(true));
    act(() => vi.advanceTimersByTime(999));
    expect(FakeEventSource.all).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(FakeEventSource.all).toHaveLength(2);
    act(() => FakeEventSource.all[1]?.fail(true));
    act(() => vi.advanceTimersByTime(1999));
    expect(FakeEventSource.all).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1));
    expect(FakeEventSource.all).toHaveLength(3);
  });
});

describe("useLiveInvalidation", () => {
  function mount(client = new QueryClient()) {
    const spy = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(({ id }) => useLiveInvalidation(id), {
      wrapper,
      initialProps: { id: W },
    });
    const emit = (type: string, data = "{}") => FakeEventSource.all.at(-1)?.emit(type, data);
    const keys = () => spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    return { spy, hook, emit, keys };
  }
  const settle = () => act(() => vi.advanceTimersByTime(LIVE_SETTLE_MS));

  it("refetches the queries of the area an event touches", () => {
    const { spy, emit, keys } = mount();
    act(() => emit("messages.updated"));
    expect(spy).not.toHaveBeenCalled();
    settle();
    expect(keys()).toEqual([queryKeys.area(W, "messages"), queryKeys.area(W, "usage")]);
    spy.mockClear();
    act(() => emit("workspace.updated"));
    settle();
    expect(keys()).toEqual([queryKeys.area(W, "workspace"), queryKeys.workspaces]);
  });

  it("refetches the MVP 2 areas on their events", () => {
    const { spy, emit, keys } = mount();
    const areas = (type: string) => {
      spy.mockClear();
      act(() => emit(type));
      settle();
      return keys().map((k) => k[2]);
    };
    expect(areas("cvs.updated")).toEqual(["cvs", "usage"]);
    expect(areas("drafts.updated")).toEqual(["drafts", "messages", "usage"]);
    expect(areas("decisions.updated")).toEqual(["decisions"]);
    expect(areas("profiles.updated")).toEqual(["profiles"]);
    expect(areas("assistant.updated")).toEqual(["assistant", "usage"]);
    expect(areas("mailbox.updated")).toEqual(["mailbox"]);
  });

  it("refetches the model usage (F1.5) on every event a model call leads to, and only those", () => {
    const { spy, emit, keys } = mount();
    const refetchesUsage = (type: string, data = "{}") => {
      spy.mockClear();
      act(() => emit(type, data));
      settle();
      return keys().some((k) => k[2] === "usage");
    };
    const scan = JSON.stringify({
      scanId: "00000000-0000-4000-8000-0000000000c1",
      kind: "first",
      status: "running",
      stopReason: null,
      handledWithoutAi: 20,
      likely: 10,
      analyzed: 1,
      jobFound: 1,
      answersFirm: 0,
      notAnalyzed: 9,
      calls: 1,
      tokens: 500,
    });
    // The CV read and the assistant call the model outside the mail pipeline.
    for (const type of [
      "cvs.updated",
      "assistant.updated",
      "messages.updated",
      "drafts.updated",
      "intake.updated",
    ]) {
      expect(refetchesUsage(type), type).toBe(true);
    }
    expect(refetchesUsage("scan.progress", scan)).toBe(true);
    for (const type of ["workspace.updated", "profiles.updated", "mailbox.updated"]) {
      expect(refetchesUsage(type), type).toBe(false);
    }
  });

  it("refetches an open list and message once for a burst of events, not once per event", async () => {
    const client = new QueryClient();
    const list = vi.fn(async () => ["row"]);
    const detail = vi.fn(async () => ({ id: "m1" }));
    // The inbox's search results and the open message, both on screen.
    const observers = [
      new QueryObserver(client, {
        queryKey: [...queryKeys.area(W, "messages"), "list", "Zurich"],
        queryFn: list,
      }),
      new QueryObserver(client, {
        queryKey: [...queryKeys.area(W, "messages"), "detail", "m1"],
        queryFn: detail,
      }),
    ];
    const unsubscribe = observers.map((o) => o.subscribe(() => {}));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect([list.mock.calls.length, detail.mock.calls.length]).toEqual([1, 1]);

    const { emit, keys } = mount(client);
    // 28 events within 250 ms, as one processing batch sends them.
    for (let i = 0; i < 28; i++) {
      act(() => {
        emit(i % 2 ? "messages.updated" : "drafts.updated");
        vi.advanceTimersByTime(9);
      });
    }
    await act(() => vi.advanceTimersByTimeAsync(LIVE_SETTLE_MS));
    expect([list.mock.calls.length, detail.mock.calls.length]).toEqual([2, 2]);
    expect(keys().map((k) => k[2])).toEqual(["drafts", "messages", "usage"]);
    for (const off of unsubscribe) off();
  });

  it("still refetches during a steady stream of events, once per max wait", () => {
    const { emit, keys } = mount();
    for (let t = 0; t < LIVE_MAX_WAIT_MS * 2; t += 50) {
      act(() => {
        emit("messages.updated");
        vi.advanceTimersByTime(50);
      });
    }
    // Each flush refetches the event's areas once: the messages and the model usage.
    expect(keys().filter((k) => k[2] === "messages")).toHaveLength(2);
    expect(keys().filter((k) => k[2] === "usage")).toHaveLength(2);
  });

  it("shows a scan event's counts on the scan screen at once, ahead of a slow refetch, and never an older event's (F4.6)", async () => {
    const client = new QueryClient();
    const scanId = "00000000-0000-4000-8000-0000000000c1";
    const progress = {
      scanId,
      kind: "first",
      status: "running",
      stopReason: null,
      handledWithoutAi: 275,
      likely: 345,
      analyzed: 0,
      jobFound: 0,
      answersFirm: 0,
      notAnalyzed: 345,
      calls: 1,
      tokens: 500,
    } as const;
    const stored: CurrentScan = {
      progress,
      stopMessage: null,
      stoppedAt: null,
      totalTokens: 500,
    };
    // GET /scans/current answers what was stored when it was asked, and takes 3 s doing so (a
    // busy database): longer than the screen may wait.
    const scan = vi.fn(() => {
      const answer = structuredClone(stored);
      return new Promise<CurrentScan>((resolve) => setTimeout(() => resolve(answer), 3000));
    });
    const key = queryKeys.currentScan(W);
    const observer = new QueryObserver(client, { queryKey: key, queryFn: scan });
    const off = observer.subscribe(() => {});
    await act(() => vi.advanceTimersByTimeAsync(3000));
    const { emit } = mount(client);
    const shown = () => client.getQueryData<CurrentScan>(key);
    // The run stores, then sends the event.
    const send = (type: "scan.progress" | "scan.stopped", data: Record<string, unknown>) => {
      const { stopMessage, ...counts } = data;
      stored.progress = { ...progress, ...counts } as CurrentScan["progress"];
      if (type === "scan.stopped") {
        stored.stopMessage = String(stopMessage);
        stored.stoppedAt = "2026-10-01T10:05:00.000Z";
      }
      act(() => emit(type, JSON.stringify({ ...progress, ...data })));
    };

    // A refetch asked before the batch finished is still under way when its event comes in.
    void observer.refetch();
    send("scan.progress", { analyzed: 20, jobFound: 16, calls: 18 });
    expect(shown()?.progress).toMatchObject({ status: "running", analyzed: 20, calls: 18 });
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(shown()?.progress?.analyzed).toBe(20);
    // The refetch still follows the event, and brings what the event has not.
    expect(scan.mock.calls.length).toBeGreaterThanOrEqual(3);

    // An older event, and another scan's, change nothing.
    act(() => emit("scan.progress", JSON.stringify({ ...progress, analyzed: 10, calls: 9 })));
    act(() =>
      emit(
        "scan.progress",
        JSON.stringify({ ...progress, scanId: "00000000-0000-4000-8000-0000000000c2" }),
      ),
    );
    expect(shown()?.progress).toMatchObject({ scanId, analyzed: 20 });

    const message = "Stopped: confident after 25 of 345 likely job emails";
    send("scan.stopped", {
      status: "stopped",
      stopReason: "confident",
      analyzed: 25,
      calls: 23,
      stopMessage: message,
    });
    expect(shown()).toMatchObject({
      progress: { status: "stopped", stopReason: "confident", analyzed: 25 },
      stopMessage: message,
    });
    // A late progress event never takes the stop back.
    act(() => emit("scan.progress", JSON.stringify({ ...progress, analyzed: 25, calls: 23 })));
    expect(shown()?.progress?.status).toBe("stopped");
    await act(() => vi.advanceTimersByTimeAsync(LIVE_SETTLE_MS + 3000));
    expect(shown()).toMatchObject({
      progress: { status: "stopped" },
      stoppedAt: "2026-10-01T10:05:00.000Z",
    });
    off();
  });

  it("drops what the old workspace collected when the workspace changes", () => {
    const { spy, emit, hook } = mount();
    act(() => emit("cvs.updated"));
    hook.rerender({ id: "00000000-0000-4000-8000-0000000000bb" });
    settle();
    expect(spy).not.toHaveBeenCalled();
  });
});
