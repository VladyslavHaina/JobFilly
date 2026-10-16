import { execFile, execFileSync, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { expect, type Route, test } from "@playwright/test";
import {
  compose,
  composeArgs,
  DIRECT_PORTS,
  PROXY_PORT,
  REPLICAS,
  ROOT,
  ready,
  serviceLog,
  signIn,
  withCleanup,
} from "../shared.ts";

// S11 of docs/mvp/MVP-1.md: startup, health and shutdown (F7.1, F7.2, F7.4, F7.5), a shell
// scenario on the test stack's compose project. The slow request is a Settings › AI Test that the
// fake AI holds for FAKE_AI_SLOW_TEST_MS (TBD-33: the stateless fake-ai is started again with
// 15000, and with 0 at the end). The proxy picks a replica per request, so the browser's Test
// request and its live-update stream are sent to app-b's direct port while they open: that is
// what "open on app-b" means here. Once app-b is going down, the stream reconnects through the
// proxy. Whatever happens, the cleanup leaves Postgres, both replicas and a quick fake AI up and
// ready, the state MVP 2's specs start from.

const SLOW_TEST_MS = "15000";

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

  await withCleanup(
    async () => {
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
        for (const replica of REPLICAS) {
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
        for (const replica of REPLICAS) expect(await ready(DIRECT_PORTS[replica])).toBe(200);
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
        await signIn(page, "maria");
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

        const stopped = promisify(execFile)("docker", composeArgs(["stop", "app-b"]), {
          cwd: ROOT,
        });
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
    },
    async () => {
      compose(["start", "postgres", ...REPLICAS]);
      if (slowFakeAi) await restartFakeAi("0");
      for (const replica of REPLICAS) await waitReady(DIRECT_PORTS[replica]);
      await waitReady(PROXY_PORT);
    },
  );
});
