import { ReadinessSchema } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createTestDeps, type TestDeps } from "./testing";

let deps: TestDeps;
beforeEach(async () => {
  deps = await createTestDeps();
});
afterEach(() => deps.close());

describe("health", () => {
  it("is live while the process runs", async () => {
    const res = await createApp(deps).request("/api/health/live");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("is ready when the database is reachable and migrated", async () => {
    const res = await createApp(deps).request("/api/health/ready");
    expect(res.status).toBe(200);
    expect(ReadinessSchema.parse(await res.json())).toEqual({ status: "ready" });
  });

  it("answers 503 once shutdown has begun", async () => {
    deps.health.beginShutdown();
    const res = await createApp(deps).request("/api/health/ready");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "not_ready", reason: "shutting_down" });
  });
});

describe("every API request", () => {
  it("logs http.request with the route pattern, never the path", async () => {
    const app = createApp(deps);
    const res = await app.request("/api/health/live");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const requestId = res.headers.get("x-request-id");
    const line = deps.logs.find((l) => l.event === "http.request");
    expect(line).toMatchObject({
      level: "info",
      instance: "test-instance",
      method: "GET",
      route: "/api/health/live",
      status: 200,
      requestId,
    });
    expect(typeof line?.durationMs).toBe("number");
  });

  it("answers unknown API paths with a JSON 404", async () => {
    const res = await createApp(deps).request("/api/nope/%3Csecret%40mail.example%3E");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(deps.rawLogs.join("\n")).not.toContain("mail.example");
  });

  it("turns an unexpected error into a plain 500 and an error line without a stack", async () => {
    deps.health.check = async () => {
      throw new Error("db said no for maria@inbox.example");
    };
    const res = await createApp(deps).request("/api/health/ready");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal", message: "Something went wrong" });
    const line = deps.logs.find((l) => l.event === "http.error");
    expect(line).toMatchObject({ level: "error", error: { name: "Error" } });
    expect(JSON.stringify(line)).not.toContain("inbox.example");
    expect(JSON.stringify(line)).not.toContain("stack");
  });
});
