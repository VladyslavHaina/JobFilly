import { expect, test } from "@playwright/test";
import {
  type EnvelopeEntry,
  type ExpectedFile,
  fixturesDir,
  MARIA_KEY_MESSAGES,
  PERSONA_ADDRESSES,
  PERSONA_NAMES,
  personaPaths,
  readJson,
} from "../../fixtures/format.ts";
import {
  apiContext,
  apiSignIn,
  eventsSince,
  LOGIN_PASSWORDS,
  logMark,
  openMessage,
  signIn,
  workspaceIdOf,
} from "../shared.ts";

// S6 of docs/mvp/MVP-1.md: inviting Tom, roles enforced (F1.6–F1.9, F6.7). Maria and Tom each
// have a browser context of their own. Maria confirmed her profile in S4, so what Tom can't do
// as a viewer is checked where the role alone decides it: the profile page's controls, and the
// server refusing his writes. As an editor, Tom corrects the category of the message the AI
// couldn't analyze (the one Maria set in S5), so no analysed category changes hands.

const dir = fixturesDir();
const expected = readJson<ExpectedFile>(`${dir}${personaPaths("maria").expected}`);
const envelopes = readJson<EnvelopeEntry[]>(`${dir}${personaPaths("maria").envelopes}`);
const subjectOf = (messageId: string) =>
  envelopes.find((e) => e.messageId === messageId)?.subject ?? messageId;

