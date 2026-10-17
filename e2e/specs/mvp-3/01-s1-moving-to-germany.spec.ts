import { expect, type Page, test } from "@playwright/test";
import { type CoreKey, fixturesDir, personaPaths, readJson } from "../../fixtures/format.ts";
import {
  type ExpectedFileMvp3,
  MARIA_PROFILES,
  MARIA_RERUN_HINT,
} from "../../fixtures/format-mvp3.ts";
import {
  deliveriesOf,
  errorsSince,
  INTAKE_LABELS,
  inboxRow,
  type LogLine,
  logMark,
  logSince,
  openPage,
  seed,
  showProfile,
  signIn,
  workspaceIdOf,
} from "../shared.ts";

// S1 of docs/mvp/MVP-3.md: moving to Germany (F1.1, F1.2), after MVP 2's end state. The
// infrastructure step is the scenario's own: `seed deliver S1` brings the Germany batch into her
// Inbox and her two "I've moved" replies into Sent. Maria presses Re-run setup on the profile
// page, types the hint, and the scan page follows the re-run until it stops. Its intake form reads
// only mail that fits the whole hint (TBD-451), so it proposes German places, EUR per year and
// permanent contracts, and none of her older answers. Confirmed as "Germany permanent", it is a
// new profile next to "My job search", which stays as it was. F1.2's "one stays on" is walked by
// switching the new profile off (its roles go back to the first one, as they were before the
// confirm), seeing the first one refuse to go off, and switching the new one on again.

const expected = readJson<ExpectedFileMvp3>(`${fixturesDir()}${personaPaths("maria").expected}`);
const rerun = expected.mvp3?.rerun;
const GERMANY = MARIA_PROFILES.germany;
const FIRST = MARIA_PROFILES.first;
const S1 = deliveriesOf("S1");

