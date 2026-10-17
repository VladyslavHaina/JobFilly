import { expect, type Page, test } from "@playwright/test";
import { PERSONA_ADDRESSES, PERSONA_NAMES } from "../../fixtures/format.ts";
import {
  apiContext,
  apiSignIn,
  errorsSince,
  logMark,
  logSince,
  memberRow,
  openPage,
  signIn,
  workspaceIdOf,
} from "../shared.ts";

// S8 of docs/mvp/MVP-3.md: members (F6.3). Maria makes Tom an admin who sees everything; Tom can
// then manage members (the invite form, other members' roles), but Maria's row, the owner's, has
// nothing to change or remove, and the server refuses removing her (probe with Tom's session).
// Maria hands ownership to Tom, Tom hands it back, and Maria sets Tom back to Editor.

const MARIA = PERSONA_NAMES.maria;
const TOM = PERSONA_NAMES.tom;
const MARIAS = `${MARIA}'s workspace`;

const handOver = (page: Page, to: string) =>
  page.getByRole("dialog", { name: `Hand ${MARIAS} over to ${to}?`, exact: true });

test("S8: members", async ({ page, browser, playwright, baseURL }) => {
  test.setTimeout(6 * 60_000);
  const mark = logMark();
  const tomContext = await browser.newContext({ baseURL });
  const tom = await tomContext.newPage();
  const tomApi = await apiContext(playwright.request, baseURL);

  try {
    await signIn(page, "maria");
    await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
    const workspaceId = workspaceIdOf(page);

    await test.step("Maria makes Tom an admin who sees everything", async () => {
      await openPage(page, "Members");
      const role = page.getByLabel(`Role for ${TOM}`, { exact: true });
      const sees = page.getByLabel(`What ${TOM} sees`, { exact: true });
      await role.selectOption({ label: "Admin" });
      await expect(role).toHaveValue("admin");
      await sees.selectOption({ label: "Everything" });
      await expect(sees).toHaveValue("everything");
      await page.reload();
      await expect(page.getByLabel(`Role for ${TOM}`, { exact: true })).toHaveValue("admin");
      await expect(page.getByLabel(`What ${TOM} sees`, { exact: true })).toHaveValue("everything");
      await expect(memberRow(page, "maria")).toContainText(`${MARIA} (you), Owner`);
    });

    await test.step("Tom can manage members, but not the owner", async () => {
      await signIn(tom, "tom");
      await expect(tom.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
      await tom.getByLabel("Workspace").selectOption({ label: MARIAS });
      await expect(tom.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
      await openPage(tom, "Members");
      await expect(
        tom.getByRole("heading", { name: "Invite someone", level: 2, exact: true }),
      ).toBeVisible();
      const owner = memberRow(tom, "maria");
      await expect(owner).toContainText(`${MARIA}, Owner`);
      await expect(owner).toContainText("Admin · Everything");
      await expect(owner.getByRole("combobox")).toHaveCount(0);
      await expect(tom.getByRole("button", { name: `Remove ${MARIA}`, exact: true })).toHaveCount(
        0,
      );
      await expect(memberRow(tom, "tom")).toContainText(`${TOM} (you)`);
    });

    await test.step("probe: Tom removing Maria, the owner, is refused", async () => {
      await apiSignIn(tomApi, "tom");
      const listed = await tomApi.get(`/api/workspaces/${workspaceId}/members`);
      expect(listed.status()).toBe(200);
      const { items } = (await listed.json()) as { items: { userId: string; email: string }[] };
      const maria = items.find((m) => m.email === PERSONA_ADDRESSES.maria);
      expect(maria, "Maria is a member").toBeDefined();
      const removed = await tomApi.delete(
        `/api/workspaces/${workspaceId}/members/${maria?.userId}`,
      );
      expect(removed.status()).toBe(409);
      await tom.reload();
      await expect(memberRow(tom, "maria")).toContainText(`${MARIA}, Owner`);
    });

    await test.step("Maria hands ownership to Tom", async () => {
      await page.reload();
      await memberRow(page, "tom").getByRole("button", { name: "Make owner", exact: true }).click();
      const dialog = handOver(page, TOM);
      await expect(dialog).toContainText(`${TOM} becomes the owner and always sees everything.`);
      await dialog.getByRole("button", { name: `Make ${TOM} the owner`, exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(memberRow(page, "tom")).toContainText(`${TOM}, Owner`);
      await expect(memberRow(page, "maria")).not.toContainText("Owner");
    });

    await test.step("Tom hands it back to Maria", async () => {
      await tom.reload();
      await expect(memberRow(tom, "tom")).toContainText(`${TOM} (you), Owner`);
      await memberRow(tom, "maria")
        .getByRole("button", { name: "Make owner", exact: true })
        .click();
      const dialog = handOver(tom, MARIA);
      await dialog.getByRole("button", { name: `Make ${MARIA} the owner`, exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(memberRow(tom, "maria")).toContainText(`${MARIA}, Owner`);
    });

    await test.step("Maria sets Tom back to Editor", async () => {
      await page.reload();
      await expect(memberRow(page, "maria")).toContainText(`${MARIA} (you), Owner`);
      const role = page.getByLabel(`Role for ${TOM}`, { exact: true });
      await role.selectOption({ label: "Editor" });
      await expect(role).toHaveValue("editor");
      await page.reload();
      await expect(page.getByLabel(`Role for ${TOM}`, { exact: true })).toHaveValue("editor");
      await expect(page.getByLabel(`What ${TOM} sees`, { exact: true })).toHaveValue("everything");
    });

    await test.step("logs: member.role_changed, workspace.ownership_transferred ×2, no errors", async () => {
      const mine = logSince(mark).filter((l) => l.workspaceId === workspaceId);
      expect(mine.filter((l) => l.event === "member.role_changed").length).toBeGreaterThanOrEqual(
        2,
      );
      expect(mine.filter((l) => l.event === "workspace.ownership_transferred")).toHaveLength(2);
      expect(errorsSince(mark)).toEqual([]);
    });
  } finally {
    await tomApi.dispose();
    await tomContext.close();
  }
});
