import { expect, test } from "@playwright/test";
import { type EnvelopeEntry, fixturesDir, personaPaths, readJson } from "../../fixtures/format.ts";
import {
  type ExpectedFileMvp3,
  MARIA_HOME_ADDRESS,
  MVP3_PATHS,
} from "../../fixtures/format-mvp3.ts";
import {
  cardHeaded,
  errorsSince,
  inboxRow,
  logMark,
  logSince,
  openPage,
  openSettingsTab,
  pgDump,
  signIn,
  workspaceIdOf,
} from "../shared.ts";

// S12 of docs/mvp/MVP-3.md: disconnect a mailbox (F7.4), the last scenario on the stack. Maria
// disconnects the personal mailbox S4 connected: the confirmation says first what goes with it
// (its stored sign-in, its synced messages with their roles, drafts and open decisions) and that
// the mail in the mailbox stays there. Afterwards it is gone from Settings and the inbox, and a
// pg_dump (the verification step) holds none of its messages and nothing naming it.

const home = readJson<EnvelopeEntry[]>(`${fixturesDir()}${MVP3_PATHS.homeEnvelopes}`);
const truth = readJson<ExpectedFileMvp3>(`${fixturesDir()}${personaPaths("maria").expected}`);
/** The personal mailbox's job mail, which the job inbox listed (S4). */
const jobMail = home.filter((e) => truth.mvp3?.home.messages[e.messageId]?.category !== "not_job");
const mainSubjects = new Set(
  readJson<EnvelopeEntry[]>(`${fixturesDir()}${personaPaths("maria").envelopes}`).map(
    (e) => e.subject,
  ),
);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const GOES = new RegExp(
  `^This deletes its stored sign-in and the ${plural(home.length, "message")} synced from it, with their \\d+ roles?, \\d+ drafts? and \\d+ open decisions?\\.$`,
);

test("S12: disconnect a mailbox", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const mark = logMark();
  await signIn(page, "maria");
  await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
  const workspaceId = workspaceIdOf(page);
  const card = cardHeaded(page, MARIA_HOME_ADDRESS);

  await test.step("she presses Disconnect on the personal mailbox: it says what goes", async () => {
    await openSettingsTab(page, "Mailbox");
    await expect(card).toHaveCount(1);
    await card
      .getByRole("button", { name: `Disconnect ${MARIA_HOME_ADDRESS}`, exact: true })
      .click();
    const warning = card
      .getByRole("status")
      .filter({ hasText: `Disconnect ${MARIA_HOME_ADDRESS}?` });
    await expect(warning).toBeVisible();
    await expect(warning.getByText(GOES)).toBeVisible();
    await expect(warning).toContainText("Mail and drafts in the mailbox itself stay there.");
  });

  await test.step("she confirms: the mailbox is gone from Settings and the inbox", async () => {
    await card.getByRole("button", { name: "Disconnect and delete its data", exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: `${MARIA_HOME_ADDRESS}:` }),
    ).toHaveCount(0);
    await openPage(page, "Inbox");
    const filter = page.getByRole("combobox", { name: "Mailbox", exact: true });
    // Her main mailbox and her Gmail one are left.
    await expect(filter.locator("option")).toHaveCount(3);
    await expect(filter).not.toContainText(MARIA_HOME_ADDRESS);
    const search = page.getByLabel("Search sender or subject");
    for (const message of jobMail) {
      const subject = message.subject ?? "";
      await search.fill(subject);
      if (mainSubjects.has(subject)) {
        // Her main mailbox has mail of the same subject: it stays, the personal one's is gone.
        const rows = page.getByRole("list", { name: "Messages", exact: true }).getByRole("link");
        await expect(rows.filter({ hasNotText: subject })).toHaveCount(0);
        await expect(inboxRow(page, subject).first()).toBeVisible();
        await expect(
          inboxRow(page, subject).filter({ hasText: `In ${MARIA_HOME_ADDRESS}` }),
        ).toHaveCount(0);
      } else {
        await expect(page.getByText("No messages match.", { exact: true })).toBeVisible();
      }
    }
    await search.fill("");
  });

  await test.step("verification: none of its messages or its credentials remain", async () => {
    const dump = pgDump();
    expect(dump.length).toBeGreaterThan(0);
    expect(dump).not.toContain(MARIA_HOME_ADDRESS);
    for (const message of home) expect(dump).not.toContain(message.messageId);
  });

  await test.step("logs: mailbox.disconnected, no errors", async () => {
    const disconnected = logSince(mark).filter(
      (l) => l.workspaceId === workspaceId && l.event === "mailbox.disconnected",
    );
    expect(disconnected).toHaveLength(1);
    expect(disconnected[0]?.messages).toBe(home.length);
    expect(errorsSince(mark)).toEqual([]);
  });
});
