import { describe, expect, it } from "vitest";
import type { Replica } from "../specs/shared.ts";
import {
  bytesOf,
  countsForLatency,
  evaluate,
  type LogLine,
  minutesFrom,
  p95,
  parseStats,
  report,
  runFolderName,
  type Sample,
  samplesCsv,
} from "./soak.ts";

// The soak's evaluation (F10.3, F10.4) on sample data: no Docker, no stack.

const MiB = 1024 ** 2;
const start = new Date("2026-10-17T10:00:00.000Z");
const end = new Date("2026-10-17T10:20:00.000Z");
const at = (minute: number) => new Date(start.getTime() + minute * 60_000).toISOString();

/** A sample of `replica` every 15 s of a 20-minute soak, memory from `mem(minute)` MiB. */
function steady(replica: Replica, mem: (minute: number) => number = () => 200): Sample[] {
  return Array.from({ length: 80 }, (_, i) => ({
    replica,
    at: i * 15_000,
    cpuPercent: i % 2 === 0 ? 2 : 4,
    memBytes: mem((i * 15) / 60) * MiB,
  }));
}

const allSteady = () => [...steady("app-a"), ...steady("app-b"), ...steady("app-c")];

const request = (minute: number, durationMs: number, route = "/api/auth/me"): LogLine => ({
  time: at(minute),
  level: "info",
  instance: "app-a",
  event: "http.request",
  method: "GET",
  route,
  status: 200,
  durationMs,
});

/** 100 API requests during the soak, `slow` of them taking 900 ms and the rest 20 ms. */
const requests = (slow: number): LogLine[] =>
  Array.from({ length: 100 }, (_, i) => request(1 + i / 10, i < slow ? 900 : 20));

const checkNamed = (log: LogLine[], samples: Sample[], part: string) =>
  evaluate({ minutes: 20, start, end, samples, log }).checks.find((c) => c.name.includes(part));

describe("the memory window", () => {
  it("passes when every sample from minute 5 stays within 20% of the minutes 5–10 average", () => {
    const samples = [
      ...steady("app-a", (m) => (m < 5 ? 120 : m < 10 ? 200 : 210)),
      ...steady("app-b"),
      ...steady("app-c"),
    ];
    const { checks } = evaluate({ minutes: 20, start, end, samples, log: requests(0) });
    const memory = checks.filter((c) => c.name.startsWith("Memory"));
    expect(memory.map((c) => c.pass)).toEqual([true, true, true]);
    // The warm-up before minute 5 doesn't count.
    expect(memory[0]?.detail).toMatch(/^average 200\.0 MiB; furthest 210\.0 MiB .*\(\+5\.0%\)/);
  });

  it("fails a replica whose memory grows past 20% after minute 10", () => {
    const leaking = steady("app-b", (m) => (m < 10 ? 200 : 200 + (m - 10) * 10));
    const check = checkNamed([], [...steady("app-a"), ...leaking, ...steady("app-c")], "app-b");
    expect(check?.pass).toBe(false);
    expect(check?.detail).toContain("+48.8%");
    expect(
      checkNamed([], [...steady("app-a"), ...leaking, ...steady("app-c")], "app-a")?.pass,
    ).toBe(true);
  });

  it("fails a drop of more than 20% too, and exactly 20% passes", () => {
    const drop = steady("app-c", (m) => (m < 15 ? 200 : 150));
    expect(checkNamed([], [...steady("app-a"), ...steady("app-b"), ...drop], "app-c")?.pass).toBe(
      false,
    );
    const edge = steady("app-c", (m) => (m < 15 ? 200 : 160));
    expect(checkNamed([], [...steady("app-a"), ...steady("app-b"), ...edge], "app-c")?.pass).toBe(
      true,
    );
  });

  it("fails a replica with no samples in the window", () => {
    const early = steady("app-a").filter((s) => s.at < 5 * 60_000);
    const check = checkNamed([], [...early, ...steady("app-b"), ...steady("app-c")], "app-a");
    expect(check).toMatchObject({ pass: false, detail: "no samples in minutes 5–10" });
  });

  it("scales the window with a shorter soak", () => {
    const samples = steady("app-a", (m) => (m < 1 ? 50 : 100)).filter((s) => s.at < 4 * 60_000);
    const { checks } = evaluate({ minutes: 4, start, end, samples, log: [] });
    expect(checks[0]).toMatchObject({ pass: true });
    expect(checks[0]?.name).toContain("minutes 1–2");
  });
});

