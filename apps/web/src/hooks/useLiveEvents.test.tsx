import type { LiveEvent } from "@jobfilly/schema";
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
    expect(keys()).toEqual([queryKeys.area(W, "messages")]);
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
    expect(areas("cvs.updated")).toEqual(["cvs"]);
    expect(areas("drafts.updated")).toEqual(["drafts", "messages"]);
    expect(areas("decisions.updated")).toEqual(["decisions"]);
    expect(areas("profiles.updated")).toEqual(["profiles"]);
    expect(areas("assistant.updated")).toEqual(["assistant"]);
    expect(areas("mailbox.updated")).toEqual(["mailbox"]);
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
    expect(keys().map((k) => k[2])).toEqual(["drafts", "messages"]);
    for (const off of unsubscribe) off();
  });

  it("still refetches during a steady stream of events, once per max wait", () => {
    const { spy, emit } = mount();
    for (let t = 0; t < LIVE_MAX_WAIT_MS * 2; t += 50) {
      act(() => {
        emit("messages.updated");
        vi.advanceTimersByTime(50);
      });
    }
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("refetches the scan screen within 2 seconds of a batch's progress and of the stop, also amid a stream of other events (F4.6)", async () => {
    const client = new QueryClient();
    const scan = vi.fn(async () => ({ analyzed: 0 }));
    // The key useCurrentScan reads.
    const observer = new QueryObserver(client, {
      queryKey: [...queryKeys.area(W, "scan"), "current"],
      queryFn: scan,
    });
    const off = observer.subscribe(() => {});
    await act(() => vi.advanceTimersByTimeAsync(0));
    const { emit } = mount(client);
    const progress = {
      scanId: "00000000-0000-4000-8000-0000000000c1",
      kind: "first",
      status: "running",
      stopReason: null,
      handledWithoutAi: 275,
      likely: 345,
      analyzed: 20,
      jobFound: 16,
      answersFirm: 8,
      notAnalyzed: 325,
      calls: 18,
      tokens: 9000,
    };
    const data = {
      "scan.progress": progress,
      "scan.stopped": {
        ...progress,
        status: "stopped",
        stopReason: "confident",
        stopMessage: "Stopped: confident after 20 of 345 likely job emails",
      },
    };
    // Within 2 s of `type`, while messages.updated keeps coming every 50 ms.
    const refetchedWithin2s = async (type: keyof typeof data) => {
      const before = scan.mock.calls.length;
      act(() => emit(type, JSON.stringify(data[type])));
      for (let t = 0; t < 2000 && scan.mock.calls.length === before; t += 50) {
        await act(() => vi.advanceTimersByTimeAsync(50));
        act(() => emit("messages.updated"));
      }
      return scan.mock.calls.length > before;
    };
    act(() => emit("messages.updated"));
    await act(() => vi.advanceTimersByTimeAsync(LIVE_MAX_WAIT_MS - 100));
    expect(await refetchedWithin2s("scan.progress")).toBe(true);
    expect(await refetchedWithin2s("scan.progress")).toBe(true);
    expect(await refetchedWithin2s("scan.stopped")).toBe(true);
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
