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
import { AI_KEY, FAKE_AI_URL, INTAKE_LABELS, openSettingsTab, signIn } from "../shared.ts";

// S7 of docs/mvp/MVP-1.md: Tom's thin inbox (F2.5, F4.4, F6.6), in his own workspace. The two
// answers he fills in are his own words (docs/mvp/MVP-1.md › Personas): no mail of his says them.
// The test stack's imap service speaks plain-text IMAP on 3143 (docker/compose.e2e.yaml).
// MVP 3 replaces MVP 1's one-mailbox limit (docs/mvp/MVP-3.md › Replaces from earlier MVPs, S13),
// so this spec no longer checks that a second mailbox can't be added; Tom still connects,
// disconnects and connects again.

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
  await page.getByRole("button", { name: "Test connection", exact: true }).click();
  await expect(page.getByText("Connected: Inbox, Sent")).toBeVisible();
}

/** Tom's mailbox card in Settings › Mailbox: the card headed by his address. */
function tomsMailbox(page: Page) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: PERSONA_ADDRESSES.tom, exact: true }) });
}

test("S7: Tom's thin inbox", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const nav = page.getByRole("navigation", { name: "Main", exact: true });

  await signIn(page, "tom");
  await expect(
    page.getByRole("heading", { name: "Connect your mailbox", level: 1, exact: true }),
  ).toBeVisible();
  await expect(page.getByText("in Tom Okafor's workspace")).toBeVisible();

  await test.step("Tom connects his mailbox", async () => {
    await fillMailbox(page);
    await page.getByRole("button", { name: "Save and continue", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Pick your AI", level: 1, exact: true }),
    ).toBeVisible();
  });

  await test.step("disconnects it and connects it again", async () => {
    await openSettingsTab(page, "Mailbox");
    const card = tomsMailbox(page);
    await expect(card).toHaveCount(1);
    // Disconnect, then its confirmation ("Disconnect and delete its data", which may name the
    // address): one button starting "Disconnect" at a time.
    const disconnect = card.getByRole("button", { name: /^Disconnect/ });
    await disconnect.click();
    await expect(card.getByRole("button", { name: "Keep it", exact: true })).toBeVisible();
    await disconnect.click();
    await expect(card).toHaveCount(0);
    await expect(page.getByLabel("Mail provider")).toBeVisible();
    await fillMailbox(page);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(card).toHaveCount(1);
  });

  await test.step("sets up the AI in his own workspace", async () => {
    await openSettingsTab(page, "AI");
    await page.getByLabel("AI provider").selectOption({ label: "OpenAI-compatible endpoint" });
    await page.getByLabel("Base URL").fill(FAKE_AI_URL);
    await page.getByLabel("API key (optional)").fill(AI_KEY);
    await page.getByRole("button", { name: "Test", exact: true }).click();
    await expect(page.getByText("Test succeeded: the AI answered.")).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  });

  await test.step("the scan stops with done", async () => {
    await nav.getByRole("link", { name: "Scan", exact: true }).click();
    await page.getByRole("button", { name: "Start scan", exact: true }).click();
    await expect(page.getByText(/^Stopped: done, /)).toBeVisible({ timeout: 5 * 60_000 });
  });

  const card = (key: CoreKey) =>
    page.getByRole("region", { name: INTAKE_LABELS[key], exact: true });
  await test.step("the intake form says “Not enough evidence” where his mail says nothing", async () => {
    await page.getByRole("link", { name: "Review your answers", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your job search", exact: true })).toBeVisible();
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
      await expect(
        card(key).getByRole("button", { name: `Remove ${value}`, exact: true }),
      ).toBeVisible();
      await expect(card(key).getByText("Set by you")).toBeVisible();
    }
    const confirm = page.getByRole("button", { name: "Confirm", exact: true });
    await expect(confirm).toBeEnabled({ timeout: 60_000 });
    await confirm.click();
    await expect(
      page.getByRole("heading", { name: "My job search", level: 1, exact: true }),
    ).toBeVisible();
    for (const { key, value } of FILLED) {
      await expect(card(key).getByText("Set by you", { exact: true })).toBeVisible();
      await expect(
        card(key).getByRole("button", { name: `Remove ${value}`, exact: true }),
      ).toBeVisible();
    }
  });
});