const country = new Intl.DisplayNames(["en"], { type: "region" });
/** €75,000 per year, as the en-US browser writes an amount (apps/web formatPay). */
const amount = (value: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

/** The chips the intake form shows for what the re-run proposes, by core key. */
function proposedChips(): { key: CoreKey; chips: string[] }[] {
  const proposes = rerun?.proposes ?? {};
  return [
    {
      key: "places",
      chips: (proposes.places ?? []).map(
        (p) => `${[p.city, country.of(p.country)].filter(Boolean).join(", ")} (${p.mode})`,
      ),
    },
    { key: "contracts", chips: proposes.contracts ?? [] },
    {
      key: "min_pay",
      chips: (proposes.min_pay ?? []).map(
        (m) => `${amount(m.amount, m.currency)} per ${m.period} (“${m.asWritten}”)`,
      ),
    },
  ];
}

/** What her older answers say, which a re-run in the hint's focus doesn't propose. */
const NOT_PROPOSED: { key: CoreKey; words: string[] }[] = [
  { key: "places", words: ["Amsterdam", "Berlin"] },
  { key: "contracts", words: ["B2B"] },
  { key: "min_pay", words: ["per day", "70,000"] },
];

const card = (page: Page, key: CoreKey) =>
  page.getByRole("region", { name: INTAKE_LABELS[key], exact: true });

const onOff = (page: Page) =>
  page.getByRole("switch", { name: "Give roles to this profile", exact: true });

test("S1: moving to Germany", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  expect(rerun?.hint).toBe(MARIA_RERUN_HINT);
  const mark = logMark();
  await signIn(page, "maria");
  await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
  const workspaceId = workspaceIdOf(page);
  const mine = (l: LogLine) => l.workspaceId === workspaceId;

  let confirmedBefore = "";
  await test.step("her one profile before the move", async () => {
    await openPage(page, "Profile");
    await expect(page.getByRole("heading", { name: FIRST, level: 1, exact: true })).toBeVisible();
    // One profile so far: no switcher yet.
    await expect(page.getByRole("combobox", { name: "Profile", exact: true })).toHaveCount(0);
    confirmedBefore = await page.getByText(/^Confirmed /).innerText();
  });

  await test.step("seed deliver S1: the Germany batch and her replies arrive", async () => {
    seed(["deliver", "S1"]);
    await openPage(page, "Inbox");
    const search = page.getByLabel("Search sender or subject");
    for (const d of S1) {
      await search.fill(d.subject);
      await expect(inboxRow(page, d.subject)).toBeVisible({ timeout: 120_000 });
    }
    await search.fill("");
    // Her replies go to Sent in the same delivery; a sync that starts after the Inbox mail is
    // in has read them too.
    const arrived = logMark();
    await expect
      .poll(() => logSince(arrived).filter((l) => mine(l) && l.event === "sync.completed").length, {
        timeout: 60_000,
        intervals: [2_000],
      })
      .toBeGreaterThan(0);
  });

  const beforeRerun = logMark();
  await test.step("she presses Re-run setup and types the hint", async () => {
    await openPage(page, "Profile");
    await expect(
      page.getByText("Life changed? Re-run setup to make another profile next to this one."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Re-run setup", exact: true }).click();
    await page.getByLabel("What changed? (optional)", { exact: true }).fill(MARIA_RERUN_HINT);
    await page.getByRole("button", { name: "Start the re-run", exact: true }).click();
    await expect(page).toHaveURL(/\/scan$/);
    await expect(
      page.getByText(/^A re-run of setup reads the last 90 days of your Inbox and Sent mail/),
    ).toBeVisible();
  });

  await test.step("the scan stops", async () => {
    const started = () =>
      logSince(beforeRerun).filter(
        (l) => mine(l) && l.event === "scan.started" && l.kind === "rerun",
      );
    await expect.poll(() => started().length, { timeout: 60_000 }).toBe(1);
    const scanId = started()[0]?.scanId;
    const stopped = () =>
      logSince(beforeRerun).filter((l) => l.event === "scan.stopped" && l.scanId === scanId);
    await expect.poll(() => stopped().length, { timeout: 5 * 60_000, intervals: [2_000] }).toBe(1);
    expect(stopped()[0]?.reason, "the re-run didn't fail").not.toBe("failed");
    await expect(page.getByText(/^Stopped: (done|confident)/)).toBeVisible({ timeout: 60_000 });
  });

  await test.step("the new intake form proposes German places, EUR per year, permanent", async () => {
    await page.getByRole("link", { name: "Review your answers", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your job search", exact: true })).toBeVisible();
    await expect(
      page.getByText(`with your note “${MARIA_RERUN_HINT}”`, { exact: false }),
    ).toBeVisible();
    for (const { key, chips } of proposedChips()) {
      expect(chips.length, key).toBeGreaterThan(0);
      for (const chip of chips) {
        await expect(
          card(page, key).getByRole("button", { name: `Remove ${chip}`, exact: true }),
        ).toBeVisible({ timeout: 60_000 });
      }
    }
    // Only mail in the hint's focus: none of her older, wider answers (TBD-451).
    for (const { key, words } of NOT_PROPOSED) {
      for (const word of words) await expect(card(page, key)).not.toContainText(word);
    }
  });

  await test.step(`Confirm as "${GERMANY}"`, async () => {
    await page.getByLabel("Name of the new profile", { exact: true }).fill(GERMANY);
    const confirm = page.getByRole("button", { name: "Confirm", exact: true });
    await expect(confirm).toBeEnabled({ timeout: 60_000 });
    await confirm.click();
    await expect(page).toHaveURL(/\/profile\?profile=/);
    await expect(page.getByRole("heading", { name: GERMANY, level: 1, exact: true })).toBeVisible();
    for (const { key, chips } of proposedChips()) {
      for (const chip of chips) {
        await expect(
          card(page, key).getByRole("button", { name: `Remove ${chip}`, exact: true }),
        ).toBeVisible();
      }
    }
  });

  await test.step("both profiles are listed and on; the first is untouched", async () => {
    const switcher = page.getByRole("combobox", { name: "Profile", exact: true });
    expect(await switcher.locator("option").allTextContents()).toEqual([FIRST, GERMANY]);
    await expect(onOff(page)).toHaveAttribute("aria-checked", "true");

    await showProfile(page, FIRST);
    await expect(onOff(page)).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText(/^Confirmed /)).toHaveText(confirmedBefore);
    const places = card(page, "places");
    await expect(
      places.getByRole("button", { name: "Remove Berlin, Germany (hybrid)", exact: true }),
    ).toBeVisible();
    await expect(places).not.toContainText("München");
    await expect(places).not.toContainText("Hamburg");
  });

  await test.step("F1.2: a profile switches off, and the last one on stays on", async () => {
    await showProfile(page, GERMANY);
    await onOff(page).click();
    await expect(onOff(page)).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText("Off: it gets no roles", { exact: true })).toBeVisible();

    await showProfile(page, FIRST);
    await onOff(page).click();
    await expect(
      page.getByRole("alert").filter({
        hasText: "At least one profile stays on. Switch another one on first.",
      }),
    ).toBeVisible();
    await page.reload();
    await expect(onOff(page)).toHaveAttribute("aria-checked", "true");

    await showProfile(page, GERMANY);
    await onOff(page).click();
    await expect(onOff(page)).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("Off: it gets no roles", { exact: true })).toHaveCount(0);
    await page.reload();
    const switcher = page.getByRole("combobox", { name: "Profile", exact: true });
    expect(await switcher.locator("option").allTextContents()).toEqual([FIRST, GERMANY]);
  });

  await test.step("logs: scan.started kind=rerun, intake.confirmed, no errors", async () => {
    const lines = logSince(mark).filter(mine);
    expect(lines.some((l) => l.event === "scan.started" && l.kind === "rerun")).toBe(true);
    expect(lines.some((l) => l.event === "intake.confirmed")).toBe(true);
    const switched = lines.filter(
      (l) => l.event === "profile.updated" && typeof l.enabled === "boolean",
    );
    expect(switched.map((l) => l.enabled)).toEqual([false, true]);
    expect(errorsSince(mark)).toEqual([]);
  });
});
