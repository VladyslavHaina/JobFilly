import { expect, type Page, test } from "@playwright/test";
import { DIRECT_PORTS, logged, REPLICAS, signIn, workspaceIdOf } from "../shared.ts";

// S3 of docs/mvp/MVP-1.md: the first scan stops when confident (F4.1–F4.7, F3.6). Maria starts
// it from the scan screen; a second view of that screen, opened through the direct port of the
// replica that is not running the scan (the one address besides the start URL the scenario has
// typed), keeps updating too (F4.6).

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

  await signIn(page, "maria");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Scan" }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+\/scan$/);
  const workspaceId = workspaceIdOf(page);

  await test.step("she presses Start scan and the counts change", async () => {
    await page.getByRole("button", { name: "Start scan" }).click();
    await expect(page.getByText("Handled without AI", { exact: true })).toBeVisible();
    await expect
      .poll(() => stat(page, "Handled without AI"), { timeout: 120_000 })
      .toBeGreaterThan(0);
    await expect.poll(() => stat(page, "Analyzed"), { timeout: 120_000 }).toBeGreaterThan(0);
  });

  await test.step("the other replica's direct port shows the scan updating too", async () => {
    await expect
      .poll(() => logged("scan.started", { workspaceId }).length, { timeout: 60_000 })
      .toBe(1);
    const instance = logged("scan.started", { workspaceId })[0]?.instance;
    expect(REPLICAS, `scan.started names a replica: ${instance}`).toContain(instance);
    const other = REPLICAS.find((r) => r !== instance) ?? REPLICAS[0];

    const second = await context.newPage();
    await second.goto(`http://127.0.0.1:${DIRECT_PORTS[other]}/w/${workspaceId}/scan`);
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
