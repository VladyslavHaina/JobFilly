import { expect, type Locator, type Page, test } from "@playwright/test";
import { MARIA_PROFILES } from "../../fixtures/format-mvp3.ts";
import {
  delivery,
  errorsSince,
  inboxRow,
  logMark,
  logSince,
  openPage,
  showHidden,
  showProfile,
  signIn,
  workspaceIdOf,
} from "../shared.ts";

// S3 of MVP 3: editing by hand (F2.1–F2.3). On her first profile Maria makes a rule
// by hand: hide roles whose working hours are UTC+5 or later (UTC+05:00 to UTC+14:00, the
// largest offset). A profile's rule applies to the roles assigned to it, and hide means hidden
//: the three Asia-Pacific roles (UTC+8, UTC+8, UTC+10), all remote and so with her first
// profile, go under Hidden. Each change says at once how many of the profile's roles it changes
// (F2.3). Then she narrows the range to UTC+6, sets the reply threshold (shown at its
// default, 70) to 80, switches the rule off, and undoes that last change, so the rule is on
// again. The rule's words are built from its conditions; she leaves "In your words" empty.

const FIRST = MARIA_PROFILES.first;
const APAC = ["apac-1", "apac-2", "apac-3"].map(delivery);
const RULE_5 = "Hide roles whose hours are within UTC+5 to UTC+14";
const RULE_6 = "Hide roles whose hours are within UTC+6 to UTC+14";
const THRESHOLD = "Fit score that gets an automatic reply";
const CHANGES_3 = "Saved. It changes 3 roles; your inbox shows them within a minute.";
const CHANGES_NONE = "Saved. It changes none of your current roles.";
const SAID_HOW_MANY =
  /^Saved\. It changes (none of your current roles\.|\d+ roles?; your inbox shows (it|them) within a minute\.)$/;

/** The Rules card of the profile page. */
const rulesCard = (page: Page): Locator =>
  page
    .getByRole("heading", { name: "Rules", level: 2, exact: true })
    .locator("xpath=ancestor::section[1]");

/** What the Rules card says its last change did (F2.3). */
const ruleSaid = (page: Page): Locator =>
  rulesCard(page)
    .getByRole("status")
    .filter({ hasText: /^Saved\./ });

/** The rule's row in the Rules list. */
const ruleRow = (page: Page, rule: string): Locator =>
  page
    .getByRole("list", { name: "Rules", exact: true })
    .getByRole("listitem")
    .filter({ has: page.getByText(rule, { exact: true }) });

const historyEntries = (page: Page): Locator =>
  page.getByRole("list", { name: "Profile history", exact: true }).locator(":scope > li");

/**
 * The inbox under Hidden: the three Asia-Pacific roles, each with the rule that hides it, or
 * nothing at all. Waits up to a minute, the time a change has to re-evaluate the roles (F2.3).
 */
