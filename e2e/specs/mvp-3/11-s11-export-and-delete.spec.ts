import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { PERSONA_ADDRESSES, PERSONA_NAMES } from "../../fixtures/format.ts";
import {
  apiContext,
  apiSignIn,
  errorsSince,
  LOGIN_PASSWORDS,
  logMark,
  logSince,
  memberRow,
  openPage,
  openSettingsTab,
  pgDump,
  signIn,
  submitSignIn,
  workspaceIdOf,
} from "../shared.ts";

// S11 of docs/mvp/MVP-3.md: export and delete (F7.1–F7.3, F9.2). Maria downloads her workspace
// from Settings › Data; the verification step unpacks the ZIP: a JSON file for every listed part,
// a manifest with the schema version, and her CV files. She removes Tom from her workspace; probe:
// Tom's session on the export's URL gets 404. Tom deletes his own workspace, typing its name and
// his password, and then his account from the Account page, which the header links to even with
// no workspace left (F7.3). He can't sign in any more, Maria's members don't list him, and her
// activity log shows what he did as "Deleted user". Afterwards a pg_dump holds neither his
// address nor his name.

const TOM = PERSONA_NAMES.tom;
const TOMS = `${TOM}'s workspace`;
/** F7.1's parts: one JSON file each. */
const PARTS = [
  "profiles",
  "rules",
  "cvs",
  "messages",
  "facts",
  "matches",
  "decisions",
  "drafts",
  "pipeline",
  "activity",
];

/**
 * The files of a ZIP, read from its central directory (stored or deflated entries, which is what
 * the export writes): the verification step's "unpacking a downloaded file", without a library.
 */
function unzip(zip: Buffer): Map<string, Buffer> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end, "the ZIP's end of central directory").toBeGreaterThanOrEqual(0);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at), "a central directory entry").toBe(0x02014b50);
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

