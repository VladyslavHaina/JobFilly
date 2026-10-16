import { expect, type Page, test } from "@playwright/test";
import {
  askAssistant,
  delivery,
  errorsSince,
  inboxRow,
  inspectDrafts,
  logMark,
  logSince,
  openAssistant,
  openMessage,
  openPage,
  repliesTo,
  roleParts,
  signIn,
  workspaceIdOf,
} from "../shared.ts";

// S8 of docs/mvp/MVP-2.md: the assistant and time zones (F8.1–F8.5, F8.9, F3.1–F3.5). The fake
// AI proposes a rule hiding roles on UTC+5 to UTC+14; Maria edits the range to start at UTC+4
// before applying it. A rule's words are built from its conditions (owner decision): "Hide roles
// whose hours are within UTC+4 to UTC+14". Three delivered roles are on Asia-Pacific hours (UTC+8,
// UTC+8, UTC+10); the first has a draft in the mailbox, which the change leaves there. Switching
// the rule off shows them again, Undo of the switch turns it back on (the walkthrough's F3.5
// steps), and Undo of the assistant's change removes the rule, so S9 starts with no rules.

const REQUEST = "Lately I don't want jobs in Asian time zones anymore, ignore them";
const SUMMARY = "Hide roles whose working hours are UTC+5 or later";
const PROPOSED = "Hide roles whose hours are within UTC+5 to UTC+14";
const RULE = "Hide roles whose hours are within UTC+4 to UTC+14";
const HIDDEN_BY = `Hidden by your rule "${RULE}"`;
const IMPACT = "hides 3 roles; 1 draft is already in your mailbox and stays there";

const APAC = ["apac-1", "apac-2", "apac-3"].map(delivery);
const BERLIN = delivery("berlin-de");

const search = (page: Page) => page.getByLabel("Search sender or subject");

/** Turns the inbox's Hidden filter on or off. */
async function showHidden(page: Page, on: boolean) {
  const filter = page.getByRole("button", { name: "Hidden", exact: true });
  if ((await filter.getAttribute("aria-pressed")) !== String(on)) await filter.click();
  await expect(filter).toHaveAttribute("aria-pressed", String(on));
}

/**
 * The inbox under Hidden: the three Asia-Pacific roles, each with the rule that hides it, or
 * nothing at all. Waits up to a minute, the time a change has to re-evaluate the roles.
 */
