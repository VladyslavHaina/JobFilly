import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { type RunningServer, startServer } from "./node";
import { createTestDeps, type TestDeps } from "./testing";

describe("startServer", () => {
  let webDist: string;
  let server: RunningServer;
  let deps: TestDeps;

  beforeAll(async () => {
    deps = await createTestDeps();
    webDist = await mkdtemp(join(tmpdir(), "jobfilly-web-"));
    await writeFile(join(webDist, "index.html"), "<!doctype html><title>ui</title>");
    server = await startServer({
      app: createApp(deps),
      hostname: "127.0.0.1",
      port: 0,
      webDist,
      log: deps.log,
    });
  });

  afterAll(async () => {
    await server.close();
    await deps.close();
    await rm(webDist, { recursive: true, force: true });
  });

  it("serves the API on a free loopback port", async () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const res = await fetch(`${server.url}/api/health/live`);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("answers unknown API paths with a JSON 404, not the UI", async () => {
    const res = await fetch(`${server.url}/api/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("serves the UI for any other path", async () => {
    const res = await fetch(`${server.url}/some/screen`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>ui</title>");
  });

  it("logs http.request for a UI deep link with the route pattern, never the path", async () => {
    const before = deps.logs.length;
    const rawBefore = deps.rawLogs.length;
    const res = await fetch(`${server.url}/w/x/inbox/%3Ca%40b.example%3E`);
    expect(res.status).toBe(200);
    const lines = deps.logs.slice(before).filter((l) => l.event === "http.request");
    expect(lines).toEqual([
      expect.objectContaining({
        level: "info",
        instance: "test-instance",
        method: "GET",
        route: "/*",
        status: 200,
        requestId: res.headers.get("x-request-id"),
        durationMs: expect.any(Number),
      }),
    ]);
    expect(deps.rawLogs.slice(rawBefore).join("\n")).not.toMatch(/\/w\/x|inbox|a%40b|b\.example/);
  });

  it("logs an API request once, from the API's own middleware", async () => {
    const before = deps.logs.length;
    await fetch(`${server.url}/api/health/live`);
    const lines = deps.logs.slice(before).filter((l) => l.event === "http.request");
    expect(lines).toEqual([expect.objectContaining({ route: "/api/health/live", status: 200 })]);
  });
});
