import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createTestDeps, type SeededUser, seedUser, signedIn, type TestDeps } from "../testing";

let deps: TestDeps;
let maria: SeededUser;
beforeEach(async () => {
  deps = await createTestDeps();
  maria = await seedUser(deps);
});
afterEach(() => deps.close());

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string) {
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes(needle)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  return text;
}

describe("GET /events (SSE)", () => {
  it("streams the workspace's events to a member", async () => {
    const app = createApp(deps);
    const api = await signedIn(app, deps, maria);
    const res = await api.get(`/api/workspaces/${maria.workspaceId}/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    expect(await readUntil(reader, ": connected")).toContain("retry: 2000");

    await deps.live.publish(maria.workspaceId, { type: "workspace.updated", data: {} });
    const text = await readUntil(reader, "workspace.updated");
    expect(text).toContain("event: workspace.updated\ndata: {}");

    // Shutdown closes the stream; the browser reconnects elsewhere.
    deps.live.closeAll();
    await expect.poll(async () => (await reader.read()).done).toBe(true);
  });

  it("never sends another workspace's events", async () => {
    const tom = await seedUser(deps);
    const app = createApp(deps);
    const api = await signedIn(app, deps, maria);
    const res = await api.get(`/api/workspaces/${maria.workspaceId}/events`);
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    await readUntil(reader, ": connected");
    await deps.live.publish(tom.workspaceId, { type: "intake.updated", data: {} });
    await deps.live.publish(maria.workspaceId, { type: "workspace.updated", data: {} });
    const text = await readUntil(reader, "workspace.updated");
    expect(text).not.toContain("intake.updated");
    await reader.cancel();
  });
});
