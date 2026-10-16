import { expect, type Page, test } from "@playwright/test";
import { openSettingsTab, signIn, withCleanup } from "../shared.ts";

// S8 of docs/mvp/MVP-1.md: the budget stop (F4.4, F4.5, F4.10). Maria's first scan stopped
// confident with likely job mail unread (S3); with a budget of 5, Analyze them stops for budget
// after 5 calls and analyzes some of it. The budget goes back to 300 at the end, and if a step
// fails before that, the cleanup still sets it back so the specs after this one start from 300.

const NOT_ANALYZED = /^(\d+) more likely job emails? not analyzed$/;
const BUDGET = 300;

async function setBudget(page: Page, budget: number) {
  await openSettingsTab(page, "AI");
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
  const nav = page.getByRole("navigation", { name: "Main", exact: true });

  await signIn(page, "maria");
  await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();

  let restored = false;
  await withCleanup(
    async () => {
      await test.step("Maria sets the budget to 5 in Settings › AI", async () => {
        await setBudget(page, 5);
      });

      let before = 0;
      await test.step("Analyze them stops for budget and fewer are left unread", async () => {
        await nav.getByRole("link", { name: "Inbox", exact: true }).click();
        await expect(page.getByText(NOT_ANALYZED)).toBeVisible();
        before = await notAnalyzed(page);
        expect(before).toBeGreaterThan(0);
        await page.getByRole("button", { name: "Analyze them", exact: true }).click();
        await expect(
          page.getByText(/^Stopped: the AI budget for this run was used up after /),
        ).toBeVisible({
          timeout: 3 * 60_000,
        });
        await expect.poll(() => notAnalyzed(page)).toBeLessThan(before);
      });

      await test.step("the scan screen says it stopped after 5 calls", async () => {
        await nav.getByRole("link", { name: "Scan", exact: true }).click();
        await expect(
          page.getByText(/^Stopped: the AI budget for this run was used up after /),
        ).toBeVisible();
        const calls = page.getByText("AI calls this run", { exact: true }).locator("xpath=..");
        await expect(calls.getByRole("definition")).toHaveText("5");
        await expect(page.getByRole("button", { name: "Analyze them", exact: true })).toBeVisible();
      });

      await test.step(`the budget goes back to ${BUDGET}`, async () => {
        await setBudget(page, BUDGET);
        restored = true;
      });
    },
    async () => {
      if (!restored) {
        await test.step(`cleanup: the budget goes back to ${BUDGET}`, () =>
          setBudget(page, BUDGET));
      }
    },
  );
});