test("S11: export and delete", async ({ page, browser, playwright, baseURL }) => {
  test.setTimeout(8 * 60_000);
  const mark = logMark();
  const tomContext = await browser.newContext({ baseURL });
  const tom = await tomContext.newPage();
  const tomApi = await apiContext(playwright.request, baseURL);

  try {
    await signIn(page, "maria");
    await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
    const workspaceId = workspaceIdOf(page);

    let cvNames: string[] = [];
    await test.step("her CVs, as the CVs page lists them", async () => {
      await openPage(page, "CVs");
      await expect(page.getByRole("heading", { name: "CVs", level: 1, exact: true })).toBeVisible();
      const headings = page.getByRole("heading", { level: 2 });
      await expect(headings.first()).toBeVisible();
      cvNames = (await headings.allInnerTexts()).map((t) => t.trim());
      expect(cvNames.length).toBeGreaterThan(0);
    });

    let exportUrl = "";
    let files = new Map<string, Buffer>();
    await test.step("she downloads the workspace as one ZIP from Settings › Data", async () => {
      await openSettingsTab(page, "Data");
      await expect(
        page.getByRole("heading", { name: "Download your data", level: 2, exact: true }),
      ).toBeVisible();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("link", { name: "Download ZIP", exact: true }).click(),
      ]);
      exportUrl = new URL(download.url()).pathname;
      expect(exportUrl).toBe(`/api/workspaces/${workspaceId}/export`);
      expect(download.suggestedFilename()).toMatch(/\.zip$/);
      const path = test.info().outputPath("export.zip");
      await download.saveAs(path);
      files = unzip(readFileSync(path));
    });

    await test.step("verification: the ZIP has every listed part, CVs included", async () => {
      const manifest = JSON.parse(files.get("manifest.json")?.toString("utf8") ?? "null") as {
        schemaVersion?: unknown;
        workspaceName?: unknown;
        parts?: string[];
        cvFiles?: string[];
      } | null;
      expect(typeof manifest?.schemaVersion).toBe("number");
      expect(manifest?.workspaceName).toBe(`${PERSONA_NAMES.maria}'s workspace`);
      expect([...(manifest?.parts ?? [])].sort()).toEqual([...PARTS].sort());
      for (const part of PARTS) {
        const file = files.get(`${part}.json`);
        expect(file, `${part}.json`).toBeDefined();
        expect(() => JSON.parse(file?.toString("utf8") ?? ""), `${part}.json`).not.toThrow();
      }
      const cvFiles = manifest?.cvFiles ?? [];
      expect(cvFiles).toHaveLength(cvNames.length);
      for (const name of cvNames) {
        expect(
          cvFiles.some((f) => new RegExp(`^cvs/[^/]*${name}\\.[a-z]+$`).test(f)),
          name,
        ).toBe(true);
      }
      for (const file of cvFiles) expect(files.get(file)?.length, file).toBeGreaterThan(0);
      // Never message bodies or secrets.
      for (const [name, content] of files) {
        if (!name.endsWith(".json")) continue;
        const text = content.toString("utf8");
        expect(text, name).not.toContain("BODYSENTINEL-");
        expect(text, name).not.toContain("E2E-SECRET-");
      }
    });

    await test.step(`Maria removes ${TOM} from her workspace`, async () => {
      await openPage(page, "Members");
      await expect(memberRow(page, "tom")).toHaveCount(1);
      await page.getByRole("button", { name: `Remove ${TOM}`, exact: true }).click();
      await expect(memberRow(page, "tom")).toHaveCount(0);
    });

    await test.step("probe: Tom's session on Maria's export URL gets 404", async () => {
      await apiSignIn(tomApi, "tom");
      expect((await tomApi.get(exportUrl)).status()).toBe(404);
    });

    await test.step("Tom deletes his own workspace, typing its name", async () => {
      await signIn(tom, "tom");
      await expect(tom.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
      const options = await tom.getByLabel("Workspace").locator("option").allTextContents();
      expect(options).toEqual([TOMS]);
      await openSettingsTab(tom, "Data");
      await expect(tom.getByText("Drafts and mail in your mailbox stay there.")).toBeVisible();
      const remove = tom.getByRole("button", { name: "Delete workspace", exact: true });
      await tom.getByLabel(`Type ${TOMS} to confirm`, { exact: true }).fill(TOMS);
      await expect(remove).toBeDisabled();
      await tom.getByLabel("Your password", { exact: true }).fill(LOGIN_PASSWORDS.tom);
      await remove.click();
      await expect(tom).toHaveURL(/\/invitations$/);
      await expect(tom.getByText("No invitations waiting for you.", { exact: true })).toBeVisible();
    });

    await test.step("Tom deletes his account; he can't sign in any more", async () => {
      // The header's link to his account, with no workspace left.
      await tom.getByRole("link", { name: TOM, exact: true }).click();
      await expect(
        tom.getByRole("heading", { name: "Your account", level: 1, exact: true }),
      ).toBeVisible();
      await expect(
        tom.getByRole("list", { name: "Workspaces deleted with your account", exact: true }),
      ).toHaveCount(0);
      await tom.getByLabel("Your password", { exact: true }).fill(LOGIN_PASSWORDS.tom);
      await tom.getByRole("button", { name: "Delete my account", exact: true }).click();
      await expect(tom).toHaveURL(/\/sign-in$/);
      await submitSignIn(tom, "tom");
      await expect(tom.getByText("Email or password is incorrect")).toBeVisible();
    });

    await test.step("Maria's members don't list him; her activity log shows him as Deleted user", async () => {
      await openPage(page, "Members");
      await expect(memberRow(page, "maria")).toHaveCount(1);
      await expect(memberRow(page, "tom")).toHaveCount(0);
      await expect(page.getByText(TOM)).toHaveCount(0);
      await openPage(page, "Activity");
      const log = page.getByRole("list", { name: "Activity", exact: true });
      await expect(
        log.getByRole("listitem").filter({ hasText: "Removed Deleted user from the workspace" }),
      ).toHaveCount(1);
      // What he did himself (S8: he handed the workspace back).
      await expect(
        log
          .getByRole("listitem")
          .filter({ hasText: `Handed the workspace over to ${PERSONA_NAMES.maria}` })
          .filter({ hasText: "Deleted user" }),
      ).toHaveCount(1);
      await expect(log).not.toContainText(TOM);
    });

    await test.step("verification: a pg_dump holds neither his address nor his name", async () => {
      const dump = pgDump();
      expect(dump.length).toBeGreaterThan(0);
      expect(dump).not.toContain(PERSONA_ADDRESSES.tom);
      expect(dump).not.toContain(TOM);
      expect(dump).not.toContain("Okafor");
    });

    await test.step("logs: export, removal, workspace and account deleted; no errors", async () => {
      const events = logSince(mark).map((l) => l.event);
      for (const event of [
        "export.completed",
        "member.removed",
        "workspace.deleted",
        "account.deleted",
      ]) {
        expect(events, event).toContain(event);
      }
      // His sign-in after the account was gone, refused: a warning, as expected.
      const failed = logSince(mark).filter((l) => l.event === "auth.sign_in_failed");
      expect(failed.length).toBeGreaterThan(0);
      expect(failed.every((l) => l.level === "warn")).toBe(true);
      expect(errorsSince(mark)).toEqual([]);
    });
  } finally {
    await tomApi.dispose();
    await tomContext.close();
  }
});
