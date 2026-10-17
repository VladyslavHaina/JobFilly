import { expect, type Page, test } from "@playwright/test";
import {
  type EnvelopeEntry,
  fixturesDir,
  MARIA_KEY_MESSAGES,
  personaPaths,
  readJson,
} from "../../fixtures/format.ts";
import {
  delivery,
  errorsSince,
  inspectDrafts,
  logMark,
  logSince,
  openMessage,
  repliesTo,
  roleParts,
  signIn,
  workspaceIdOf,
} from "../shared.ts";

// S6 of MVP 2: the sender check (F5.1–F5.5). Both scams, the one in the first scan's
// backlog and the one S2 delivered, are high risk for the fee and the passport scan, and have no
// draft; the free-mail "recruiter" is caution until Maria marks the sender trusted, which holds
// after the next sync and is named in the check.

const envelopes = readJson<EnvelopeEntry[]>(`${fixturesDir()}${personaPaths("maria").envelopes}`);
const backlogScamSubject =
  envelopes.find((e) => e.messageId === MARIA_KEY_MESSAGES.scam)?.subject ?? "";
const SCAM = delivery("scam");
const FREEMAIL = delivery("freemail");

const senderCheck = (page: Page) => page.getByRole("region", { name: "Sender check", exact: true });

const badge = (page: Page, verdict: string) =>
  senderCheck(page).getByRole("img", { name: `Sender check: ${verdict}`, exact: true });

const ESTIMATE = "These are estimates from the email and its domain, not facts.";

test("S6: sender check", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const mark = logMark();
  await signIn(page, "maria");
  await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
  const workspaceId = workspaceIdOf(page);

  const scams = [
    { subject: SCAM.subject, messageId: SCAM.messageId },
    { subject: backlogScamSubject, messageId: MARIA_KEY_MESSAGES.scam },
  ];
  for (const scam of scams) {
    await test.step(`"${scam.subject}" is high risk: a fee and a passport scan, no draft`, async () => {
      await openMessage(page, scam.subject);
      await expect(badge(page, "High risk")).toBeVisible();
      await expect(senderCheck(page).getByRole("alert")).toContainText(
        "This sender looks high risk",
      );
      await expect(senderCheck(page)).toContainText("asks for a fee");
      await expect(senderCheck(page)).toContainText("asks for a passport scan");
      await expect(senderCheck(page)).toContainText(ESTIMATE);
      await expect(roleParts(page).draft).toContainText("No draft for this role.");
      expect(repliesTo(inspectDrafts("maria"), scam.messageId)).toEqual([]);
    });
  }

  await test.step("the free-mail recruiter is Caution", async () => {
    await openMessage(page, FREEMAIL.subject);
    await expect(badge(page, "Caution")).toBeVisible();
    await expect(senderCheck(page)).toContainText(
      "writes as a company recruiter from a free-mail address (gmail.com)",
    );
    await expect(senderCheck(page)).toContainText(ESTIMATE);
  });

  const trusted = senderCheck(page).getByRole("button", { name: "Trusted", exact: true });
  await test.step("Maria marks that sender Trusted", async () => {
    await trusted.click();
    await expect(trusted).toHaveAttribute("aria-pressed", "true");
    await expect(senderCheck(page)).toContainText(
      `Marked trusted for every email from ${FREEMAIL.from.address}.`,
    );
    await expect(badge(page, "Looks fine")).toBeVisible();
  });

  await test.step("after the next sync it is still trusted, and the check says so", async () => {
    const synced = logMark();
    await expect
      .poll(
        () =>
          logSince(synced).filter(
            (l) => l.event === "sync.completed" && l.workspaceId === workspaceId,
          ).length,
        { timeout: 60_000, intervals: [2_000] },
      )
      .toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/inbox$/);
    await openMessage(page, FREEMAIL.subject);
    await expect(trusted).toHaveAttribute("aria-pressed", "true");
    await expect(badge(page, "Looks fine")).toBeVisible();
    await expect(senderCheck(page)).toContainText("is marked trusted in this workspace", {
      timeout: 60_000,
    });
  });

  await test.step("logs: no errors", async () => {
    expect(errorsSince(mark)).toEqual([]);
  });
});
