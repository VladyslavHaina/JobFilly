import { expect, type Page, test } from "@playwright/test";
import { PERSONA_ADDRESSES } from "../../fixtures/format.ts";

// S8 of docs/mvp/MVP-1.md: the budget stop (F4.4, F4.5, F4.10). Maria's first scan stopped
// confident with likely job mail unread (S3); with a budget of 5, Analyze them stops for budget
// after 5 calls and analyzes some of it. The budget goes back to 300 at the end.

const LOGIN = "E2E-SECRET-maria-login";
const NOT_ANALYZED = /^(\d+) more likely job emails? not analyzed$/;

async function setBudget(page: Page, budget: number) {
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Settings" })
    .click();
  await page
    .getByRole("navigation", { name: "Settings" })
    .getByRole("link", { name: "AI" })
    .click();
  const field = page.getByLabel("Model calls per scan run");
  await field.fill(String(budget));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await expect(field).toHaveValue(String(budget));
}

async function notAnalyzed(page: Page): Promise<number> {
  const text = await page.getByText(NOT_ANALYZED).innerText();
  return Number(NOT_ANALYZED.exec(text)?.[1]);
}

test("S8: budget stop", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const nav = page.getByRole("navigation", { name: "Main" });

  await page.goto("/");
  await page.getByLabel("Email").fill(PERSONA_ADDRESSES.maria);
  await page.getByLabel("Password").fill(LOGIN);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Job inbox" })).toBeVisible();

  await test.step("Maria sets the budget to 5 in Settings › AI", async () => {
    await setBudget(page, 5);
  });

  let before = 0;
  await test.step("Analyze them stops for budget and fewer are left unread", async () => {
    await nav.getByRole("link", { name: "Inbox" }).click();
    await expect(page.getByText(NOT_ANALYZED)).toBeVisible();
    before = await notAnalyzed(page);
    expect(before).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Analyze them" }).click();
    await expect(
      page.getByText(/^Stopped: the AI budget for this run was used up after /),
    ).toBeVisible({
      timeout: 3 * 60_000,
    });
    await expect.poll(() => notAnalyzed(page)).toBeLessThan(before);
  });

  await test.step("the scan screen says it stopped after 5 calls", async () => {
    await nav.getByRole("link", { name: "Scan" }).click();
    await expect(
      page.getByText(/^Stopped: the AI budget for this run was used up after /),
    ).toBeVisible();
    const calls = page.getByText("AI calls this run", { exact: true }).locator("xpath=..");
    await expect(calls.getByRole("definition")).toHaveText("5");
    await expect(page.getByRole("button", { name: "Analyze them" })).toBeVisible();
  });

  await test.step("the budget goes back to 300", async () => {
    await setBudget(page, 300);
  });
});
