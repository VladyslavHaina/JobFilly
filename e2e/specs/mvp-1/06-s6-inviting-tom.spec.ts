import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
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
import { COMPOSE_FILE, fileState } from "../../stack.ts";

// S6 of docs/mvp/MVP-1.md: inviting Tom, roles enforced (F1.6–F1.9, F6.7). Maria and Tom each
// have a browser context of their own. As an editor, Tom corrects the category of the message
// the AI couldn't analyze (the one Maria set in S5), so no analysed category changes hands.

const MARIA_LOGIN = "E2E-SECRET-maria-login";
const TOM_LOGIN = "E2E-SECRET-tom-login";

const dir = fixturesDir();
const expected = readJson<ExpectedFile>(`${dir}${personaPaths("maria").expected}`);
const envelopes = readJson<EnvelopeEntry[]>(`${dir}${personaPaths("maria").envelopes}`);
const subjectOf = (messageId: string) =>
  envelopes.find((e) => e.messageId === messageId)?.subject ?? messageId;

const ROOT = resolve(import.meta.dirname, "../../..");
/** The running stack's compose project: the one stack.ts passes on, else e2e/.stack's. */
const project = process.env.JOBFILLY_E2E_PROJECT ?? fileState(join(ROOT, "e2e", ".stack")).read();
const REPLICAS = ["app-a", "app-b"];
type LogLine = { event?: unknown; [field: string]: unknown };

function replicaLog(replica: string): LogLine[] {
  if (!project) throw new Error('No test stack is up: start one with "pnpm e2e:stack up"');
  const args = ["compose", "-p", project, "-f", COMPOSE_FILE, "logs", "--no-color"];
  const out = execFileSync("docker", [...args, "--no-log-prefix", replica], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  return out.split("\n").flatMap((line) => {
    try {
      return line.startsWith("{") ? [JSON.parse(line) as LogLine] : [];
    } catch {
      return [];
    }
  });
}

/** The events both replicas logged since `mark` (each replica's line count then). */
const eventsSince = (mark: number[]) =>
  REPLICAS.flatMap((replica, i) =>
    replicaLog(replica)
      .slice(mark[i])
      .map((l) => l.event),
  );

/** Opens a message of the job inbox by finding its subject with the search field. */
async function open(page: Page, messageId: string) {
  const subject = subjectOf(messageId);
  await page.getByLabel("Search sender or subject").fill(subject);
  await page
    .getByRole("list", { name: "Messages" })
    .getByRole("link")
    .filter({ hasText: subject })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: subject, level: 2, exact: true })).toBeVisible();
}

test("S6: inviting Tom, roles enforced", async ({ page, browser, playwright, baseURL }) => {
  test.setTimeout(5 * 60_000);
  const mark = REPLICAS.map((replica) => replicaLog(replica).length);
  const origin = new URL(baseURL ?? "http://127.0.0.1:8080").origin;
  const tomContext = await browser.newContext({ baseURL: origin });
  const tom = await tomContext.newPage();
  const tomApi = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });

  try {
    await test.step("Tom registers in a browser of his own", async () => {
      await tom.goto("/");
      await tom.getByRole("link", { name: "Create account" }).click();
      await tom.getByLabel("Name").fill(PERSONA_NAMES.tom);
      await tom.getByLabel("Email").fill(PERSONA_ADDRESSES.tom);
      await tom.getByLabel("Password").fill(TOM_LOGIN);
      await tom.getByRole("button", { name: "Create account" }).click();
      await expect(
        tom.getByRole("heading", { name: "Connect your mailbox", level: 1 }),
      ).toBeVisible();
      await expect(tom.getByText("in Tom's workspace")).toBeVisible();
    });

    await page.goto("/");
    await page.getByLabel("Email").fill(PERSONA_ADDRESSES.maria);
    await page.getByLabel("Password").fill(MARIA_LOGIN);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Job inbox" })).toBeVisible();
    const mariaWorkspace = new URL(page.url()).pathname.split("/")[2] ?? "";
    const message = MARIA_KEY_MESSAGES.germanRecruiter;
    const categoryUrl = `/api/workspaces/${mariaWorkspace}/messages/${encodeURIComponent(message)}/category`;
    const correction = { data: { category: expected.messages[message]?.category } };

    await test.step("probe: Tom on one of Maria's workspace URLs gets 404", async () => {
      const signIn = await tomApi.post("/api/auth/sign-in", {
        data: { email: PERSONA_ADDRESSES.tom, password: TOM_LOGIN },
      });
      expect(signIn.status()).toBe(200);
      expect((await tomApi.get(`/api/workspaces/${mariaWorkspace}/messages`)).status()).toBe(404);
      expect((await tomApi.put(categoryUrl, correction)).status()).toBe(404);
    });

    await test.step("Maria invites Tom as a viewer", async () => {
      await page
        .getByRole("navigation", { name: "Main" })
        .getByRole("link", { name: "Members" })
        .click();
      await page.getByLabel("Email").fill(PERSONA_ADDRESSES.tom);
      await page.getByLabel("Role", { exact: true }).selectOption({ label: "Viewer" });
      await page.getByRole("button", { name: "Send invite" }).click();
      await expect(page.getByText(`Invited ${PERSONA_ADDRESSES.tom} as Viewer`)).toBeVisible();
      await expect(page.getByLabel("Invite link")).toHaveValue(/^http/);
    });

    await test.step("Tom sees the invitation, accepts it and lands in Maria's inbox", async () => {
      await tom.reload();
      const invitation = tom.getByText("Maria invited you to “Maria's workspace” as a viewer");
      await expect(invitation).toBeVisible();
      await tom.getByRole("button", { name: "Accept" }).click();
      await expect(tom.getByRole("heading", { name: "Job inbox" })).toBeVisible();
      await expect(tom.getByLabel("Workspace").locator("option:checked")).toHaveText(
        "Maria's workspace",
      );
      await expect(
        tom.getByRole("list", { name: "Messages" }).getByRole("link").first(),
      ).toBeVisible();
    });

    await test.step("as a viewer, correcting and confirming are disabled", async () => {
      await open(tom, message);
      await expect(tom.getByLabel("Category", { exact: true })).toBeDisabled();
      await expect(
        tom.getByText("Only editors and admins can correct the category."),
      ).toBeVisible();
      const nav = tom.getByRole("navigation", { name: "Main" });
      await expect(nav.getByRole("link", { name: "Members" })).toHaveCount(0);
      await nav.getByRole("link", { name: "Intake" }).click();
      await expect(tom.getByRole("heading", { name: "Your job search" })).toBeVisible();
      await expect(tom.getByRole("button", { name: "Confirm" })).toHaveCount(0);
      await expect(tom.getByRole("button", { name: /^Remove / }).first()).toBeDisabled();
      await nav.getByRole("link", { name: "Profile" }).click();
      await expect(
        tom.getByText("You can see the profile; only editors and admins can change it."),
      ).toBeVisible();
      await expect(tom.getByRole("button", { name: "Rename" })).toBeDisabled();
      await expect(tom.getByRole("button", { name: /^Remove / }).first()).toBeDisabled();
    });

    await test.step("probe: Tom correcting a category gets 403", async () => {
      expect((await tomApi.put(categoryUrl, correction)).status()).toBe(403);
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

    await test.step("now Tom can correct a category", async () => {
      await tom
        .getByRole("navigation", { name: "Main" })
        .getByRole("link", { name: "Inbox" })
        .click();
      await tom.reload();
      await open(tom, MARIA_KEY_MESSAGES.alwaysInvalid);
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
