import { expect, type Page, test } from "@playwright/test";
import {
  type EnvelopeEntry,
  fixturesDir,
  PERSONA_ADDRESSES,
  readJson,
} from "../../fixtures/format.ts";
import { MARIA_HOME_ADDRESS, MVP3_PATHS } from "../../fixtures/format-mvp3.ts";
import { EXTRA_ACCOUNTS } from "../../seed/accounts.ts";
import {
  apiContext,
  apiSignIn,
  cardHeaded,
  errorsSince,
  inboxRow,
  logMark,
  logSince,
  openPage,
  openSettingsTab,
  signIn,
  workspaceIdOf,
} from "../shared.ts";

// S4 of MVP 3: a second mailbox (F3.1–F3.3). Maria connects her personal mailbox
// (maria-home, plain IMAP on the test mail server) from Settings › Mailbox; its job mail comes in
// marked with that mailbox, and the inbox filters by it. Then Sign in with Google, the only OAuth
// provider: the browser goes to the fake authorisation server's consent page through
// the proxy's :8084, she presses Allow, and her Gmail test account is connected
// (its token is GreenMail's password for it, D6). Probe: the callback with a wrong state, and
// with the state of the sign-in just used, are refused.

const MAIN = PERSONA_ADDRESSES.maria;
const GMAIL = EXTRA_ACCOUNTS["maria-gmail"].user;
const home = readJson<EnvelopeEntry[]>(`${fixturesDir()}${MVP3_PATHS.homeEnvelopes}`);
const JOB_SUBJECTS = [
  '2 new jobs for "backend engineer"',
  "Thank you for applying to Alfama Labs",
  "Engenheira de Backend – presencial em Lisboa",
];

const search = (page: Page) => page.getByLabel("Search sender or subject");

