import { expect, type Page, test } from "@playwright/test";
import {
  CORE_KEYS,
  type CoreKey,
  type ExpectedFile,
  fixturesDir,
  PERSONA_ADDRESSES,
  personaPaths,
  readJson,
} from "../../fixtures/format.ts";
import { ACCOUNTS } from "../../seed/accounts.ts";
import { AI_KEY, FAKE_AI_URL, INTAKE_LABELS, signIn } from "../shared.ts";

// S7 of docs/mvp/MVP-1.md: Tom's thin inbox (F2.5, F4.4, F6.6), in his own workspace. The two
// answers he fills in are his own words (docs/mvp/MVP-1.md › Personas): no mail of his says them.
// The test stack's imap service speaks plain-text IMAP on 3143 (docker/compose.e2e.yaml).

const FILLED: { key: CoreKey; value: string }[] = [
  { key: "target_roles", value: "Band 6 nurse" },
  { key: "languages", value: "English" },
];

const expected = readJson<ExpectedFile>(`${fixturesDir()}${personaPaths("tom").expected}`);

/** Fills the mailbox form with Tom's test mailbox and tests it. */
async function fillMailbox(page: Page) {
  await page.getByLabel("Mail provider").selectOption({ label: "Other IMAP" });
  await page.getByLabel("Email address").fill(PERSONA_ADDRESSES.tom);
  await page.getByLabel("IMAP server").fill("imap");
  await page.getByLabel("Port").fill("3143");
  await page.getByLabel("Security").selectOption({ label: "None (plain text)" });
  await page.getByLabel("Password", { exact: true }).fill(ACCOUNTS.tom.password);
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText("Connected: Inbox, Sent")).toBeVisible();
}

/** The connected mailbox, with no way to add another one (one per workspace until MVP 3). */
async function expectOneMailbox(page: Page) {
  await expect(page.getByRole("heading", { name: "Connected mailbox" })).toBeVisible();
  await expect(page.getByText(PERSONA_ADDRESSES.tom)).toBeVisible();
  await expect(page.getByText("A workspace has one mailbox.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Mail provider")).toHaveCount(0);
}

test("S7: Tom's thin inbox", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const nav = page.getByRole("navigation", { name: "Main" });

  await signIn(page, "tom");
  await expect(page.getByRole("heading", { name: "Connect your mailbox", level: 1 })).toBeVisible();
  await expect(page.getByText("in Tom's workspace")).toBeVisible();

  await test.step("Tom connects his mailbox", async () => {
    await fillMailbox(page);
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.getByRole("heading", { name: "Pick your AI", level: 1 })).toBeVisible();
  });

  await test.step("disconnects it and connects it again; never a second one", async () => {
    await nav.getByRole("link", { name: "Settings" }).click();
    await expectOneMailbox(page);
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await page.getByRole("button", { name: "Disconnect and delete the stored password" }).click();
    await expect(page.getByLabel("Mail provider")).toBeVisible();
    await fillMailbox(page);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expectOneMailbox(page);
  });

  await test.step("sets up the AI in his own workspace", async () => {
    await page
      .getByRole("navigation", { name: "Settings" })
      .getByRole("link", { name: "AI" })
      .click();
    await page.getByLabel("AI provider").selectOption({ label: "OpenAI-compatible endpoint" });
    await page.getByLabel("Base URL").fill(FAKE_AI_URL);
    await page.getByLabel("API key (optional)").fill(AI_KEY);
    await page.getByRole("button", { name: "Test", exact: true }).click();
    await expect(page.getByText("Test succeeded: the AI answered.")).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  });

  await test.step("the scan stops with done", async () => {
    await nav.getByRole("link", { name: "Scan" }).click();
    await page.getByRole("button", { name: "Start scan" }).click();
    await expect(page.getByText(/^Stopped: done, /)).toBeVisible({ timeout: 5 * 60_000 });
  });

  const card = (key: CoreKey) =>
    page.getByRole("region", { name: INTAKE_LABELS[key], exact: true });
  await test.step("the intake form says “Not enough evidence” where his mail says nothing", async () => {
    await page.getByRole("link", { name: "Review your answers" }).click();
    await expect(page.getByRole("heading", { name: "Your job search" })).toBeVisible();
    const empty = CORE_KEYS.filter((key) => expected.profile.answers[key].values.length === 0);
    expect(empty.length).toBeGreaterThanOrEqual(FILLED.length);
    for (const key of empty) {
      await expect(card(key).getByText("Not enough evidence")).toBeVisible();
    }
  });

  await test.step("he fills two answers and confirms", async () => {
    for (const { key, value } of FILLED) {
      const label = INTAKE_LABELS[key].toLowerCase();
      await card(key)
        .getByRole("textbox", { name: `Add to ${label}`, exact: true })
        .fill(value);
      await card(key).getByRole("button", { name: "Add", exact: true }).click();
      await expect(card(key).getByRole("button", { name: `Remove ${value}` })).toBeVisible();
      await expect(card(key).getByText("Set by you")).toBeVisible();
    }
    const confirm = page.getByRole("button", { name: "Confirm" });
    await expect(confirm).toBeEnabled({ timeout: 60_000 });
    await confirm.click();
    await expect(page.getByRole("heading", { name: "My job search", level: 1 })).toBeVisible();
    for (const { key, value } of FILLED) {
      await expect(card(key).getByText("Set by you", { exact: true })).toBeVisible();
      await expect(card(key).getByRole("button", { name: `Remove ${value}` })).toBeVisible();
    }
  });
});
