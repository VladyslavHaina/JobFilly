import { expect, type Page, test } from "@playwright/test";
import {
  type ExpectedFileMvp2,
  fixturesDir,
  type Persona,
  personaPaths,
  readJson,
} from "../../fixtures/format.ts";
import {
  apiContext,
  apiSignIn,
  cvFiles,
  cvName,
  errorsSince,
  logMark,
  logSince,
  openPage,
  signIn,
  workspaceIdOf,
} from "../shared.ts";

// S1 of docs/mvp/MVP-2.md: CVs (F2.1, F2.2, F2.4), after MVP 1's end state. Maria uploads her
// three CVs with the file picker, Tom his one in his own workspace. The CVs page asks for no
// name, so each CV is named after its file ("backend-en"); expected.json names them as cvs.json
// does ("Backend (EN)"), and cvName maps one to the other. Preferred CV is a switch on the CV
// (TBD-439), not a tag. F2.4 (files in Postgres, never on a replica's disk) is proven outside
// the walkthrough, by apps/server/src/cvs/no-disk.test.ts and the read-only root filesystem.

const expectedOf = (persona: Persona) =>
  readJson<ExpectedFileMvp2>(`${fixturesDir()}${personaPaths(persona).expected}`);

/** A CV's card on the CVs page, found by its name. */
const cvCard = (page: Page, name: string) =>
  page.getByRole("heading", { name, level: 2, exact: true }).locator("xpath=ancestor::section[1]");

/** Uploads the persona's CVs and checks each one's suggested tags and skills (F2.1, F2.2). */
async function uploadCvs(page: Page, persona: Persona) {
  await openPage(page, "CVs");
  await expect(page.getByRole("heading", { name: "CVs", level: 1, exact: true })).toBeVisible();
  await page.getByLabel("Upload CVs", { exact: true }).setInputFiles(cvFiles(persona));

  for (const cv of expectedOf(persona).cvs) {
    const name = cvName(persona, cv.name);
    const card = cvCard(page, name);
    const tags = card.getByRole("list", { name: `Tags for ${name}`, exact: true });
    // Read by the AI after the upload: the tags come with the read.
    for (const tag of cv.tags) {
      await expect(tags.getByRole("button", { name: `Remove ${tag}`, exact: true })).toBeVisible({
        timeout: 60_000,
      });
    }
    const skills = card.getByRole("list", { name: `Skills in ${name}`, exact: true });
    for (const skill of cv.skills) {
      await expect(
        skills.getByRole("button", { name: `Remove ${skill}`, exact: true }),
      ).toBeVisible();
    }
    if (cv.droppedSkill) {
      // The skill the fake AI invented isn't in the CV's text, so it is dropped (F2.2).
      await expect(card).not.toContainText(cv.droppedSkill);
    }
    await expect(
      card
        .getByRole("list", { name: `Format of ${name}`, exact: true })
        .getByRole("listitem")
        .first(),
    ).toBeVisible();
  }
}

test("S1: CVs", async ({ page, browser, playwright, baseURL }) => {
  test.setTimeout(5 * 60_000);
  const mark = logMark();
  const tomContext = await browser.newContext({ baseURL });
  const tom = await tomContext.newPage();
  const mariaApi = await apiContext(playwright.request, baseURL);
  const tomApi = await apiContext(playwright.request, baseURL);

  try {
    await signIn(page, "maria");
    await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
    const mariaWorkspace = workspaceIdOf(page);

    await test.step("Maria uploads her three CVs; each shows its suggested tags", async () => {
      await uploadCvs(page, "maria");
    });

    const backendEn = cvName("maria", "Backend (EN)");
    await test.step("she adds a tag of her own and turns on Preferred CV for Backend (EN)", async () => {
      const card = cvCard(page, backendEn);
      const tags = card.getByRole("list", { name: `Tags for ${backendEn}`, exact: true });
      await card
        .getByRole("textbox", { name: `Tags for ${backendEn}`, exact: true })
        .fill("remote");
      await page.keyboard.press("Enter");
      await expect(tags.getByRole("button", { name: "Remove remote", exact: true })).toBeVisible();

      const preferred = card.getByRole("switch", { name: "Preferred CV", exact: true });
      await expect(preferred).toHaveAttribute("aria-checked", "false");
      await preferred.click();
      await expect(preferred).toHaveAttribute("aria-checked", "true");
      await page.reload();
      await expect(preferred).toHaveAttribute("aria-checked", "true");
      await expect(tags.getByRole("button", { name: "Remove remote", exact: true })).toBeVisible();
      // Only that one is preferred.
      for (const cv of expectedOf("maria").cvs) {
        const name = cvName("maria", cv.name);
        if (name === backendEn) continue;
        await expect(
          cvCard(page, name).getByRole("switch", { name: "Preferred CV", exact: true }),
        ).toHaveAttribute("aria-checked", "false");
      }
    });

    await test.step("the profile page lists all three", async () => {
      await openPage(page, "Profile");
      const list = page.getByRole("list", { name: "CVs", exact: true });
      const names = expectedOf("maria").cvs.map((cv) => cvName("maria", cv.name));
      await expect(list.getByRole("listitem")).toHaveCount(names.length);
      for (const name of names) await expect(list).toContainText(name);
    });

    let tomWorkspace = "";
    await test.step("Tom uploads his CV in his own workspace", async () => {
      await signIn(tom, "tom");
      await expect(tom.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
      await expect(tom.getByLabel("Workspace").locator("option:checked")).toHaveText(
        "Tom Okafor's workspace",
      );
      tomWorkspace = workspaceIdOf(tom);
      await uploadCvs(tom, "tom");
    });

    await test.step("probe: Maria's session downloading Tom's CV gets 404", async () => {
      await apiSignIn(tomApi, "tom");
      const listed = await tomApi.get(`/api/workspaces/${tomWorkspace}/cvs`);
      expect(listed.status()).toBe(200);
      const { items } = (await listed.json()) as { items: { id: string }[] };
      expect(items).toHaveLength(1);
      const file = (workspace: string) => `/api/workspaces/${workspace}/cvs/${items[0]?.id}/file`;
      // The control: Tom gets his own CV.
      expect((await tomApi.get(file(tomWorkspace))).status()).toBe(200);

      await apiSignIn(mariaApi, "maria");
      expect((await mariaApi.get(file(tomWorkspace))).status()).toBe(404);
      // Nor under her own workspace's URL.
      expect((await mariaApi.get(file(mariaWorkspace))).status()).toBe(404);
    });

    await test.step("logs: cv.uploaded ×4, cv.skill_dropped, no errors", async () => {
      await expect
        .poll(() => logSince(mark).filter((l) => l.event === "cv.uploaded").length)
        .toBe(4);
      const dropped = logSince(mark).filter((l) => l.event === "cv.skill_dropped");
      expect(dropped.length).toBeGreaterThan(0);
      expect(dropped.every((l) => l.level === "warn")).toBe(true);
      expect(errorsSince(mark)).toEqual([]);
    });
  } finally {
    await Promise.all([mariaApi.dispose(), tomApi.dispose()]);
    await tomContext.close();
  }
});