async function expectHidden(page: Page, hidden: boolean) {
  await openPage(page, "Inbox");
  await search(page).fill("");
  await showHidden(page, true);
  if (hidden) {
    for (const d of APAC) {
      const row = inboxRow(page, d.subject).filter({ hasText: d.from.name ?? d.from.address });
      await expect(row).toContainText(HIDDEN_BY, { timeout: 60_000 });
    }
  } else {
    await expect(page.getByText("No messages match.", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
  }
  await showHidden(page, false);
}

test("S8: assistant, time zones", async ({ page }) => {
  test.setTimeout(8 * 60_000);
  const mark = logMark();
  await signIn(page, "maria");
  await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
  const workspaceId = workspaceIdOf(page);
  const [drafted, ...others] = APAC;
  expect(APAC.filter((d) => d.roles[0]?.draft)).toEqual([drafted]);
  if (!drafted) throw new Error("three Asia-Pacific deliveries");

  const panel = page.getByRole("dialog", { name: "Assistant", exact: true });
  // Her newest proposal: its summary follows an edit, so it is found by its place.
  const card = panel.getByRole("article", { name: /^Proposal: / }).last();

  await test.step("she opens the Assistant and asks; it thinks, then proposes", async () => {
    await askAssistant(await openAssistant(page), REQUEST);
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByRole("heading", { name: SUMMARY, exact: true })).toBeVisible();
  });

  const lines = card.getByRole("list", { name: "Before and after", exact: true });
  await test.step("the card: the rule in plain words, before and after, and the impact", async () => {
    await expect(lines).toContainText("No such rule");
    await expect(lines).toContainText(PROPOSED);
    await expect(card).toContainText(`Impact on your current roles: ${IMPACT}`);
  });

  await test.step("she changes the range to start at UTC+4", async () => {
    await card.getByRole("button", { name: "Edit", exact: true }).click();
    await card.getByRole("textbox", { name: "Hours from", exact: true }).fill("UTC+4");
    await card.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(lines).toContainText(RULE);
    await expect(lines).not.toContainText(PROPOSED);
    await expect(card).toContainText(`Impact on your current roles: ${IMPACT}`);
  });

  await test.step("nothing changes until Apply", async () => {
    await panel.getByRole("button", { name: "Close the assistant", exact: true }).click();
    await expect(panel).toHaveCount(0);
    await showHidden(page, true);
    await expect(page.getByText("No messages match.", { exact: true })).toBeVisible();
    await showHidden(page, false);
  });

  await test.step("Apply saves it", async () => {
    await openAssistant(page);
    await card.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(card.getByText("Applied", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Close the assistant", exact: true }).click();
  });

  await test.step("within a minute the three roles are under Hidden, named by the rule", async () => {
    await expectHidden(page, true);
    await showHidden(page, true);
    await openMessage(page, others[0]?.subject ?? "");
    const { fit } = roleParts(page);
    await expect(fit).toContainText(HIDDEN_BY);
    await expect(fit).toContainText("Your rule");
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/inbox$/);
    await showHidden(page, false);
  });

  await test.step("verification: the draft already in the mailbox stays there", async () => {
    expect(repliesTo(inspectDrafts("maria"), drafted.messageId)).toHaveLength(1);
  });

  await test.step("a role with no stated time zone isn't hidden, and says why", async () => {
    await openMessage(page, BERLIN.subject);
    await expect(roleParts(page).fit).toContainText(
      `Your rule "${RULE}" isn't applied: time zone not stated`,
    );
  });

  const rules = page.getByRole("list", { name: "Rules", exact: true });
  const rule = rules.getByRole("listitem").filter({ hasText: RULE });
  const entries = page
    .getByRole("list", { name: "Profile history", exact: true })
    .locator(":scope > li");
  const change = entries.filter({ hasText: "From the assistant" }).first();
  await test.step("the profile lists the rule, and the change in its history", async () => {
    await openPage(page, "Profile");
    await expect(rule).toContainText("From the assistant");
    await expect(change).toContainText("Maria Santos");
    await expect(change).toContainText(`“${REQUEST}”`);
    await expect(change).toContainText(`Rule: no such rule → ${RULE}`);
  });

  const toggle = page.getByRole("switch", { name: `Use the rule "${RULE}"`, exact: true });
  await test.step("switched off, the rule hides nothing within a minute", async () => {
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(rule).toContainText("From the assistant · Off");
    await expectHidden(page, false);
  });

  await test.step("Undo of the switch turns it back on", async () => {
    await openPage(page, "Profile");
    await entries.first().getByRole("button", { name: "Undo", exact: true }).click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expectHidden(page, true);
  });

  await test.step("Undo of the assistant's change removes the rule, and the roles are back", async () => {
    await openPage(page, "Profile");
    await change.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(change.getByText("Undone", { exact: true })).toBeVisible();
    await expect(page.getByText("No rules yet. Ask the assistant to add one.")).toBeVisible();
    await expectHidden(page, false);
    for (const d of APAC) {
      await search(page).fill(d.subject);
      const row = inboxRow(page, d.subject).filter({ hasText: d.from.name ?? d.from.address });
      await expect(row).toBeVisible({ timeout: 60_000 });
      await expect(row).not.toContainText("Hidden by your rule");
    }
  });

  await test.step("logs: the proposal, its apply, the rule hiding and the undo", async () => {
    const mine = logSince(mark).filter((l) => l.workspaceId === workspaceId);
    const has = (event: string, fields: Record<string, unknown> = {}) =>
      mine.some((l) => l.event === event && Object.entries(fields).every(([k, v]) => l[k] === v));
    expect(
      mine.some((l) => l.event === "assistant.message" && typeof l.threadId === "string"),
    ).toBe(true);
    expect(has("assistant.proposal_created", { changes: 1 })).toBe(true);
    expect(has("assistant.proposal_applied")).toBe(true);
    expect(has("rule.applied", { action: "hide" })).toBe(true);
    expect(has("profile.change_undone")).toBe(true);
    expect(errorsSince(mark)).toEqual([]);
  });
});
