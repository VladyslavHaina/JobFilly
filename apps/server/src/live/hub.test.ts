import type { LiveEvent } from "@jobfilly/schema";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../log";
import { createTestDeps, type TestDeps } from "../testing";
import { createLiveHub, type LiveHub, type StreamOwner } from "./hub";

let deps: TestDeps | undefined;
let other: LiveHub | undefined;
afterEach(async () => {
  await other?.stop();
  other = undefined;
  await deps?.close();
  deps = undefined;
});

const W1 = "11111111-1111-4111-8111-111111111111";
const W2 = "22222222-2222-4222-8222-222222222222";
const U1 = "33333333-3333-4333-8333-333333333333";
const U2 = "44444444-4444-4444-8444-444444444444";
const S1 = "55555555-5555-4555-8555-555555555555";
const S2 = "66666666-6666-4666-8666-666666666666";
const S3 = "77777777-7777-4777-8777-777777777777";
const event: LiveEvent = { type: "intake.updated", data: {} };

const owner = (workspaceId: string, userId = U1, sessionId = S1): StreamOwner => ({
  workspaceId,
  userId,
  sessionId,
});

/** A second hub on the same database plays the other replica. */
async function otherReplica(d: TestDeps): Promise<LiveHub> {
  other = createLiveHub(
    d.connection.notifier,
    createLogger({ level: "error", instance: "app-b", write: () => {} }),
  );
  await other.start();
  return other;
}

describe("live updates", () => {
  it("fans an event out to the workspace's streams on every replica, and nowhere else", async () => {
    deps = await createTestDeps();
    const b = await otherReplica(deps);
    const here: LiveEvent[] = [];
    const there: LiveEvent[] = [];
    const elsewhere: LiveEvent[] = [];
    deps.live.subscribe(
      owner(W1),
      (e) => here.push(e),
      () => {},
    );
    b.subscribe(
      owner(W1, U2, S2),
      (e) => there.push(e),
      () => {},
    );
    b.subscribe(
      owner(W2),
      (e) => elsewhere.push(e),
      () => {},
    );

    await deps.live.publish(W1, event);
    await expect.poll(() => there.length).toBe(1);
    await expect.poll(() => here.length).toBe(1);
    expect(here).toEqual([event]);
    expect(elsewhere).toEqual([]);
  });

  it("stops delivering to an unsubscribed stream and closes all on shutdown", async () => {
    deps = await createTestDeps();
    const got: LiveEvent[] = [];
    const closed: string[] = [];
    const unsubscribe = deps.live.subscribe(
      owner(W1),
      (e) => got.push(e),
      () => closed.push("a"),
    );
    deps.live.subscribe(
      owner(W2),
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

describe("revoking streams (F1.4, F1.9)", () => {
  it("closes a removed member's streams in that workspace on every replica, and no others", async () => {
    deps = await createTestDeps();
    const b = await otherReplica(deps);
    const closed: string[] = [];
    const got: string[] = [];
    const stream = (hub: LiveHub, name: string, o: StreamOwner) =>
      hub.subscribe(
        o,
        () => got.push(name),
        () => closed.push(name),
      );
    stream(deps.live, "removed here", owner(W1, U1, S1));
    stream(b, "removed there", owner(W1, U1, S3));
    stream(b, "same user, other workspace", owner(W2, U1, S3));
    stream(b, "other member", owner(W1, U2, S2));

    await deps.live.revoke({ type: "member.removed", workspaceId: W1, userId: U1 });
    // The replica that made the change closes its own streams before revoke() returns.
    expect(closed).toContain("removed here");
    await expect.poll(() => closed.length).toBe(2);
    expect(closed.sort()).toEqual(["removed here", "removed there"]);

    // Anything published afterwards reaches only the streams still open.
    await deps.live.publish(W1, event);
    await deps.live.publish(W2, event);
    await expect.poll(() => got.length).toBe(2);
    await new Promise((r) => setTimeout(r, 30));
    expect(got.sort()).toEqual(["other member", "same user, other workspace"]);
    expect(deps.live.streams).toBe(0);
    expect(b.streams).toBe(2);
  });

  it("closes an ended session's streams in every workspace on every replica", async () => {
    deps = await createTestDeps();
    const b = await otherReplica(deps);
    const closed: string[] = [];
    deps.live.subscribe(
      owner(W1, U1, S1),
      () => {},
      () => closed.push("W1 here"),
    );
    b.subscribe(
      owner(W2, U1, S1),
      () => {},
      () => closed.push("W2 there"),
    );
    b.subscribe(
      owner(W1, U1, S2),
      () => {},
      () => closed.push("same user, other session"),
    );
    // A listener of the server itself has no session or user, so no access change closes it.
    deps.live.subscribe(
      W1,
      () => {},
      () => closed.push("server"),
    );

    await b.revoke({ type: "session.ended", sessionId: S1 });
    await expect.poll(() => closed.length).toBe(2);
    expect(closed.sort()).toEqual(["W1 here", "W2 there"]);
    await new Promise((r) => setTimeout(r, 30));
    expect(closed).toHaveLength(2);
    expect(b.streams).toBe(1);
    await deps.live.revoke({ type: "member.removed", workspaceId: W1, userId: U1 });
    expect(deps.live.streams).toBe(1);
  });

  it("refuses an access change that doesn't match its schema", async () => {
    deps = await createTestDeps();
    await expect(deps.live.revoke({ type: "session.ended", sessionId: "token" })).rejects.toThrow();
  });
});