async function expectHidden(page: Page, rule: string | null) {
  await openPage(page, "Inbox");
  await page.getByLabel("Search sender or subject").fill("");
  await showHidden(page, true);
  if (rule) {
    for (const d of APAC) {
      const row = inboxRow(page, d.subject).filter({ hasText: d.from.name ?? d.from.address });
      await expect(row).toContainText(`Hidden by your rule "${rule}"`, { timeout: 60_000 });
    }
  } else {
    await expect(page.getByText("No messages match.", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
  }
  await showHidden(page, false);
}

test("S3: editing by hand", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const mark = logMark();
  await signIn(page, "maria");
  await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
  const workspaceId = workspaceIdOf(page);

  await test.step("nothing is hidden before the rule", async () => {
    await expectHidden(page, null);
  });

  await test.step("she makes a rule by hand: hide roles on UTC+5 or later; it says 3 roles", async () => {
    await showProfile(page, FIRST);
    await rulesCard(page).getByRole("button", { name: "Add a rule", exact: true }).click();
    const form = page.getByRole("form", { name: "New rule", exact: true });
    // A new rule starts with nothing picked.
    await expect(form.getByRole("combobox", { name: "Fact", exact: true })).toHaveValue("");
    await form
      .getByRole("combobox", { name: "Fact", exact: true })
      .selectOption({ label: "Working hours (UTC offsets)" });
    await form
      .getByRole("combobox", { name: "Compared", exact: true })
      .selectOption({ label: "is within" });
    await form.getByRole("textbox", { name: "From", exact: true }).fill("UTC+05:00");
    await form.getByRole("textbox", { name: "To", exact: true }).fill("UTC+14:00");
    await form
      .getByRole("combobox", { name: "Then", exact: true })
      .selectOption({ label: "Hide the role" });
    await form.getByRole("button", { name: "Save rule", exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(ruleSaid(page)).toHaveText(CHANGES_3);
    await expect(ruleRow(page, RULE_5)).toContainText("Added by you");
  });

  await test.step("within a minute the Asia-Pacific roles are under Hidden, named by the rule", async () => {
    await expectHidden(page, RULE_5);
  });

  await test.step("she changes its range to UTC+6 or later; it says none changed", async () => {
    await showProfile(page, FIRST);
    await ruleRow(page, RULE_5)
      .getByRole("button", { name: `Change the rule "${RULE_5}"`, exact: true })
      .click();
    const form = page.getByRole("form", { name: "Change the rule", exact: true });
    await expect(form.getByRole("textbox", { name: "From", exact: true })).toHaveValue("UTC+05:00");
    await form.getByRole("textbox", { name: "From", exact: true }).fill("UTC+06:00");
    // Her words are the old range's: left empty, the rule is worded from its conditions again.
    await form.getByRole("textbox", { name: "In your words (optional)", exact: true }).fill("");
    await form.getByRole("button", { name: "Save rule", exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(ruleSaid(page)).toHaveText(CHANGES_NONE);
    await expect(ruleRow(page, RULE_6)).toBeVisible();
    await expect(ruleRow(page, RULE_5)).toHaveCount(0);
  });

  await test.step("the same roles stay hidden, by the changed rule", async () => {
    await expectHidden(page, RULE_6);
  });

  await test.step("she changes the reply threshold from its default 70 to 80", async () => {
    await showProfile(page, FIRST);
    const entry = page.getByRole("region", { name: THRESHOLD, exact: true });
    await expect(entry).toContainText("Default");
    const field = entry.getByRole("spinbutton", { name: THRESHOLD, exact: true });
    await expect(field).toHaveValue("70");
    // Said above the profile's entries, once the change is saved.
    const said = page.getByRole("status").filter({ hasText: SAID_HOW_MANY });
    await expect(said).toHaveCount(0);
    await field.fill("80");
    await entry.getByRole("button", { name: "Save", exact: true }).click();
    await expect(said).toHaveCount(1);
    await expect(entry.getByText("Set by you", { exact: true })).toBeVisible();
    await expect(entry.getByRole("spinbutton", { name: THRESHOLD, exact: true })).toHaveValue("80");
  });

  const toggle = page.getByRole("switch", { name: `Use the rule "${RULE_6}"`, exact: true });
  await test.step("she switches the rule off: it says 3 roles, and nothing is hidden", async () => {
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(ruleRow(page, RULE_6)).toContainText("Added by you · Off");
    await expect(ruleSaid(page)).toHaveText(CHANGES_3);
    await expectHidden(page, null);
  });

  const switchedOff = historyEntries(page).filter({
    hasText: `Rule: ${RULE_6} → ${RULE_6} (off)`,
  });
  await test.step("Undo of the last change turns the rule back on", async () => {
    await showProfile(page, FIRST);
    await expect(historyEntries(page).first()).toContainText(`Rule: ${RULE_6} → ${RULE_6} (off)`);
    await historyEntries(page).first().getByRole("button", { name: "Undo", exact: true }).click();
    await expect(switchedOff.getByText("Undone", { exact: true })).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expectHidden(page, RULE_6);
  });

  await test.step("the profile history lists every change, by hand, with who made it", async () => {
    await showProfile(page, FIRST);
    const changes = [
      `Rule: ${RULE_6} (off) → ${RULE_6}`,
      `Rule: ${RULE_6} → ${RULE_6} (off)`,
      new RegExp(`${THRESHOLD}: (not set|70) → 80`),
      `Rule: ${RULE_5} → ${RULE_6}`,
      `Rule: no such rule → ${RULE_5}`,
    ];
    // Newest first: the undo's own change on top.
    for (const [i, line] of changes.entries()) {
      const entry = historyEntries(page).nth(i);
      await expect(entry).toContainText(line);
      await expect(entry).toContainText("Maria Santos");
      await expect(entry).toContainText("By hand");
    }
  });

  await test.step("logs: profile.updated, rule.applied, profile.change_undone, no errors", async () => {
    const mine = logSince(mark).filter((l) => l.workspaceId === workspaceId);
    expect(mine.some((l) => l.event === "profile.updated")).toBe(true);
    expect(mine.some((l) => l.event === "rule.applied" && l.action === "hide")).toBe(true);
    expect(mine.some((l) => l.event === "profile.change_undone")).toBe(true);
    expect(errorsSince(mark)).toEqual([]);
  });
});
