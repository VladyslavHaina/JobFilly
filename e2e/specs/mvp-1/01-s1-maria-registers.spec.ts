import { expect, test } from "@playwright/test";
import { PERSONA_ADDRESSES, PERSONA_NAMES } from "../../fixtures/format.ts";
import { ACCOUNTS } from "../../seed/accounts.ts";
import {
  apiContext,
  apiSignIn,
  eventsSince,
  LOGIN_PASSWORDS,
  logMark,
  workspaceIdOf,
} from "../shared.ts";

// S1 of docs/mvp/MVP-1.md: Maria registers and connects her mailbox (F1.1, F1.2, F2.1–F2.3).
// She ends on "Pick your AI"; S2 picks it in Settings › AI. The test stack's imap service speaks
// plain-text IMAP on port 3143 (docker/compose.e2e.yaml), which only the test stack allows (F2.4).

const WRONG_PASSWORD = "E2E-SECRET-maria-wrong";

test("S1: Maria registers and connects her mailbox", async ({ page, playwright, baseURL }) => {
  const mark = logMark();

  await test.step("she creates her account from the start page", async () => {
    await page.goto("/");
    await page.getByRole("link", { name: "Create account", exact: true }).click();
    await page.getByLabel("Name").fill(PERSONA_NAMES.maria);
    await page.getByLabel("Email").fill(PERSONA_ADDRESSES.maria);
    await page.getByLabel("Password").fill(LOGIN_PASSWORDS.maria);
    await page.getByRole("button", { name: "Create account", exact: true }).click();

    await expect(
      page.getByRole("heading", { name: "Connect your mailbox", level: 1, exact: true }),
    ).toBeVisible();
    await expect(page.getByText("in Maria Santos's workspace")).toBeVisible();
    await expect(page.getByLabel("Workspace").locator("option:checked")).toHaveText(
      "Maria Santos's workspace",
    );
  });

  await test.step("her session is one HttpOnly, SameSite=Lax cookie (F1.2)", async () => {
    const cookies = (await page.context().cookies()).filter((c) => c.name === "jf_session");
    expect(cookies).toHaveLength(1);
    const [session] = cookies;
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Lax");
    expect(session?.path).toBe("/");
    // PUBLIC_URL is http in the test stack, so the cookie isn't Secure.
    expect(session?.secure).toBe(false);
    // At least 128 random bits, however they are written.
    expect(session?.value.length ?? 0).toBeGreaterThanOrEqual(22);
  });

  const provider = page.getByLabel("Mail provider");
  await test.step("the Gmail preset says it needs an app password, with a help link", async () => {
    await provider.selectOption({ label: "Gmail" });
    await expect(page.getByText("Gmail needs an app password")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "How to create an app password at Gmail", exact: true }),
    ).toHaveAttribute("href", /^https:\/\//);
  });

  const password = page.getByLabel("Password", { exact: true });
  const testConnection = page.getByRole("button", { name: "Test connection", exact: true });
  await test.step("Other IMAP with a wrong password gives a plain error without it", async () => {
    await provider.selectOption({ label: "Other IMAP" });
    await page.getByLabel("Email address").fill(PERSONA_ADDRESSES.maria);
    await page.getByLabel("IMAP server").fill("imap");
    await page.getByLabel("Port").fill("3143");
    await page.getByLabel("Security").selectOption({ label: "None (plain text)" });
    await password.fill(WRONG_PASSWORD);
    await testConnection.click();

    const failure = page.getByRole("alert").filter({ hasText: "Couldn't connect" });
    await expect(failure).toContainText("didn't accept the user name or password");
    await expect(page.locator("body")).not.toContainText(WRONG_PASSWORD);
  });

  await test.step("the right password connects, and saving goes on to the AI", async () => {
    await password.fill(ACCOUNTS.maria.password);
    await testConnection.click();
    await expect(page.getByText("Connected: Inbox, Sent")).toBeVisible();
    await page.getByRole("button", { name: "Save and continue", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Pick your AI", level: 1, exact: true }),
    ).toBeVisible();
  });

  const workspaceId = workspaceIdOf(page);

  await test.step("probe: the mailbox settings carry no password", async () => {
    const api = await apiContext(playwright.request, baseURL);
    try {
      await apiSignIn(api, "maria");
      const response = await api.get(`/api/workspaces/${workspaceId}/mailboxes`);
      expect(response.status()).toBe(200);
      const text = await response.text();
      expect(text).not.toContain(ACCOUNTS.maria.password);
      const { items } = JSON.parse(text) as { items: Record<string, unknown>[] };
      expect(items.map((m) => m.address)).toEqual([PERSONA_ADDRESSES.maria]);
      expect(Object.keys(items[0] ?? {}).filter((key) => /password|secret/i.test(key))).toEqual([]);
    } finally {
      await api.dispose();
    }
  });

  await test.step("logs", async () => {
    await expect
      .poll(() => eventsSince(mark))
      .toEqual(
        expect.arrayContaining([
          "auth.registered",
          "auth.signed_in",
          "mailbox.test_failed",
          "mailbox.connected",
        ]),
      );
  });
});
