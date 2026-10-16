import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const key = Buffer.alloc(32, 7).toString("base64");
const valid = {
  DATABASE_URL: "postgres://jobfilly:pw@postgres:5432/jobfilly",
  JOBFILLY_SECRET_KEY: key,
  PUBLIC_URL: "http://127.0.0.1:8080",
};

function message(env: Record<string, string | undefined>) {
  const result = loadConfig(env, "test-host");
  if (result.ok) throw new Error("expected a failure");
  return result.message;
}

describe("loadConfig", () => {
  it("reads every variable with its default", () => {
    const result = loadConfig(valid, "app-a");
    if (!result.ok) throw new Error(result.message);
    expect(result.config).toMatchObject({
      databaseUrl: valid.DATABASE_URL,
      origin: "http://127.0.0.1:8080",
      secureCookies: false,
      host: "127.0.0.1",
      port: 8787,
      webDist: undefined,
      logLevel: "info",
      syncIntervalSeconds: 120,
      rdapUrl: "https://rdap.org",
      allowInsecureMail: false,
      instance: "app-a",
    });
    expect(Buffer.from(result.config.secretKey).toString("base64")).toBe(key);
  });

  it("reads the optional ones when set", () => {
    const result = loadConfig({
      ...valid,
      PUBLIC_URL: "https://jobfilly.home.lan/",
      HOST: "0.0.0.0",
      PORT: "9000",
      WEB_DIST: "/app/web",
      LOG_LEVEL: "debug",
      JOBFILLY_SYNC_INTERVAL_SECONDS: "60",
      JOBFILLY_RDAP_URL: "http://rdap:8080",
      JOBFILLY_ALLOW_INSECURE_MAIL: "true",
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.config).toMatchObject({
      origin: "https://jobfilly.home.lan",
      secureCookies: true,
      host: "0.0.0.0",
      port: 9000,
      webDist: "/app/web",
      logLevel: "debug",
      syncIntervalSeconds: 60,
      rdapUrl: "http://rdap:8080",
      allowInsecureMail: true,
    });
  });

  it("says which required variable is missing, one at a time", () => {
    expect(message({ ...valid, DATABASE_URL: undefined })).toBe("DATABASE_URL is required");
    expect(message({ ...valid, DATABASE_URL: "" })).toBe("DATABASE_URL is required");
    expect(message({ ...valid, JOBFILLY_SECRET_KEY: undefined })).toBe(
      "JOBFILLY_SECRET_KEY is required",
    );
    expect(message({ ...valid, PUBLIC_URL: undefined })).toBe("PUBLIC_URL is required");
    expect(message({})).toBe("DATABASE_URL is required");
  });

  it("says plainly what is wrong with an invalid value", () => {
    expect(message({ ...valid, DATABASE_URL: "mysql://x" })).toBe(
      "DATABASE_URL must be a postgres:// connection string",
    );
    expect(message({ ...valid, JOBFILLY_SECRET_KEY: "c2hvcnQ=" })).toMatch(
      /^JOBFILLY_SECRET_KEY must be 32 bytes, base64-encoded/,
    );
    expect(message({ ...valid, PUBLIC_URL: "jobfilly.lan" })).toMatch(/^PUBLIC_URL must be a URL/);
    expect(message({ ...valid, PUBLIC_URL: "ftp://x" })).toBe(
      "PUBLIC_URL must start with http:// or https://",
    );
    expect(message({ ...valid, PORT: "http" })).toBe("PORT must be a whole number from 0 to 65535");
    expect(message({ ...valid, LOG_LEVEL: "loud" })).toBe(
      "LOG_LEVEL must be one of debug, info, warn, error",
    );
    expect(message({ ...valid, JOBFILLY_ALLOW_INSECURE_MAIL: "yes" })).toBe(
      'JOBFILLY_ALLOW_INSECURE_MAIL must be "true" or "false"',
    );
    expect(message({ ...valid, JOBFILLY_SYNC_INTERVAL_SECONDS: "0" })).toBe(
      "JOBFILLY_SYNC_INTERVAL_SECONDS must be a positive whole number",
    );
  });
});

describe("starting the server without configuration", () => {
  // Starting tsx and loading the server's modules takes a second on a quiet machine but took over
  // 20 seconds on one shared with other builds, and a child killed at its timeout exits 143, not
  // 1. So the child gets 90 seconds, and the test, which only waits for it, more than that.
  it("exits non-zero with one clear JSON line", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const result = spawnSync(
      process.execPath,
      [join(root, "node_modules/tsx/dist/cli.mjs"), join(root, "src/index.ts")],
      { env: { PATH: process.env.PATH ?? "" }, encoding: "utf8", timeout: 90_000 },
    );
    expect(result.error, "the server didn't exit within 90 seconds").toBeUndefined();
    expect(result.status).toBe(1);
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      level: "fatal",
      event: "config.invalid",
      message: "DATABASE_URL is required",
    });
  }, 120_000);
});
