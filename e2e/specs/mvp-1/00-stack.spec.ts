import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

// The stack itself, before any scenario: the proxy serves the app, and each replica is ready on
// its direct port (docs/mvp/README.md › The test stack). And the specs themselves: every scenario
// of docs/mvp/MVP-1.md has its spec here, so a run that would only play part of MVP 1 (and leave
// the next MVP without the state it starts from) fails at once instead of skipping.

test("every MVP 1 scenario is codified as a spec", () => {
  const doc = readFileSync(resolve(import.meta.dirname, "../../../docs/mvp/MVP-1.md"), "utf8");
  const scenarios = [...doc.matchAll(/^\| S(\d+) \| \*\*/gm)].map((m) => Number(m[1]));
  expect(scenarios.length).toBeGreaterThan(0);
  const specs = readdirSync(import.meta.dirname);
  const missing = scenarios.filter(
    (n) => !specs.some((name) => name.startsWith(`${String(n).padStart(2, "0")}-s${n}-`)),
  );
  expect(missing.map((n) => `S${n}`)).toEqual([]);
});

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
