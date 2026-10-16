import { execFile, execFileSync, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, type Route, test } from "@playwright/test";
import { PERSONA_ADDRESSES } from "../../fixtures/format.ts";
import { COMPOSE_FILE, fileState } from "../../stack.ts";

// S11 of docs/mvp/MVP-1.md: startup, health and shutdown (F7.1, F7.2, F7.4, F7.5), a shell
// scenario on the test stack's compose project. The slow request is a Settings › AI Test that the
// fake AI holds for FAKE_AI_SLOW_TEST_MS (TBD-33: the stateless fake-ai is started again with
// 15000, and with 0 at the end). The proxy picks a replica per request, so the browser's Test
// request and its live-update stream are sent to app-b's direct port while they open: that is
// what "open on app-b" means here. Once app-b is going down, the stream reconnects through the
// proxy. Whatever happens, the scenario leaves Postgres, both replicas and a quick fake AI up.

const LOGIN = "E2E-SECRET-maria-login";
const SLOW_TEST_MS = "15000";
/** Each replica's direct port on the test stack's proxy. */
const DIRECT_PORTS = { "app-a": 8081, "app-b": 8082 } as const;
const PROXY_PORT = 8080;

const ROOT = resolve(import.meta.dirname, "../../..");
/** The running stack's compose project: the one stack.ts passes on, else e2e/.stack's. */
const project = process.env.JOBFILLY_E2E_PROJECT ?? fileState(join(ROOT, "e2e", ".stack")).read();
type LogLine = { event?: unknown; [field: string]: unknown };

function composeArgs(args: string[]): string[] {
  if (!project) throw new Error('No test stack is up: start one with "pnpm e2e:stack up"');
  return ["compose", "-p", project, "-f", COMPOSE_FILE, ...args];
}

