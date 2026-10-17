import { expect, test } from "@playwright/test";
import { DIRECT_PORTS, REPLICAS } from "../shared.ts";

// The stack itself, before any scenario: the proxy serves the app, and each replica is ready on
// its direct port. That every MVP 1 scenario has its spec here is checked by e2e/stack.test.ts,
// in pnpm check.

test("the start page loads through the proxy", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`);
  });
  page.on("requestfailed", (request) => problems.push(`failed: ${request.url()}`));

  await page.goto("/");

  await expect(page).toHaveTitle("JobFilly");
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  expect(problems).toEqual([]);
});

for (const replica of REPLICAS) {
  const port = DIRECT_PORTS[replica];
  test(`${replica} answers ready on its direct port :${port}`, async ({ request }) => {
    const response = await request.get(`http://127.0.0.1:${port}/api/health/ready`);
    expect(response.status()).toBe(200);
  });
}
