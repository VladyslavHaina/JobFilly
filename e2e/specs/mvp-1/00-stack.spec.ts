import { expect, test } from "@playwright/test";

// The stack itself, before any scenario: the proxy serves the app, and each replica is ready on
// its direct port (docs/mvp/README.md › The test stack).

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
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect(problems).toEqual([]);
});

for (const [replica, port] of [
  ["app-a", 8081],
  ["app-b", 8082],
] as const) {
  test(`${replica} answers ready on its direct port :${port}`, async ({ request }) => {
    const response = await request.get(`http://127.0.0.1:${port}/api/health/ready`);
    expect(response.status()).toBe(200);
  });
}