function compose(args: string[], env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync("docker", composeArgs(args), {
    cwd: ROOT,
    env,
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
}

function serviceLog(service: string): LogLine[] {
  return compose(["logs", "--no-color", "--no-log-prefix", service])
    .split("\n")
    .flatMap((line) => {
      try {
        return line.startsWith("{") ? [JSON.parse(line) as LogLine] : [];
      } catch {
        return [];
      }
    });
}

async function ready(port: number): Promise<number | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health/ready`, {
      // Longer than the replicas' 5-second database connection timeout.
      signal: AbortSignal.timeout(10_000),
    });
    return response.status;
  } catch {
    return null;
  }
}

const waitReady = (port: number) =>
  expect.poll(() => ready(port), { timeout: 180_000, intervals: [1_000] }).toBe(200);

/** Starts the fake AI again with this extra wait on ai.test.v1, and waits until it listens. */
async function restartFakeAi(slowTestMs: string) {
  compose(["up", "--detach", "--no-deps", "--no-build", "fake-ai"], {
    ...process.env,
    FAKE_AI_SLOW_TEST_MS: slowTestMs,
  });
  await expect
    .poll(() => serviceLog("fake-ai").some((l) => l.event === "fake_ai.ready"), {
      timeout: 60_000,
    })
    .toBe(true);
}

/** Sends a request to app-b's direct port instead of the proxy. */
function toAppB(route: Route) {
  const url = new URL(route.request().url());
  url.port = String(DIRECT_PORTS["app-b"]);
  return route.continue({ url: url.toString() });
}

test("S11: startup, health and shutdown", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  let slowFakeAi = false;

  try {
    await test.step("a container without DATABASE_URL exits with one clear message", async () => {
      const run = spawnSync(
        "docker",
        composeArgs(["run", "--rm", "--no-deps", "-T", "-e", "DATABASE_URL=", "app-a"]),
        { cwd: ROOT, encoding: "utf8", timeout: 120_000 },
      );
      expect(run.status).not.toBe(0);
      expect(`${run.stdout}${run.stderr}`).toContain("DATABASE_URL is required");
    });

    await test.step("both replicas: a non-root user, a read-only root, the configured port", async () => {
      for (const replica of Object.keys(DIRECT_PORTS)) {
        const id = compose(["ps", "--quiet", replica]).trim();
        expect(id, `${replica} runs`).not.toBe("");
        const [info] = JSON.parse(
          execFileSync("docker", ["inspect", id], { encoding: "utf8" }),
        ) as {
          Config: { User: string; Env: string[] };
          HostConfig: { ReadonlyRootfs: boolean; Tmpfs: Record<string, string> | null };
        }[];
        expect(["", "root", "0", "0:0"]).not.toContain(info?.Config.User);
        expect(info?.HostConfig.ReadonlyRootfs).toBe(true);
        expect(Object.keys(info?.HostConfig.Tmpfs ?? {})).toEqual(["/tmp"]);
        const port = info?.Config.Env.find((e) => e.startsWith("PORT="))?.slice("PORT=".length);
        expect(port).toBeDefined();
        expect(port).not.toBe("8787");
      }
      // Each answers on that port: the proxy reaches them there.
      for (const port of Object.values(DIRECT_PORTS)) expect(await ready(port)).toBe(200);
    });

    await test.step("without Postgres a replica isn't ready; with it again, it is", async () => {
      compose(["stop", "postgres"]);
      await expect
        .poll(() => ready(DIRECT_PORTS["app-a"]), { timeout: 60_000, intervals: [1_000] })
        .toBe(503);
      compose(["start", "postgres"]);
      await waitReady(DIRECT_PORTS["app-a"]);
      await waitReady(DIRECT_PORTS["app-b"]);
    });

    await test.step("SIGTERM on app-b with a slow request and a live stream open on it", async () => {
      slowFakeAi = true;
      await restartFakeAi(SLOW_TEST_MS);
      const mark = serviceLog("app-b").length;

      await page.route("**/api/workspaces/*/events", toAppB);
      await page.route("**/api/workspaces/*/ai/test", toAppB);
      await page.goto("/");
      await page.getByLabel("Email").fill(PERSONA_ADDRESSES.maria);
      await page.getByLabel("Password").fill(LOGIN);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page
        .getByRole("navigation", { name: "Main" })
        .getByRole("link", { name: "Settings" })
        .click();
      await page
        .getByRole("navigation", { name: "Settings" })
        .getByRole("link", { name: "AI" })
        .click();

      const sent = page.waitForRequest((r) => r.url().endsWith("/ai/test"));
      await page.getByRole("button", { name: "Test", exact: true }).click();
      await sent;
      await expect(page.getByText("Waiting for the AI to answer…")).toBeVisible();
      // From here on the stream reconnects through the proxy.
      await page.unroute("**/api/workspaces/*/events");
      const reconnected = page.waitForResponse(
        (r) => /\/api\/workspaces\/[^/]+\/events$/.test(new URL(r.url()).pathname) && r.ok(),
        { timeout: 90_000 },
      );

      const stopped = promisify(execFile)("docker", composeArgs(["stop", "app-b"]), { cwd: ROOT });
      // The request in flight on app-b completes.
      await expect(page.getByText("Test succeeded: the AI answered.")).toBeVisible({
        timeout: 40_000,
      });
      await stopped;
      await reconnected;
      await page.unroute("**/api/workspaces/*/ai/test");

      const id = compose(["ps", "--all", "--quiet", "app-b"]).trim();
      const exit = execFileSync("docker", ["inspect", "--format", "{{.State.ExitCode}}", id], {
        encoding: "utf8",
      });
      expect(exit.trim()).toBe("0");
      const events = serviceLog("app-b")
        .slice(mark)
        .map((l) => l.event);
      expect(events).toContain("server.shutting_down");
    });

    await test.step("app-b starts again", async () => {
      compose(["start", "app-b"]);
      await waitReady(DIRECT_PORTS["app-b"]);
      await waitReady(PROXY_PORT);
    });
  } finally {
    compose(["start", "postgres", "app-a", "app-b"]);
    if (slowFakeAi) await restartFakeAi("0");
  }
});
