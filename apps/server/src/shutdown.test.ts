import { describe, expect, it } from "vitest";
import { createBackgroundWork, type Health } from "./deps";
import type { JobQueue } from "./jobs/queue";
import type { LiveHub } from "./live";
import { createLogger } from "./log";
import type { RunningServer } from "./node";
import { DRAIN_MS, INFLIGHT_MS, shutdown } from "./shutdown";

function setup(options: { requestsEndAfter: number | null }) {
  const steps: string[] = [];
  let release: () => void = () => {};
  const closed = new Promise<void>((r) => {
    release = r;
  });
  const health: Health = {
    check: async () => ({ status: "ready" }),
    beginShutdown: () => steps.push("not ready"),
    shuttingDown: false,
  };
  const server: RunningServer = {
    url: "http://x",
    close: () => {
      steps.push("stop accepting");
      return closed;
    },
    closeAllConnections: () => {
      steps.push("cut connections");
      release();
    },
  };
  const live = {
    closeAll: () => steps.push("close streams"),
    stop: async () => {
      steps.push("stop listening");
    },
  } as unknown as LiveHub;
  const queue = {
    stop: async () => {
      steps.push("hand back jobs");
    },
  } as unknown as JobQueue;
  // A real tracker holding one background call that cleans up a moment after it is aborted.
  const background = createBackgroundWork();
  void background.run(
    (signal) =>
      new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          steps.push("abort background work");
          setTimeout(() => {
            steps.push("background work released");
            resolve();
          }, 5);
        });
      }),
    () => {},
  );
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({
    level: "info",
    instance: "app-b",
    write: (l) => lines.push(JSON.parse(l)),
  });
  const sleep = async (ms: number) => {
    steps.push(`wait ${ms}`);
    if (ms === INFLIGHT_MS && options.requestsEndAfter === null) return;
    if (ms === INFLIGHT_MS) await new Promise(() => {});
  };
  if (options.requestsEndAfter !== null) setTimeout(release, options.requestsEndAfter);
  const targets = {
    health,
    log,
    server,
    live,
    queue,
    background,
    closeDatabase: async () => {
      steps.push("close database");
    },
  };
  return { steps, lines, targets, sleep };
}

describe("graceful shutdown", () => {
  it("follows the ARCHITECTURE order when requests finish in time", async () => {
    const { steps, lines, targets, sleep } = setup({ requestsEndAfter: 5 });
    await shutdown(targets, { sleep });
    expect(steps).toEqual([
      "not ready",
      `wait ${DRAIN_MS}`,
      "stop accepting",
      "close streams",
      `wait ${INFLIGHT_MS}`,
      "hand back jobs",
      "abort background work",
      "background work released",
      "stop listening",
      "close database",
    ]);
    expect(lines.map((l) => l.event)).toEqual(["server.shutting_down", "server.stopped"]);
    expect(lines[1]).toMatchObject({ requestsFinishedInTime: true });
  });

  it("cuts requests still open after 20 seconds, then hands jobs back", async () => {
    const { steps, lines, targets, sleep } = setup({ requestsEndAfter: null });
    await shutdown(targets, { sleep });
    expect(steps).toEqual([
      "not ready",
      `wait ${DRAIN_MS}`,
      "stop accepting",
      "close streams",
      `wait ${INFLIGHT_MS}`,
      "cut connections",
      "hand back jobs",
      "abort background work",
      "background work released",
      "stop listening",
      "close database",
    ]);
    expect(lines[1]).toMatchObject({ requestsFinishedInTime: false });
  });

  it("drains for 5 seconds and gives requests 20", () => {
    expect(DRAIN_MS).toBe(5000);
    expect(INFLIGHT_MS).toBe(20_000);
  });
});
