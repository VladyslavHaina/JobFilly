import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { PERSONA_ADDRESSES } from "../../fixtures/format.ts";
import { COMPOSE_FILE, fileState } from "../../stack.ts";

// S3 of docs/mvp/MVP-1.md: the first scan stops when confident (F4.1–F4.7, F3.6). Maria starts
// it from the scan screen; a second view of that screen, opened through the direct port of the
// replica that is not running the scan, keeps updating too (F4.6).

const LOGIN = "E2E-SECRET-maria-login";
/** Each replica's direct port on the test stack's proxy, for read-only views. */
const DIRECT_PORTS: Record<string, number> = { "app-a": 8081, "app-b": 8082 };

const ROOT = resolve(import.meta.dirname, "../../..");
/** The running stack's compose project: the one stack.ts passes on, else e2e/.stack's. */
const project = process.env.JOBFILLY_E2E_PROJECT ?? fileState(join(ROOT, "e2e", ".stack")).read();
const REPLICAS = ["app-a", "app-b"];
type LogLine = { event?: unknown; instance?: unknown; [field: string]: unknown };

function replicaLog(replica: string): LogLine[] {
  if (!project) throw new Error('No test stack is up: start one with "pnpm e2e:stack up"');
  const args = ["compose", "-p", project, "-f", COMPOSE_FILE, "logs", "--no-color"];
  const out = execFileSync("docker", [...args, "--no-log-prefix", replica], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  return out.split("\n").flatMap((line) => {
    try {
      return line.startsWith("{") ? [JSON.parse(line) as LogLine] : [];
    } catch {
      return [];
    }
  });
}

/** Every line both replicas logged with this event and these fields. */
const logged = (event: string, fields: Record<string, unknown>) =>
  REPLICAS.flatMap(replicaLog).filter(
    (l) => l.event === event && Object.entries(fields).every(([k, v]) => l[k] === v),
  );

const STOPPED_CONFIDENT = /^Stopped: confident after (\d+) of (\d+) likely job emails?$/;

/** A number on the scan screen, by its label. */
async function stat(page: Page, label: string): Promise<number> {
  const value = page.getByText(label, { exact: true }).locator("xpath=..").getByRole("definition");
  return Number((await value.innerText()).replace(/\D/g, ""));
}

const analyzed = (page: Page) =>
  page
    .getByRole("progressbar", { name: "Likely job emails analyzed" })
    .getAttribute("aria-valuenow");

test("S3: the first scan stops when confident", async ({ page, context }) => {
  test.setTimeout(15 * 60_000);

  await page.goto("/");
  await page.getByLabel("Email").fill(PERSONA_ADDRESSES.maria);
  await page.getByLabel("Password").fill(LOGIN);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Scan" }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+\/scan$/);
  const workspaceId = new URL(page.url()).pathname.split("/")[2] ?? "";

  await test.step("she presses Start scan and the counts change", async () => {
    await page.getByRole("button", { name: "Start scan" }).click();
    await expect(page.getByText("Handled without AI", { exact: true })).toBeVisible();
    await expect
      .poll(() => stat(page, "Handled without AI"), { timeout: 120_000 })
      .toBeGreaterThan(0);
    await expect.poll(() => stat(page, "Analyzed"), { timeout: 120_000 }).toBeGreaterThan(0);
  });

  let instance = "";
  await test.step("the other replica's direct port shows the scan updating too", async () => {
    await expect
      .poll(() => logged("scan.started", { workspaceId }).length, { timeout: 60_000 })
      .toBe(1);
    instance = String(logged("scan.started", { workspaceId })[0]?.instance);
    const other = REPLICAS.find((r) => r !== instance);
    expect(other, `scan.started names a replica: ${instance}`).toBeDefined();

    const second = await context.newPage();
    await second.goto(`http://127.0.0.1:${DIRECT_PORTS[other ?? ""]}/w/${workspaceId}/scan`);
    await expect(
      second.getByRole("progressbar", { name: "Likely job emails analyzed" }),
    ).toBeVisible();
    // Both views move on without a reload, until the scan stops.
    for (const view of [page, second]) {
      const before = Number(await analyzed(view));
      await expect
        .poll(
          async () =>
            Number(await analyzed(view)) > before ||
            (await view.getByText(/^Stopped: /).count()) > 0,
          { timeout: 60_000 },
        )
        .toBe(true);
    }

    for (const view of [page, second]) {
      await expect(view.getByText(STOPPED_CONFIDENT)).toBeVisible({ timeout: 10 * 60_000 });
    }
    await second.close();
  });

  await test.step("it stopped as confident with likely job emails left unread", async () => {
    const message = await page.getByText(STOPPED_CONFIDENT).innerText();
    const [, read, likely] = STOPPED_CONFIDENT.exec(message) ?? [];
    expect(Number(read)).toBeGreaterThan(0);
    expect(Number(read)).toBeLessThan(Number(likely));
    expect(await stat(page, "Not analyzed yet")).toBeGreaterThan(0);
    expect(await stat(page, "Job emails found")).toBeGreaterThan(0);
    expect(await stat(page, "Answers firming up")).toBeGreaterThan(0);
    // F3.6: the scan screen shows the workspace's token total.
    expect(await stat(page, "Tokens used in total")).toBeGreaterThan(0);
    await expect(page.getByRole("link", { name: "Review your answers" })).toBeVisible();
  });

  await test.step("logs: one scan.started across both replicas, a line per batch", async () => {
    const started = logged("scan.started", { workspaceId });
    expect(started).toHaveLength(1);
    const scanId = started[0]?.scanId;
    expect(logged("scan.batch_completed", { scanId }).length).toBeGreaterThan(0);
    await expect.poll(() => logged("scan.stopped", { scanId, reason: "confident" }).length).toBe(1);
  });
});