describe("p95 latency", () => {
  it("is the nearest-rank 95th percentile", () => {
    expect(p95([])).toBeNull();
    expect(p95([7])).toBe(7);
    expect(p95(Array.from({ length: 100 }, (_, i) => i + 1))).toBe(95);
    expect(p95(Array.from({ length: 20 }, (_, i) => 20 - i))).toBe(19);
  });

  it("passes under 300 ms and fails at or above it", () => {
    expect(checkNamed(requests(5), allSteady(), "p95")).toMatchObject({
      pass: true,
      detail: "20 ms over 100 requests",
    });
    expect(checkNamed(requests(6), allSteady(), "p95")).toMatchObject({
      pass: false,
      detail: "900 ms over 100 requests",
    });
    const at300 = Array.from({ length: 10 }, (_, i) => request(2, 300));
    expect(checkNamed(at300, allSteady(), "p95")?.pass).toBe(false);
  });

  it("counts API routes only: no health checks, live streams or UI files", () => {
    expect(countsForLatency(request(1, 5))).toBe(true);
    expect(countsForLatency(request(1, 5, "/api/workspaces/:workspaceId/messages"))).toBe(true);
    expect(countsForLatency(request(1, 5, "/api/health/ready"))).toBe(false);
    expect(countsForLatency(request(1, 5, "/api/workspaces/:workspaceId/events"))).toBe(false);
    expect(countsForLatency(request(1, 5, "/*"))).toBe(false);
    expect(countsForLatency({ ...request(1, 5), event: "scan.started" })).toBe(false);
    const noisy = [
      ...requests(0),
      ...Array.from({ length: 50 }, () => request(3, 5_000, "/api/health/ready")),
    ];
    expect(checkNamed(noisy, allSteady(), "p95")?.pass).toBe(true);
  });

  it("leaves out requests before and after the soak, and fails with none", () => {
    const setup = Array.from({ length: 50 }, () => request(-2, 5_000));
    expect(checkNamed([...setup, ...requests(0)], allSteady(), "p95")?.pass).toBe(true);
    expect(checkNamed(setup, allSteady(), "p95")).toMatchObject({
      pass: false,
      detail: "no API requests logged",
    });
  });
});

describe("the job.failed count", () => {
  const failed = (minute: number): LogLine => ({
    time: at(minute),
    level: "error",
    event: "job.failed",
  });

  it("passes with none during the soak", () => {
    expect(checkNamed([...requests(0), failed(-1), failed(21)], allSteady(), "job")).toMatchObject({
      pass: true,
      detail: "0 job.failed lines",
    });
  });

  it("fails with any", () => {
    expect(checkNamed([...requests(0), failed(3), failed(12)], allSteady(), "job")).toMatchObject({
      pass: false,
      detail: "2 job.failed lines",
    });
  });
});

describe("docker stats and the resource figures", () => {
  it("reads sizes in docker's units", () => {
    expect(bytesOf("512B")).toBe(512);
    expect(bytesOf("1.5KiB")).toBe(1536);
    expect(bytesOf("210.4MiB")).toBeCloseTo(210.4 * MiB);
    expect(bytesOf("1GiB")).toBe(1024 ** 3);
    expect(bytesOf("12MB")).toBe(12e6);
    expect(bytesOf("--")).toBeNull();
  });

  it("parses one line per replica and skips what doesn't read", () => {
    const stdout = [
      "aaa111\t1.25%\t210.4MiB / 7.66GiB",
      "bbb222\t0.50%\t198MiB / 7.66GiB",
      "ccc333\t--\t-- / --",
      "zzz999\t3.00%\t10MiB / 7.66GiB",
      "",
    ].join("\n");
    const names: Record<string, Replica> = { aaa111: "app-a", bbb222: "app-b", ccc333: "app-c" };
    expect(parseStats(stdout, (c) => names[c], 15_000)).toEqual([
      { replica: "app-a", at: 15_000, cpuPercent: 1.25, memBytes: 210.4 * MiB },
      { replica: "app-b", at: 15_000, cpuPercent: 0.5, memBytes: 198 * MiB },
    ]);
  });

  it("records CPU and memory average and max per replica, in soak.md too", () => {
    const samples = [
      ...steady("app-a", (m) => (m < 19 ? 200 : 230)),
      ...steady("app-b"),
      ...steady("app-c"),
    ];
    const evaluation = evaluate({ minutes: 20, start, end, samples, log: requests(0) });
    expect(evaluation.usage[0]).toMatchObject({
      replica: "app-a",
      samples: 80,
      cpuAvg: 3,
      cpuMax: 4,
    });
    expect(evaluation.usage[0]?.memMax).toBe(230 * MiB);
    const text = report({
      project: "jobfilly-e2e-x",
      minutes: 20,
      start,
      end,
      evaluation,
      problems: [],
    });
    expect(text).toContain("# MVP 3 soak (F10.3, F10.4): PASS");
    expect(text).toContain("| app-a | 80 | 3.0% | 4.0% | 201.5 MiB | 230.0 MiB |");
    expect(
      report({
        project: "x",
        minutes: 20,
        start,
        end,
        evaluation,
        problems: ["seed generate exited 1"],
      }),
    ).toContain("FAIL");
  });

  it("writes memory.csv with one row per sample", () => {
    const csv = samplesCsv(start, [
      { replica: "app-b", at: 30_000, cpuPercent: 1.5, memBytes: 1000 },
    ]);
    expect(csv).toBe(
      "time,elapsed_s,replica,cpu_percent,mem_bytes\n2026-10-17T10:00:30.000Z,30,app-b,1.50,1000\n",
    );
  });
});

describe("arguments and the run folder", () => {
  it("runs 20 minutes by default and takes --minutes for a self-test", () => {
    expect(minutesFrom([])).toBe(20);
    expect(minutesFrom(["--minutes", "4"])).toBe(4);
    for (const bad of [["--minutes"], ["--minutes", "3"], ["--minutes", "2.5"], ["--hours", "1"]]) {
      expect(minutesFrom(bad)).toBeNull();
    }
  });

  it("names the run folder by its UTC start", () => {
    expect(runFolderName(new Date("2026-10-17T09:05:03.120Z"))).toBe("20261017-090503-soak");
  });
});
