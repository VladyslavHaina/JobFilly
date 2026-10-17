import { expect, type Page, test } from "@playwright/test";
import {
  cvName,
  delivery,
  errorsSince,
  inspectDrafts,
  logged,
  logMark,
  logSince,
  openMessage,
  openPage,
  repliesTo,
  roleParts,
  signIn,
  workspaceIdOf,
} from "../shared.ts";

// S4 of MVP 2: edit, discard, draft on demand (F6.2, F6.4, F6.5, F6.7, F2.3, F2.5).
// The remote-EU role's first draft held "[Name]" and was written again (S2); Maria edits that
// draft, discards the Berlin one, asks for a draft on the data-engineering role (capped below
// the reply threshold, so it has none) and then deletes the CV that draft used. Each mailbox
// change is checked with `seed inspect drafts maria`.

const REMOTE = delivery("remote-eu");
const BERLIN = delivery("berlin-de");
const DATA = delivery("data-eng");
const DATA_CV = cvName("maria", "Data engineering (EN)");
const BACKEND_DE = cvName("maria", "Backend (DE)");

/** Her own words for the remote-EU reply: plain ASCII, so the mailbox copy reads the same. */
const EDITED =
  "Hi Ingrid,\n\nThanks for getting in touch. A first call next Tuesday or Wednesday works well for me.\n\nBest regards,\nMaria Santos";
const EDITED_LINE = "A first call next Tuesday or Wednesday works well for me.";

const firstLine = (text: string | undefined) => text?.split("\n")[0] ?? "";

const draftCard = (page: Page) =>
  roleParts(page).draft.getByRole("article", { name: "Reply draft", exact: true });

test("S4: edit, discard, draft on demand", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const mark = logMark();
  await signIn(page, "maria");
  await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
  const workspaceId = workspaceIdOf(page);

  await test.step("the remote-EU draft exists although the first attempt had a placeholder", async () => {
    const rejected = logged("draft.rejected_placeholder", { workspaceId, attempt: 1 });
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected.every((l) => l.level === "warn")).toBe(true);
    await openMessage(page, REMOTE.subject);
    // Its remote scope is free words ("within the EU"): never matched against hers by its words,
    // so unknown, and still a good match.
    const scope = roleParts(page)
      .fit.getByRole("list", { name: "Why this fit score", exact: true })
      .getByRole("listitem")
      .filter({ hasText: "Remote, within the EU — not compared with your remote" });
    await expect(scope).toContainText("Unknown");
    const card = draftCard(page);
    await expect(
      card.getByRole("img", { name: "Draft status: In mailbox", exact: true }),
    ).toBeVisible();
    await expect(card).toContainText(firstLine(REMOTE.roles[0]?.answers[2]?.body));
    await expect(card).not.toContainText("[Name]");
  });

  await test.step("she edits it and saves: one draft for that thread, with the new text", async () => {
    const card = draftCard(page);
    await card.getByRole("button", { name: "Edit", exact: true }).click();
    await card.getByRole("textbox", { name: "Reply", exact: true }).fill(EDITED);
    await card.getByRole("button", { name: "Save", exact: true }).click();
    await expect(card.getByRole("img", { name: "Draft status: Edited", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(card).toContainText(EDITED_LINE);
    const replies = repliesTo(inspectDrafts("maria"), REMOTE.messageId);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toContain(EDITED_LINE);
    expect(replies[0]?.draft).toBe(true);
  });

  await test.step("she discards the Berlin draft: it is gone from the mailbox", async () => {
    await openMessage(page, BERLIN.subject);
    await draftCard(page).getByRole("button", { name: "Discard", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "Discard this draft?", exact: true });
    await confirm.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(confirm).toHaveCount(0);
    await expect(roleParts(page).draft).toContainText(
      "You discarded the draft for this role, so no new one is written on its own.",
    );
    expect(repliesTo(inspectDrafts("maria"), BERLIN.messageId)).toEqual([]);
  });

  await test.step("the data-engineering role has no draft; Draft a reply writes one", async () => {
    await openMessage(page, DATA.subject);
    const { draft, cv } = roleParts(page);
    await expect(draft).toContainText("No draft for this role.");
    await draft.getByRole("button", { name: "Draft a reply", exact: true }).click();
    const card = draftCard(page);
    await expect(
      card.getByRole("img", { name: "Draft status: In mailbox", exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText("Drafted on request");
    await expect(card).toContainText(firstLine(DATA.roles[0]?.answers[1]?.body));
    await expect(cv).toContainText(`→ ${DATA_CV}`);
    expect(repliesTo(inspectDrafts("maria"), DATA.messageId)).toHaveLength(1);
  });

  await test.step("an editor changes the role's CV, and goes back to the automatic choice", async () => {
    const { cv } = roleParts(page);
    const choice = cv.getByLabel("Use another CV for role 1", { exact: true });
    await choice.selectOption({ label: BACKEND_DE });
    await expect(cv).toContainText(`You chose ${BACKEND_DE} for this role`);
    await choice.selectOption({ label: "Choose automatically" });
    // The automatic choice comes back with the role's re-evaluation, which waits its turn in the
    // workspace's queue like the delete below.
    await expect(cv).toContainText(`→ ${DATA_CV}`, { timeout: 60_000 });
  });

  await test.step("the Drafts page shows each draft's status", async () => {
    await openPage(page, "Drafts");
    for (const status of ["In mailbox", "Edited", "Discarded"]) {
      await expect(
        page.getByRole("img", { name: `Draft status: ${status}`, exact: true }).first(),
      ).toBeVisible();
    }
  });

  await test.step(`she deletes ${DATA_CV}: gone from CVs and from the role's choice`, async () => {
    await openPage(page, "CVs");
    const heading = page.getByRole("heading", { name: DATA_CV, level: 2, exact: true });
    await heading
      .locator("xpath=ancestor::section[1]")
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    const confirm = page.getByRole("dialog", { name: `Delete ${DATA_CV}?`, exact: true });
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(heading).toHaveCount(0);

    await openPage(page, "Inbox");
    await openMessage(page, DATA.subject);
    const { cv } = roleParts(page);
    await expect(cv).not.toContainText(DATA_CV, { timeout: 60_000 });
    await expect(cv).toContainText("→");
    const options = await cv
      .getByLabel("Use another CV for role 1", { exact: true })
      .locator("option")
      .allInnerTexts();
    expect(options).not.toContain(DATA_CV);
    expect(options.length).toBeGreaterThan(1);
  });

  await test.step("verification: the draft that used it is still in the mailbox", async () => {
    expect(repliesTo(inspectDrafts("maria"), DATA.messageId)).toHaveLength(1);
    await expect(
      roleParts(page).draft.getByRole("article", { name: "Reply draft", exact: true }),
    ).toBeVisible();
  });

  await test.step("logs: draft.updated, draft.discarded, an on-demand draft.created", async () => {
    const events = logSince(mark).filter((l) => l.workspaceId === workspaceId);
    expect(events.some((l) => l.event === "draft.updated")).toBe(true);
    expect(events.some((l) => l.event === "draft.discarded")).toBe(true);
    expect(events.some((l) => l.event === "draft.created" && l.origin === "on_demand")).toBe(true);
    expect(errorsSince(mark)).toEqual([]);
  });
});
