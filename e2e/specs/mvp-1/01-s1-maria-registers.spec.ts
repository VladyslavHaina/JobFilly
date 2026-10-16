import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { PERSONA_ADDRESSES, PERSONA_NAMES } from "../../fixtures/format.ts";
import { ACCOUNTS } from "../../seed/accounts.ts";
import { COMPOSE_FILE, fileState } from "../../stack.ts";

// S1 of docs/mvp/MVP-1.md: Maria registers and connects her mailbox (F1.1, F1.2, F2.1–F2.3).
// She ends on "Pick your AI", where S2 goes on. The test stack's imap service speaks plain-text
// IMAP on port 3143 (docker/compose.e2e.yaml), which only the test stack allows (F2.4).

const LOGIN = "E2E-SECRET-maria-login";
const WRONG_PASSWORD = "E2E-SECRET-maria-wrong";

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

test("S1: Maria registers and connects her mailbox", async ({ page, playwright, baseURL }) => {
  const mark = REPLICAS.map((replica) => replicaLog(replica).length);

  await test.step("she creates her account from the start page", async () => {
    await page.goto("/");
    await page.getByRole("link", { name: "Create account" }).click();
    await page.getByLabel("Name").fill(PERSONA_NAMES.maria);
    await page.getByLabel("Email").fill(PERSONA_ADDRESSES.maria);
    await page.getByLabel("Password").fill(LOGIN);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(
      page.getByRole("heading", { name: "Connect your mailbox", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("in Maria's workspace")).toBeVisible();
    await expect(page.getByLabel("Workspace").locator("option:checked")).toHaveText(
      "Maria's workspace",
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
      page.getByRole("link", { name: "How to create an app password at Gmail" }),
    ).toHaveAttribute("href", /^https:\/\//);
  });

  const password = page.getByLabel("Password", { exact: true });
  const testConnection = page.getByRole("button", { name: "Test connection" });
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
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.getByRole("heading", { name: "Pick your AI", level: 1 })).toBeVisible();
  });

  const workspaceId = new URL(page.url()).pathname.split("/")[2] ?? "";

  await test.step("probe: the mailbox settings carry no password", async () => {
    const origin = new URL(baseURL ?? "http://127.0.0.1:8080").origin;
    const api = await playwright.request.newContext({
      baseURL: origin,
      extraHTTPHeaders: { Origin: origin },
    });
    try {
      const signIn = await api.post("/api/auth/sign-in", {
        data: { email: PERSONA_ADDRESSES.maria, password: LOGIN },
      });
      expect(signIn.status()).toBe(200);
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
