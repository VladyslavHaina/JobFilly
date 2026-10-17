import { expect, type Page, test } from "@playwright/test";
import { fixturesDir, personaPaths, readJson } from "../../fixtures/format.ts";
import type { ApplicationStage, ExpectedFileMvp3 } from "../../fixtures/format-mvp3.ts";
import {
  delivery,
  errorsSince,
  logMark,
  logSince,
  openPage,
  seed,
  signIn,
  workspaceIdOf,
} from "../shared.ts";

// S6 of docs/mvp/MVP-3.md: the pipeline (F5.1–F5.3). The infrastructure step is the scenario's
// own: `seed deliver S6` brings the pipeline threads into her Inbox. The pipeline groups every
// role by the stage its mail gives: the Lindwurm thread under Offer, the Mainwelle one under
// Rejected, the Brandung application flagged after 21 days without an answer, and the Möwe role
// two agencies sent once, with both senders (expected.json mvp3.pipeline). She moves Brandung to
// Interview by hand (mvp3.manualStage); it stays there after the next sync.

const expected = readJson<ExpectedFileMvp3>(`${fixturesDir()}${personaPaths("maria").expected}`);
const pipeline = expected.mvp3?.pipeline ?? [];
const manual = expected.mvp3?.manualStage;

const LABEL: Record<ApplicationStage, string> = {
  new: "New",
  replied: "Replied",
  applied: "Applied",
  interview: "Interview",
  assessment: "Assessment",
  offer: "Offer",
  rejected: "Rejected",
  closed: "Closed",
};

type Item = (typeof pipeline)[number];

/** The item's card, as the pipeline names it: "<title> · <company>". */
const itemCard = (page: Page, item: Item) =>
  page.getByRole("article", { name: `${item.title} · ${item.company}`, exact: true });

/** The names the pipeline shows for the item's senders: the sender's name, else the address. */
function senderNames(item: Item): string[] {
  return item.senders.map((address) => {
    const from = item.deliveries.map(delivery).find((d) => d.from.address === address)?.from;
    return from?.name ?? address;
  });
}

test("S6: pipeline", async ({ page }) => {
  test.setTimeout(8 * 60_000);
  const mark = logMark();
  await signIn(page, "maria");
  await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
  const workspaceId = workspaceIdOf(page);
  const silent = pipeline.find((p) => p.id === manual?.item);
  expect(silent, "the item S6 moves by hand").toBeDefined();
  expect(pipeline.map((p) => p.id).sort()).toEqual([
    "offer",
    "rejection",
    "silent",
    "two-agencies",
  ]);

  await test.step("seed deliver S6: the pipeline threads arrive", async () => {
    seed(["deliver", "S6"]);
    await openPage(page, "Pipeline");
    await expect(
      page.getByRole("heading", { name: "Pipeline", level: 1, exact: true }),
    ).toBeVisible();
    for (const item of pipeline) {
      await expect(itemCard(page, item)).toHaveCount(1, { timeout: 180_000 });
    }
  });

  for (const item of pipeline) {
    await test.step(`${item.title} · ${item.company}: under ${LABEL[item.stage]}`, async () => {
      // Its stage follows its newest mail: wait for the thread's last message to be read.
      const stage = page.getByRole("region", { name: LABEL[item.stage], exact: true });
      const card = stage.getByRole("article", {
        name: `${item.title} · ${item.company}`,
        exact: true,
      });
      await expect(card).toBeVisible({ timeout: 120_000 });
      // The same role, one card, whoever sent it (F5.3).
      await expect(itemCard(page, item)).toHaveCount(1);
      const names = senderNames(item);
      await expect(card).toContainText(
        names.length > 1 ? `From ${names.length} senders: ` : `From ${names[0]}`,
      );
      for (const name of names) await expect(card).toContainText(name);
      // How long it has been there, and the next step (F5.2).
      await expect(card).toContainText(/(Since today|For \d+ days?) · Next: \S/);
      const flag = card.getByRole("img", { name: "No reply for 21 days or more", exact: true });
      await expect(flag).toHaveCount(item.flagged ? 1 : 0);
    });
  }

  const target = manual?.stage ?? "interview";
  await test.step(`she moves ${silent?.company} to ${LABEL[target]} by hand`, async () => {
    if (!silent) return;
    const before = page.getByRole("region", { name: LABEL[silent.stage], exact: true });
    await before
      .getByRole("article", { name: `${silent.title} · ${silent.company}`, exact: true })
      .getByRole("combobox", { name: "Stage", exact: true })
      .selectOption({ label: LABEL[target] });
    const moved = page
      .getByRole("region", { name: LABEL[target], exact: true })
      .getByRole("article", { name: `${silent.title} · ${silent.company}`, exact: true });
    await expect(moved).toBeVisible();
    await expect(moved.getByText("Set by you", { exact: true })).toBeVisible();
    await expect(moved).toContainText("Since today · Next: ");
    await expect(itemCard(page, silent)).toHaveCount(1);
  });

  await test.step("it stays there after the next sync", async () => {
    if (!silent) return;
    const changed = logMark();
    await expect
      .poll(
        () =>
          logSince(changed).filter(
            (l) => l.workspaceId === workspaceId && l.event === "sync.completed",
          ).length,
        { timeout: 90_000, intervals: [2_000] },
      )
      .toBeGreaterThan(0);
    await page.reload();
    const moved = page
      .getByRole("region", { name: LABEL[target], exact: true })
      .getByRole("article", { name: `${silent.title} · ${silent.company}`, exact: true });
    await expect(moved).toBeVisible();
    await expect(moved.getByText("Set by you", { exact: true })).toBeVisible();
    await expect(moved.getByRole("combobox", { name: "Stage", exact: true })).toHaveValue(target);
  });

  await test.step("logs: pipeline.stage_changed, no errors", async () => {
    const changed = logSince(mark).filter(
      (l) => l.workspaceId === workspaceId && l.event === "pipeline.stage_changed",
    );
    expect(changed.map((l) => [l.previousStage, l.stage])).toEqual([[silent?.stage, target]]);
    expect(errorsSince(mark)).toEqual([]);
  });
});
