import type { LiveEvent } from "@jobfilly/schema";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../log";
import { createTestDeps, type TestDeps } from "../testing";
import { createLiveHub } from "./hub";

let deps: TestDeps | undefined;
afterEach(async () => {
  await deps?.close();
  deps = undefined;
});

const W1 = "11111111-1111-4111-8111-111111111111";
const W2 = "22222222-2222-4222-8222-222222222222";
const event: LiveEvent = { type: "intake.updated", data: {} };

describe("live updates", () => {
  it("fans an event out to the workspace's streams on every replica, and nowhere else", async () => {
    deps = await createTestDeps();
    // A second hub on the same database plays the other replica.
    const other = createLiveHub(
      deps.connection.notifier,
      createLogger({ level: "error", instance: "app-b", write: () => {} }),
    );
    await other.start();
    const here: LiveEvent[] = [];
    const there: LiveEvent[] = [];
    const elsewhere: LiveEvent[] = [];
    deps.live.subscribe(
      W1,
      (e) => here.push(e),
      () => {},
    );
    other.subscribe(
      W1,
      (e) => there.push(e),
      () => {},
    );
    other.subscribe(
      W2,
      (e) => elsewhere.push(e),
      () => {},
    );

    await deps.live.publish(W1, event);
    await expect.poll(() => there.length).toBe(1);
    await expect.poll(() => here.length).toBe(1);
    expect(here).toEqual([event]);
    expect(elsewhere).toEqual([]);
    await other.stop();
  });

  it("stops delivering to an unsubscribed stream and closes all on shutdown", async () => {
    deps = await createTestDeps();
    const got: LiveEvent[] = [];
    const closed: string[] = [];
    const unsubscribe = deps.live.subscribe(
      W1,
      (e) => got.push(e),
      () => closed.push("a"),
    );
    deps.live.subscribe(
      W2,
      () => {},
      () => closed.push("b"),
    );
    expect(deps.live.streams).toBe(2);
    unsubscribe();
    await deps.live.publish(W1, event);
    await new Promise((r) => setTimeout(r, 30));
    expect(got).toEqual([]);
    deps.live.closeAll();
    expect(closed).toEqual(["b"]);
    expect(deps.live.streams).toBe(0);
  });

  it("refuses an event that doesn't match its schema", async () => {
    deps = await createTestDeps();
    await expect(
      deps.live.publish(W1, { type: "scan.progress", data: {} } as unknown as LiveEvent),
    ).rejects.toThrow();
  });
});