test("S4: second mailbox", async ({ page, playwright, baseURL }) => {
  test.setTimeout(8 * 60_000);
  const mark = logMark();
  const api = await apiContext(playwright.request, baseURL);

  try {
    await signIn(page, "maria");
    await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
    const workspaceId = workspaceIdOf(page);
    expect(home.map((e) => e.subject)).toEqual(expect.arrayContaining(JOB_SUBJECTS));

    await test.step("she connects her personal mailbox next to her main one", async () => {
      await openSettingsTab(page, "Mailbox");
      await expect(cardHeaded(page, MAIN)).toHaveCount(1);
      await page.getByRole("button", { name: "Connect another mailbox", exact: true }).click();
      await page.getByLabel("Mail provider").selectOption({ label: "Other IMAP" });
      await page.getByLabel("Email address").fill(MARIA_HOME_ADDRESS);
      await page.getByLabel("IMAP server").fill("imap");
      await page.getByLabel("Port").fill("3143");
      await page.getByLabel("Security").selectOption({ label: "None (plain text)" });
      await page
        .getByLabel("Password", { exact: true })
        .fill(EXTRA_ACCOUNTS["maria-home"].password);
      await page.getByRole("button", { name: "Test connection", exact: true }).click();
      await expect(page.getByText(/^Connected: Inbox/)).toBeVisible();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(cardHeaded(page, MARIA_HOME_ADDRESS)).toHaveCount(1);
      await expect(cardHeaded(page, MAIN)).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: `Disconnect ${MARIA_HOME_ADDRESS}`, exact: true }),
      ).toBeVisible();
      // Each mailbox has its own sync status, named by its address.
      const status = page.getByRole("status").filter({ hasText: `${MARIA_HOME_ADDRESS}:` });
      await expect(status).toContainText(`${MAIN}:`);
    });

    await test.step("its job email appears in the inbox, marked with that mailbox", async () => {
      await openPage(page, "Inbox");
      for (const subject of JOB_SUBJECTS) {
        await search(page).fill(subject);
        // Her main mailbox has job alerts of the same subject: this one is marked with the other.
        await expect(
          inboxRow(page, subject).filter({ hasText: `In ${MARIA_HOME_ADDRESS}` }),
        ).toHaveCount(1, { timeout: 120_000 });
      }
      await search(page).fill("");
      // Her main mailbox's mail is marked too.
      await expect(
        page
          .getByRole("list", { name: "Messages", exact: true })
          .getByRole("link")
          .filter({ hasText: `In ${MAIN}` })
          .first(),
      ).toBeVisible();
    });

    await test.step("the inbox filters by mailbox", async () => {
      const filter = page.getByRole("combobox", { name: "Mailbox", exact: true });
      await filter.selectOption({ label: MARIA_HOME_ADDRESS });
      const rows = page.getByRole("list", { name: "Messages", exact: true }).getByRole("link");
      await expect(rows).toHaveCount(JOB_SUBJECTS.length);
      for (const subject of JOB_SUBJECTS) {
        await expect(inboxRow(page, subject)).toContainText(`In ${MARIA_HOME_ADDRESS}`);
      }
      await expect(page.getByText("1 non-job email hidden", { exact: true })).toBeVisible();
      await filter.selectOption({ label: "All mailboxes" });
      await expect(rows.filter({ hasText: `In ${MAIN}` }).first()).toBeVisible();
    });

    let state = "";
    await test.step("Sign in with Google completes against the fake authorisation server", async () => {
      await openSettingsTab(page, "Mailbox");
      await page.getByRole("button", { name: "Connect another mailbox", exact: true }).click();
      await page.getByRole("button", { name: "Sign in with Google", exact: true }).click();
      // Google's consent page, here the fake server's, reached through the proxy.
      await page.waitForURL(/^http:\/\/127\.0\.0\.1:8084\/authorize\?/);
      const authorize = new URL(page.url());
      state = authorize.searchParams.get("state") ?? "";
      expect(state).not.toBe("");
      expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
      await expect(
        page.getByRole("heading", { name: "Sign in with Google", level: 1, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(`JobFilly wants to read, compose and send mail for ${GMAIL}.`),
      ).toBeVisible();
      await page.getByRole("button", { name: "Allow", exact: true }).click();
      await page.waitForURL(/\/settings\/mailbox\?oauth=connected$/);
      await expect(
        page.getByText("Your Gmail mailbox is connected.", { exact: true }),
      ).toBeVisible();
      const card = cardHeaded(page, GMAIL);
      await expect(card).toHaveCount(1);
      // "Signs in with" Google, not a password.
      await expect(card.getByText("Google", { exact: true })).toBeVisible();
      for (const address of [MAIN, MARIA_HOME_ADDRESS]) {
        await expect(cardHeaded(page, address)).toHaveCount(1);
      }
    });

    await test.step("probe: the OAuth callback with a wrong state, or a used one, is refused", async () => {
      await apiSignIn(api, "maria");
      for (const tried of ["E2E-wrong-state", state]) {
        const response = await api.get(
          `/api/oauth/google/callback?state=${encodeURIComponent(tried)}&code=E2E-code`,
          { maxRedirects: 0 },
        );
        expect(response.status(), tried === state ? "the used state" : "a wrong state").toBe(400);
        expect(((await response.json()) as { error?: string }).error).toBe("oauth_refused");
      }
    });

    await test.step("logs: mailbox.connected, mailbox.oauth_connected, no errors", async () => {
      const mine = logSince(mark).filter((l) => l.workspaceId === workspaceId);
      expect(mine.some((l) => l.event === "mailbox.connected")).toBe(true);
      expect(mine.some((l) => l.event === "mailbox.oauth_connected")).toBe(true);
      const refused = logSince(mark).filter((l) => l.event === "oauth.callback_refused");
      expect(refused.map((l) => l.reason)).toEqual(["unknown_state", "unknown_state"]);
      expect(refused.every((l) => l.level === "warn")).toBe(true);
      expect(errorsSince(mark)).toEqual([]);
    });
  } finally {
    await api.dispose();
  }
});
