import { describe, expect, it } from "vitest";
import { mergeByTime } from "./logs.ts";

const line = (instance: string, time: string | undefined, enabled?: boolean) => ({
  instance,
  time,
  enabled,
});

describe("mergeByTime", () => {
  it("orders lines from different replicas by time, not by replica", () => {
    // MVP 3 S1: "off" handled by app-b, then "on" by app-a.
    const appA = [line("app-a", "2026-10-17T13:00:48.847Z", true)];
    const appB = [line("app-b", "2026-10-17T13:00:48.534Z", false)];
    expect(mergeByTime([appA, appB, []]).map((l) => l.enabled)).toEqual([false, true]);
  });

  it("interleaves the replicas' lines", () => {
    const appA = [
      line("app-a", "2026-10-17T10:00:01.000Z"),
      line("app-a", "2026-10-17T10:00:04.000Z"),
    ];
    const appB = [line("app-b", "2026-10-17T10:00:02.000Z")];
    const appC = [
      line("app-c", "2026-10-17T10:00:00.500Z"),
      line("app-c", "2026-10-17T10:00:03.000Z"),
    ];
    expect(mergeByTime([appA, appB, appC]).map((l) => `${l.instance} ${l.time}`)).toEqual([
      "app-c 2026-10-17T10:00:00.500Z",
      "app-a 2026-10-17T10:00:01.000Z",
      "app-b 2026-10-17T10:00:02.000Z",
      "app-c 2026-10-17T10:00:03.000Z",
      "app-a 2026-10-17T10:00:04.000Z",
    ]);
  });

  it("keeps the given order for equal times, and puts lines without a time last", () => {
    const same = "2026-10-17T10:00:00.000Z";
    const appA = [line("app-a", undefined), line("app-a", same, true), line("app-a", same, false)];
    const appB = [line("app-b", same, true)];
    expect(mergeByTime([appA, appB]).map((l) => [l.instance, l.time, l.enabled])).toEqual([
      ["app-a", same, true],
      ["app-a", same, false],
      ["app-b", same, true],
      ["app-a", undefined, undefined],
    ]);
  });
});