test("S6: inviting Tom, roles enforced", async ({ page, browser, playwright, baseURL }) => {
  test.setTimeout(5 * 60_000);
  const mark = logMark();
  const tomContext = await browser.newContext({ baseURL });
  const tom = await tomContext.newPage();
  const tomApi = await apiContext(playwright.request, baseURL);
  const tomNav = tom.getByRole("navigation", { name: "Main", exact: true });

  try {
    await test.step("Tom registers in a browser of his own", async () => {
      await tom.goto("/");
      await tom.getByRole("link", { name: "Create account", exact: true }).click();
      await tom.getByLabel("Name").fill(PERSONA_NAMES.tom);
      await tom.getByLabel("Email").fill(PERSONA_ADDRESSES.tom);
      await tom.getByLabel("Password").fill(LOGIN_PASSWORDS.tom);
      await tom.getByRole("button", { name: "Create account", exact: true }).click();
      await expect(
        tom.getByRole("heading", { name: "Connect your mailbox", level: 1, exact: true }),
      ).toBeVisible();
      await expect(tom.getByText("in Tom's workspace")).toBeVisible();
    });

    await signIn(page, "maria");
    await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
    const mariaWorkspace = workspaceIdOf(page);
    const message = MARIA_KEY_MESSAGES.germanRecruiter;
    const workspaceApi = `/api/workspaces/${mariaWorkspace}`;
    const categoryUrl = `${workspaceApi}/messages/${encodeURIComponent(message)}/category`;
    const correction = { data: { category: expected.messages[message]?.category } };

    await test.step("probe: Tom on one of Maria's workspace URLs gets 404", async () => {
      await apiSignIn(tomApi, "tom");
      expect((await tomApi.get(`${workspaceApi}/messages`)).status()).toBe(404);
      expect((await tomApi.put(categoryUrl, correction)).status()).toBe(404);
    });

    await test.step("Maria invites Tom as a viewer", async () => {
      await page
        .getByRole("navigation", { name: "Main", exact: true })
        .getByRole("link", { name: "Members", exact: true })
        .click();
      await page.getByLabel("Email").fill(PERSONA_ADDRESSES.tom);
      await page.getByLabel("Role", { exact: true }).selectOption({ label: "Viewer" });
      await page.getByRole("button", { name: "Send invite", exact: true }).click();
      await expect(page.getByText(`Invited ${PERSONA_ADDRESSES.tom} as Viewer`)).toBeVisible();
      await expect(page.getByLabel("Invite link")).toHaveValue(/^http/);
    });

    await test.step("Tom sees the invitation, accepts it and lands in Maria's inbox", async () => {
      await tom.reload();
      const invitation = tom.getByText("Maria invited you to “Maria's workspace” as a viewer");
      await expect(invitation).toBeVisible();
      await tom.getByRole("button", { name: "Accept", exact: true }).click();
      await expect(tom.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
      await expect(tom.getByLabel("Workspace").locator("option:checked")).toHaveText(
        "Maria's workspace",
      );
      await expect(
        tom.getByRole("list", { name: "Messages", exact: true }).getByRole("link").first(),
      ).toBeVisible();
    });

    const rename = tom.getByRole("button", { name: "Rename", exact: true });
    const removeEntry = tom.getByRole("button", { name: /^Remove / }).first();
    await test.step("as a viewer, correcting and changing the profile are disabled", async () => {
      await openMessage(tom, subjectOf(message));
      await expect(tom.getByLabel("Category", { exact: true })).toBeDisabled();
      await expect(
        tom.getByText("Only editors and admins can correct the category."),
      ).toBeVisible();
      await expect(tomNav.getByRole("link", { name: "Members", exact: true })).toHaveCount(0);
      // An editor may change the confirmed profile, so these are disabled for the role alone.
      await tomNav.getByRole("link", { name: "Profile", exact: true }).click();
      await expect(
        tom.getByRole("heading", { name: "My job search", level: 1, exact: true }),
      ).toBeVisible();
      await expect(
        tom.getByText("You can see the profile; only editors and admins can change it."),
      ).toBeVisible();
      await expect(rename).toBeDisabled();
      await expect(removeEntry).toBeDisabled();
    });

    await test.step("probes: Tom correcting, changing the profile or confirming gets 403", async () => {
      expect((await tomApi.put(categoryUrl, correction)).status()).toBe(403);
      const profiles = await tomApi.get(`${workspaceApi}/profiles`);
      expect(profiles.status(), "a viewer sees the profile").toBe(200);
      const { items } = (await profiles.json()) as { items: { id: string; name: string }[] };
      const [profile] = items;
      expect(profile, "Maria's profile, confirmed in S4").toBeDefined();
      const renamed = await tomApi.patch(`${workspaceApi}/profiles/${profile?.id}`, {
        data: { name: `${profile?.name} (Tom)` },
      });
      expect(renamed.status()).toBe(403);
      expect((await tomApi.post(`${workspaceApi}/intake/confirm`, { data: {} })).status()).toBe(
        403,
      );
    });

    await test.step("Maria makes Tom an editor", async () => {
      // Tom is among the people once he accepted.
      await page.reload();
      const role = page.getByLabel(`Role for ${PERSONA_NAMES.tom}`);
      await expect(role).toHaveValue("viewer");
      await role.selectOption({ label: "Editor" });
      await expect(role).toHaveValue("editor");
      await page.reload();
      await expect(page.getByLabel(`Role for ${PERSONA_NAMES.tom}`)).toHaveValue("editor");
    });

    await test.step("now Tom can change the profile and correct a category", async () => {
      await tom.reload();
      await expect(
        tom.getByRole("heading", { name: "My job search", level: 1, exact: true }),
      ).toBeVisible();
      await expect(rename).toBeEnabled();
      await expect(removeEntry).toBeEnabled();
      await expect(
        tom.getByText("You can see the profile; only editors and admins can change it."),
      ).toHaveCount(0);

      await tomNav.getByRole("link", { name: "Inbox", exact: true }).click();
      await openMessage(tom, subjectOf(MARIA_KEY_MESSAGES.alwaysInvalid));
      const category = tom.getByLabel("Category", { exact: true });
      await expect(category).toBeEnabled();
      await category.selectOption({ label: "Other job mail" });
      await expect(category).toHaveValue("other_job");
      await expect(tom.getByText("Corrected by hand: later analysis keeps it.")).toBeVisible();
    });

    await test.step("Maria's switcher doesn't show Tom's workspace", async () => {
      const options = await page.getByLabel("Workspace").locator("option").allInnerTexts();
      expect(options).toEqual(["Maria's workspace"]);
    });

    await test.step("logs", async () => {
      await expect
        .poll(() => eventsSince(mark))
        .toEqual(
          expect.arrayContaining([
            "workspace.invite_created",
            "workspace.invite_accepted",
            "workspace.role_changed",
          ]),
        );
    });
  } finally {
    await tomApi.dispose();
    await tomContext.close();
  }
});
