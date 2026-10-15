import type { LiveEvent } from "@jobfilly/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "./queryKeys";
import { useLiveEvents, useLiveInvalidation } from "./useLiveEvents";

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
  it("refetches the queries of the area an event touches", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useLiveInvalidation(W), { wrapper });
    const es = FakeEventSource.all[0];
    act(() => es?.emit("messages.updated", "{}"));
    expect(spy).toHaveBeenLastCalledWith({ queryKey: queryKeys.area(W, "messages") });
    spy.mockClear();
    act(() => es?.emit("workspace.updated", "{}"));
    expect(spy.mock.calls.map((c) => c[0])).toEqual([
      { queryKey: queryKeys.area(W, "workspace") },
      { queryKey: queryKeys.workspaces },
    ]);
  });
});
