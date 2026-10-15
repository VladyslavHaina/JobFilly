import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RunningServer, startServer } from "./node";

describe("startServer", () => {
  let webDist: string;
  let server: RunningServer;

  beforeAll(async () => {
    webDist = await mkdtemp(join(tmpdir(), "jobfilly-web-"));
    await writeFile(join(webDist, "index.html"), "<!doctype html><title>ui</title>");
    server = await startServer({ hostname: "127.0.0.1", port: 0, version: "test", webDist });
  });

  afterAll(async () => {
    await server.close();
    await rm(webDist, { recursive: true, force: true });
  });

  it("serves the API on a free loopback port", async () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const res = await fetch(`${server.url}/api/health`);
    expect(await res.json()).toEqual({ status: "ok", version: "test" });
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
});
